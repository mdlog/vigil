// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// ERC-20 (18 desimal) + subset ERC-8056 dengan setter untuk test/demo. Bukan implementasi Robinhood.
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

    /// Menjadwalkan multiplier baru (seperti Robinhood: newUIMultiplier != uiMultiplier sampai effectiveAt).
    function scheduleMultiplier(uint256 newMult, uint256 at) external {
        newUIMultiplier = newMult;
        effectiveAt = at;
    }

    /// Menerapkan multiplier terjadwal; setelah ini newUIMultiplier() == uiMultiplier() (perilaku V10b).
    function applyMultiplier() external {
        require(block.timestamp >= effectiveAt, "not yet");
        uiMultiplier = newUIMultiplier;
    }
}
