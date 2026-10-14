// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IAccountV3} from "../src/interfaces/IERC6551.sol";
import {ChogWorldBase} from "./ChogWorldBase.t.sol";
import {ChogOperator} from "../src/ChogOperator.sol";
import {QuestBoard} from "../src/QuestBoard.sol";
import {ChogState} from "../src/ChogState.sol";

contract ChogOperatorTest is ChogWorldBase {
    uint32 internal constant SLIME = 0; // fee 5
    uint32 internal constant TRAIN = 7; // fee 3

    address internal aliceAcc;
    uint256 internal nonce;

    function setUp() public override {
        super.setUp();
        aliceAcc = _enroll(alice, ALICE_CHOG, 1_000 ether);
    }

    function _aid() internal returns (bytes32) {
        return keccak256(abi.encode("action", nonce++));
    }

    function _blockedReason(Vm.Log[] memory logs) internal view returns (string memory) {
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(w.operator) && logs[i].topics[0] == ChogOperator.ActionBlocked.selector) {
                (, bytes32 actionId, string memory reason) = abi.decode(logs[i].data, (uint256, bytes32, string));
                actionId;
                return reason;
            }
        }
        return "";
    }

    function _quest(uint32 questId) internal returns (bool ok, string memory reason) {
        vm.recordLogs();
        vm.prank(keeper);
        ok = w.operator.startQuest(address(nft), ALICE_CHOG, questId, _aid());
        reason = _blockedReason(vm.getRecordedLogs());
    }

    function _resolveAlice() internal {
        _mine(3);
        w.quests.resolveQuest(address(nft), ALICE_CHOG);
    }

    // ---------------------------------------------------------------------
    // Enrollment
    // ---------------------------------------------------------------------

    function test_EnrollAwakensAndStoresPolicy() public view {
        ChogOperator.Policy memory p = w.operator.policyOf(address(nft), ALICE_CHOG);
        assertEq(p.owner, alice);
        assertTrue(p.active);
        assertEq(p.dailyCap, 150 ether);
        assertTrue(w.state.isAwakened(_key(ALICE_CHOG)));
        assertTrue(w.operator.isActive(address(nft), ALICE_CHOG));
        assertEq(w.operator.remainingDailyCap(address(nft), ALICE_CHOG), 150 ether);
    }

    function test_EnrollSetsGoalsInTheSameCall() public {
        _createAccount(BOB_CHOG);
        vm.prank(bob);
        w.operator.enroll(address(nft), BOB_CHOG, _defaultPolicy(), 0x0a); // money + strongest
        assertEq(w.state.character(_key(BOB_CHOG)).goalMask, 0x0a);
    }

    function test_EnrollRejectsUnknownGoals() public {
        ChogOperator.PolicyParams memory p = _defaultPolicy();
        vm.prank(bob);
        vm.expectRevert(ChogState.BadGoals.selector);
        w.operator.enroll(address(nft), BOB_CHOG, p, 0x10);
    }

    function test_EnrollOnlyByOwner() public {
        ChogOperator.PolicyParams memory p = _defaultPolicy();
        vm.prank(alice);
        vm.expectRevert(ChogOperator.NotChogOwner.selector);
        w.operator.enroll(address(nft), BOB_CHOG, p, 0);
    }

    function test_EnrollRejectsBadPolicy() public {
        ChogOperator.PolicyParams memory p = _defaultPolicy();
        p.actionMask = 0;
        vm.prank(bob);
        vm.expectRevert(ChogOperator.BadPolicy.selector);
        w.operator.enroll(address(nft), BOB_CHOG, p, 0);

        p = _defaultPolicy();
        p.actionMask = 0x10;
        vm.prank(bob);
        vm.expectRevert(ChogOperator.BadPolicy.selector);
        w.operator.enroll(address(nft), BOB_CHOG, p, 0);

        p = _defaultPolicy();
        p.maxPerAction = p.dailyCap + 1;
        vm.prank(bob);
        vm.expectRevert(ChogOperator.BadPolicy.selector);
        w.operator.enroll(address(nft), BOB_CHOG, p, 0);

        p = _defaultPolicy();
        p.maxActionsPerDay = 0;
        vm.prank(bob);
        vm.expectRevert(ChogOperator.BadPolicy.selector);
        w.operator.enroll(address(nft), BOB_CHOG, p, 0);

        p = _defaultPolicy();
        p.expiry = uint64(block.timestamp);
        vm.prank(bob);
        vm.expectRevert(ChogOperator.BadPolicy.selector);
        w.operator.enroll(address(nft), BOB_CHOG, p, 0);
    }

    // ---------------------------------------------------------------------
    // Happy path
    // ---------------------------------------------------------------------

    function test_KeeperRunsQuestThroughAccount() public {
        uint256 before = chog.balanceOf(aliceAcc);
        (bool ok,) = _quest(SLIME);
        assertTrue(ok);
        assertEq(before - chog.balanceOf(aliceAcc), 5 ether);
        assertEq(chog.allowance(aliceAcc, address(w.quests)), 0, "allowance reset after the action");
        assertEq(w.operator.remainingDailyCap(address(nft), ALICE_CHOG), 145 ether);
        _resolveAlice();
        assertGt(w.state.character(_key(ALICE_CHOG)).xp, 0);
    }

    function test_KeeperBuysAndUsesItems() public {
        vm.prank(keeper);
        assertTrue(w.operator.buyItem(address(nft), ALICE_CHOG, 1, 2, _aid()));
        assertEq(w.items.balanceOf(aliceAcc, 1), 2);
        assertEq(chog.allowance(aliceAcc, address(w.items)), 0);

        bytes32 key = _key(ALICE_CHOG);
        vm.prank(address(w.arena));
        w.state.injure(key, 1 hours);
        vm.prank(keeper);
        assertTrue(w.operator.useItem(address(nft), ALICE_CHOG, 1, _aid()));
        assertFalse(w.state.isInjured(key));
    }

    function test_KeeperAttacks() public {
        address bobAcc = _enroll(bob, BOB_CHOG, 100 ether);
        bobAcc;
        vm.prank(keeper);
        assertTrue(w.operator.attack(address(nft), ALICE_CHOG, address(nft), BOB_CHOG, 1, _aid()));
        assertEq(chog.balanceOf(address(w.arena)), 50 ether);
        assertEq(chog.allowance(aliceAcc, address(w.arena)), 0);
    }

    function test_GameRevertBubblesUp() public {
        (bool ok,) = _quest(SLIME);
        assertTrue(ok);
        // A second quest while one is running reverts inside the game and the whole action reverts,
        // so no budget is consumed.
        bytes32 aid = _aid();
        vm.prank(keeper);
        vm.expectRevert(QuestBoard.RunInProgress.selector);
        w.operator.startQuest(address(nft), ALICE_CHOG, TRAIN, aid);
        assertEq(w.operator.remainingDailyCap(address(nft), ALICE_CHOG), 145 ether);
        assertFalse(w.operator.usedAction(aid));
    }

    // ---------------------------------------------------------------------
    // Policy fences (ported from SpendArcVault scenarios)
    // ---------------------------------------------------------------------

    function test_OnlyKeeper() public {
        bytes32 aid = _aid();
        vm.prank(alice);
        vm.expectRevert(ChogOperator.NotKeeper.selector);
        w.operator.startQuest(address(nft), ALICE_CHOG, SLIME, aid);
    }

    function test_BlocksOverMaxPerAction() public {
        vm.prank(keeper);
        // Tier 2 attack costs 200 > maxPerAction 60.
        vm.recordLogs();
        bool ok = w.operator.attack(address(nft), ALICE_CHOG, address(nft), BOB_CHOG, 2, _aid());
        assertFalse(ok);
        assertEq(_blockedReason(vm.getRecordedLogs()), "exceeds maxPerAction");
    }

    function test_BlocksOverDailyCapAndResetsAfterWindow() public {
        ChogOperator.PolicyParams memory p = _defaultPolicy();
        p.dailyCap = 8 ether;
        p.maxPerAction = 5 ether;
        vm.prank(alice);
        w.operator.updatePolicy(address(nft), ALICE_CHOG, p);

        (bool ok,) = _quest(SLIME); // 5
        assertTrue(ok);
        _resolveAlice();
        string memory reason;
        (ok, reason) = _quest(SLIME); // would be 10 > 8
        assertFalse(ok);
        assertEq(reason, "exceeds dailyCap");
        (ok,) = _quest(TRAIN); // 8 <= 8
        assertTrue(ok);
        _resolveAlice();

        vm.warp(block.timestamp + 1 days);
        assertEq(w.operator.remainingDailyCap(address(nft), ALICE_CHOG), 8 ether);
        (ok,) = _quest(SLIME);
        assertTrue(ok);
    }

    function test_BlocksOverMaxActionsPerDay() public {
        ChogOperator.PolicyParams memory p = _defaultPolicy();
        p.maxActionsPerDay = 1;
        vm.prank(alice);
        w.operator.updatePolicy(address(nft), ALICE_CHOG, p);
        (bool ok,) = _quest(TRAIN);
        assertTrue(ok);
        _resolveAlice();
        string memory reason;
        (ok, reason) = _quest(SLIME);
        assertFalse(ok);
        assertEq(reason, "exceeds maxActionsPerDay");
    }

    function test_BlocksDuplicateAction() public {
        bytes32 aid = _aid();
        vm.prank(keeper);
        assertTrue(w.operator.startQuest(address(nft), ALICE_CHOG, TRAIN, aid));
        _resolveAlice();
        vm.recordLogs();
        vm.prank(keeper);
        assertFalse(w.operator.startQuest(address(nft), ALICE_CHOG, SLIME, aid));
        assertEq(_blockedReason(vm.getRecordedLogs()), "duplicate action");
    }

    function test_BlocksDisallowedActionKind() public {
        ChogOperator.PolicyParams memory p = _defaultPolicy();
        p.actionMask = uint8(1) << w.operator.ACTION_QUEST();
        vm.prank(alice);
        w.operator.updatePolicy(address(nft), ALICE_CHOG, p);
        vm.recordLogs();
        vm.prank(keeper);
        assertFalse(w.operator.buyItem(address(nft), ALICE_CHOG, 1, 1, _aid()));
        assertEq(_blockedReason(vm.getRecordedLogs()), "action not allowed");
    }

    function test_PauseAndUnpause() public {
        vm.prank(alice);
        w.operator.setPaused(address(nft), ALICE_CHOG, true);
        (bool ok, string memory reason) = _quest(SLIME);
        assertFalse(ok);
        assertEq(reason, "paused");
        assertEq(w.operator.inactiveReason(address(nft), ALICE_CHOG), "paused");
        vm.prank(alice);
        w.operator.setPaused(address(nft), ALICE_CHOG, false);
        (ok,) = _quest(SLIME);
        assertTrue(ok);
    }

    function test_Expiry() public {
        ChogOperator.PolicyParams memory p = _defaultPolicy();
        p.expiry = uint64(block.timestamp + 1 hours);
        vm.prank(alice);
        w.operator.updatePolicy(address(nft), ALICE_CHOG, p);
        vm.warp(block.timestamp + 2 hours);
        (bool ok, string memory reason) = _quest(SLIME);
        assertFalse(ok);
        assertEq(reason, "policy expired");
    }

    function test_Revoke() public {
        vm.prank(alice);
        w.operator.revoke(address(nft), ALICE_CHOG);
        (bool ok, string memory reason) = _quest(SLIME);
        assertFalse(ok);
        assertEq(reason, "not enrolled");
        vm.prank(alice);
        vm.expectRevert(ChogOperator.NotEnrolled.selector);
        w.operator.setPaused(address(nft), ALICE_CHOG, false);
    }

    function test_OwnerRevokingAccountPermissionStopsAgent() public {
        address[] memory callers = new address[](1);
        callers[0] = address(w.operator);
        bool[] memory perms = new bool[](1);
        vm.prank(alice);
        IAccountV3(aliceAcc).setPermissions(callers, perms);
        (bool ok, string memory reason) = _quest(SLIME);
        assertFalse(ok);
        assertEq(reason, "permission not granted");
    }

    function test_OnlyOwnerConfigures() public {
        ChogOperator.PolicyParams memory p = _defaultPolicy();
        vm.startPrank(bob);
        vm.expectRevert(ChogOperator.NotChogOwner.selector);
        w.operator.updatePolicy(address(nft), ALICE_CHOG, p);
        vm.expectRevert(ChogOperator.NotChogOwner.selector);
        w.operator.setPaused(address(nft), ALICE_CHOG, true);
        vm.expectRevert(ChogOperator.NotChogOwner.selector);
        w.operator.revoke(address(nft), ALICE_CHOG);
        vm.stopPrank();
    }

    // ---------------------------------------------------------------------
    // Ownership transfer: the character moves, the agent's authority does not
    // ---------------------------------------------------------------------

    function test_TransferKillsPolicyButAssetsTravel() public {
        (bool ok,) = _quest(SLIME);
        assertTrue(ok);
        _resolveAlice();
        uint256 balance = chog.balanceOf(aliceAcc);
        uint256 xp = w.state.character(_key(ALICE_CHOG)).xp;

        vm.prank(alice);
        nft.transferFrom(alice, bob, ALICE_CHOG);

        assertEq(w.operator.inactiveReason(address(nft), ALICE_CHOG), "owner changed");
        vm.recordLogs();
        vm.prank(keeper);
        ok = w.operator.startQuest(address(nft), ALICE_CHOG, SLIME, _aid());
        Vm.Log[] memory logs = vm.getRecordedLogs();
        assertFalse(ok);
        assertEq(_blockedReason(logs), "owner changed");
        assertFalse(w.operator.policyOf(address(nft), ALICE_CHOG).active, "policy retired");

        // Bob now owns the Chog, its account, its $CHOG and its progression.
        assertEq(chog.balanceOf(aliceAcc), balance);
        assertEq(w.state.character(_key(ALICE_CHOG)).xp, xp);
        vm.prank(bob);
        IAccountV3(aliceAcc)
            .execute(address(chog), 0, abi.encodeWithSignature("transfer(address,uint256)", bob, 1 ether), 0);
        assertEq(chog.balanceOf(bob), 1 ether);

        // Alice can no longer configure it, even though her old policy still names her.
        vm.prank(alice);
        vm.expectRevert(ChogOperator.NotEnrolled.selector);
        w.operator.setPaused(address(nft), ALICE_CHOG, true);
    }

    function test_StalePolicyStaysDeadIfNftComesBack() public {
        vm.prank(alice);
        nft.transferFrom(alice, bob, ALICE_CHOG);
        vm.prank(keeper);
        w.operator.startQuest(address(nft), ALICE_CHOG, SLIME, _aid()); // retires the policy
        vm.prank(bob);
        nft.transferFrom(bob, alice, ALICE_CHOG);
        (bool ok, string memory reason) = _quest(SLIME);
        assertFalse(ok);
        assertEq(reason, "not enrolled");
    }

    function test_NewOwnerCanReEnroll() public {
        vm.prank(alice);
        nft.transferFrom(alice, bob, ALICE_CHOG);
        address[] memory callers = new address[](1);
        callers[0] = address(w.operator);
        bool[] memory perms = new bool[](1);
        perms[0] = true;
        vm.startPrank(bob);
        IAccountV3(aliceAcc).setPermissions(callers, perms);
        w.operator.enroll(address(nft), ALICE_CHOG, _defaultPolicy(), 0);
        vm.stopPrank();
        (bool ok,) = _quest(SLIME);
        assertTrue(ok);
    }

    // ---------------------------------------------------------------------
    // Guardian
    // ---------------------------------------------------------------------

    function test_GuardianPauseStopsEverything() public {
        vm.prank(admin);
        w.operator.setGuardianPaused(true);
        bytes32 aid = _aid();
        vm.prank(keeper);
        vm.expectRevert(ChogOperator.GuardianPaused.selector);
        w.operator.startQuest(address(nft), ALICE_CHOG, SLIME, aid);
        assertEq(w.operator.inactiveReason(address(nft), ALICE_CHOG), "guardian paused");
    }

    function test_GuardianRotatesKeeper() public {
        address newKeeper = makeAddr("newKeeper");
        vm.prank(alice);
        vm.expectRevert(ChogOperator.NotGuardian.selector);
        w.operator.setKeeper(newKeeper);
        vm.prank(admin);
        w.operator.setKeeper(newKeeper);
        bytes32 aid = _aid();
        vm.prank(keeper);
        vm.expectRevert(ChogOperator.NotKeeper.selector);
        w.operator.startQuest(address(nft), ALICE_CHOG, SLIME, aid);
        vm.prank(newKeeper);
        assertTrue(w.operator.startQuest(address(nft), ALICE_CHOG, SLIME, aid));
    }
}
