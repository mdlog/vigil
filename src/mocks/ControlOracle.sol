// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IOracle} from "morpho-blue/interfaces/IOracle.sol";
import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";

/// The control market's oracle (Market A): raw feed × SCALE_FACTOR, no session awareness — the semantics
/// of a single-feed MorphoChainlinkOracleV2 without a quote feed. Used only for the demo comparison.
contract ControlOracle is IOracle {
    uint256 public immutable SCALE_FACTOR;
    address public immutable FEED;

    constructor(address feed, uint8 baseTokenDecimals, uint8 quoteTokenDecimals) {
        FEED = feed;
        SCALE_FACTOR = 10 ** (36 + quoteTokenDecimals - baseTokenDecimals - IAggregatorV3(feed).decimals());
    }

    function price() external view returns (uint256) {
        (, int256 a,,,) = IAggregatorV3(FEED).latestRoundData();
        require(a > 0, "bad answer");
        return uint256(a) * SCALE_FACTOR;
    }
}
