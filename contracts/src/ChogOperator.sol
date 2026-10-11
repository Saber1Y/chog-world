// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAccountV3} from "./interfaces/IERC6551.sol";
import {ChogState} from "./ChogState.sol";
import {QuestBoard} from "./QuestBoard.sol";
import {Arena} from "./Arena.sol";
import {ChogItems} from "./ChogItems.sol";

/// @title ChogOperator
/// @notice The only executor a Chog owner grants on their Chog's token-bound account. It lets the
///         CHOG World agent (the keeper) take a fixed set of game actions, each priced up front and checked
///         against the owner's policy: per-action cap, rolling 24h budget, action count, allowed action
///         kinds, expiry and pause. Policy logic is adapted from SpendArcVault.
///
///         Non-upgradeable, game targets fixed at construction, no arbitrary calls: the keeper can only
///         ask for typed actions. If the NFT changes hands the policy stops working immediately, because
///         it is bound to the owner who signed it.
contract ChogOperator {
    uint8 public constant ACTION_QUEST = 0;
    uint8 public constant ACTION_ATTACK = 1;
    uint8 public constant ACTION_BUY = 2;
    uint8 public constant ACTION_USE = 3;
    uint8 public constant ALL_ACTIONS = 0x0f;

    uint256 private constant DAY = 1 days;
    uint8 private constant CALL = 0;

    struct PolicyParams {
        uint64 expiry; // 0 = no expiry
        uint8 actionMask;
        uint16 maxActionsPerDay;
        uint128 maxPerAction;
        uint128 dailyCap;
    }

    struct Policy {
        address owner;
        bool active;
        bool paused;
        uint8 actionMask;
        uint64 expiry;
        uint64 windowStart;
        uint16 maxActionsPerDay;
        uint16 actionsToday;
        uint128 maxPerAction;
        uint128 dailyCap;
        uint128 spentToday;
    }

    ChogState public immutable state;
    QuestBoard public immutable quests;
    Arena public immutable arena;
    ChogItems public immutable items;
    IERC20 public immutable chog;
    address public immutable guardian;

    address public keeper;
    bool public guardianPaused;

    mapping(bytes32 key => Policy) internal _policies;
    mapping(bytes32 actionId => bool) public usedAction;

    event Enrolled(bytes32 indexed key, address indexed owner, address account, PolicyParams params);
    event PolicyUpdated(bytes32 indexed key, PolicyParams params);
    event PausedSet(bytes32 indexed key, bool paused);
    event Revoked(bytes32 indexed key);
    event OwnerChanged(bytes32 indexed key, address indexed previousOwner, address indexed newOwner);
    event ActionExecuted(bytes32 indexed key, uint8 indexed kind, uint256 cost, bytes32 actionId);
    event ActionBlocked(bytes32 indexed key, uint8 indexed kind, uint256 cost, bytes32 actionId, string reason);
    event KeeperSet(address indexed keeper);
    event GuardianPausedSet(bool paused);

    error NotChogOwner();
    error NotEnrolled();
    error NotKeeper();
    error NotGuardian();
    error GuardianPaused();
    error BadPolicy();

    modifier onlyKeeper() {
        if (msg.sender != keeper) revert NotKeeper();
        if (guardianPaused) revert GuardianPaused();
        _;
    }

    modifier onlyGuardian() {
        if (msg.sender != guardian) revert NotGuardian();
        _;
    }

    constructor(
        ChogState state_,
        QuestBoard quests_,
        Arena arena_,
        ChogItems items_,
        address guardian_,
        address keeper_
    ) {
        state = state_;
        quests = quests_;
        arena = arena_;
        items = items_;
        chog = quests_.chog();
        guardian = guardian_;
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    // ---------------------------------------------------------------------
    // Owner
    // ---------------------------------------------------------------------

    /// @notice Hand your Chog to the agent under `params`. Also awakens the Chog. The owner must
    ///         separately call `setPermissions([this],[true])` on the Chog's account.
    function enroll(address collection, uint256 tokenId, PolicyParams calldata params) external {
        if (state.ownerOfChog(collection, tokenId) != msg.sender) revert NotChogOwner();
        _validate(params);
        state.awaken(collection, tokenId);
        bytes32 key = state.keyOf(collection, tokenId);
        _policies[key] = Policy({
            owner: msg.sender,
            active: true,
            paused: false,
            actionMask: params.actionMask,
            expiry: params.expiry,
            windowStart: uint64(block.timestamp),
            maxActionsPerDay: params.maxActionsPerDay,
            actionsToday: 0,
            maxPerAction: params.maxPerAction,
            dailyCap: params.dailyCap,
            spentToday: 0
        });
        emit Enrolled(key, msg.sender, state.accountOf(collection, tokenId), params);
    }

    function updatePolicy(address collection, uint256 tokenId, PolicyParams calldata params) external {
        Policy storage p = _ownedPolicy(collection, tokenId);
        _validate(params);
        p.actionMask = params.actionMask;
        p.expiry = params.expiry;
        p.maxActionsPerDay = params.maxActionsPerDay;
        p.maxPerAction = params.maxPerAction;
        p.dailyCap = params.dailyCap;
        emit PolicyUpdated(state.keyOf(collection, tokenId), params);
    }

    function setPaused(address collection, uint256 tokenId, bool paused) external {
        _ownedPolicy(collection, tokenId).paused = paused;
        emit PausedSet(state.keyOf(collection, tokenId), paused);
    }

    function revoke(address collection, uint256 tokenId) external {
        _ownedPolicy(collection, tokenId).active = false;
        emit Revoked(state.keyOf(collection, tokenId));
    }

    // ---------------------------------------------------------------------
    // Keeper actions
    // ---------------------------------------------------------------------

    function startQuest(address collection, uint256 tokenId, uint32 questId, bytes32 actionId)
        external
        onlyKeeper
        returns (bool)
    {
        uint256 cost = quests.quest(questId).fee;
        return _act(
            collection,
            tokenId,
            ACTION_QUEST,
            cost,
            actionId,
            address(quests),
            abi.encodeCall(QuestBoard.startQuest, (questId))
        );
    }

    function attack(
        address collection,
        uint256 tokenId,
        address defCollection,
        uint256 defId,
        uint8 tier,
        bytes32 actionId
    ) external onlyKeeper returns (bool) {
        uint256 cost = arena.tierFee(tier);
        return _act(
            collection,
            tokenId,
            ACTION_ATTACK,
            cost,
            actionId,
            address(arena),
            abi.encodeCall(Arena.attack, (defCollection, defId, tier))
        );
    }

    function buyItem(address collection, uint256 tokenId, uint256 itemId, uint256 qty, bytes32 actionId)
        external
        onlyKeeper
        returns (bool)
    {
        uint256 cost = items.priceOf(itemId, qty);
        return _act(
            collection,
            tokenId,
            ACTION_BUY,
            cost,
            actionId,
            address(items),
            abi.encodeCall(ChogItems.buy, (itemId, qty))
        );
    }

    function useItem(address collection, uint256 tokenId, uint256 itemId, bytes32 actionId)
        external
        onlyKeeper
        returns (bool)
    {
        return _act(
            collection, tokenId, ACTION_USE, 0, actionId, address(items), abi.encodeCall(ChogItems.use, (itemId))
        );
    }

    // ---------------------------------------------------------------------
    // Admin (guardian)
    // ---------------------------------------------------------------------

    function setKeeper(address keeper_) external onlyGuardian {
        keeper = keeper_;
        emit KeeperSet(keeper_);
    }

    function setGuardianPaused(bool paused) external onlyGuardian {
        guardianPaused = paused;
        emit GuardianPausedSet(paused);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function policyOf(address collection, uint256 tokenId) external view returns (Policy memory) {
        return _policies[state.keyOf(collection, tokenId)];
    }

    function remainingDailyCap(address collection, uint256 tokenId) external view returns (uint256) {
        Policy memory p = _policies[state.keyOf(collection, tokenId)];
        uint256 spent = block.timestamp >= uint256(p.windowStart) + DAY ? 0 : p.spentToday;
        return spent >= p.dailyCap ? 0 : p.dailyCap - spent;
    }

    /// @notice Empty string when the agent may act for this Chog, otherwise the reason it may not.
    function inactiveReason(address collection, uint256 tokenId) public view returns (string memory) {
        Policy memory p = _policies[state.keyOf(collection, tokenId)];
        if (guardianPaused) return "guardian paused";
        if (!p.active) return "not enrolled";
        if (state.ownerOfChog(collection, tokenId) != p.owner) return "owner changed";
        if (p.paused) return "paused";
        if (p.expiry != 0 && block.timestamp > p.expiry) return "policy expired";
        address account = state.accountOf(collection, tokenId);
        if (account.code.length == 0) return "account not deployed";
        if (!IAccountV3(account).permissions(p.owner, address(this))) return "permission not granted";
        return "";
    }

    function isActive(address collection, uint256 tokenId) external view returns (bool) {
        return bytes(inactiveReason(collection, tokenId)).length == 0;
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _validate(PolicyParams calldata params) internal view {
        if (params.actionMask == 0 || params.actionMask & ~ALL_ACTIONS != 0) revert BadPolicy();
        if (params.maxPerAction > params.dailyCap || params.maxActionsPerDay == 0) revert BadPolicy();
        if (params.expiry != 0 && params.expiry <= block.timestamp) revert BadPolicy();
    }

    function _ownedPolicy(address collection, uint256 tokenId) internal view returns (Policy storage p) {
        p = _policies[state.keyOf(collection, tokenId)];
        if (!p.active) revert NotEnrolled();
        if (msg.sender != p.owner || state.ownerOfChog(collection, tokenId) != msg.sender) revert NotChogOwner();
    }

    function _act(
        address collection,
        uint256 tokenId,
        uint8 kind,
        uint256 cost,
        bytes32 actionId,
        address target,
        bytes memory data
    ) internal returns (bool) {
        bytes32 key = state.keyOf(collection, tokenId);
        string memory reason = _authorize(key, collection, tokenId, kind, cost, actionId);
        if (bytes(reason).length != 0) {
            emit ActionBlocked(key, kind, cost, actionId, reason);
            return false;
        }

        IAccountV3 account = IAccountV3(state.accountOf(collection, tokenId));
        if (cost > 0) account.execute(address(chog), 0, abi.encodeCall(IERC20.approve, (target, cost)), CALL);
        account.execute(target, 0, data, CALL);
        if (cost > 0) account.execute(address(chog), 0, abi.encodeCall(IERC20.approve, (target, 0)), CALL);

        emit ActionExecuted(key, kind, cost, actionId);
        return true;
    }

    /// @dev Returns an empty string on success. Updates the budget window and counters only on success.
    function _authorize(bytes32 key, address collection, uint256 tokenId, uint8 kind, uint256 cost, bytes32 actionId)
        internal
        returns (string memory)
    {
        Policy storage p = _policies[key];
        if (!p.active) return "not enrolled";

        address currentOwner = state.ownerOfChog(collection, tokenId);
        if (currentOwner != p.owner) {
            // The NFT moved: this policy belonged to the previous owner. Retire it for good.
            p.active = false;
            emit OwnerChanged(key, p.owner, currentOwner);
            return "owner changed";
        }
        if (p.paused) return "paused";
        if (p.expiry != 0 && block.timestamp > p.expiry) return "policy expired";
        if (p.actionMask & (uint8(1) << kind) == 0) return "action not allowed";

        address account = state.accountOf(collection, tokenId);
        if (account.code.length == 0) return "account not deployed";
        if (!IAccountV3(account).permissions(p.owner, address(this))) return "permission not granted";

        if (cost > p.maxPerAction) return "exceeds maxPerAction";
        if (block.timestamp >= uint256(p.windowStart) + DAY) {
            p.windowStart = uint64(block.timestamp);
            p.spentToday = 0;
            p.actionsToday = 0;
        }
        if (uint256(p.spentToday) + cost > p.dailyCap) return "exceeds dailyCap";
        if (p.actionsToday >= p.maxActionsPerDay) return "exceeds maxActionsPerDay";
        if (usedAction[actionId]) return "duplicate action";

        usedAction[actionId] = true;
        // casting to 'uint128' is safe because spentToday + cost <= dailyCap, which is a uint128.
        // forge-lint: disable-next-line(unsafe-typecast)
        p.spentToday = uint128(p.spentToday + cost);
        p.actionsToday += 1;
        return "";
    }
}
