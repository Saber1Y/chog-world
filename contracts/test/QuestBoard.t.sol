// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {ChogWorldBase} from "./ChogWorldBase.t.sol";
import {QuestBoard} from "../src/QuestBoard.sol";
import {ChogState} from "../src/ChogState.sol";
import {Stats} from "../src/libraries/ChogDNA.sol";

contract QuestBoardTest is ChogWorldBase {
    uint32 internal constant SLIME = 0;
    uint32 internal constant WYRM = 2;
    uint32 internal constant EXPLORE_0 = 3;
    uint32 internal constant TRAIN = 7;
    uint32 internal constant DOOM = 50;

    address internal account;

    function setUp() public override {
        super.setUp();
        account = _awaken(alice, ALICE_CHOG, 500 ether);
        _approveFrom(alice, account, address(w.quests), type(uint256).max);

        // A quest no Chog can win, for loss-path tests.
        QuestBoard.Quest memory q = w.quests.quest(SLIME);
        q.minLevel = 1;
        q.monster = Stats({hp: 5_000, atk: 400, def: 300, spd: 400, crit: 100, element: 0});
        vm.prank(admin);
        w.quests.setQuest(DOOM, q);
    }

    function _start(uint32 questId) internal {
        _accountCall(alice, account, address(w.quests), abi.encodeCall(QuestBoard.startQuest, (questId)));
    }

    function _resolvedEvent(Vm.Log[] memory logs)
        internal
        view
        returns (bool won, uint32 xp, uint256 reward, bool late)
    {
        bytes32 sig = QuestBoard.QuestResolved.selector;
        for (uint256 i; i < logs.length; i++) {
            if (logs[i].emitter == address(w.quests) && logs[i].topics[0] == sig) {
                uint256 lootId;
                bytes32 seed;
                (won, xp, reward, lootId, seed, late) =
                    abi.decode(logs[i].data, (bool, uint32, uint256, uint256, bytes32, bool));
                return (won, xp, reward, late);
            }
        }
        revert("QuestResolved not emitted");
    }

    function test_StartChargesFeeAndRecordsRun() public {
        uint256 before = chog.balanceOf(account);
        _start(SLIME);
        assertEq(before - chog.balanceOf(account), 5 ether);
        (uint64 runId, uint32 questId, uint64 startBlock) = w.quests.activeRun(_key(ALICE_CHOG));
        assertEq(runId, 1);
        assertEq(questId, SLIME);
        assertEq(startBlock, block.number);
    }

    function test_StartRequiresChogAccount() public {
        vm.prank(alice);
        vm.expectRevert(ChogState.NotChogAccount.selector);
        w.quests.startQuest(SLIME);
    }

    function test_StartGuards() public {
        vm.expectRevert(QuestBoard.LevelTooLow.selector);
        _start(WYRM);

        vm.expectRevert(QuestBoard.QuestUnavailable.selector);
        _start(99);

        _start(SLIME);
        vm.expectRevert(QuestBoard.RunInProgress.selector);
        _start(TRAIN);

        _mine(3);
        w.quests.resolveQuest(address(nft), ALICE_CHOG);
        vm.expectRevert(QuestBoard.OnCooldown.selector);
        _start(SLIME);

        bytes32 key = _key(ALICE_CHOG);
        vm.prank(address(w.arena));
        w.state.injure(key, 1 hours);
        vm.expectRevert(QuestBoard.ChogInjured.selector);
        _start(TRAIN);
    }

    function test_ResolveNeedsSeedBlock() public {
        _start(SLIME);
        assertFalse(w.quests.canResolve(_key(ALICE_CHOG)));
        vm.expectRevert(QuestBoard.SeedNotReady.selector);
        w.quests.resolveQuest(address(nft), ALICE_CHOG);
        _mine(3);
        assertTrue(w.quests.canResolve(_key(ALICE_CHOG)));
        w.quests.resolveQuest(address(nft), ALICE_CHOG);
        vm.expectRevert(QuestBoard.NoActiveRun.selector);
        w.quests.resolveQuest(address(nft), ALICE_CHOG);
    }

    function test_HuntWinPaysRewardXpAndRep() public {
        _start(SLIME);
        _mine(3);
        uint256 before = chog.balanceOf(account);
        vm.recordLogs();
        w.quests.resolveQuest(address(nft), ALICE_CHOG);
        (bool won, uint32 xp, uint256 reward, bool late) = _resolvedEvent(vm.getRecordedLogs());

        assertTrue(won, "every DNA beats the slime");
        assertFalse(late);
        assertEq(xp, 20);
        assertGe(reward, 6 ether);
        assertLe(reward, 12 ether);
        assertEq(chog.balanceOf(account) - before, reward);
        ChogState.Character memory c = w.state.character(_key(ALICE_CHOG));
        assertEq(c.xp, 20);
        assertEq(c.rep, 2);
        assertEq(c.quests, 1);
        assertFalse(w.state.isInjured(_key(ALICE_CHOG)));
    }

    function test_HuntLossInjuresAndHalvesXp() public {
        _start(DOOM);
        _mine(3);
        uint256 before = chog.balanceOf(account);
        vm.recordLogs();
        w.quests.resolveQuest(address(nft), ALICE_CHOG);
        (bool won, uint32 xp, uint256 reward,) = _resolvedEvent(vm.getRecordedLogs());
        assertFalse(won);
        assertEq(xp, 10);
        assertEq(reward, 0);
        assertEq(chog.balanceOf(account), before);
        assertTrue(w.state.isInjured(_key(ALICE_CHOG)));
        assertEq(w.state.repOf(_key(ALICE_CHOG)), 0);
    }

    function test_ExploreDiscoversZoneOnce() public {
        _start(EXPLORE_0);
        _mine(3);
        vm.recordLogs();
        w.quests.resolveQuest(address(nft), ALICE_CHOG);
        (bool won, uint32 xp,,) = _resolvedEvent(vm.getRecordedLogs());
        assertTrue(won);
        assertEq(xp, 15 + 7, "discovery bonus");
        assertEq(w.state.repOf(_key(ALICE_CHOG)), 3);
        assertEq(w.state.character(_key(ALICE_CHOG)).zonesVisited, 1);

        vm.warp(block.timestamp + 2 hours);
        _start(EXPLORE_0);
        _mine(3);
        vm.recordLogs();
        w.quests.resolveQuest(address(nft), ALICE_CHOG);
        (, xp,,) = _resolvedEvent(vm.getRecordedLogs());
        assertEq(xp, 15, "no bonus on a known zone");
    }

    function test_TrainGivesXpOnly() public {
        _start(TRAIN);
        _mine(3);
        uint256 before = chog.balanceOf(account);
        w.quests.resolveQuest(address(nft), ALICE_CHOG);
        assertEq(chog.balanceOf(account), before);
        assertEq(w.state.character(_key(ALICE_CHOG)).xp, 40);
    }

    function test_LateResolveFizzles() public {
        _start(DOOM);
        _mine(300); // past the 256-block window
        vm.recordLogs();
        w.quests.resolveQuest(address(nft), ALICE_CHOG);
        (bool won, uint32 xp, uint256 reward, bool late) = _resolvedEvent(vm.getRecordedLogs());
        assertTrue(late);
        assertFalse(won);
        assertEq(xp, 10);
        assertEq(reward, 0);
        assertFalse(w.state.isInjured(_key(ALICE_CHOG)), "no penalty for a missed window");
    }

    function test_OutcomeIndependentOfResolver() public {
        _start(SLIME);
        _mine(3);
        uint256 snap = vm.snapshotState();
        vm.recordLogs();
        vm.prank(bob);
        w.quests.resolveQuest(address(nft), ALICE_CHOG);
        (,, uint256 rewardBob,) = _resolvedEvent(vm.getRecordedLogs());
        vm.revertToState(snap);
        _mine(5); // a later block inside the window must not change the seed
        vm.recordLogs();
        vm.prank(carol);
        w.quests.resolveQuest(address(nft), ALICE_CHOG);
        (,, uint256 rewardCarol,) = _resolvedEvent(vm.getRecordedLogs());
        assertEq(rewardBob, rewardCarol);
    }

    function test_SetQuestValidation() public {
        QuestBoard.Quest memory q = w.quests.quest(SLIME);
        q.rewardMin = 10 ether;
        q.rewardMax = 1 ether;
        vm.prank(admin);
        vm.expectRevert(QuestBoard.BadQuest.selector);
        w.quests.setQuest(60, q);

        q = w.quests.quest(SLIME);
        q.monster.hp = 0;
        vm.prank(admin);
        vm.expectRevert(QuestBoard.BadQuest.selector);
        w.quests.setQuest(60, q);

        q = w.quests.quest(SLIME);
        q.zone = 4;
        vm.prank(admin);
        vm.expectRevert(QuestBoard.BadQuest.selector);
        w.quests.setQuest(60, q);
    }
}
