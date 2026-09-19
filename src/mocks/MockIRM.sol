// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IIrm} from "morpho-blue/interfaces/IIrm.sol";
import {MarketParams, Market} from "morpho-blue/interfaces/IMorpho.sol";

/// IRM tetap: rate per detik konstan (default ≈ 5%/tahun). Pengganti AdaptiveCurveIRM untuk test/testnet.
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
