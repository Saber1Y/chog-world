// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ChogWorldBase} from "./ChogWorldBase.t.sol";
import {Arena} from "../src/Arena.sol";
import {ChogState} from "../src/ChogState.sol";

contract ArenaTest is ChogWorldBase {
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    address internal aliceAcc;
    address internal bobAcc;
    address internal carolAcc;

    function setUp() public override {
        super.setUp();
        aliceAcc = _awaken(alice, ALICE_CHOG, 1_000 ether);
        bobAcc = _awaken(bob, BOB_CHOG, 1_000 ether);
        carolAcc = _awaken(carol, CAROL_CHOG, 1_000 ether);
        _approveFrom(alice, aliceAcc, address(w.arena), type(uint256).max);
        _approveFrom(bob, bobAcc, address(w.arena), type(uint256).max);
        _approveFrom(carol, carolAcc, address(w.arena), type(uint256).max);
    }

    /// @dev Make a Chog overwhelmingly strong: level 20 plus top gear in its account.
    function _champion(uint256 id) internal {
        bytes32 key = _key(id);
        address acc = _account(id);
        vm.startPrank(address(w.quests));
        w.state.grantXp(key, 10_500);
        w.items.grantLoot(acc, 13, 1);
        w.items.grantLoot(acc, 23, 1);
        vm.stopPrank();
    }

    function _attack(address owner, address acc, uint256 defId, uint8 tier) internal returns (uint64 id) {
        _accountCall(owner, acc, address(w.arena), abi.encodeCall(Arena.attack, (address(nft), defId, tier)));
        id = w.arena.nextBattleId() - 1;
    }

    function test_AttackEscrowsFee() public {
        uint64 id = _attack(alice, aliceAcc, BOB_CHOG, 1);
        assertEq(chog.balanceOf(aliceAcc), 950 ether);
        assertEq(chog.balanceOf(address(w.arena)), 50 ether);
        (bytes32 attKey, bytes32 defKey,,,,, uint256 fee,, bool resolved) = w.arena.battles(id);
        assertEq(attKey, _key(ALICE_CHOG));
        assertEq(defKey, _key(BOB_CHOG));
        assertEq(fee, 50 ether);
        assertFalse(resolved);
        assertEq(w.arena.pendingBattle(_key(ALICE_CHOG)), id);
    }

    function test_AttackerWinPayout() public {
        _champion(ALICE_CHOG);
        uint64 id = _attack(alice, aliceAcc, BOB_CHOG, 0);
        _mine(3);
        w.arena.resolveBattle(id);

        // 10 fee: 1 burned, 9 back, +7 bonus from Treasury.
        assertEq(chog.balanceOf(aliceAcc), 1_000 ether - 10 ether + 9 ether + 7 ether);
        assertEq(chog.balanceOf(DEAD), 1 ether);
        assertEq(chog.balanceOf(address(w.arena)), 0);

        ChogState.Character memory a = w.state.character(_key(ALICE_CHOG));
        ChogState.Character memory b = w.state.character(_key(BOB_CHOG));
        assertEq(a.wins, 1);
        assertEq(b.losses, 1);
        assertEq(a.rep, 16);
        assertEq(b.rep, -8);
        assertTrue(w.state.isInjured(_key(BOB_CHOG)));
        assertTrue(a.titles & 1 != 0, "first blood");
        assertEq(w.items.balanceOf(aliceAcc, 1000), 1, "first blood trophy in the Chog's account");
    }

    function test_DefenderWinPaysBounty() public {
        _champion(BOB_CHOG);
        uint64 id = _attack(alice, aliceAcc, BOB_CHOG, 1);
        uint256 treasuryBefore = chog.balanceOf(address(w.treasury));
        _mine(3);
        w.arena.resolveBattle(id);

        // 50 fee: 5 burned, 25 bounty to the defender, 20 to Treasury.
        assertEq(chog.balanceOf(bobAcc), 1_000 ether + 25 ether);
        assertEq(chog.balanceOf(DEAD), 5 ether);
        assertEq(chog.balanceOf(address(w.treasury)) - treasuryBefore, 20 ether);
        assertEq(w.arena.defenseStreak(_key(BOB_CHOG)), 1);
        assertTrue(w.state.isInjured(_key(ALICE_CHOG)));
    }

    function test_GiantSlayerTitle() public {
        // Alice's Chog (weakest DNA in the fixture) is exactly GIANT_GAP levels above Carol's,
        // and Carol carries top gear and battle scars.
        bytes32 aliceKey = _key(ALICE_CHOG);
        bytes32 carolKey = _key(CAROL_CHOG);
        vm.startPrank(address(w.quests));
        w.state.grantXp(aliceKey, 750); // level 6
        w.items.grantLoot(carolAcc, 13, 1);
        w.items.grantLoot(carolAcc, 23, 1);
        for (uint256 i; i < 5; i++) {
            w.state.addScar(carolKey);
        }
        vm.stopPrank();
        assertEq(w.state.levelOf(aliceKey), 6);

        uint64 id = _attack(carol, carolAcc, ALICE_CHOG, 0);
        _mine(3);
        w.arena.resolveBattle(id);
        assertEq(w.state.character(carolKey).wins, 1, "geared, scarred Carol beats an ungeared level 6");
        assertTrue(w.state.character(carolKey).titles & (uint32(1) << w.state.TITLE_GIANT_SLAYER()) != 0);
        assertEq(w.items.balanceOf(carolAcc, 1000 + w.state.TITLE_GIANT_SLAYER()), 1);
    }

    function test_NoGiantSlayerBelowGap() public {
        _champion(ALICE_CHOG);
        uint64 id = _attack(alice, aliceAcc, BOB_CHOG, 0);
        _mine(3);
        w.arena.resolveBattle(id);
        assertTrue(w.state.character(_key(ALICE_CHOG)).titles & (uint32(1) << w.state.TITLE_GIANT_SLAYER()) == 0);
    }

    function test_UnbrokenAfterFiveDefenses() public {
        _champion(BOB_CHOG);
        address[3] memory owners = [alice, carol, alice];
        address[3] memory accs = [aliceAcc, carolAcc, aliceAcc];
        uint256 defenses;
        for (uint256 round; round < 5; round++) {
            uint256 idx = round % 2 == 0 ? 0 : 1;
            vm.warp(block.timestamp + 2 hours); // clear injuries and the pair cooldown
            uint64 id = _attack(owners[idx], accs[idx], BOB_CHOG, 0);
            _mine(3);
            w.arena.resolveBattle(id);
            defenses++;
        }
        assertEq(w.arena.defenseStreak(_key(BOB_CHOG)), defenses);
        assertTrue(w.state.character(_key(BOB_CHOG)).titles & (uint32(1) << w.state.TITLE_UNBROKEN()) != 0);
    }

    function test_AttackGuards() public {
        vm.expectRevert(Arena.SelfBattle.selector);
        _attack(alice, aliceAcc, ALICE_CHOG, 0);

        // Same owner, different Chog.
        _awaken(alice, ALICE_SECOND, 0);
        vm.expectRevert(Arena.SameOwner.selector);
        _attack(alice, aliceAcc, ALICE_SECOND, 0);

        vm.expectRevert(Arena.BadTier.selector);
        _attack(alice, aliceAcc, BOB_CHOG, 3);

        // Unawakened defender.
        nft.mint(bob, 9);
        vm.expectRevert(Arena.NotAwakened.selector);
        _attack(alice, aliceAcc, 9, 0);

        // One pending battle per attacker.
        _attack(alice, aliceAcc, BOB_CHOG, 0);
        vm.expectRevert(Arena.BattlePending.selector);
        _attack(alice, aliceAcc, CAROL_CHOG, 0);
    }

    function test_PairCooldown() public {
        _champion(ALICE_CHOG);
        uint64 id = _attack(alice, aliceAcc, BOB_CHOG, 0);
        _mine(3);
        w.arena.resolveBattle(id);
        bytes32 bobKey = _key(BOB_CHOG);
        vm.prank(address(w.items));
        w.state.heal(bobKey);
        vm.expectRevert(Arena.PairCooldown.selector);
        _attack(alice, aliceAcc, BOB_CHOG, 0);
        // Reverse direction shares the pair key.
        vm.expectRevert(Arena.PairCooldown.selector);
        _attack(bob, bobAcc, ALICE_CHOG, 0);
    }

    function test_InjuredCannotFightOrBeAttacked() public {
        bytes32 bobKey = _key(BOB_CHOG);
        vm.prank(address(w.quests));
        w.state.injure(bobKey, 1 hours);
        vm.expectRevert(Arena.DefenderInjured.selector);
        _attack(alice, aliceAcc, BOB_CHOG, 0);
        vm.expectRevert(Arena.ChogInjured.selector);
        _attack(bob, bobAcc, ALICE_CHOG, 0);
    }

    function test_DefenderRateLimit() public {
        // Three different attackers within an hour, then the defender is busy.
        nft.mint(makeAddr("dave"), 10);
        address daveAcc = _awaken(makeAddr("dave"), 10, 100 ether);
        _approveFrom(makeAddr("dave"), daveAcc, address(w.arena), type(uint256).max);
        nft.mint(makeAddr("erin"), 11);
        address erinAcc = _awaken(makeAddr("erin"), 11, 100 ether);
        _approveFrom(makeAddr("erin"), erinAcc, address(w.arena), type(uint256).max);

        _attack(alice, aliceAcc, CAROL_CHOG, 0);
        _attack(bob, bobAcc, CAROL_CHOG, 0);
        _attack(makeAddr("dave"), daveAcc, CAROL_CHOG, 0);
        vm.expectRevert(Arena.DefenderBusy.selector);
        _attack(makeAddr("erin"), erinAcc, CAROL_CHOG, 0);
    }

    function test_LateBattleIsVoidedAndRefunded() public {
        uint64 id = _attack(alice, aliceAcc, BOB_CHOG, 2);
        _mine(300);
        w.arena.resolveBattle(id);
        assertEq(chog.balanceOf(aliceAcc), 1_000 ether, "full refund");
        assertEq(w.state.character(_key(ALICE_CHOG)).wins + w.state.character(_key(ALICE_CHOG)).losses, 0);
        vm.expectRevert(Arena.AlreadyResolved.selector);
        w.arena.resolveBattle(id);
    }

    function test_ResolveGuards() public {
        vm.expectRevert(Arena.UnknownBattle.selector);
        w.arena.resolveBattle(42);
        uint64 id = _attack(alice, aliceAcc, BOB_CHOG, 0);
        vm.expectRevert(Arena.SeedNotReady.selector);
        w.arena.resolveBattle(id);
    }

    function test_RivalryCounts() public {
        _champion(ALICE_CHOG);
        for (uint256 i; i < 3; i++) {
            uint64 id = _attack(alice, aliceAcc, BOB_CHOG, 0);
            _mine(3);
            w.arena.resolveBattle(id);
            vm.warp(block.timestamp + 2 hours);
        }
        assertEq(w.arena.rivalry(w.arena.pairKeyOf(_key(ALICE_CHOG), _key(BOB_CHOG))), 3);
    }
}
