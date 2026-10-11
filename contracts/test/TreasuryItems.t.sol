// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ChogWorldBase} from "./ChogWorldBase.t.sol";
import {Treasury} from "../src/Treasury.sol";
import {ChogItems} from "../src/ChogItems.sol";
import {ChogState} from "../src/ChogState.sol";

contract TreasuryTest is ChogWorldBase {
    function test_PayClampsToDailyEmission() public {
        vm.prank(admin);
        w.treasury.setDailyEmissionCap(100 ether);
        vm.startPrank(address(w.quests));
        assertEq(w.treasury.pay(alice, 70 ether), 70 ether);
        assertEq(w.treasury.pay(alice, 70 ether), 30 ether, "clamped to remaining");
        assertEq(w.treasury.pay(alice, 1 ether), 0);
        vm.warp(block.timestamp + 1 days);
        assertEq(w.treasury.pay(alice, 50 ether), 50 ether, "window resets");
        vm.stopPrank();
        assertEq(chog.balanceOf(alice), 150 ether);
    }

    function test_PayClampsToBalance() public {
        vm.prank(admin);
        w.treasury.withdraw(admin, 99_990 ether);
        vm.prank(address(w.arena));
        assertEq(w.treasury.pay(alice, 50 ether), 10 ether);
    }

    function test_OnlyGamesPay() public {
        vm.prank(alice);
        vm.expectRevert();
        w.treasury.pay(alice, 1 ether);
    }

    function test_BurnBpsBounded() public {
        vm.prank(admin);
        vm.expectRevert(Treasury.BurnTooHigh.selector);
        w.treasury.setBurnBps(5_001);
    }
}

contract ChogItemsTest is ChogWorldBase {
    address internal constant DEAD = 0x000000000000000000000000000000000000dEaD;

    function test_BuySplitsFeeBetweenBurnAndTreasury() public {
        address account = _awaken(alice, ALICE_CHOG, 100 ether);
        uint256 treasuryBefore = chog.balanceOf(address(w.treasury));
        _approveFrom(alice, account, address(w.items), 30 ether);
        _accountCall(alice, account, address(w.items), abi.encodeCall(ChogItems.buy, (1, 2)));
        assertEq(w.items.balanceOf(account, 1), 2);
        assertEq(chog.balanceOf(account), 70 ether);
        assertEq(chog.balanceOf(DEAD), 3 ether, "10% burned");
        assertEq(chog.balanceOf(address(w.treasury)) - treasuryBefore, 27 ether);
    }

    function test_BuyRejectsBadInput() public {
        vm.expectRevert(ChogItems.ItemUnavailable.selector);
        w.items.buy(99, 1);
        vm.expectRevert(ChogItems.BadQuantity.selector);
        w.items.buy(1, 0);
        vm.expectRevert(ChogItems.BadQuantity.selector);
        w.items.buy(1, 11);
    }

    function test_PotionHealsAndElixirBuffs() public {
        address account = _awaken(alice, ALICE_CHOG, 100 ether);
        bytes32 key = _key(ALICE_CHOG);
        vm.prank(address(w.arena));
        w.state.injure(key, 1 hours);
        assertTrue(w.state.isInjured(key));

        _approveFrom(alice, account, address(w.items), 40 ether);
        _accountCall(alice, account, address(w.items), abi.encodeCall(ChogItems.buy, (1, 1)));
        _accountCall(alice, account, address(w.items), abi.encodeCall(ChogItems.buy, (2, 1)));
        _accountCall(alice, account, address(w.items), abi.encodeCall(ChogItems.use, (1)));
        assertFalse(w.state.isInjured(key));
        _accountCall(alice, account, address(w.items), abi.encodeCall(ChogItems.use, (2)));
        assertEq(w.state.character(key).buffUntil, block.timestamp + 24 hours);
        assertEq(w.items.balanceOf(account, 1), 0);
        assertEq(w.items.balanceOf(account, 2), 0);
    }

    function test_UseRequiresChogAccountAndConsumable() public {
        address account = _awaken(alice, ALICE_CHOG, 200 ether);
        vm.expectRevert(ChogState.NotChogAccount.selector);
        vm.prank(alice);
        w.items.use(1);

        _approveFrom(alice, account, address(w.items), 40 ether);
        _accountCall(alice, account, address(w.items), abi.encodeCall(ChogItems.buy, (11, 1)));
        vm.expectRevert(ChogItems.NotUsable.selector);
        _accountCall(alice, account, address(w.items), abi.encodeCall(ChogItems.use, (11)));
    }

    function test_TrophiesAreSoulbound() public {
        address account = _awaken(alice, ALICE_CHOG, 0);
        bytes32 key = _key(ALICE_CHOG);
        vm.prank(address(w.arena));
        w.state.awardTitle(key, 0);
        assertEq(w.items.balanceOf(account, 1000), 1);
        // Even the Chog's own account cannot move a trophy.
        vm.expectRevert(ChogItems.Soulbound.selector);
        _accountCall(
            alice,
            account,
            address(w.items),
            abi.encodeWithSignature(
                "safeTransferFrom(address,address,uint256,uint256,bytes)", account, bob, 1000, 1, ""
            )
        );
    }

    function test_TrophyMintOnlyFromState() public {
        vm.prank(admin);
        vm.expectRevert(ChogItems.OnlyState.selector);
        w.items.mintTrophy(alice, 0);
    }

    function test_GearTiersAndValidation() public {
        assertEq(w.items.bestTier(alice, 0), 0);
        vm.startPrank(address(w.quests));
        w.items.grantLoot(alice, 11, 1);
        w.items.grantLoot(alice, 13, 1);
        w.items.grantLoot(alice, 22, 1);
        vm.expectRevert(ChogItems.BadItem.selector);
        w.items.grantLoot(alice, 1000, 1);
        vm.stopPrank();
        assertEq(w.items.bestTier(alice, 0), 3);
        assertEq(w.items.bestTier(alice, 1), 2);

        vm.startPrank(admin);
        vm.expectRevert(ChogItems.BadItem.selector);
        w.items.setItem(14, 1 ether, ChogItems.Kind.WEAPON, 4, true);
        vm.expectRevert(ChogItems.BadItem.selector);
        w.items.setItem(12, 1 ether, ChogItems.Kind.WEAPON, 1, true);
        vm.expectRevert(ChogItems.BadItem.selector);
        w.items.setItem(1001, 1 ether, ChogItems.Kind.POTION, 0, true);
        vm.stopPrank();
    }
}
