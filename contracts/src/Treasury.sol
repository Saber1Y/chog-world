// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @title Treasury
/// @notice Holds the $CHOG reward pool. Game contracts can pay out rewards, but never more than
///         `dailyEmissionCap` per rolling 24 hours: the mainnet safety limit on what the world can emit.
contract Treasury is AccessControl {
    using SafeERC20 for IERC20;

    bytes32 public constant GAME_ROLE = keccak256("GAME_ROLE");
    uint16 public constant MAX_BURN_BPS = 5_000;
    uint256 private constant DAY = 1 days;

    IERC20 public immutable chog;

    uint256 public dailyEmissionCap;
    uint256 public emittedToday;
    uint64 public windowStart;
    uint16 public burnBps;

    event Paid(address indexed game, address indexed to, uint256 requested, uint256 paid);
    event EmissionCapSet(uint256 cap);
    event BurnBpsSet(uint16 bps);
    event Withdrawn(address indexed to, uint256 amount);

    error BurnTooHigh();

    constructor(address admin, IERC20 chog_, uint256 dailyEmissionCap_, uint16 burnBps_) {
        if (burnBps_ > MAX_BURN_BPS) revert BurnTooHigh();
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        chog = chog_;
        dailyEmissionCap = dailyEmissionCap_;
        burnBps = burnBps_;
        windowStart = uint64(block.timestamp);
    }

    /// @notice Pay up to `amount`, clamped by the remaining daily emission and the pool balance.
    function pay(address to, uint256 amount) external onlyRole(GAME_ROLE) returns (uint256 paid) {
        if (block.timestamp >= uint256(windowStart) + DAY) {
            windowStart = uint64(block.timestamp);
            emittedToday = 0;
        }
        uint256 room = dailyEmissionCap > emittedToday ? dailyEmissionCap - emittedToday : 0;
        uint256 balance = chog.balanceOf(address(this));
        paid = amount;
        if (paid > room) paid = room;
        if (paid > balance) paid = balance;
        if (paid > 0) {
            emittedToday += paid;
            chog.safeTransfer(to, paid);
        }
        emit Paid(msg.sender, to, amount, paid);
    }

    function remainingEmission() external view returns (uint256) {
        if (block.timestamp >= uint256(windowStart) + DAY) return dailyEmissionCap;
        return dailyEmissionCap > emittedToday ? dailyEmissionCap - emittedToday : 0;
    }

    function setDailyEmissionCap(uint256 cap) external onlyRole(DEFAULT_ADMIN_ROLE) {
        dailyEmissionCap = cap;
        emit EmissionCapSet(cap);
    }

    function setBurnBps(uint16 bps) external onlyRole(DEFAULT_ADMIN_ROLE) {
        if (bps > MAX_BURN_BPS) revert BurnTooHigh();
        burnBps = bps;
        emit BurnBpsSet(bps);
    }

    function withdraw(address to, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        chog.safeTransfer(to, amount);
        emit Withdrawn(to, amount);
    }
}
