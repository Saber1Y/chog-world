// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ChogWorldBase} from "./ChogWorldBase.t.sol";
import {ChogState} from "../src/ChogState.sol";
import {ChogItems} from "../src/ChogItems.sol";
import {Stats} from "../src/libraries/ChogDNA.sol";
import {MockChog} from "./mocks/Mocks.sol";

contract ChogStateTest is ChogWorldBase {
    function test_AwakenByOwnerOnly() public {
        vm.prank(bob);
        vm.expectRevert(ChogState.NotChogOwner.selector);
        w.state.awaken(address(nft), ALICE_CHOG);

        vm.prank(alice);
        w.state.awaken(address(nft), ALICE_CHOG);
        ChogState.Character memory c = w.state.character(_key(ALICE_CHOG));
        assertTrue(c.awakened);
        assertEq(c.level, 1);
        assertEq(c.bornAt, block.timestamp);
        (address col, uint256 id) = w.state.refOf(_key(ALICE_CHOG));
        assertEq(col, address(nft));
        assertEq(id, ALICE_CHOG);
    }

    function test_AwakenRejectsUnknownCollection() public {
        MockChog other = new MockChog();
        other.mint(alice, 1);
        vm.prank(alice);
        vm.expectRevert(ChogState.CollectionNotAllowed.selector);
        w.state.awaken(address(other), 1);
    }

    function test_ResolveAccount() public {
        address account = _createAccount(ALICE_CHOG);
        (address col, uint256 id) = w.state.resolveAccount(account);
        assertEq(col, address(nft));
        assertEq(id, ALICE_CHOG);
    }

    function test_ResolveAccountRejectsImpostors() public {
        // An EOA.
        vm.expectRevert(ChogState.NotChogAccount.selector);
        w.state.resolveAccount(alice);

        // A contract that is not an account.
        vm.expectRevert(ChogState.NotChogAccount.selector);
        w.state.resolveAccount(address(w.treasury));

        // A real account for a collection that is not allowed.
        MockChog other = new MockChog();
        other.mint(alice, 1);
        address foreign = REGISTRY.createAccount(address(accountImpl), bytes32(0), block.chainid, address(other), 1);
        vm.expectRevert(ChogState.NotChogAccount.selector);
        w.state.resolveAccount(foreign);

        // An account on a non-canonical salt claims the right token but is not the canonical account.
        address salted =
            REGISTRY.createAccount(address(accountImpl), bytes32(uint256(1)), block.chainid, address(nft), ALICE_CHOG);
        vm.expectRevert(ChogState.NotChogAccount.selector);
        w.state.resolveAccount(salted);
    }

    function test_SetGoalsOwnerOnly() public {
        _awaken(alice, ALICE_CHOG, 0);
        vm.prank(bob);
        vm.expectRevert(ChogState.NotChogOwner.selector);
        w.state.setGoals(address(nft), ALICE_CHOG, 0x3);

        vm.prank(alice);
        w.state.setGoals(address(nft), ALICE_CHOG, 0x3);
        assertEq(w.state.character(_key(ALICE_CHOG)).goalMask, 0x3);
    }

    function test_SetGoalsForRequiresGameRole() public {
        _awaken(alice, ALICE_CHOG, 0);
        bytes32 key = _key(ALICE_CHOG);
        vm.prank(alice);
        vm.expectRevert();
        w.state.setGoalsFor(key, 0x1);
        vm.prank(address(w.operator));
        w.state.setGoalsFor(key, 0x5);
        assertEq(w.state.character(key).goalMask, 0x5);
        vm.prank(alice);
        vm.expectRevert(ChogState.BadGoals.selector);
        w.state.setGoals(address(nft), ALICE_CHOG, 0xff);
    }

    function test_CheckInStreakAndBuff() public {
        _awaken(alice, ALICE_CHOG, 0);
        vm.startPrank(alice);
        w.state.checkIn(address(nft), ALICE_CHOG);
        ChogState.Character memory c = w.state.character(_key(ALICE_CHOG));
        assertEq(c.streak, 1);
        assertEq(c.buffUntil, block.timestamp + 24 hours);
        assertEq(c.xp, 10);

        vm.expectRevert(ChogState.CheckInTooSoon.selector);
        w.state.checkIn(address(nft), ALICE_CHOG);

        for (uint256 i = 2; i <= 7; i++) {
            vm.warp(block.timestamp + 21 hours);
            w.state.checkIn(address(nft), ALICE_CHOG);
        }
        c = w.state.character(_key(ALICE_CHOG));
        assertEq(c.streak, 7);
        assertTrue(c.titles & (uint32(1) << w.state.TITLE_DEVOTED()) != 0, "devoted title");
        assertEq(w.items.balanceOf(_account(ALICE_CHOG), 1000 + w.state.TITLE_DEVOTED()), 1, "trophy minted to account");

        // Missing the 48h window resets the streak.
        vm.warp(block.timestamp + 49 hours);
        w.state.checkIn(address(nft), ALICE_CHOG);
        assertEq(w.state.character(_key(ALICE_CHOG)).streak, 1);
        vm.stopPrank();
    }

    function test_XpLevelsAndBuff() public {
        _awaken(alice, ALICE_CHOG, 0);
        bytes32 key = _key(ALICE_CHOG);
        vm.startPrank(address(w.quests));
        w.state.grantXp(key, 49);
        assertEq(w.state.levelOf(key), 1);
        w.state.grantXp(key, 1);
        assertEq(w.state.levelOf(key), 2);
        w.state.grantXp(key, 100);
        assertEq(w.state.levelOf(key), 3);
        w.state.buff(key, 1 hours);
        assertEq(w.state.grantXp(key, 20), 30, "buff gives +50%");
        vm.stopPrank();
        assertEq(w.state.levelForXp(type(uint32).max), w.state.MAX_LEVEL());
    }

    function test_GameHooksRequireRole() public {
        _awaken(alice, ALICE_CHOG, 0);
        bytes32 key = _key(ALICE_CHOG);
        vm.startPrank(alice);
        vm.expectRevert();
        w.state.grantXp(key, 1000);
        vm.expectRevert();
        w.state.adjustRep(key, 100, 0);
        vm.expectRevert();
        w.state.heal(key);
        vm.stopPrank();
    }

    function test_HooksRequireAwakened() public {
        bytes32 key = _key(ALICE_CHOG);
        vm.prank(address(w.quests));
        vm.expectRevert(ChogState.NotAwakened.selector);
        w.state.grantXp(key, 10);
    }

    function test_RepTracksSeason() public {
        _awaken(alice, ALICE_CHOG, 0);
        bytes32 key = _key(ALICE_CHOG);
        vm.prank(address(w.arena));
        w.state.adjustRep(key, 10, 3);
        assertEq(w.state.seasonRep(1, key), 10);
        vm.prank(admin);
        w.state.startSeason();
        vm.prank(address(w.arena));
        w.state.adjustRep(key, -4, 4);
        assertEq(w.state.repOf(key), 6);
        assertEq(w.state.seasonRep(2, key), -4);
    }

    function test_ExplorerTitleAfterAllZones() public {
        _awaken(alice, ALICE_CHOG, 0);
        bytes32 key = _key(ALICE_CHOG);
        vm.startPrank(address(w.quests));
        for (uint8 z; z < 4; z++) {
            assertTrue(w.state.visitZone(key, z));
            assertFalse(w.state.visitZone(key, z));
        }
        vm.expectRevert(ChogState.BadZone.selector);
        w.state.visitZone(key, 4);
        vm.stopPrank();
        assertTrue(w.state.character(key).titles & (uint32(1) << w.state.TITLE_EXPLORER()) != 0);
    }

    function test_CombatStatsGrowWithLevelScarsAndGear() public {
        address account = _awaken(alice, ALICE_CHOG, 1_000 ether);
        bytes32 key = _key(ALICE_CHOG);
        Stats memory base = w.state.combatStats(address(nft), ALICE_CHOG);

        vm.startPrank(address(w.quests));
        w.state.grantXp(key, 150); // level 3
        w.state.addScar(key);
        vm.stopPrank();

        _approveFrom(alice, account, address(w.items), type(uint256).max);
        _accountCall(alice, account, address(w.items), abi.encodeCall(ChogItems.buy, (12, 1)));
        _accountCall(alice, account, address(w.items), abi.encodeCall(ChogItems.buy, (21, 1)));

        Stats memory s = w.state.combatStats(address(nft), ALICE_CHOG);
        assertEq(s.hp, base.hp + 10 + 5, "level + armor t1");
        assertEq(s.atk, base.atk + 2 + 6, "level + weapon t2");
        assertEq(s.def, base.def + 1 + 1 + 2, "level + scar + armor t1");
        assertEq(s.spd, base.spd, "spd grows every 3 levels");
        assertEq(s.element, base.element);
    }

    function test_ScarBonusIsCapped() public {
        _awaken(alice, ALICE_CHOG, 0);
        bytes32 key = _key(ALICE_CHOG);
        Stats memory base = w.state.combatStats(address(nft), ALICE_CHOG);
        vm.startPrank(address(w.quests));
        for (uint256 i; i < 9; i++) {
            w.state.addScar(key);
        }
        vm.stopPrank();
        assertEq(w.state.combatStats(address(nft), ALICE_CHOG).def, base.def + 5);
    }
}
