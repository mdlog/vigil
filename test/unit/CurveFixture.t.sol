// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {VigilRiskEngine} from "../../src/VigilRiskEngine.sol";
import {VigilSessionOracle} from "../../src/VigilSessionOracle.sol";
import {VigilCalendar} from "../../src/VigilCalendar.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {CalendarFixture} from "../CalendarFixture.sol";

/// Nilai H(L) yang dipakai dashboard (web/test/parity.network.test.ts) dan README — surface NVDA produksi.
contract CurveFixtureTest is Test {
    VigilRiskEngine risk;

    function setUp() public {
        VigilCalendar cal = new VigilCalendar(address(this), CalendarFixture.closedDays(), CalendarFixture.halfDays());
        VigilSessionOracle so = new VigilSessionOracle(cal, IERC20(address(0)), address(this), address(this));
        risk = new VigilRiskEngine(so, address(this), address(this));
    }

    function _sf() internal pure returns (VigilRiskEngine.Surface memory) {
        return
            VigilRiskEngine.Surface({
                sigmaGapWad: 0.016e18, kTailBps: 30_000, hFloorBps: 50, hMaxBps: 2_500, updatedAt: 0
            });
    }

    function test_curveFixture() public view {
        assertEq(risk.closureHaircutBps(_sf(), 0, 10_000), 50);
        assertEq(risk.closureHaircutBps(_sf(), 3_600, 10_000), 164);
        assertEq(risk.closureHaircutBps(_sf(), 63_000, 10_000), 530); // malam biasa 17,5 j
        assertEq(risk.closureHaircutBps(_sf(), 86_400, 10_000), 611);
        assertEq(risk.closureHaircutBps(_sf(), 235_800, 10_000), 977); // akhir pekan 65,5 j
        assertEq(risk.closureHaircutBps(_sf(), 322_200, 10_000), 1_133); // long weekend 89,5 j
        assertEq(risk.closureHaircutBps(_sf(), 432_000, 10_000), 1_304);
        assertEq(risk.closureHaircutBps(_sf(), 63_000, 20_000), 1_010); // earnings 2×
    }
}
