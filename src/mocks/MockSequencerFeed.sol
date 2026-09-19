// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";

/// A mock L2 sequencer uptime feed: answer 0 = up, 1 = down; startedAt = when the current status began.
contract MockSequencerFeed is IAggregatorV3 {
    int256 public status;
    uint256 public startedAt;

    constructor() {
        startedAt = block.timestamp;
    }

    function setStatus(int256 s) external {
        status = s;
        startedAt = block.timestamp;
    }

    function decimals() external pure returns (uint8) {
        return 0;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (1, status, startedAt, startedAt, 1);
    }
}
