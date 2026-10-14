// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC6551Registry, IAccountV3} from "../src/interfaces/IERC6551.sol";
import {ChogState} from "../src/ChogState.sol";
import {Treasury} from "../src/Treasury.sol";
import {ChogItems} from "../src/ChogItems.sol";
import {QuestBoard} from "../src/QuestBoard.sol";
import {Arena} from "../src/Arena.sol";
import {ChogOperator} from "../src/ChogOperator.sol";
import {ChogWorldDeployer} from "../script/ChogWorldDeployer.sol";
import {MockChog, MockCHOG, MockAccountV3} from "./mocks/Mocks.sol";

/// @notice Shared fixture: real ERC-6551 registry bytecode at its canonical address, a V3-compatible
///         account implementation, mock Chog + $CHOG, and the full world deployed by ChogWorldDeployer.
abstract contract ChogWorldBase is Test, ChogWorldDeployer {
    IERC6551Registry internal constant REGISTRY = IERC6551Registry(0x000000006551c19487814612e58FE06813775758);

    address internal admin = makeAddr("admin");
    address internal keeper = makeAddr("keeper");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    MockChog internal nft;
    MockCHOG internal chog;
    MockAccountV3 internal accountImpl;
    World internal w;

    uint256 internal constant ALICE_CHOG = 1;
    uint256 internal constant BOB_CHOG = 2;
    uint256 internal constant CAROL_CHOG = 3;
    uint256 internal constant ALICE_SECOND = 4;

    function setUp() public virtual {
        vm.chainId(143);
        vm.etch(address(REGISTRY), vm.parseBytes(vm.trim(vm.readFile("test/fixtures/erc6551-registry.hex"))));

        nft = new MockChog();
        chog = new MockCHOG();
        accountImpl = new MockAccountV3();

        vm.startPrank(admin);
        w = _deployWorld(
            Config({
                admin: admin,
                keeper: keeper,
                registry: REGISTRY,
                accountImplementation: address(accountImpl),
                collection: address(nft),
                chog: IERC20(address(chog)),
                dailyEmissionCap: 10_000 ether,
                burnBps: 1_000,
                itemsUri: "https://chog.world/items/{id}.json"
            })
        );
        vm.stopPrank();

        chog.mint(address(w.treasury), 100_000 ether);
        nft.mint(alice, ALICE_CHOG);
        nft.mint(bob, BOB_CHOG);
        nft.mint(carol, CAROL_CHOG);
        nft.mint(alice, ALICE_SECOND);

        vm.warp(1_800_000_000);
        vm.roll(1_000);
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    function _key(uint256 id) internal view returns (bytes32) {
        return w.state.keyOf(address(nft), id);
    }

    function _account(uint256 id) internal view returns (address) {
        return w.state.accountOf(address(nft), id);
    }

    function _createAccount(uint256 id) internal returns (address account) {
        account = REGISTRY.createAccount(address(accountImpl), bytes32(0), block.chainid, address(nft), id);
        assertEq(account, _account(id), "registry/state account mismatch");
    }

    /// @dev Awaken a Chog, deploy its account and fund it, acting as `owner`.
    function _awaken(address owner, uint256 id, uint256 funding) internal returns (address account) {
        account = _createAccount(id);
        vm.prank(owner);
        w.state.awaken(address(nft), id);
        if (funding > 0) chog.mint(account, funding);
    }

    /// @dev Make the Chog's account call `target` (signed by the NFT owner, as a user would from a wallet).
    function _accountCall(address owner, address account, address target, bytes memory data) internal {
        vm.prank(owner);
        IAccountV3(account).execute(target, 0, data, 0);
    }

    function _approveFrom(address owner, address account, address spender, uint256 amount) internal {
        _accountCall(owner, account, address(chog), abi.encodeCall(IERC20.approve, (spender, amount)));
    }

    /// @dev Advance `n` blocks, giving every passed block a deterministic hash.
    function _mine(uint256 n) internal {
        uint256 start = block.number;
        vm.roll(start + n);
        for (uint256 i; i < n; i++) {
            vm.setBlockhash(start + i, keccak256(abi.encode("block", start + i)));
        }
    }

    function _defaultPolicy() internal pure returns (ChogOperator.PolicyParams memory) {
        return ChogOperator.PolicyParams({
            expiry: 0, actionMask: 0x0f, maxActionsPerDay: 20, maxPerAction: 60 ether, dailyCap: 150 ether
        });
    }

    /// @dev Full owner onboarding: account, permission grant, enroll, funding.
    function _enroll(address owner, uint256 id, uint256 funding) internal returns (address account) {
        account = _createAccount(id);
        address[] memory callers = new address[](1);
        callers[0] = address(w.operator);
        bool[] memory perms = new bool[](1);
        perms[0] = true;
        vm.startPrank(owner);
        IAccountV3(account).setPermissions(callers, perms);
        w.operator.enroll(address(nft), id, _defaultPolicy(), 0);
        vm.stopPrank();
        if (funding > 0) chog.mint(account, funding);
    }
}
