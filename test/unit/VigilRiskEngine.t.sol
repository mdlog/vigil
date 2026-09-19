// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {VigilCalendar} from "../../src/VigilCalendar.sol";
import {VigilSessionOracle} from "../../src/VigilSessionOracle.sol";
import {VigilRiskEngine} from "../../src/VigilRiskEngine.sol";
import {MockStockToken} from "../../src/mocks/MockStockToken.sol";
import {MockFeed} from "../../src/mocks/MockFeed.sol";
import {MockUSDG} from "../../src/mocks/MockUSDG.sol";
import {Regime} from "../../src/interfaces/IVigil.sol";
import {CalendarFixture} from "../CalendarFixture.sol";

contract VigilRiskEngineTest is Test {
    uint64 constant FRI_1400 = 1722621600; // 2024-08-02 14:00 ET
    uint64 constant FRI_1430 = 1722623400;
    uint64 constant FRI_1500 = 1722625200;
    uint64 constant FRI_1530 = 1722627000;
    uint64 constant FRI_1600 = 1722628800;
    uint64 constant SAT_1200 = 1722700800;
    uint64 constant SUN_2100 = 1722819600;
    uint64 constant MON_0930 = 1722864600;
    uint64 constant MON_1530 = 1722886200;
    uint64 constant MON_1600 = 1722888000;
    uint64 constant MON_2100 = 1722906000;
    uint64 constant TUE_0930 = 1722951000;
    uint64 constant TUE_1000 = 1722952800;

    VigilCalendar cal;
    VigilSessionOracle so;
    VigilRiskEngine risk;
    MockStockToken nvda;
    MockFeed feed;
    MockUSDG usdg;
    address guardian = address(0xA11CE);
    address calibrator = address(0xCA11);

    function setUp() public {
        vm.warp(FRI_1400);
        cal = new VigilCalendar(guardian, CalendarFixture.closedDays(), CalendarFixture.halfDays());
        usdg = new MockUSDG();
        nvda = new MockStockToken("NVIDIA (mock)", "NVDA");
        feed = new MockFeed(8, 100e8);
        so = new VigilSessionOracle(cal, usdg, guardian, vm.addr(0xBEEF));
        risk = new VigilRiskEngine(so, calibrator, guardian);
        vm.startPrank(guardian);
        so.setRiskEngine(risk);
        so.registerAsset(
            address(nvda), VigilSessionOracle.AssetConfig(address(feed), 6 hours, 3, 1 hours, 1 hours, 100, false)
        );
        vm.stopPrank();
        vm.prank(calibrator);
        risk.setSurface(address(nvda), _surface(0.016e18)); // NVDA terkalibrasi: σ 1,6%, k 3,0
    }

    function _surface(uint64 sigma) internal pure returns (VigilRiskEngine.Surface memory) {
        return
            VigilRiskEngine.Surface({sigmaGapWad: sigma, kTailBps: 30_000, hFloorBps: 50, hMaxBps: 2_500, updatedAt: 0});
    }

    function _h() internal view returns (uint256) {
        return risk.haircutBps(address(nvda));
    }

    // Nilai §6.6: akhir pekan 976–977 bps, malam biasa 530, akhir pekan panjang ≈1.133, earnings (4,2×) ≈2.066
    function test_closureHaircut_matchesCalibratedNumbers() public view {
        VigilRiskEngine.Surface memory sf = _surface(0.016e18);
        assertApproxEqAbs(risk.closureHaircutBps(sf, 235_800, 10_000), 977, 2);
        assertApproxEqAbs(risk.closureHaircutBps(sf, 63_000, 10_000), 530, 1);
        assertApproxEqAbs(risk.closureHaircutBps(sf, 322_200, 10_000), 1_133, 3);
        assertApproxEqAbs(risk.closureHaircutBps(sf, 63_000, 42_000), 2_066, 3);
        assertEq(risk.closureHaircutBps(sf, 63_000, 100_000), 2_500); // dibatasi GLOBAL_H_MAX (INV-4)
    }

    function testFuzz_INV2_monotoneInClosureLength(uint64 l1, uint64 l2, uint16 mult) public view {
        l1 = uint64(bound(l1, 1, 5 days));
        l2 = uint64(bound(l2, l1, 5 days));
        mult = uint16(bound(mult, 10_000, 50_000));
        VigilRiskEngine.Surface memory sf = _surface(0.016e18);
        assertLe(risk.closureHaircutBps(sf, l1, mult), risk.closureHaircutBps(sf, l2, mult));
    }

    function test_weekendRampInConstantRampOut() public {
        assertEq(_h(), 0); // 14:00, di luar preCloseWindow
        assertEq(risk.targetHaircutBps(address(nvda)), 0);
        vm.warp(FRI_1430);
        assertEq(_h(), 0); // ramp mulai tepat di T−90m
        assertEq(risk.targetHaircutBps(address(nvda)), 977);
        vm.warp(FRI_1500);
        assertApproxEqAbs(_h(), 488, 2); // separuh jalan
        vm.warp(FRI_1530);
        assertApproxEqAbs(_h(), 977, 2); // penuh 30 menit sebelum close (G1)
        vm.warp(FRI_1600);
        assertApproxEqAbs(_h(), 977, 2);
        vm.warp(SAT_1200);
        assertApproxEqAbs(_h(), 977, 2); // konstan sepanjang penutupan (INV-2)
        vm.warp(SUN_2100);
        assertApproxEqAbs(_h(), 977, 2);
        vm.warp(MON_0930 - 1);
        assertApproxEqAbs(_h(), 977, 2);
        vm.warp(MON_0930);
        feed.set(100e8);
        assertApproxEqAbs(_h(), 977, 2); // ramp-out mulai
        assertEq(risk.targetHaircutBps(address(nvda)), 0);
        vm.warp(MON_0930 + 30 minutes);
        assertApproxEqAbs(_h(), 488, 2);
        vm.warp(MON_0930 + 60 minutes);
        assertEq(_h(), 0);
    }

    function test_weeknightIsOneOvernight() public {
        vm.warp(MON_2100);
        feed.set(100e8);
        assertApproxEqAbs(_h(), 530, 1);
        vm.warp(TUE_0930 + 2 hours);
        feed.set(100e8);
        assertEq(_h(), 0);
    }

    function test_keeperHaltRampsFromAttestation() public {
        // halt ad-hoc pada 14:00 (di luar preCloseWindow): tanpa tightSince akan menjadi step
        uint256 pk = 0xBEEF;
        VigilSessionOracle.Attestation memory a = VigilSessionOracle.Attestation({
            asset: address(nvda),
            regime: uint8(Regime.CLOSED),
            closeAt: FRI_1400,
            nextOpen: cal.sessionAt(FRI_1400).nextOpen,
            issuedAt: FRI_1400,
            deadline: FRI_1400 + 30 minutes
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(pk, so.hashAttestation(a));
        so.attest(a, abi.encodePacked(r, s, v));
        assertEq(_h(), 0);
        vm.warp(FRI_1400 + 30 minutes);
        // L = Sen 09:30 − Jum 14:00 = 243.000 s → H ≈ 992; separuh target setelah 30 menit — klaim T2 di PRD
        assertApproxEqAbs(_h(), 496, 2);
    }

    function test_setSurface_guardsAndRamp() public {
        vm.startPrank(calibrator);
        VigilRiskEngine.Surface memory s = _surface(0.016e18);
        s.hMaxBps = 2_600;
        vm.expectRevert(VigilRiskEngine.AboveGlobalMax.selector);
        risk.setSurface(address(nvda), s);
        vm.expectRevert(VigilRiskEngine.TooFrequent.selector);
        risk.setSurface(address(nvda), _surface(0.017e18));
        vm.warp(FRI_1400 + 1 hours); // = 15:00, ramp pre-close separuh jalan
        vm.expectRevert(VigilRiskEngine.DeltaTooLarge.selector);
        risk.setSurface(address(nvda), _surface(0.02e18)); // 977 → 1.208 = +231 bps
        risk.setSurface(address(nvda), _surface(0.018e18)); // 977 → 1.094 = +117 bps, OK
        vm.stopPrank();
        vm.warp(SAT_1200); // ramp surface sudah selesai; sekarang H_weekend = 1.094
        assertApproxEqAbs(_h(), 1_094, 3);
        vm.warp(SAT_1200 + 2 hours);
        vm.prank(calibrator);
        risk.setSurface(address(nvda), _surface(0.016e18)); // 1.094 → 977
        vm.warp(SAT_1200 + 2 hours + 30 minutes);
        assertApproxEqAbs(_h(), uint256(1_094 + 977) / 2, 3); // lerp antar-surface
        vm.warp(SAT_1200 + 3 hours);
        assertApproxEqAbs(_h(), 977, 2);
    }

    function test_scheduleEvent_leadTimeAndRampedMultiplier() public {
        VigilRiskEngine.ScheduledEvent memory e =
            VigilRiskEngine.ScheduledEvent({from: FRI_1400 + 23 hours, until: FRI_1400 + 30 hours, multBps: 42_000});
        vm.prank(calibrator);
        vm.expectRevert(VigilRiskEngine.LeadTimeTooShort.selector);
        risk.scheduleEvent(address(nvda), e);
        e = VigilRiskEngine.ScheduledEvent({from: MON_1600, until: TUE_0930, multBps: 42_000}); // malam earnings Senin
        vm.prank(calibrator);
        risk.scheduleEvent(address(nvda), e);
        vm.warp(MON_1530);
        feed.set(100e8);
        // ramp-in event separuh (mult 2,6×) pada penutupan L = 63.000: 50 + 3 × 416 = 1.298
        assertApproxEqAbs(_h(), 1_298, 4);
        vm.warp(MON_2100);
        assertApproxEqAbs(_h(), 2_066, 3); // §6.6
        assertTrue(risk.eventActive(address(nvda), MON_2100));
        vm.warp(TUE_0930 + 30 minutes);
        feed.set(100e8);
        // ramp-out kalender (fOut ½) dan ramp-out event (mult 2,6×) bersamaan: ½ × 1.298
        assertApproxEqAbs(_h(), 649, 4);
    }

    /// INV-3: dengan feed konstan, haircut tidak pernah melompat lebih dari batas laju ramp.
    function testFuzz_INV3_noStep(uint64 t, uint16 dt) public {
        t = uint64(bound(t, FRI_1400, TUE_1000));
        dt = uint16(bound(dt, 1, 900));
        vm.prank(calibrator);
        risk.scheduleEvent(
            address(nvda), VigilRiskEngine.ScheduledEvent({from: MON_1600, until: TUE_0930, multBps: 42_000})
        );
        feed.setAt(100e8, t); // feed segar pada t → tanpa pengetatan rule 3
        vm.warp(t);
        uint256 h0 = _h();
        vm.warp(t + dt);
        uint256 h1 = _h();
        uint256 d = h0 > h1 ? h0 - h1 : h1 - h0;
        // dua ramp bisa bertumpuk (kalender × event): batas 2 × H_MAX/RAMP per detik, plus pembulatan
        assertLe(d, 2 + 2 * uint256(2_500) * dt / 3_600);
    }

    function test_premiumTables_interpolation() public {
        VigilRiskEngine.PremiumTable memory p = VigilRiskEngine.PremiumTable({
            lBucket: [uint64(63_000), 149_400, 235_800, 322_200],
            rateNoEvent: [uint128(1e9), 2e9, 4e9, 5e9],
            rateEvent: [uint128(10e9), 12e9, 14e9, 15e9]
        });
        VigilRiskEngine.BufferTable memory b = VigilRiskEngine.BufferTable({
            bBps: [uint16(400), 600, 800, 1_023, 1_500, 2_000],
            multWad: [uint128(6.24e18), 2.97e18, 1.68e18, 1e18, 0.42e18, 0.21e18]
        });
        vm.prank(calibrator);
        risk.setPremiumTables(address(nvda), p, b);
        assertEq(risk.premiumRefRatePerSecond(address(nvda), Regime.MARKET, 235_800), 0);
        assertEq(risk.premiumRefRatePerSecond(address(nvda), Regime.CLOSED, 235_800), 4e9);
        assertEq(risk.premiumRefRatePerSecond(address(nvda), Regime.OVERNIGHT, 63_000), 1e9);
        assertEq(risk.premiumRefRatePerSecond(address(nvda), Regime.CLOSED, 149_400), 2e9);
        assertEq(risk.premiumRefRatePerSecond(address(nvda), Regime.CLOSED, (63_000 + 149_400) / 2), 1.5e9);
        assertEq(risk.premiumRefRatePerSecond(address(nvda), Regime.CORP_ACTION, 1_000_000), 5e9); // clamp atas
        assertEq(risk.bufferMultiplierWad(address(nvda), 1_023), 1e18);
        assertEq(risk.bufferMultiplierWad(address(nvda), 100), 6.24e18);
        assertEq(risk.bufferMultiplierWad(address(nvda), 3_000), 0.21e18);
        assertEq(risk.bufferMultiplierWad(address(nvda), 700), 2.325e18); // tengah 600–800
        // tabel tidak monoton ditolak
        b.multWad[1] = 7e18;
        vm.prank(calibrator);
        vm.expectRevert(VigilRiskEngine.BadTable.selector);
        risk.setPremiumTables(address(nvda), p, b);
    }
}
