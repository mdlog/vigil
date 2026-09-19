// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// The ERC-8056 surface of Robinhood's TESTNET stock tokens (implementation `Stock`, Sep 2026): uiMultiplier,
/// newUIMultiplier and effectiveAt, but no oraclePaused(). Used to test that VigilSessionOracle works without it.
contract MockStockTokenLegacy is ERC20 {
    uint256 public uiMultiplier = 1e18;
    uint256 public newUIMultiplier = 1e18;
    uint256 public effectiveAt;

    constructor(string memory n, string memory s) ERC20(n, s) {}

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function scheduleMultiplier(uint256 newMult, uint256 at) external {
        newUIMultiplier = newMult;
        effectiveAt = at;
    }

    function applyMultiplier() external {
        require(block.timestamp >= effectiveAt, "not yet");
        uiMultiplier = newUIMultiplier;
    }
}
