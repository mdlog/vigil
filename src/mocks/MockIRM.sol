// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IIrm} from "morpho-blue/interfaces/IIrm.sol";
import {MarketParams, Market} from "morpho-blue/interfaces/IMorpho.sol";

/// A fixed IRM: constant per-second rate (default ≈ 5 %/year). Stands in for the AdaptiveCurveIRM in tests/testnet.
contract MockIRM is IIrm {
    uint256 public ratePerSecond;

    constructor(uint256 rate) {
        ratePerSecond = rate;
    }

    function borrowRate(MarketParams memory, Market memory) external view returns (uint256) {
        return ratePerSecond;
    }

    function borrowRateView(MarketParams memory, Market memory) external view returns (uint256) {
        return ratePerSecond;
    }
}
