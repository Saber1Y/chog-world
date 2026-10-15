// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ChogWorldBase} from "./ChogWorldBase.t.sol";
import {ChogOperator} from "../src/ChogOperator.sol";
import {QuestBoard} from "../src/QuestBoard.sol";
import {Treasury} from "../src/Treasury.sol";
import {ChogItems} from "../src/ChogItems.sol";
import {MockChog} from "./mocks/Mocks.sol";
import {IAccountV3} from "../src/interfaces/IERC6551.sol";

/// @notice Drives the keeper, resolvers, time and NFT transfers at random.
contract OperatorHandler is Test {
    ChogOperator internal operator;
    QuestBoard internal quests;
    MockChog internal nft;
    address internal keeper;
    address internal alice;
    address internal bob;
    uint256 internal immutable tokenId;

    uint256 public executedAfterOwnerChange;
    uint256 public executedTotal;
    uint256 internal nonce;

    constructor(
        ChogOperator operator_,
        QuestBoard quests_,
        MockChog nft_,
        address keeper_,
        address alice_,
        address bob_,
        uint256 tokenId_
    ) {
        operator = operator_;
        quests = quests_;
        nft = nft_;
        keeper = keeper_;
        alice = alice_;
        bob = bob_;
        tokenId = tokenId_;
    }

    function _ownerMismatch() internal view returns (bool) {
        return nft.ownerOf(tokenId) != operator.policyOf(address(nft), tokenId).owner;
    }

    function _record(bool ok, bool mismatch) internal {
        if (ok) executedTotal++;
        if (ok && mismatch) executedAfterOwnerChange++;
    }

    function quest(uint256 questSeed) external {
        uint32 questId = uint32(bound(questSeed, 0, 7));
        bool mismatch = _ownerMismatch();
        vm.prank(keeper);
        try operator.startQuest(address(nft), tokenId, questId, keccak256(abi.encode(nonce++))) returns (bool ok) {
            _record(ok, mismatch);
        } catch {}
    }

    function buy(uint256 itemSeed, uint256 qtySeed) external {
        uint256[4] memory ids = [uint256(1), 2, 11, 21];
        uint256 id = ids[bound(itemSeed, 0, 3)];
        uint256 qty = bound(qtySeed, 1, 3);
        bool mismatch = _ownerMismatch();
        vm.prank(keeper);
        try operator.buyItem(address(nft), tokenId, id, qty, keccak256(abi.encode(nonce++))) returns (bool ok) {
            _record(ok, mismatch);
        } catch {}
    }

    function resolve() external {
        vm.roll(block.number + 3);
        for (uint256 i = 1; i <= 3; i++) {
            vm.setBlockhash(block.number - i, keccak256(abi.encode(block.number - i)));
        }
        try quests.resolveQuest(address(nft), tokenId) {} catch {}
    }

    function warp(uint256 secondsSeed) external {
        vm.warp(block.timestamp + bound(secondsSeed, 1 minutes, 30 hours));
    }

    /// @dev Whoever owns the Chog now grants the operator and enrolls a fresh policy.
    function reenroll() external {
        address owner = nft.ownerOf(tokenId);
        address account = operator.state().accountOf(address(nft), tokenId);
        address[] memory callers = new address[](1);
        callers[0] = address(operator);
        bool[] memory perms = new bool[](1);
        perms[0] = true;
        vm.startPrank(owner);
        IAccountV3(account).setPermissions(callers, perms);
        operator.enroll(
            address(nft),
            tokenId,
            ChogOperator.PolicyParams({
                expiry: 0, actionMask: 0x0f, maxActionsPerDay: 20, maxPerAction: 60 ether, dailyCap: 150 ether, maxGasFee: 0
            }),
            0
        );
        vm.stopPrank();
    }

    function transferNft() external {
        address from = nft.ownerOf(tokenId);
        address to = from == alice ? bob : alice;
        vm.prank(from);
        nft.transferFrom(from, to, tokenId);
    }
}

contract OperatorInvariantTest is ChogWorldBase {
    OperatorHandler internal handler;

    function setUp() public override {
        super.setUp();
        _enroll(alice, ALICE_CHOG, 100_000 ether);
        vm.prank(admin);
        w.treasury.setDailyEmissionCap(200 ether);

        handler = new OperatorHandler(w.operator, w.quests, nft, keeper, alice, bob, ALICE_CHOG);
        targetContract(address(handler));
    }

    /// @dev Guards against a vacuous pass: the handler really executes, blocks after a transfer,
    ///      and executes again once the new owner enrolls.
    function test_HandlerSequenceIsMeaningful() public {
        handler.quest(0);
        assertEq(handler.executedTotal(), 1);
        handler.transferNft();
        handler.buy(0, 1);
        assertEq(handler.executedTotal(), 1, "blocked after transfer");
        handler.reenroll();
        handler.buy(0, 1);
        assertEq(handler.executedTotal(), 2, "new owner's policy executes");
        assertEq(handler.executedAfterOwnerChange(), 0);
    }

    function invariant_SpendNeverExceedsDailyCap() public view {
        ChogOperator.Policy memory p = w.operator.policyOf(address(nft), ALICE_CHOG);
        assertLe(p.spentToday, p.dailyCap);
        assertLe(p.actionsToday, p.maxActionsPerDay);
    }

    function invariant_NothingExecutesAfterOwnerChange() public view {
        assertEq(handler.executedAfterOwnerChange(), 0);
    }

    function invariant_TreasuryEmissionUnderCap() public view {
        assertLe(w.treasury.emittedToday(), w.treasury.dailyEmissionCap());
    }

    function invariant_TrophiesNeverLeaveAccounts() public view {
        // Trophies are only ever minted into Chog accounts; no EOA in the scenario holds one.
        for (uint256 t; t < 6; t++) {
            assertEq(w.items.balanceOf(alice, 1000 + t), 0);
            assertEq(w.items.balanceOf(bob, 1000 + t), 0);
        }
    }
}
