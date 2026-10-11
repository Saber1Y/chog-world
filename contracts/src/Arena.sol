// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ChogState} from "./ChogState.sol";
import {Treasury} from "./Treasury.sol";
import {GameBase} from "./GameBase.sol";
import {BattleEngine} from "./libraries/BattleEngine.sol";

/// @title Arena
/// @notice Asynchronous Chog vs Chog battles. The attacker's token-bound account escrows a fee and
///         fights the defender's live stats; the defender does not need to be online. Defenders earn a
///         bounty when they hold, so a Chog keeps earning while its owner is away.
contract Arena is AccessControl, GameBase {
    using SafeERC20 for IERC20;

    struct Battle {
        bytes32 attKey;
        bytes32 defKey;
        address attCollection;
        uint256 attId;
        address defCollection;
        uint256 defId;
        uint256 fee;
        uint64 startBlock;
        bool resolved;
    }

    struct Settlement {
        bytes32 winKey;
        bytes32 loseKey;
        int32 repDelta;
        uint256 payout;
    }

    uint64 public constant SEED_DELAY = 2;
    uint64 public constant PAIR_COOLDOWN = 1 hours;
    uint8 public constant DEFENDER_MAX_PER_HOUR = 3;
    uint64 public constant LOSER_INJURY = 30 minutes;
    uint16 public constant WIN_BONUS_BPS = 7_000;
    uint16 public constant BOUNTY_BPS = 5_000;
    uint16 public constant RIVALRY_THRESHOLD = 3;
    uint16 public constant UNBROKEN_STREAK = 5;
    uint16 public constant GIANT_GAP = 5;
    uint32 public constant WIN_XP = 30;
    uint32 public constant LOSS_XP = 10;

    uint8 public constant REP_ARENA_WIN = 3;
    uint8 public constant REP_ARENA_LOSS = 4;

    uint256[3] public tierFee = [uint256(10 ether), 50 ether, 200 ether];

    mapping(uint64 battleId => Battle) public battles;
    uint64 public nextBattleId = 1;
    mapping(bytes32 key => uint64 battleId) public pendingBattle;
    mapping(bytes32 pairKey => uint64) public lastPairFight;
    mapping(bytes32 pairKey => uint16) public rivalry;
    mapping(bytes32 key => uint64) public defenderWindowStart;
    mapping(bytes32 key => uint8) public defenderWindowCount;
    mapping(bytes32 key => uint16) public defenseStreak;

    event BattleStarted(
        uint64 indexed battleId,
        bytes32 indexed attKey,
        bytes32 indexed defKey,
        uint8 tier,
        uint256 fee,
        uint64 startBlock
    );
    event BattleResolved(
        uint64 indexed battleId,
        bytes32 indexed winKey,
        bytes32 indexed loseKey,
        bool attackerWon,
        bytes32 seed,
        uint8 rounds,
        uint256 hpAttacker,
        uint256 hpDefender,
        bytes32 logHash,
        int32 repDelta,
        uint256 payout
    );
    event BattleVoided(uint64 indexed battleId);
    event RivalryUpdated(bytes32 indexed pairKey, bytes32 indexed a, bytes32 indexed b, uint16 fights);

    error BadTier();
    error NotAwakened();
    error SelfBattle();
    error SameOwner();
    error ChogInjured();
    error DefenderInjured();
    error BattlePending();
    error PairCooldown();
    error DefenderBusy();
    error UnknownBattle();
    error AlreadyResolved();
    error SeedNotReady();

    constructor(address admin, ChogState state_, Treasury treasury_) GameBase(state_, treasury_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    function pairKeyOf(bytes32 a, bytes32 b) public pure returns (bytes32) {
        return a < b ? keccak256(abi.encode(a, b)) : keccak256(abi.encode(b, a));
    }

    /// @notice Challenge another Chog. The caller must be a Chog's token-bound account; it escrows the fee.
    function attack(address defCollection, uint256 defId, uint8 tier) external returns (uint64 battleId) {
        if (tier >= 3) revert BadTier();
        (address attCollection, uint256 attId) = state.resolveAccount(msg.sender);
        bytes32 attKey = state.keyOf(attCollection, attId);
        bytes32 defKey = state.keyOf(defCollection, defId);
        _checkAttack(attCollection, attId, attKey, defCollection, defId, defKey);

        uint256 fee = tierFee[tier];
        chog.safeTransferFrom(msg.sender, address(this), fee);

        battleId = nextBattleId++;
        battles[battleId] = Battle({
            attKey: attKey,
            defKey: defKey,
            attCollection: attCollection,
            attId: attId,
            defCollection: defCollection,
            defId: defId,
            fee: fee,
            startBlock: uint64(block.number),
            resolved: false
        });
        pendingBattle[attKey] = battleId;
        lastPairFight[pairKeyOf(attKey, defKey)] = uint64(block.timestamp);
        emit BattleStarted(battleId, attKey, defKey, tier, fee, uint64(block.number));
    }

    function canResolve(uint64 battleId) external view returns (bool) {
        Battle memory b = battles[battleId];
        return b.startBlock != 0 && !b.resolved && block.number > b.startBlock + SEED_DELAY;
    }

    /// @notice Settle a battle. Callable by anyone once the seed block exists.
    function resolveBattle(uint64 battleId) external {
        Battle storage b = battles[battleId];
        if (b.startBlock == 0) revert UnknownBattle();
        if (b.resolved) revert AlreadyResolved();
        if (block.number <= b.startBlock + SEED_DELAY) revert SeedNotReady();
        b.resolved = true;
        delete pendingBattle[b.attKey];

        bytes32 bh = blockhash(b.startBlock + SEED_DELAY);
        if (bh == bytes32(0)) {
            // Seed window missed: void and refund rather than let a late resolver pick the outcome.
            chog.safeTransfer(state.accountOf(b.attCollection, b.attId), b.fee);
            emit BattleVoided(battleId);
            return;
        }
        bytes32 seed = keccak256(abi.encode(bh, battleId));

        BattleEngine.Result memory res = BattleEngine.simulate(
            state.combatStats(b.attCollection, b.attId), state.combatStats(b.defCollection, b.defId), seed
        );
        Settlement memory s = _settle(b, res.aWins);
        emit BattleResolved(
            battleId,
            s.winKey,
            s.loseKey,
            res.aWins,
            seed,
            res.rounds,
            res.hpA,
            res.hpB,
            res.logHash,
            s.repDelta,
            s.payout
        );
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setTierFee(uint8 tier, uint256 fee) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (tier >= 3) revert BadTier();
        tierFee[tier] = fee;
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _checkAttack(
        address attCollection,
        uint256 attId,
        bytes32 attKey,
        address defCollection,
        uint256 defId,
        bytes32 defKey
    ) internal {
        if (attKey == defKey) revert SelfBattle();
        if (!state.isAwakened(attKey) || !state.isAwakened(defKey)) revert NotAwakened();
        if (state.ownerOfChog(attCollection, attId) == state.ownerOfChog(defCollection, defId)) revert SameOwner();
        if (state.isInjured(attKey)) revert ChogInjured();
        if (state.isInjured(defKey)) revert DefenderInjured();
        if (pendingBattle[attKey] != 0) revert BattlePending();

        uint64 lastFight = lastPairFight[pairKeyOf(attKey, defKey)];
        if (lastFight != 0 && block.timestamp < uint256(lastFight) + PAIR_COOLDOWN) revert PairCooldown();

        if (block.timestamp >= uint256(defenderWindowStart[defKey]) + 1 hours) {
            defenderWindowStart[defKey] = uint64(block.timestamp);
            defenderWindowCount[defKey] = 0;
        }
        if (defenderWindowCount[defKey] >= DEFENDER_MAX_PER_HOUR) revert DefenderBusy();
        defenderWindowCount[defKey] += 1;
    }

    function _settle(Battle storage b, bool attackerWon) internal returns (Settlement memory s) {
        (s.winKey, s.loseKey) = attackerWon ? (b.attKey, b.defKey) : (b.defKey, b.attKey);
        s.payout = _pay(b, attackerWon);

        uint16 winLevel = state.levelOf(s.winKey);
        uint16 loseLevel = state.levelOf(s.loseKey);
        s.repDelta = _repDelta(state.repOf(s.winKey), state.repOf(s.loseKey));
        state.adjustRep(s.winKey, s.repDelta, REP_ARENA_WIN);
        state.adjustRep(s.loseKey, -(s.repDelta / 2), REP_ARENA_LOSS);
        state.recordBattle(s.winKey, true);
        state.recordBattle(s.loseKey, false);
        state.grantXp(s.winKey, WIN_XP);
        state.grantXp(s.loseKey, LOSS_XP);
        state.injure(s.loseKey, LOSER_INJURY);

        if (uint256(winLevel) + GIANT_GAP <= loseLevel) state.awardTitle(s.winKey, state.TITLE_GIANT_SLAYER());
        if (attackerWon) {
            defenseStreak[b.defKey] = 0;
        } else {
            defenseStreak[b.defKey] += 1;
            if (defenseStreak[b.defKey] >= UNBROKEN_STREAK) state.awardTitle(b.defKey, state.TITLE_UNBROKEN());
        }

        bytes32 pk = pairKeyOf(b.attKey, b.defKey);
        rivalry[pk] += 1;
        emit RivalryUpdated(pk, b.attKey, b.defKey, rivalry[pk]);
    }

    /// @dev Attacker wins: fee back minus burn, plus a Treasury bonus. Defender wins: the defender's
    ///      account takes a bounty, the burn share is burned and the rest funds the Treasury.
    function _pay(Battle storage b, bool attackerWon) internal returns (uint256 payout) {
        uint256 fee = b.fee;
        uint256 burned = fee * treasury.burnBps() / 10_000;
        if (burned > 0) chog.safeTransfer(BURN_ADDRESS, burned);

        if (attackerWon) {
            address att = state.accountOf(b.attCollection, b.attId);
            chog.safeTransfer(att, fee - burned);
            payout = fee - burned + treasury.pay(att, fee * WIN_BONUS_BPS / 10_000);
        } else {
            uint256 bounty = fee * BOUNTY_BPS / 10_000;
            chog.safeTransfer(state.accountOf(b.defCollection, b.defId), bounty);
            chog.safeTransfer(address(treasury), fee - burned - bounty);
            payout = bounty;
        }
    }

    function _repDelta(int32 winnerRep, int32 loserRep) internal pure returns (int32 d) {
        d = 16 + (loserRep - winnerRep) / 25;
        if (d < 4) d = 4;
        if (d > 32) d = 32;
    }
}
