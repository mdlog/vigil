// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";

/// A mock Chainlink feed: the price can be set and "frozen" (updatedAt stops moving) like a 24/5 feed outside market hours.
contract MockFeed is IAggregatorV3 {
    uint8 public immutable decimals;
    int256 public answer;
    uint256 public updatedAt;
    uint80 public roundId;

    constructor(uint8 dec, int256 initial) {
        decimals = dec;
        answer = initial;
        updatedAt = block.timestamp;
        roundId = 1;
    }

    /// A new update at the current block.timestamp.
    function set(int256 a) external {
        answer = a;
        updatedAt = block.timestamp;
        roundId++;
    }

    /// An update with an explicit timestamp (for historical replays).
    function setAt(int256 a, uint256 ts) external {
        answer = a;
        updatedAt = ts;
        roundId++;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, updatedAt, updatedAt, roundId);
    }
}
