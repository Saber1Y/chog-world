// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IERC6551Registry} from "../src/interfaces/IERC6551.sol";
import {ChogWorldDeployer} from "./ChogWorldDeployer.sol";
import {DevChog, DevCHOG} from "./dev/DevTokens.sol";

/// @notice Deploys CHOG World.
///
/// Mainnet (143): uses the real Chog NFT and $CHOG; refuses any other addresses.
///   forge script script/Deploy.s.sol --rpc-url monad --broadcast --verify --ledger
///
/// Testnet (10143) or local: DEV_TOKENS=true deploys DevChog + DevCHOG stand-ins.
///   DEV_TOKENS=true forge script script/Deploy.s.sol --rpc-url monad_testnet --broadcast
///
/// Env: KEEPER (required), DAILY_EMISSION_CAP (wei, default 1000e18), BURN_BPS (default 1000),
///      ITEMS_URI, CHOG_URI (dev only), TREASURY_FUNDING (dev only, default 50000e18),
///      GAS_FEE_QUEST / GAS_FEE_ATTACK / GAS_FEE_BUY / GAS_FEE_USE (wei of MON per move, default 0),
///      DEPLOYMENT_FILE (default "<chainId>.json"; use "local.json" for anvil forks).
contract Deploy is Script, ChogWorldDeployer {
    uint256 internal constant MONAD = 143;
    address internal constant REAL_CHOG_NFT = 0x9994604c3D3C43B82A79B41281E202613313Afba;
    address internal constant REAL_CHOG_TOKEN = 0x350035555E10d9AfAF1566AaebfCeD5BA6C27777;
    IERC6551Registry internal constant REGISTRY = IERC6551Registry(0x000000006551c19487814612e58FE06813775758);
    address internal constant ACCOUNT_PROXY = 0x55266d75D1a14E4572138116aF39863Ed6596E7F;

    function run() external returns (World memory w) {
        bool dev = vm.envOr("DEV_TOKENS", false);
        if (block.chainid == MONAD && dev) revert("DEV_TOKENS is not allowed on mainnet");
        require(address(REGISTRY).code.length > 0, "ERC-6551 registry missing on this chain");
        require(ACCOUNT_PROXY.code.length > 0, "Tokenbound account proxy missing on this chain");

        address keeper = vm.envAddress("KEEPER");
        uint256 cap = vm.envOr("DAILY_EMISSION_CAP", uint256(1_000 ether));
        uint16 burnBps = uint16(vm.envOr("BURN_BPS", uint256(1_000)));
        string memory itemsUri = vm.envOr("ITEMS_URI", string("https://chog.world/api/items/{id}.json"));

        vm.startBroadcast();
        (, address admin,) = vm.readCallers();
        uint256 startBlock = block.number;

        address collection = REAL_CHOG_NFT;
        address token = REAL_CHOG_TOKEN;
        if (dev) {
            collection = address(new DevChog(vm.envOr("CHOG_URI", string("ipfs://chog-dev"))));
            token = address(new DevCHOG(admin));
        } else {
            require(block.chainid == MONAD, "real Chog assets exist on Monad mainnet only; set DEV_TOKENS=true");
            require(IERC20Metadata(token).decimals() == 18, "unexpected $CHOG decimals");
        }

        w = _deployWorld(
            Config({
                admin: admin,
                keeper: keeper,
                registry: REGISTRY,
                accountImplementation: ACCOUNT_PROXY,
                collection: collection,
                chog: IERC20(token),
                dailyEmissionCap: cap,
                burnBps: burnBps,
                itemsUri: itemsUri
            })
        );

        if (dev) DevCHOG(token).mint(address(w.treasury), vm.envOr("TREASURY_FUNDING", uint256(50_000 ether)));
        // Per-move gas fees (wei of MON) each Chog pays the keeper; 0 leaves moves free.
        w.operator.setGasFee(w.operator.ACTION_QUEST(), uint128(vm.envOr("GAS_FEE_QUEST", uint256(0))));
        w.operator.setGasFee(w.operator.ACTION_ATTACK(), uint128(vm.envOr("GAS_FEE_ATTACK", uint256(0))));
        w.operator.setGasFee(w.operator.ACTION_BUY(), uint128(vm.envOr("GAS_FEE_BUY", uint256(0))));
        w.operator.setGasFee(w.operator.ACTION_USE(), uint128(vm.envOr("GAS_FEE_USE", uint256(0))));
        vm.stopBroadcast();

        _writeDeployment(w, collection, token, startBlock);
    }

    function _writeDeployment(World memory w, address collection, address token, uint256 startBlock) internal {
        string memory k = "deployment";
        vm.serializeUint(k, "chainId", block.chainid);
        vm.serializeUint(k, "startBlock", startBlock);
        vm.serializeAddress(k, "collection", collection);
        vm.serializeAddress(k, "chogToken", token);
        vm.serializeAddress(k, "state", address(w.state));
        vm.serializeAddress(k, "treasury", address(w.treasury));
        vm.serializeAddress(k, "items", address(w.items));
        vm.serializeAddress(k, "quests", address(w.quests));
        vm.serializeAddress(k, "arena", address(w.arena));
        string memory json = vm.serializeAddress(k, "operator", address(w.operator));
        string memory file = vm.envOr("DEPLOYMENT_FILE", string.concat(vm.toString(block.chainid), ".json"));
        string memory path = string.concat("deployments/", file);
        vm.writeJson(json, path);
        console.log("deployment written to", path);
    }
}
