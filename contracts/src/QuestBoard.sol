// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ChogState} from "./ChogState.sol";
import {ChogItems} from "./ChogItems.sol";
import {Treasury} from "./Treasury.sol";
import {GameBase} from "./GameBase.sol";
import {Stats} from "./libraries/ChogDNA.sol";
import {BattleEngine} from "./libraries/BattleEngine.sol";

/// @title QuestBoard
/// @notice Quests a Chog's token-bound account can start. Outcomes use a seed from a block hash that
///         did not exist when the quest started, and anyone can resolve once it is available.
contract QuestBoard is AccessControl, GameBase {
    enum Kind {
        HUNT,
        EXPLORE,
        TRAIN
    }

    struct Quest {
        uint128 fee;
        uint128 rewardMin;
        uint128 rewardMax;
        uint32 xp;
        uint32 cooldown;
        uint16 minLevel;
        uint16 lootBps;
        uint16 lootId;
        uint8 zone;
        Kind kind;
        bool active;
        Stats monster;
    }

    struct Outcome {
        bool won;
        uint32 xp;
        uint256 reward;
        uint256 lootId;
    }

    struct Run {
        uint64 runId;
        uint32 questId;
        uint64 startBlock;
    }

    uint64 public constant SEED_DELAY = 2;
    uint64 public constant LOSS_INJURY = 1 hours;
    uint256 public constant SCAR_CHANCE = 20; // percent, on a lost hunt

    uint8 public constant REP_QUEST = 1;
    uint8 public constant REP_DISCOVERY = 2;

    ChogItems public immutable items;

    mapping(uint32 questId => Quest) internal _quests;
    uint32 public questCount;
    mapping(bytes32 key => Run) public activeRun;
    mapping(bytes32 key => mapping(uint32 questId => uint64)) public lastStartedAt;
    uint64 public nextRunId = 1;

    event QuestSet(uint32 indexed questId, Kind kind, uint8 zone, uint128 fee, bool active);
    event QuestStarted(bytes32 indexed key, uint64 indexed runId, uint32 indexed questId, uint64 startBlock);
    event QuestResolved(
        bytes32 indexed key,
        uint64 indexed runId,
        uint32 indexed questId,
        bool won,
        uint32 xp,
        uint256 reward,
        uint256 lootId,
        bytes32 seed,
        bool late
    );

    error QuestUnavailable();
    error NotAwakened();
    error ChogInjured();
    error LevelTooLow();
    error RunInProgress();
    error OnCooldown();
    error NoActiveRun();
    error SeedNotReady();
    error BadQuest();

    constructor(address admin, ChogState state_, Treasury treasury_, ChogItems items_) GameBase(state_, treasury_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        items = items_;
    }

    function setQuest(uint32 questId, Quest calldata q) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (q.rewardMax < q.rewardMin || q.lootBps > 10_000 || q.zone >= state.ZONE_COUNT()) revert BadQuest();
        if (q.kind == Kind.HUNT && q.monster.hp == 0) revert BadQuest();
        _quests[questId] = q;
        if (questId >= questCount) questCount = questId + 1;
        emit QuestSet(questId, q.kind, q.zone, q.fee, q.active);
    }

    function quest(uint32 questId) external view returns (Quest memory) {
        return _quests[questId];
    }

    /// @notice Start a quest. The caller must be a Chog's token-bound account; it pays the fee.
    function startQuest(uint32 questId) external {
        (address collection, uint256 tokenId) = state.resolveAccount(msg.sender);
        bytes32 key = state.keyOf(collection, tokenId);
        Quest storage q = _quests[questId];
        if (!q.active) revert QuestUnavailable();
        if (!state.isAwakened(key)) revert NotAwakened();
        if (state.isInjured(key)) revert ChogInjured();
        if (state.levelOf(key) < q.minLevel) revert LevelTooLow();
        if (activeRun[key].runId != 0) revert RunInProgress();
        uint64 last = lastStartedAt[key][questId];
        if (last != 0 && block.timestamp < uint256(last) + q.cooldown) revert OnCooldown();

        _collectFee(msg.sender, q.fee);
        uint64 runId = nextRunId++;
        activeRun[key] = Run(runId, questId, uint64(block.number));
        lastStartedAt[key][questId] = uint64(block.timestamp);
        emit QuestStarted(key, runId, questId, uint64(block.number));
    }

    function canResolve(bytes32 key) external view returns (bool) {
        Run memory run = activeRun[key];
        return run.runId != 0 && block.number > run.startBlock + SEED_DELAY;
    }

    /// @notice Settle the active quest for a Chog. Callable by anyone once the seed block exists.
    function resolveQuest(address collection, uint256 tokenId) external {
        bytes32 key = state.keyOf(collection, tokenId);
        Run memory run = activeRun[key];
        if (run.runId == 0) revert NoActiveRun();
        if (block.number <= run.startBlock + SEED_DELAY) revert SeedNotReady();
        delete activeRun[key];

        (bytes32 seed, bool late) = _seed(run, key);
        Outcome memory o = late
            ? Outcome(false, _quests[run.questId].xp / 2, 0, 0)
            : _play(_quests[run.questId], key, collection, tokenId, seed);

        o.xp = state.grantXp(key, o.xp);
        state.recordQuest(key);
        emit QuestResolved(key, run.runId, run.questId, o.won, o.xp, o.reward, o.lootId, seed, late);
    }

    /// @dev A late run fizzles instead of playing: whoever resolves after the seed window could
    ///      otherwise choose the outcome by choosing the block.
    function _play(Quest memory q, bytes32 key, address collection, uint256 tokenId, bytes32 seed)
        internal
        returns (Outcome memory o)
    {
        o.won = true;
        o.xp = q.xp;
        if (q.kind == Kind.HUNT) {
            o.won = BattleEngine.simulate(state.combatStats(collection, tokenId), q.monster, seed).aWins;
        } else if (q.kind == Kind.EXPLORE && state.visitZone(key, q.zone)) {
            o.xp += q.xp / 2;
            state.adjustRep(key, 3, REP_DISCOVERY);
        }

        if (!o.won) {
            o.xp = q.xp / 2;
            state.injure(key, LOSS_INJURY);
            if (uint256(keccak256(abi.encode(seed, "scar"))) % 100 < SCAR_CHANCE) state.addScar(key);
            return o;
        }

        address account = state.accountOf(collection, tokenId);
        if (q.rewardMax > 0) {
            uint256 span = uint256(q.rewardMax) - q.rewardMin + 1;
            o.reward = treasury.pay(account, q.rewardMin + uint256(keccak256(abi.encode(seed, "reward"))) % span);
        }
        if (q.lootBps > 0 && uint256(keccak256(abi.encode(seed, "loot"))) % 10_000 < q.lootBps) {
            o.lootId = q.lootId;
            items.grantLoot(account, o.lootId, 1);
        }
        if (q.kind == Kind.HUNT) state.adjustRep(key, 2, REP_QUEST);
    }

    /// @dev Seed from the block hash SEED_DELAY blocks after start. Outside the 256-block window the
    ///      hash is gone and the run is marked late.
    function _seed(Run memory run, bytes32 key) internal view returns (bytes32 seed, bool late) {
        bytes32 bh = blockhash(run.startBlock + SEED_DELAY);
        late = bh == bytes32(0);
        seed = keccak256(abi.encode(bh, run.runId, key));
    }
}
