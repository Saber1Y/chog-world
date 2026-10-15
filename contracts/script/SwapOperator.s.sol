// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ChogOperator} from "../src/ChogOperator.sol";
import {ChogState} from "../src/ChogState.sol";
import {QuestBoard} from "../src/QuestBoard.sol";
import {Arena} from "../src/Arena.sol";
import {ChogItems} from "../src/ChogItems.sol";

/// @notice Replaces the ChogOperator of an existing world, keeping every Chog's progress, coins and gear.
///         ChogOperator is immutable, so a new version is a new contract: this deploys it, moves the
///         game role from the old operator to the new one, pauses the old one for good and sets the gas
///         fees. Owners then grant the new operator and enroll again (one signature each).
///
///   DEPLOYMENT_FILE=10143.json KEEPER=0x... GAS_FEE_QUEST=90000000000000000 \
///   forge script script/SwapOperator.s.sol --rpc-url $RPC --broadcast --private-key $ADMIN_KEY
///
///   Gas fees are in wei of MON per executed move (defaults 0). Must run as the world's admin.
contract SwapOperator is Script {
    function run() external returns (ChogOperator next) {
        string memory file = vm.envOr("DEPLOYMENT_FILE", string.concat(vm.toString(block.chainid), ".json"));
        string memory path = string.concat("deployments/", file);
        string memory json = vm.readFile(path);
        require(vm.parseJsonUint(json, ".chainId") == block.chainid, "deployment file is for another chain");

        ChogState state = ChogState(vm.parseJsonAddress(json, ".state"));
        ChogOperator previous = ChogOperator(payable(vm.parseJsonAddress(json, ".operator")));
        address keeper = vm.envOr("KEEPER", previous.keeper());

        vm.startBroadcast();
        (, address admin,) = vm.readCallers();
        require(previous.guardian() == admin, "run this as the world's admin");

        next = new ChogOperator(
            state,
            QuestBoard(vm.parseJsonAddress(json, ".quests")),
            Arena(vm.parseJsonAddress(json, ".arena")),
            ChogItems(vm.parseJsonAddress(json, ".items")),
            admin,
            keeper
        );
        bytes32 game = state.GAME_ROLE();
        state.grantRole(game, address(next));
        state.revokeRole(game, address(previous));
        previous.setGuardianPaused(true);

        next.setGasFee(next.ACTION_QUEST(), uint128(vm.envOr("GAS_FEE_QUEST", uint256(0))));
        next.setGasFee(next.ACTION_ATTACK(), uint128(vm.envOr("GAS_FEE_ATTACK", uint256(0))));
        next.setGasFee(next.ACTION_BUY(), uint128(vm.envOr("GAS_FEE_BUY", uint256(0))));
        next.setGasFee(next.ACTION_USE(), uint128(vm.envOr("GAS_FEE_USE", uint256(0))));
        vm.stopBroadcast();

        vm.writeJson(vm.toString(address(next)), path, ".operator");
        console.log("previous operator paused:", address(previous));
        console.log("new operator:", address(next));
        console.log("deployment updated:", path);
    }
}
