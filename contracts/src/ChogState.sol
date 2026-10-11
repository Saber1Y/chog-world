// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC6551Registry, IERC6551Account} from "./interfaces/IERC6551.sol";
import {ChogDNA, Stats} from "./libraries/ChogDNA.sol";

interface IChogItems {
    /// @return tier Highest gear tier (0..3) `holder` owns for `slot` (0 weapon, 1 armor).
    function bestTier(address holder, uint8 slot) external view returns (uint8 tier);

    /// @notice Mint the soulbound trophy for `title` to `to` (no-op if already held).
    function mintTrophy(address to, uint8 title) external;
}

/// @title ChogState
/// @notice Progression for every awakened Chog, keyed by keccak256(collection, tokenId).
///         The Chog itself is the character: its token-bound account is the player in every game
///         contract, and its progression follows the NFT to whoever owns it.
contract ChogState is AccessControl {
    bytes32 public constant GAME_ROLE = keccak256("GAME_ROLE");

    uint16 public constant MAX_LEVEL = 50;
    uint16 public constant MAX_SCAR_BONUS = 5;
    uint64 public constant CHECK_IN_INTERVAL = 20 hours;
    uint64 public constant STREAK_WINDOW = 48 hours;
    uint64 public constant BUFF_DURATION = 24 hours;
    uint32 public constant CHECK_IN_XP = 10;

    // Title bits.
    uint8 public constant TITLE_FIRST_BLOOD = 0;
    uint8 public constant TITLE_GIANT_SLAYER = 1;
    uint8 public constant TITLE_UNBROKEN = 2;
    uint8 public constant TITLE_EXPLORER = 3;
    uint8 public constant TITLE_VETERAN = 4;
    uint8 public constant TITLE_DEVOTED = 5;

    uint8 public constant ZONE_COUNT = 4;

    struct Character {
        bool awakened;
        uint64 bornAt;
        uint32 xp;
        uint16 level;
        int32 rep;
        uint16 wins;
        uint16 losses;
        uint16 quests;
        uint64 injuredUntil;
        uint64 buffUntil;
        uint32 titles;
        uint16 scars;
        uint8 goalMask;
        uint8 zonesVisited;
        uint16 streak;
        uint64 lastCheckIn;
    }

    IERC6551Registry public immutable registry;
    address public immutable accountImplementation;

    struct ChogRef {
        address collection;
        uint256 tokenId;
    }

    IChogItems public items;
    uint32 public season;

    mapping(address collection => bool) public collectionAllowed;
    mapping(bytes32 key => Character) internal _characters;
    mapping(bytes32 key => ChogRef) public refOf;
    mapping(uint32 season => mapping(bytes32 key => int32)) public seasonRep;

    event CollectionSet(address indexed collection, bool allowed);
    event ItemsSet(address indexed items);
    event Awakened(bytes32 indexed key, address indexed collection, uint256 indexed tokenId, address account);
    event GoalsSet(bytes32 indexed key, uint8 goalMask);
    event CheckedIn(bytes32 indexed key, uint16 streak, uint64 buffUntil);
    event XpGained(bytes32 indexed key, uint32 amount, uint32 totalXp);
    event LevelUp(bytes32 indexed key, uint16 level);
    event ReputationChanged(bytes32 indexed key, int32 delta, int32 rep, uint8 reason);
    event BattleRecorded(bytes32 indexed key, bool won, uint16 wins, uint16 losses);
    event QuestRecorded(bytes32 indexed key, uint16 quests);
    event Injured(bytes32 indexed key, uint64 until);
    event Healed(bytes32 indexed key);
    event Buffed(bytes32 indexed key, uint64 until);
    event TitleAwarded(bytes32 indexed key, uint8 title);
    event ScarAdded(bytes32 indexed key, uint16 scars);
    event ZoneDiscovered(bytes32 indexed key, uint8 zone);
    event SeasonStarted(uint32 season);

    error NotChogAccount();
    error NotChogOwner();
    error CollectionNotAllowed();
    error NotAwakened();
    error CheckInTooSoon();
    error BadZone();

    constructor(address admin, IERC6551Registry registry_, address accountImplementation_) {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        registry = registry_;
        accountImplementation = accountImplementation_;
        season = 1;
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setCollection(address collection, bool allowed) external onlyRole(DEFAULT_ADMIN_ROLE) {
        collectionAllowed[collection] = allowed;
        emit CollectionSet(collection, allowed);
    }

    function setItems(IChogItems items_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        items = items_;
        emit ItemsSet(address(items_));
    }

    function startSeason() external onlyRole(DEFAULT_ADMIN_ROLE) {
        season += 1;
        emit SeasonStarted(season);
    }

    // ---------------------------------------------------------------------
    // Identity helpers
    // ---------------------------------------------------------------------

    function keyOf(address collection, uint256 tokenId) public pure returns (bytes32) {
        return keccak256(abi.encode(collection, tokenId));
    }

    /// @notice Counterfactual token-bound account for a Chog (salt 0, this chain).
    function accountOf(address collection, uint256 tokenId) public view returns (address) {
        return registry.account(accountImplementation, bytes32(0), block.chainid, collection, tokenId);
    }

    /// @notice Resolve a caller back to its Chog, proving it is that Chog's canonical token-bound account.
    function resolveAccount(address account) public view returns (address collection, uint256 tokenId) {
        if (account.code.length == 0) revert NotChogAccount();
        uint256 chainId;
        try IERC6551Account(account).token() returns (uint256 c, address tc, uint256 id) {
            (chainId, collection, tokenId) = (c, tc, id);
        } catch {
            revert NotChogAccount();
        }
        if (chainId != block.chainid || !collectionAllowed[collection]) revert NotChogAccount();
        if (accountOf(collection, tokenId) != account) revert NotChogAccount();
    }

    function ownerOfChog(address collection, uint256 tokenId) public view returns (address) {
        return IERC721(collection).ownerOf(tokenId);
    }

    // ---------------------------------------------------------------------
    // Owner actions
    // ---------------------------------------------------------------------

    /// @notice Bring a Chog into the world. Callable by its owner or by a game contract acting for the owner.
    function awaken(address collection, uint256 tokenId) external {
        if (!collectionAllowed[collection]) revert CollectionNotAllowed();
        if (msg.sender != ownerOfChog(collection, tokenId) && !hasRole(GAME_ROLE, msg.sender)) {
            revert NotChogOwner();
        }
        bytes32 key = keyOf(collection, tokenId);
        Character storage c = _characters[key];
        if (c.awakened) return;
        c.awakened = true;
        c.bornAt = uint64(block.timestamp);
        c.level = 1;
        refOf[key] = ChogRef(collection, tokenId);
        emit Awakened(key, collection, tokenId, accountOf(collection, tokenId));
    }

    function setGoals(address collection, uint256 tokenId, uint8 goalMask) external {
        bytes32 key = _ownedAwakened(collection, tokenId);
        _characters[key].goalMask = goalMask;
        emit GoalsSet(key, goalMask);
    }

    /// @notice Daily check-in: keeps the streak alive and grants an XP buff for the next 24 hours.
    function checkIn(address collection, uint256 tokenId) external {
        bytes32 key = _ownedAwakened(collection, tokenId);
        Character storage c = _characters[key];
        uint64 nowTs = uint64(block.timestamp);
        if (c.lastCheckIn != 0 && nowTs < c.lastCheckIn + CHECK_IN_INTERVAL) revert CheckInTooSoon();

        c.streak = (c.lastCheckIn != 0 && nowTs <= c.lastCheckIn + STREAK_WINDOW) ? c.streak + 1 : 1;
        c.lastCheckIn = nowTs;
        // Grant the check-in XP before the new buff starts, so the buff only applies to what comes next.
        _grantXp(key, CHECK_IN_XP);
        c.buffUntil = nowTs + BUFF_DURATION;
        emit CheckedIn(key, c.streak, c.buffUntil);
        if (c.streak >= 7) _awardTitle(key, TITLE_DEVOTED);
    }

    // ---------------------------------------------------------------------
    // Game hooks
    // ---------------------------------------------------------------------

    function grantXp(bytes32 key, uint32 amount) external onlyRole(GAME_ROLE) returns (uint32 granted) {
        return _grantXp(key, amount);
    }

    function adjustRep(bytes32 key, int32 delta, uint8 reason) external onlyRole(GAME_ROLE) {
        Character storage c = _awakened(key);
        c.rep += delta;
        seasonRep[season][key] += delta;
        emit ReputationChanged(key, delta, c.rep, reason);
    }

    function recordBattle(bytes32 key, bool won) external onlyRole(GAME_ROLE) {
        Character storage c = _awakened(key);
        if (won) c.wins += 1;
        else c.losses += 1;
        emit BattleRecorded(key, won, c.wins, c.losses);
        if (won && c.wins == 1) _awardTitle(key, TITLE_FIRST_BLOOD);
        if (uint256(c.wins) + c.losses >= 50) _awardTitle(key, TITLE_VETERAN);
    }

    function recordQuest(bytes32 key) external onlyRole(GAME_ROLE) {
        Character storage c = _awakened(key);
        c.quests += 1;
        emit QuestRecorded(key, c.quests);
    }

    function injure(bytes32 key, uint64 duration) external onlyRole(GAME_ROLE) {
        Character storage c = _awakened(key);
        uint64 until = uint64(block.timestamp) + duration;
        if (until > c.injuredUntil) c.injuredUntil = until;
        emit Injured(key, c.injuredUntil);
    }

    function heal(bytes32 key) external onlyRole(GAME_ROLE) {
        _awakened(key).injuredUntil = 0;
        emit Healed(key);
    }

    function buff(bytes32 key, uint64 duration) external onlyRole(GAME_ROLE) {
        Character storage c = _awakened(key);
        uint64 until = uint64(block.timestamp) + duration;
        if (until > c.buffUntil) c.buffUntil = until;
        emit Buffed(key, c.buffUntil);
    }

    function awardTitle(bytes32 key, uint8 title) external onlyRole(GAME_ROLE) returns (bool isNew) {
        _awakened(key);
        return _awardTitle(key, title);
    }

    function addScar(bytes32 key) external onlyRole(GAME_ROLE) {
        Character storage c = _awakened(key);
        c.scars += 1;
        emit ScarAdded(key, c.scars);
    }

    function visitZone(bytes32 key, uint8 zone) external onlyRole(GAME_ROLE) returns (bool isNew) {
        if (zone >= ZONE_COUNT) revert BadZone();
        Character storage c = _awakened(key);
        uint8 bit = uint8(1) << zone;
        if (c.zonesVisited & bit != 0) return false;
        c.zonesVisited |= bit;
        emit ZoneDiscovered(key, zone);
        if (c.zonesVisited == (uint8(1) << ZONE_COUNT) - 1) _awardTitle(key, TITLE_EXPLORER);
        return true;
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function character(bytes32 key) external view returns (Character memory) {
        return _characters[key];
    }

    function isAwakened(bytes32 key) external view returns (bool) {
        return _characters[key].awakened;
    }

    function isInjured(bytes32 key) public view returns (bool) {
        return _characters[key].injuredUntil > block.timestamp;
    }

    function levelOf(bytes32 key) external view returns (uint16) {
        return _characters[key].level;
    }

    function repOf(bytes32 key) external view returns (int32) {
        return _characters[key].rep;
    }

    /// @notice XP required to go from `level` to `level + 1` (cumulative threshold).
    function xpThreshold(uint16 level) public pure returns (uint32) {
        return uint32(25) * level * (level + 1);
    }

    function levelForXp(uint32 xp) public pure returns (uint16 level) {
        level = 1;
        while (level < MAX_LEVEL && xp >= xpThreshold(level)) level++;
    }

    /// @notice Effective combat stats: DNA base + level growth + scar toughness + best gear in the Chog's account.
    function combatStats(address collection, uint256 tokenId) external view returns (Stats memory s) {
        s = ChogDNA.baseStats(ChogDNA.dna(collection, tokenId));
        Character storage c = _characters[keyOf(collection, tokenId)];
        uint16 lv = c.level == 0 ? 0 : c.level - 1;
        s.hp += 5 * lv;
        s.atk += lv;
        s.def += lv / 2;
        s.spd += lv / 3;
        s.def += c.scars < MAX_SCAR_BONUS ? c.scars : MAX_SCAR_BONUS;
        if (address(items) != address(0)) {
            address account = accountOf(collection, tokenId);
            uint16 weapon = items.bestTier(account, 0);
            uint16 armor = items.bestTier(account, 1);
            s.atk += 3 * weapon;
            s.def += 2 * armor;
            s.hp += 5 * armor;
        }
    }

    function dnaOf(address collection, uint256 tokenId)
        external
        pure
        returns (bytes32 d, Stats memory base, uint16 hue)
    {
        d = ChogDNA.dna(collection, tokenId);
        base = ChogDNA.baseStats(d);
        hue = ChogDNA.hue(d);
    }

    // ---------------------------------------------------------------------
    // Internals
    // ---------------------------------------------------------------------

    function _ownedAwakened(address collection, uint256 tokenId) internal view returns (bytes32 key) {
        if (msg.sender != ownerOfChog(collection, tokenId)) revert NotChogOwner();
        key = keyOf(collection, tokenId);
        if (!_characters[key].awakened) revert NotAwakened();
    }

    function _awakened(bytes32 key) internal view returns (Character storage c) {
        c = _characters[key];
        if (!c.awakened) revert NotAwakened();
    }

    function _grantXp(bytes32 key, uint32 amount) internal returns (uint32 granted) {
        Character storage c = _awakened(key);
        granted = c.buffUntil > block.timestamp ? amount * 3 / 2 : amount;
        c.xp += granted;
        emit XpGained(key, granted, c.xp);
        uint16 newLevel = levelForXp(c.xp);
        if (newLevel > c.level) {
            c.level = newLevel;
            emit LevelUp(key, newLevel);
        }
    }

    function _awardTitle(bytes32 key, uint8 title) internal returns (bool isNew) {
        Character storage c = _characters[key];
        uint32 bit = uint32(1) << title;
        if (c.titles & bit != 0) return false;
        c.titles |= bit;
        emit TitleAwarded(key, title);
        if (address(items) != address(0)) {
            ChogRef memory ref = refOf[key];
            items.mintTrophy(accountOf(ref.collection, ref.tokenId), title);
        }
        return true;
    }
}
