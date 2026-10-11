// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Combat stats. Every Chog shares the same metadata, so base stats come from a public,
///         deterministic DNA hash of (collection, tokenId). Growth comes from what the Chog does.
struct Stats {
    uint16 hp;
    uint16 atk;
    uint16 def;
    uint16 spd;
    uint16 crit; // percent, 0..100
    uint8 element; // 0 Ember, 1 Moss, 2 Volt, 3 Tide
}

library ChogDNA {
    bytes32 internal constant DNA_SALT = keccak256("CHOG_WORLD_DNA_V1");

    uint16 internal constant HP_BASE = 80;
    uint16 internal constant HP_RANGE = 41; // 80..120
    uint16 internal constant ATK_BASE = 10;
    uint16 internal constant ATK_RANGE = 11; // 10..20
    uint16 internal constant DEF_BASE = 4;
    uint16 internal constant DEF_RANGE = 9; // 4..12
    uint16 internal constant SPD_BASE = 5;
    uint16 internal constant SPD_RANGE = 11; // 5..15
    uint16 internal constant CRIT_BASE = 3;
    uint16 internal constant CRIT_RANGE = 10; // 3..12

    function dna(address collection, uint256 tokenId) internal pure returns (bytes32) {
        return keccak256(abi.encode(DNA_SALT, collection, tokenId));
    }

    function baseStats(bytes32 d) internal pure returns (Stats memory s) {
        uint256 x = uint256(d);
        s.hp = HP_BASE + uint16(_byte(x, 0) % HP_RANGE);
        s.atk = ATK_BASE + uint16(_byte(x, 1) % ATK_RANGE);
        s.def = DEF_BASE + uint16(_byte(x, 2) % DEF_RANGE);
        s.spd = SPD_BASE + uint16(_byte(x, 3) % SPD_RANGE);
        s.crit = CRIT_BASE + uint16(_byte(x, 4) % CRIT_RANGE);
        s.element = uint8(_byte(x, 5) % 4);
    }

    /// @notice Cosmetic hue (0..359) used by the renderer.
    function hue(bytes32 d) internal pure returns (uint16) {
        return uint16(((_byte(uint256(d), 6) << 8) | _byte(uint256(d), 7)) % 360);
    }

    /// @dev i-th byte counting from the most significant end.
    function _byte(uint256 x, uint256 i) private pure returns (uint256) {
        return (x >> (248 - i * 8)) & 0xff;
    }
}
