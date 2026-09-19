// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// ERC-20 (18 decimals) + the ERC-8056 subset with setters for tests/demos. Not the Robinhood implementation.
contract MockStockToken is ERC20 {
    uint256 public uiMultiplier = 1e18;
    uint256 public newUIMultiplier = 1e18;
    uint256 public effectiveAt;
    bool public oraclePaused;

    constructor(string memory n, string memory s) ERC20(n, s) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function setOraclePaused(bool p) external {
        oraclePaused = p;
    }

    /// Schedules a new multiplier (like Robinhood: newUIMultiplier != uiMultiplier until effectiveAt).
    function scheduleMultiplier(uint256 newMult, uint256 at) external {
        newUIMultiplier = newMult;
        effectiveAt = at;
    }

    /// Applies the scheduled multiplier; afterwards newUIMultiplier() == uiMultiplier() (the V10b behaviour).
    function applyMultiplier() external {
        require(block.timestamp >= effectiveAt, "not yet");
        uiMultiplier = newUIMultiplier;
    }
}
