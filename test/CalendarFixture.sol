// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

/// Libur & early-close NYSE 2024–2027 sebagai indeks hari ET (V15: verifikasi di nyse.com sebelum mainnet).
library CalendarFixture {
    function closedDays() internal pure returns (uint32[] memory d) {
        uint32[41] memory c = [
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
            21176 // 2027
        ];
        d = new uint32[](c.length);
        for (uint256 i; i < c.length; ++i) {
            d[i] = c[i];
        }
    }

    function halfDays() internal pure returns (uint32[] memory d) {
        uint32[9] memory h = [uint32(19907), 20056, 20081, 20272, 20420, 20446, 20784, 20811, 21148];
        d = new uint32[](h.length);
        for (uint256 i; i < h.length; ++i) {
            d[i] = h[i];
        }
    }
}
