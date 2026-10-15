// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {IERC6551Registry, IAccountV3} from "../../src/interfaces/IERC6551.sol";
import {ChogOperator} from "../../src/ChogOperator.sol";
import {ChogWorldDeployer} from "../../script/ChogWorldDeployer.sol";

interface IAccountProxyInit {
    function initialize(address implementation) external;
}

/// @notice Full flow against the real Chog NFT, $CHOG, ERC-6551 registry and Tokenbound AccountV3 on
///         Monad mainnet. Run with: MONAD_RPC_URL=https://rpc.monad.xyz forge test --match-path 'test/fork/*'
contract MonadForkTest is Test, ChogWorldDeployer {
    IERC6551Registry internal constant REGISTRY = IERC6551Registry(0x000000006551c19487814612e58FE06813775758);
    address internal constant ACCOUNT_PROXY = 0x55266d75D1a14E4572138116aF39863Ed6596E7F;
    address internal constant ACCOUNT_V3 = 0x41C8f39463A868d3A88af00cd0fe7102F30E44eC;
    address internal constant CHOG_NFT = 0x9994604c3D3C43B82A79B41281E202613313Afba;
    IERC20 internal constant CHOG = IERC20(0x350035555E10d9AfAF1566AaebfCeD5BA6C27777);
    uint256 internal constant TOKEN_ID = 1;

    address internal admin = makeAddr("admin");
    address internal keeper = makeAddr("keeper");
    address internal buyer = makeAddr("buyer");

    World internal w;
    address internal owner;
    address internal account;
    bool internal forked;

    function setUp() public {
        string memory rpc = vm.envOr("MONAD_RPC_URL", string(""));
        if (bytes(rpc).length == 0) return;
        vm.createSelectFork(rpc);
        forked = true;
        assertEq(block.chainid, 143, "not Monad mainnet");

        vm.startPrank(admin);
        w = _deployWorld(
            Config({
                admin: admin,
                keeper: keeper,
                registry: REGISTRY,
                accountImplementation: ACCOUNT_PROXY,
                collection: CHOG_NFT,
                chog: CHOG,
                dailyEmissionCap: 10_000 ether,
                burnBps: 1_000,
                itemsUri: "https://chog.world/items/{id}.json"
            })
        );
        vm.stopPrank();

        owner = IERC721(CHOG_NFT).ownerOf(TOKEN_ID);
        account = w.state.accountOf(CHOG_NFT, TOKEN_ID);
        if (account.code.length == 0) {
            REGISTRY.createAccount(ACCOUNT_PROXY, bytes32(0), block.chainid, CHOG_NFT, TOKEN_ID);
            IAccountProxyInit(account).initialize(ACCOUNT_V3);
        }
        deal(address(CHOG), account, 1_000 ether);
        deal(address(CHOG), address(w.treasury), 10_000 ether);
    }

    function _mine(uint256 n) internal {
        uint256 start = block.number;
        vm.roll(start + n);
        for (uint256 i; i < n; i++) {
            vm.setBlockhash(start + i, keccak256(abi.encode("fork-block", start + i)));
        }
    }

    function _grantAndEnroll(address who) internal {
        address[] memory callers = new address[](1);
        callers[0] = address(w.operator);
        bool[] memory perms = new bool[](1);
        perms[0] = true;
        vm.startPrank(who);
        IAccountV3(account).setPermissions(callers, perms);
        w.operator
            .enroll(
                CHOG_NFT,
                TOKEN_ID,
                ChogOperator.PolicyParams({
                    expiry: 0, actionMask: 0x0f, maxActionsPerDay: 20, maxPerAction: 60 ether, dailyCap: 150 ether, maxGasFee: 0
                }),
                0
            );
        vm.stopPrank();
    }

    function test_FullFlowOnRealContracts() public {
        if (!forked) vm.skip(true);

        // The real account resolves back to the real Chog.
        (address collection, uint256 tokenId) = w.state.resolveAccount(account);
        assertEq(collection, CHOG_NFT);
        assertEq(tokenId, TOKEN_ID);

        _grantAndEnroll(owner);
        assertTrue(IAccountV3(account).permissions(owner, address(w.operator)), "V3 keys permissions by owner");
        assertEq(w.operator.inactiveReason(CHOG_NFT, TOKEN_ID), "");

        // Quest through the operator, executed by the real V3 account.
        uint256 before = CHOG.balanceOf(account);
        vm.prank(keeper);
        assertTrue(w.operator.startQuest(CHOG_NFT, TOKEN_ID, 0, keccak256("fork-1")));
        assertEq(before - CHOG.balanceOf(account), 5 ether);
        assertEq(CHOG.allowance(account, address(w.quests)), 0);
        _mine(3);
        w.quests.resolveQuest(CHOG_NFT, TOKEN_ID);
        assertGt(w.state.character(w.state.keyOf(CHOG_NFT, TOKEN_ID)).xp, 0);

        // Owner-paid gas: the real V3 account pays the keeper in MON for each move, within the owner's limit.
        vm.prank(admin);
        w.operator.setGasFee(0, 0.1 ether);
        ChogOperator.PolicyParams memory withGas = ChogOperator.PolicyParams({
            expiry: 0, actionMask: 0x0f, maxActionsPerDay: 20, maxPerAction: 60 ether, dailyCap: 150 ether, maxGasFee: 0.1 ether
        });
        vm.prank(owner);
        w.operator.updatePolicy(CHOG_NFT, TOKEN_ID, withGas);
        vm.deal(account, 1 ether);
        uint256 keeperBefore = keeper.balance;
        vm.prank(keeper);
        assertTrue(w.operator.startQuest(CHOG_NFT, TOKEN_ID, 7, keccak256("fork-gas")));
        assertEq(w.operator.gasFeesOwed(keeper), 0.1 ether, "fee collected from the Chog's account");
        vm.prank(keeper);
        w.operator.withdrawGasFees();
        assertEq(keeper.balance - keeperBefore, 0.1 ether, "keeper repaid");
        assertEq(account.balance, 0.9 ether);
        _mine(3);
        w.quests.resolveQuest(CHOG_NFT, TOKEN_ID);
        vm.prank(admin);
        w.operator.setGasFee(0, 0);

        // The real V3 account accepts ERC-1155 gear.
        vm.prank(keeper);
        assertTrue(w.operator.buyItem(CHOG_NFT, TOKEN_ID, 11, 1, keccak256("fork-2")));
        assertEq(w.items.balanceOf(account, 11), 1);

        // Selling the NFT: the agent loses authority, the character and its assets move with the Chog.
        vm.prank(owner);
        IERC721(CHOG_NFT).transferFrom(owner, buyer, TOKEN_ID);
        assertFalse(IAccountV3(account).permissions(buyer, address(w.operator)), "grant does not carry over");
        assertEq(w.operator.inactiveReason(CHOG_NFT, TOKEN_ID), "owner changed");
        vm.prank(keeper);
        assertFalse(w.operator.startQuest(CHOG_NFT, TOKEN_ID, 7, keccak256("fork-3")));
        assertFalse(w.operator.policyOf(CHOG_NFT, TOKEN_ID).active);

        assertEq(w.items.balanceOf(account, 11), 1, "gear stays with the Chog");
        vm.prank(buyer);
        IAccountV3(account).execute(address(CHOG), 0, abi.encodeCall(IERC20.transfer, (buyer, 1 ether)), 0);
        assertEq(CHOG.balanceOf(buyer), 1 ether, "new owner controls the account");

        // The previous owner can no longer drive the account.
        vm.prank(owner);
        vm.expectRevert();
        IAccountV3(account).execute(address(CHOG), 0, abi.encodeCall(IERC20.transfer, (owner, 1 ether)), 0);

        // The new owner can hand the Chog to the agent again (after quest 7's cooldown from the gas check).
        vm.warp(block.timestamp + 1 days);
        _grantAndEnroll(buyer);
        vm.prank(keeper);
        assertTrue(w.operator.startQuest(CHOG_NFT, TOKEN_ID, 7, keccak256("fork-4")));
    }
}
