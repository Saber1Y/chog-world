// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC1155} from "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {ChogState, IChogItems} from "./ChogState.sol";
import {Treasury} from "./Treasury.sol";
import {GameBase} from "./GameBase.sol";

/// @title ChogItems
/// @notice Gear and consumables bought with $CHOG, plus soulbound trophies. Items count for a Chog
///         only while they sit in its token-bound account, so they travel with the NFT.
contract ChogItems is ERC1155, AccessControl, GameBase, IChogItems {
    bytes32 public constant GAME_ROLE = keccak256("GAME_ROLE");

    enum Kind {
        NONE,
        POTION,
        ELIXIR,
        WEAPON,
        ARMOR
    }

    struct Item {
        uint128 price;
        Kind kind;
        uint8 tier;
        bool active;
    }

    uint256 public constant POTION = 1;
    uint256 public constant ELIXIR = 2;
    uint256 public constant WEAPON_BASE = 10; // 11, 12, 13
    uint256 public constant ARMOR_BASE = 20; // 21, 22, 23
    uint256 public constant TROPHY_BASE = 1000; // 1000 + title bit, soulbound
    uint8 public constant MAX_TIER = 3;
    uint64 public constant ELIXIR_DURATION = 24 hours;

    mapping(uint256 id => Item) public items;

    event ItemSet(uint256 indexed id, uint128 price, Kind kind, uint8 tier, bool active);
    event ItemBought(address indexed buyer, uint256 indexed id, uint256 qty, uint256 cost);
    event ItemUsed(bytes32 indexed key, uint256 indexed id);
    event LootGranted(address indexed to, uint256 indexed id, uint256 qty);

    error ItemUnavailable();
    error BadQuantity();
    error NotUsable();
    error Soulbound();
    error OnlyState();
    error BadItem();

    constructor(address admin, ChogState state_, Treasury treasury_, string memory uri_)
        ERC1155(uri_)
        GameBase(state_, treasury_)
    {
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setItem(uint256 id, uint128 price, Kind kind, uint8 tier, bool active)
        external
        onlyRole(DEFAULT_ADMIN_ROLE)
    {
        if (id >= TROPHY_BASE || kind == Kind.NONE) revert BadItem();
        if (kind == Kind.WEAPON && (tier == 0 || tier > MAX_TIER || id != WEAPON_BASE + tier)) revert BadItem();
        if (kind == Kind.ARMOR && (tier == 0 || tier > MAX_TIER || id != ARMOR_BASE + tier)) revert BadItem();
        items[id] = Item(price, kind, tier, active);
        emit ItemSet(id, price, kind, tier, active);
    }

    function setURI(string calldata uri_) external onlyRole(DEFAULT_ADMIN_ROLE) {
        _setURI(uri_);
    }

    // ---------------------------------------------------------------------
    // Shop
    // ---------------------------------------------------------------------

    function buy(uint256 id, uint256 qty) external {
        Item memory it = items[id];
        if (!it.active) revert ItemUnavailable();
        if (qty == 0 || qty > 10) revert BadQuantity();
        uint256 cost = uint256(it.price) * qty;
        _collectFee(msg.sender, cost);
        _mint(msg.sender, id, qty, "");
        emit ItemBought(msg.sender, id, qty, cost);
    }

    function priceOf(uint256 id, uint256 qty) external view returns (uint256) {
        Item memory it = items[id];
        if (!it.active) revert ItemUnavailable();
        return uint256(it.price) * qty;
    }

    /// @notice Use a consumable. The caller must be a Chog's token-bound account.
    function use(uint256 id) external {
        (address collection, uint256 tokenId) = state.resolveAccount(msg.sender);
        bytes32 key = state.keyOf(collection, tokenId);
        Kind kind = items[id].kind;
        if (kind != Kind.POTION && kind != Kind.ELIXIR) revert NotUsable();
        _burn(msg.sender, id, 1);
        if (kind == Kind.POTION) state.heal(key);
        else state.buff(key, ELIXIR_DURATION);
        emit ItemUsed(key, id);
    }

    // ---------------------------------------------------------------------
    // Game hooks
    // ---------------------------------------------------------------------

    function grantLoot(address to, uint256 id, uint256 qty) external onlyRole(GAME_ROLE) {
        if (id >= TROPHY_BASE || items[id].kind == Kind.NONE) revert BadItem();
        _mint(to, id, qty, "");
        emit LootGranted(to, id, qty);
    }

    function mintTrophy(address to, uint8 title) external {
        if (msg.sender != address(state)) revert OnlyState();
        uint256 id = TROPHY_BASE + title;
        if (balanceOf(to, id) == 0) _mint(to, id, 1, "");
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function bestTier(address holder, uint8 slot) external view returns (uint8) {
        uint256 base = slot == 0 ? WEAPON_BASE : ARMOR_BASE;
        for (uint8 t = MAX_TIER; t > 0; t--) {
            if (balanceOf(holder, base + t) > 0) return t;
        }
        return 0;
    }

    // ---------------------------------------------------------------------
    // Overrides
    // ---------------------------------------------------------------------

    function _update(address from, address to, uint256[] memory ids, uint256[] memory values) internal override {
        if (from != address(0)) {
            for (uint256 i; i < ids.length; i++) {
                if (ids[i] >= TROPHY_BASE) revert Soulbound();
            }
        }
        super._update(from, to, ids, values);
    }

    function supportsInterface(bytes4 interfaceId) public view override(ERC1155, AccessControl) returns (bool) {
        return super.supportsInterface(interfaceId);
    }
}
