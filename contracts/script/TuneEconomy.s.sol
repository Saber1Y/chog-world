// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {ChogWorldDeployer} from "./ChogWorldDeployer.sol";
import {QuestBoard} from "../src/QuestBoard.sol";
import {Treasury} from "../src/Treasury.sol";

/// @notice Applies the current quest rewards (ChogWorldDeployer._seedQuests) and the Treasury's daily
///         payout cap to an existing world, without redeploying anything. Run as the world's admin.
///
///   DEPLOYMENT_FILE=10143.json DAILY_EMISSION_CAP=1000000000000000000000 \
///   forge script script/TuneEconomy.s.sol --rpc-url $RPC --broadcast --private-key $ADMIN_KEY
contract TuneEconomy is Script, ChogWorldDeployer {
    function run() external {
        string memory file = vm.envOr("DEPLOYMENT_FILE", string.concat(vm.toString(block.chainid), ".json"));
        string memory json = vm.readFile(string.concat("deployments/", file));
        require(vm.parseJsonUint(json, ".chainId") == block.chainid, "deployment file is for another chain");
        QuestBoard quests = QuestBoard(vm.parseJsonAddress(json, ".quests"));
        Treasury treasury = Treasury(vm.parseJsonAddress(json, ".treasury"));
        uint256 cap = vm.envOr("DAILY_EMISSION_CAP", uint256(1_000 ether));

        vm.startBroadcast();
        _seedQuests(quests);
        treasury.setDailyEmissionCap(cap);
        vm.stopBroadcast();

        console.log("quest rewards updated on", address(quests));
        console.log("treasury daily cap (CHOG):", cap / 1 ether);
    }
}
