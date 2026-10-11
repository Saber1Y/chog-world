// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ChogState} from "./ChogState.sol";
import {Treasury} from "./Treasury.sol";

/// @notice Shared plumbing for contracts that charge $CHOG fees: a share is burned, the rest funds the Treasury.
abstract contract GameBase {
    using SafeERC20 for IERC20;

    /// @dev $CHOG has no public burn, so burned tokens go to the conventional dead address.
    address public constant BURN_ADDRESS = 0x000000000000000000000000000000000000dEaD;

    ChogState public immutable state;
    Treasury public immutable treasury;
    IERC20 public immutable chog;

    event FeeCollected(address indexed from, uint256 amount, uint256 burned);

    constructor(ChogState state_, Treasury treasury_) {
        state = state_;
        treasury = treasury_;
        chog = treasury_.chog();
    }

    function _collectFee(address from, uint256 amount) internal {
        if (amount == 0) return;
        uint256 burned = amount * treasury.burnBps() / 10_000;
        if (burned > 0) chog.safeTransferFrom(from, BURN_ADDRESS, burned);
        chog.safeTransferFrom(from, address(treasury), amount - burned);
        emit FeeCollected(from, amount, burned);
    }
}
