// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {VigilCalendar} from "../../src/VigilCalendar.sol";
import {Regime, Session} from "../../src/interfaces/IVigil.sol";
import {CalendarFixture} from "../CalendarFixture.sol";

contract VigilCalendarTest is Test {
    // Jangkar dari zoneinfo (America/New_York) — independen dari implementasi.
    uint64 constant FRI_1500 = 1722625200; // 2024-08-02 15:00 ET
    uint64 constant FRI_1600 = 1722628800;
    uint64 constant THU_1600 = 1722542400;
    uint64 constant FRI_0930 = 1722605400;
    uint64 constant SAT_1200 = 1722700800;
    uint64 constant SUN_2100 = 1722819600;
    uint64 constant MON_0400 = 1722844800; // 2024-08-05 04:00 ET
    uint64 constant MON_0500 = 1722848400;
    uint64 constant MON_0930 = 1722864600;
    uint64 constant MON_1600 = 1722888000;
    uint64 constant MON_1700 = 1722891600;
    uint64 constant MON_2000 = 1722902400;
    uint64 constant MON_2100 = 1722906000;
    uint64 constant TUE_0400 = 1722931200;
    uint64 constant TUE_0930 = 1722951000;
    uint64 constant LAB_FRI_1600 = 1788552000; // 2026-09-04
    uint64 constant LAB_SAT_1200 = 1788624000;
    uint64 constant LAB_MON_1200 = 1788796800; // Labor Day 2026-09-07
    uint64 constant LAB_TUE_0400 = 1788854400;
    uint64 constant LAB_TUE_0930 = 1788874200;
    uint64 constant HALF_1200 = 1795798800; // 2026-11-27 (early close 13:00)
    uint64 constant HALF_1300 = 1795802400;
    uint64 constant HALF_1400 = 1795806000;
    uint64 constant HALF_NEXT_OPEN = 1796049000; // 2026-11-30 09:30
    uint64 constant DST_FRI_0930 = 1772807400; // 2026-03-06 09:30 EST
    uint64 constant DST_MON_0930 = 1773063000; // 2026-03-09 09:30 EDT
    uint64 constant DST_FRI_1600 = 1772830800;
    uint64 constant NOW_REF = 1789782120; // 2026-09-18 21:42 ET (Jumat)

    VigilCalendar cal;
    address guardian = address(0xA11CE);

    function setUp() public {
        cal = new VigilCalendar(guardian, CalendarFixture.closedDays(), CalendarFixture.halfDays());
    }

    function test_marketFridayAfternoon_closureIsWeekend() public view {
        Session memory s = cal.sessionAt(FRI_1500);
        assertEq(uint8(s.cal), uint8(Regime.MARKET));
        assertEq(s.closeAt, FRI_1600);
        assertEq(s.nextOpen, MON_0930);
        assertEq(s.nextOpen - s.closeAt, 235_800); // L akhir pekan (§6.2)
        assertEq(s.lastOpen, FRI_0930);
        assertEq(s.prevClose, THU_1600);
        assertEq(s.segmentEnd, FRI_1600);
    }

    function test_weekendIsClosedWithSameClosure() public view {
        Session memory a = cal.sessionAt(SAT_1200);
        Session memory b = cal.sessionAt(SUN_2100);
        assertEq(uint8(a.cal), uint8(Regime.CLOSED));
        assertEq(uint8(b.cal), uint8(Regime.CLOSED)); // Minggu 20:00→Senin 04:00 tetap CLOSED (§8.0)
        assertEq(a.closeAt, FRI_1600);
        assertEq(a.nextOpen, MON_0930);
        assertEq(b.closeAt, FRI_1600);
        assertEq(b.segmentEnd, MON_0400);
    }

    function test_mondayPreMarketExtended() public view {
        Session memory s = cal.sessionAt(MON_0500);
        assertEq(uint8(s.cal), uint8(Regime.EXTENDED));
        assertEq(s.closeAt, FRI_1600);
        assertEq(s.nextOpen, MON_0930);
        assertEq(s.segmentEnd, MON_0930);
        assertEq(uint8(cal.sessionAt(MON_0400).cal), uint8(Regime.EXTENDED));
        assertEq(uint8(cal.sessionAt(MON_0400 - 1).cal), uint8(Regime.CLOSED));
    }

    function test_openBoundaryAndPostMarket() public view {
        assertEq(uint8(cal.sessionAt(MON_0930).cal), uint8(Regime.MARKET));
        assertEq(uint8(cal.sessionAt(MON_0930 - 1).cal), uint8(Regime.EXTENDED));
        Session memory p = cal.sessionAt(MON_1700);
        assertEq(uint8(p.cal), uint8(Regime.EXTENDED));
        assertEq(p.closeAt, MON_1600);
        assertEq(p.nextOpen, TUE_0930);
        assertEq(p.segmentEnd, MON_2000);
    }

    function test_weeknightOvernight() public view {
        Session memory s = cal.sessionAt(MON_2100);
        assertEq(uint8(s.cal), uint8(Regime.OVERNIGHT));
        assertEq(s.nextOpen - s.closeAt, 63_000); // satu overnight (§6.2)
        assertEq(s.segmentEnd, TUE_0400);
        assertEq(uint8(cal.sessionAt(TUE_0400 - 1).cal), uint8(Regime.OVERNIGHT));
        assertEq(uint8(cal.sessionAt(TUE_0400).cal), uint8(Regime.EXTENDED));
    }

    function test_longWeekendLaborDay() public view {
        Session memory s = cal.sessionAt(LAB_SAT_1200);
        assertEq(uint8(s.cal), uint8(Regime.CLOSED));
        assertEq(s.closeAt, LAB_FRI_1600);
        assertEq(s.nextOpen, LAB_TUE_0930);
        assertEq(s.nextOpen - s.closeAt, 322_200); // akhir pekan panjang (§6.2)
        Session memory h = cal.sessionAt(LAB_MON_1200);
        assertEq(uint8(h.cal), uint8(Regime.CLOSED));
        assertEq(h.segmentEnd, LAB_TUE_0400);
        assertFalse(cal.isTradingDay(20703));
    }

    function test_halfDayClosesAt13() public view {
        Session memory m = cal.sessionAt(HALF_1200);
        assertEq(uint8(m.cal), uint8(Regime.MARKET));
        assertEq(m.closeAt, HALF_1300);
        assertEq(m.nextOpen, HALF_NEXT_OPEN);
        Session memory p = cal.sessionAt(HALF_1400);
        assertEq(uint8(p.cal), uint8(Regime.EXTENDED));
        assertEq(p.closeAt, HALF_1300);
    }

    function test_dstTransitionShiftsSessionBoundary() public view {
        assertFalse(cal.isDst(1772953199));
        assertTrue(cal.isDst(1772953200)); // 2026-03-08 07:00 UTC
        assertEq(uint8(cal.sessionAt(DST_FRI_0930).cal), uint8(Regime.MARKET));
        assertEq(uint8(cal.sessionAt(DST_FRI_0930 - 1).cal), uint8(Regime.EXTENDED));
        assertEq(uint8(cal.sessionAt(DST_MON_0930).cal), uint8(Regime.MARKET));
        assertEq(uint8(cal.sessionAt(DST_MON_0930 - 1).cal), uint8(Regime.EXTENDED));
        Session memory s = cal.sessionAt(DST_FRI_1600 + 1);
        assertEq(s.closeAt, DST_FRI_1600);
        assertEq(s.nextOpen, DST_MON_0930);
        assertEq(s.nextOpen - s.closeAt, 235_800 - 3_600); // akhir pekan DST satu jam lebih pendek secara UTC
    }

    function test_liveReference_fridayNightIsClosed() public view {
        // Jumat 18 Sep 2026 21:42 ET — saat verifikasi Hari 1 feed NVDA terakhir update 15:55.
        Session memory s = cal.sessionAt(NOW_REF);
        assertEq(uint8(s.cal), uint8(Regime.CLOSED));
        assertEq(s.closeAt, 1789761600);
    }

    function test_addHoliday_onlyGuardian_onlyFuture_onlyTighten() public {
        vm.warp(NOW_REF);
        (uint32 today,) = cal.etDayOf(NOW_REF);
        vm.expectRevert(VigilCalendar.NotGuardian.selector);
        cal.addHoliday(today + 30, 1);
        vm.startPrank(guardian);
        vm.expectRevert(VigilCalendar.TooSoon.selector);
        cal.addHoliday(today + 7, 1);
        cal.addHoliday(today + 8, 1);
        assertFalse(cal.isTradingDay(today + 8));
        vm.expectRevert(VigilCalendar.CannotLoosen.selector);
        cal.addHoliday(today + 8, 2);
        vm.expectRevert(VigilCalendar.BadKind.selector);
        cal.addHoliday(today + 9, 0);
        vm.stopPrank();
    }

    function testFuzz_roundTrip(uint64 ts) public view {
        ts = uint64(bound(ts, 1650000000, 1900000000));
        (uint32 day, uint32 tod) = cal.etDayOf(ts);
        if (tod >= 4 hours) assertEq(cal.toUtc(day, tod), ts); // di luar jam transisi DST
        Session memory s = cal.sessionAt(ts);
        assertLe(s.closeAt, s.nextOpen);
        assertGt(s.segmentEnd, ts);
        assertLe(s.nextOpen - s.closeAt, 5 days); // maxClosedHorizon (§6.6)
        if (s.cal != Regime.MARKET) assertLe(s.closeAt, ts);
    }
}
