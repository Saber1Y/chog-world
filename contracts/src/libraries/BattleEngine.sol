// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Stats} from "./ChogDNA.sol";

/// @notice Deterministic turn-based battle. Mirrored line for line by `packages/shared/src/engine.ts`
///         so any battle can be replayed off-chain from its seed and checked against `logHash`.
library BattleEngine {
    uint8 internal constant MAX_ROUNDS = 12;

    struct Result {
        bool aWins;
        uint8 rounds;
        uint256 hpA;
        uint256 hpB;
        bytes32 logHash;
    }

    /// @dev Element cycle: Ember > Moss > Volt > Tide > Ember.
    function hasAdvantage(uint8 attacker, uint8 defender) internal pure returns (bool) {
        return (attacker + 1) % 4 == defender;
    }

    function simulate(Stats memory a, Stats memory b, bytes32 seed) internal pure returns (Result memory r) {
        uint256 hpA = a.hp;
        uint256 hpB = b.hp;
        bool aFirst = a.spd > b.spd || (a.spd == b.spd && uint256(seed) & 1 == 0);
        bytes32 log = seed;
        uint256 step;

        for (uint8 round = 1; round <= MAX_ROUNDS; round++) {
            r.rounds = round;
            for (uint256 turn; turn < 2; turn++) {
                bool attackerIsA = (turn == 0) == aFirst;
                (Stats memory att, Stats memory dfn) = attackerIsA ? (a, b) : (b, a);

                uint256 rnd = uint256(keccak256(abi.encode(seed, step)));
                step++;

                uint256 dmg = uint256(att.atk) * (90 + (rnd % 21)) / 100;
                uint256 armor = uint256(dfn.def) / 2;
                dmg = dmg > armor ? dmg - armor : 0;
                if (dmg == 0) dmg = 1;
                bool crit = (rnd >> 8) % 100 < att.crit;
                if (crit) dmg *= 2;
                if (hasAdvantage(att.element, dfn.element)) dmg = dmg * 115 / 100;

                log = keccak256(abi.encodePacked(log, attackerIsA, dmg, crit));

                if (attackerIsA) {
                    hpB = hpB > dmg ? hpB - dmg : 0;
                } else {
                    hpA = hpA > dmg ? hpA - dmg : 0;
                }
                if (hpA == 0 || hpB == 0) {
                    r.aWins = hpB == 0;
                    r.hpA = hpA;
                    r.hpB = hpB;
                    r.logHash = log;
                    return r;
                }
            }
        }

        // No knockout: the side with the larger fraction of hp left wins; ties go to B (the defender).
        r.aWins = hpA * b.hp > hpB * a.hp;
        r.hpA = hpA;
        r.hpB = hpB;
        r.logHash = log;
    }
}
