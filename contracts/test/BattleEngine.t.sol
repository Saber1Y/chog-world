// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ChogDNA, Stats} from "../src/libraries/ChogDNA.sol";
import {BattleEngine} from "../src/libraries/BattleEngine.sol";

contract BattleEngineTest is Test {
    function _stats(uint16 hp, uint16 atk, uint16 def, uint16 spd, uint16 crit, uint8 el)
        internal
        pure
        returns (Stats memory)
    {
        return Stats({hp: hp, atk: atk, def: def, spd: spd, crit: crit, element: el});
    }

    function _bounded(Stats memory s) internal pure returns (Stats memory) {
        s.hp = uint16(bound(s.hp, 1, 2_000));
        s.atk = uint16(bound(s.atk, 0, 500));
        s.def = uint16(bound(s.def, 0, 500));
        s.spd = uint16(bound(s.spd, 0, 500));
        s.crit = uint16(bound(s.crit, 0, 100));
        s.element = uint8(bound(s.element, 0, 3));
        return s;
    }

    function testFuzz_Deterministic(Stats memory a, Stats memory b, bytes32 seed) public pure {
        a = _bounded(a);
        b = _bounded(b);
        BattleEngine.Result memory r1 = BattleEngine.simulate(a, b, seed);
        BattleEngine.Result memory r2 = BattleEngine.simulate(a, b, seed);
        assertEq(r1.aWins, r2.aWins);
        assertEq(r1.rounds, r2.rounds);
        assertEq(r1.hpA, r2.hpA);
        assertEq(r1.hpB, r2.hpB);
        assertEq(r1.logHash, r2.logHash);
    }

    function testFuzz_Bounded(Stats memory a, Stats memory b, bytes32 seed) public pure {
        a = _bounded(a);
        b = _bounded(b);
        BattleEngine.Result memory r = BattleEngine.simulate(a, b, seed);
        assertGe(r.rounds, 1);
        assertLe(r.rounds, BattleEngine.MAX_ROUNDS);
        assertLe(r.hpA, a.hp);
        assertLe(r.hpB, b.hp);
        // A knocked-out side always loses.
        if (r.hpA == 0) assertFalse(r.aWins);
        if (r.hpB == 0) assertTrue(r.aWins);
    }

    function test_OverwhelmingFighterWins() public pure {
        Stats memory giant = _stats(500, 80, 40, 30, 10, 0);
        Stats memory slime = _stats(30, 3, 0, 1, 0, 0);
        for (uint256 i; i < 32; i++) {
            bytes32 seed = keccak256(abi.encode(i));
            assertTrue(BattleEngine.simulate(giant, slime, seed).aWins);
            assertFalse(BattleEngine.simulate(slime, giant, seed).aWins);
        }
    }

    function test_EveryHitDealsAtLeastOne() public pure {
        // Zero attack against huge defence still chips 1 per hit, so no battle is a pure stalemate.
        Stats memory a = _stats(100, 0, 0, 10, 0, 0);
        Stats memory b = _stats(100, 0, 500, 5, 0, 0);
        BattleEngine.Result memory r = BattleEngine.simulate(a, b, bytes32(uint256(7)));
        assertEq(r.rounds, BattleEngine.MAX_ROUNDS);
        assertEq(r.hpA, 100 - 12);
        assertEq(r.hpB, 100 - 12);
        assertFalse(r.aWins, "tie goes to the defender");
    }

    function test_ElementCycle() public pure {
        assertTrue(BattleEngine.hasAdvantage(0, 1));
        assertTrue(BattleEngine.hasAdvantage(1, 2));
        assertTrue(BattleEngine.hasAdvantage(2, 3));
        assertTrue(BattleEngine.hasAdvantage(3, 0));
        assertFalse(BattleEngine.hasAdvantage(1, 0));
        assertFalse(BattleEngine.hasAdvantage(0, 0));
        assertFalse(BattleEngine.hasAdvantage(0, 2));
    }

    function testFuzz_DnaStatsInRange(address collection, uint256 tokenId) public pure {
        Stats memory s = ChogDNA.baseStats(ChogDNA.dna(collection, tokenId));
        assertGe(s.hp, 80);
        assertLe(s.hp, 120);
        assertGe(s.atk, 10);
        assertLe(s.atk, 20);
        assertGe(s.def, 4);
        assertLe(s.def, 12);
        assertGe(s.spd, 5);
        assertLe(s.spd, 15);
        assertGe(s.crit, 3);
        assertLe(s.crit, 12);
        assertLe(s.element, 3);
        assertLt(ChogDNA.hue(ChogDNA.dna(collection, tokenId)), 360);
    }

    function test_DnaDiffersAcrossTokens() public pure {
        address c = address(0x9994604c3D3C43B82A79B41281E202613313Afba);
        assertTrue(ChogDNA.dna(c, 1) != ChogDNA.dna(c, 2));
    }
}
