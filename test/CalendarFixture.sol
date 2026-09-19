// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// NYSE holidays & early closes 2024–2028 as ET day indices — verified against nyse.com (V15, 19 Sep 2026);
/// the official date list is pinned in test/unit/VigilCalendar.t.sol.
library CalendarFixture {
    function closedDays() internal pure returns (uint32[] memory d) {
        uint32[50] memory c = [
            uint32(19723),
            19737,
            19772,
            19811,
            19870,
            19893,
            19908,
            19968,
            20055,
            20082, // 2024
            20089,
            20097,
            20108,
            20136,
            20196,
            20234,
            20258,
            20273,
            20332,
            20419,
            20447, // 2025
            20454,
            20472,
            20500,
            20546,
            20598,
            20623,
            20637,
            20703,
            20783,
            20812, // 2026
            20819,
            20836,
            20864,
            20903,
            20969,
            20987,
            21004,
            21067,
            21147,
            21176, // 2027
            21200,
            21235,
            21288,
            21333,
            21354,
            21369,
            21431,
            21511,
            21543 // 2028
        ];
        d = new uint32[](c.length);
        for (uint256 i; i < c.length; ++i) {
            d[i] = c[i];
        }
    }

    function halfDays() internal pure returns (uint32[] memory d) {
        uint32[11] memory h = [uint32(19907), 20056, 20081, 20272, 20420, 20446, 20784, 20811, 21148, 21368, 21512];
        d = new uint32[](h.length);
        for (uint256 i; i < h.length; ++i) {
            d[i] = h[i];
        }
    }
}
