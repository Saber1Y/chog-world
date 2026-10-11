// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ChogDNA, Stats} from "../../src/libraries/ChogDNA.sol";
import {BattleEngine} from "../../src/libraries/BattleEngine.sol";

/// @notice Exposes the pure libraries so packages/shared can check its TypeScript mirror against
///         the compiled Solidity on anvil.
contract EngineHarness {
    function simulate(Stats calldata a, Stats calldata b, bytes32 seed)
        external
        pure
        returns (BattleEngine.Result memory)
    {
        return BattleEngine.simulate(a, b, seed);
    }

    function dna(address collection, uint256 tokenId) external pure returns (bytes32 d, Stats memory base, uint16 hue) {
        d = ChogDNA.dna(collection, tokenId);
        base = ChogDNA.baseStats(d);
        hue = ChogDNA.hue(d);
    }
}
