// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Base} from "../Base.t.sol";
import {VigilRiskEngine} from "../../src/VigilRiskEngine.sol";
import {VigilSessionOracle} from "../../src/VigilSessionOracle.sol";
import {VigilOracle} from "../../src/VigilOracle.sol";
import {Regime} from "../../src/interfaces/IVigil.sol";
import {Position, Market, MarketParams} from "morpho-blue/interfaces/IMorpho.sol";

/// Skenario PRD §12 dijalankan pada Morpho Blue asli dengan dua pasar identik (A kontrol, B Vigil).
contract ScenariosTest is Base {
    address carol = address(0xCA201); // peminjam di pasar kontrol

    function setUp() public override {
        super.setUp();
        usdg.mint(liquidator, 5_000_000e6);
        vm.startPrank(liquidator);
        usdg.approve(address(morpho), type(uint256).max);
        usdg.approve(address(preLiq), type(uint256).max);
        usdg.approve(address(lossReporter), type(uint256).max);
        vm.stopPrank();
    }

    /// Bot unwind: unwind member yang memenuhi syarat; likuidasi keras non-member yang tidak sehat pada harga pasar.
    function _botPreClose() internal {
        (bool ok,) = preLiq.isUnwindable(idB, alice);
        if (ok) {
            vm.prank(liquidator);
            preLiq.preLiquidate(idB, alice, type(uint256).max, "");
        }
        // bob (non-member) tidak sehat pada harga ter-haircut → likuidasi keras parsial (seize 35% jaminan)
        Position memory pb = _pos(mB, bob);
        if (pb.collateral > 0) {
            vm.prank(liquidator);
            try morpho.liquidate(mB, bob, uint256(pb.collateral) * 35 / 100, 0, "") {} catch {}
        }
    }

    function _replay(int256 closePx, int256 openPx, uint64 fri1400, uint64 fri1555, uint64 mon0930) internal {
        vm.warp(fri1400);
        feed.set(closePx);
        _catchUp();
        _open(mB, alice, 10e18, 0.86e18);
        _join(alice, 20e6);
        _open(mB, bob, 10e18, 0.86e18);
        _open(mA, carol, 10e18, 0.86e18);
        uint256 supplyA0 = _mkt(mA).totalSupplyAssets;
        uint256 supplyB0 = _mkt(mB).totalSupplyAssets;

        // Jumat 15:00–15:30: jendela pre-close — soft unwind member, likuidasi keras non-member
        vm.warp(fri1400 + 1 hours);
        _botPreClose();
        vm.warp(fri1400 + 90 minutes);
        _botPreClose();
        uint256 pxScaled = uint256(closePx) * 1e16;
        assertLe(_ltv(mB, alice, pxScaled), 0.76e18 + 1e13); // member di-unwind ke target sebelum close (+bunga 30 menit)
        assertApproxEqRel(_ltv(mA, carol, pxScaled), 0.86e18, 0.0001e18); // kontrol tidak tersentuh

        // akhir pekan: feed beku sejak Jumat 15:55, oracle Vigil tidak revert, haircut cap 500
        feed.setAt(closePx, fri1555);
        vm.warp(fri1555 + 30 hours);
        assertEq(vOracle.currentHaircutBps(), CAP_BPS);
        vOracle.price();
        premium.accrue(idB, alice);
        assertGt(premium.escrowOf(idB, alice).paid, 0); // premi akhir pekan mengalir ke backstop

        // Senin 09:30 + 5 menit: gap tercetak
        vm.warp(mon0930 + 5 minutes);
        feed.set(openPx);
        // pasar kontrol: likuidasi penuh → bad debt tersosialisasi
        uint256 collCarol = _pos(mA, carol).collateral;
        vm.prank(liquidator);
        morpho.liquidate(mA, carol, collCarol, 0, "");
        assertLt(_mkt(mA).totalSupplyAssets, supplyA0);
        // pasar Vigil: alice (76%) tidak sehat tetapi TIDAK underwater → likuidasi tanpa shortfall, tanpa cover
        (uint256 shortfall,,,) = lossReporter.previewCover(idB, alice);
        assertEq(shortfall, 0);
        vm.prank(liquidator);
        lossReporter.liquidateWithCover(idB, alice, "");
        assertGe(_mkt(mB).totalSupplyAssets, supplyB0);
        assertEq(backstop.totalCovered(), 0);
        assertEq(_pos(mB, alice).borrowShares, 0);
    }

    /// Skenario 2a — replay 5 Agustus 2024 (close 107,27 → open 92,06, −14,18%).
    function test_scenario2_replayAug5_2024() public {
        _replay(10726999664, 9205999756, FRI_1400, FRI_1555, MON_0930);
    }

    /// Skenario 2b — replay 27 Januari 2025 (close 142,62 → open 124,80, −12,49%).
    function test_scenario2_replayJan27_2025() public {
        // 2025-01-24 Jumat 14:00 ET (EST) = 1737745200; 15:55 = 1737752100; 2025-01-27 09:30 = 1737988200
        _replay(14261999512, 12480000305, 1737745200, 1737752100, 1737988200);
    }

    /// Skenario 1 — akhir pekan biasa, gap −2%: tidak ada unwind, tidak ada likuidasi, premi tetap terakumulasi.
    function test_scenario1_normalWeekend() public {
        _open(mB, alice, 10e18, 0.75e18); // di bawah ambang soft akhir pekan (0,86 × 0,9023 = 77,6%)
        _join(alice, 20e6);
        vm.warp(FRI_1500);
        (bool ok,) = preLiq.isUnwindable(idB, alice);
        assertFalse(ok);
        feed.setAt(P0, FRI_1555);
        vm.warp(MON_0930 + 5 minutes);
        feed.set(P0 * 98 / 100);
        vm.prank(liquidator);
        vm.expectRevert(); // sehat: 0,75/0,98 = 76,5% < 86%
        morpho.liquidate(mB, alice, 1e18, 0, "");
        premium.accrue(idB, alice);
        assertGt(premium.escrowOf(idB, alice).paid, 0);
    }

    /// Skenario 3 — malam earnings: event 4,2× dijadwalkan ≥ 24 jam sebelumnya; member max-LTV di-unwind
    /// pre-close oleh ambang event; gap −12% saat open Selasa → kontrol bad debt, Vigil tidak.
    function test_scenario3_earningsNight() public {
        vm.prank(calibrator);
        risk.scheduleEvent(
            address(nvda), VigilRiskEngine.ScheduledEvent({from: MON_1600, until: TUE_0930, multBps: 42_000})
        );
        vm.warp(MON_0930 + 2 hours);
        feed.set(P0);
        _open(mB, alice, 10e18, 0.86e18);
        _join(alice, 20e6);
        _open(mA, carol, 10e18, 0.86e18);
        vm.warp(MON_1600 - 30 minutes);
        feed.set(P0);
        assertGt(preLiq.softHaircutBps(idB), 1_200); // H_soft naik ter-ramp (event × kalender) ≈ 1.298
        (bool ok,) = preLiq.isUnwindable(idB, alice);
        assertTrue(ok);
        vm.prank(liquidator);
        preLiq.preLiquidate(idB, alice, type(uint256).max, "");
        assertLe(_ltv(mB, alice, 120e24), 0.76e18 + 1e13);
        feed.setAt(P0, MON_1600 - 5 minutes);
        vm.warp(TUE_0930 + 5 minutes);
        feed.set(P0 * 88 / 100);
        uint256 supplyA0 = _mkt(mA).totalSupplyAssets;
        uint256 supplyB0 = _mkt(mB).totalSupplyAssets;
        uint256 collCarol = _pos(mA, carol).collateral;
        vm.prank(liquidator);
        morpho.liquidate(mA, carol, collCarol, 0, ""); // 0,86 → underwater (b 10,23% < 12%)
        assertLt(_mkt(mA).totalSupplyAssets, supplyA0); // kontrol: bad debt tersosialisasi
        vm.prank(liquidator);
        lossReporter.liquidateWithCover(idB, alice, ""); // 0,76/0,88 = 86,4%: likuidasi tanpa shortfall
        assertGe(_mkt(mB).totalSupplyAssets, supplyB0);
        assertEq(backstop.totalCovered(), 0);
    }

    /// Skenario 9 — akhir pekan panjang (Labor Day 2026): feed beku 4 hari, oracle tidak revert, L = 322.200.
    function test_scenario9_longWeekendNoRevert() public {
        uint64 labFri1400 = 1788544800; // 2026-09-04 14:00 ET
        uint64 labFri1555 = 1788551700;
        uint64 labTue0930 = 1788874200;
        vm.warp(labFri1400);
        feed.set(P0);
        _open(mB, alice, 10e18, 0.5e18);
        feed.setAt(P0, labFri1555);
        vm.warp(labFri1555 + 2 days); // Minggu
        vOracle.price();
        vm.warp(labFri1555 + 3 days); // Senin libur
        vOracle.price();
        (,, uint64 closeAt, uint64 nextOpen) = so.regimeOf(address(nvda));
        assertEq(nextOpen - closeAt, 322_200);
        assertGe(risk.haircutBps(address(nvda)), 1_130);
        vm.warp(labTue0930 + 10 minutes);
        vOracle.price(); // tenggang sejak open Selasa
    }

    /// Skenario 5 — keeper mati: halt palsu kedaluwarsa, sistem kembali ke kalender; premi malam biasa tetap jalan.
    function test_scenario5_keeperDeath() public {
        VigilSessionOracle.Attestation memory a = VigilSessionOracle.Attestation({
            asset: address(nvda),
            regime: uint8(Regime.CLOSED),
            closeAt: FRI_1400,
            nextOpen: cal.sessionAt(FRI_1400).nextOpen,
            issuedAt: FRI_1400,
            deadline: FRI_1400 + 10 minutes
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(keeperPk, so.hashAttestation(a));
        so.attest(a, abi.encodePacked(r, s, v));
        assertEq(vOracle.regime(), uint8(Regime.CLOSED));
        vm.warp(FRI_1400 + 31 minutes);
        feed.set(P0);
        assertEq(vOracle.regime(), uint8(Regime.MARKET)); // tidak ada keeper → kalender
        _open(mB, alice, 10e18, 0.5e18);
        _join(alice, 20e6);
        vm.warp(MON_0930);
        feed.set(P0);
        vm.warp(TUE_0930);
        feed.set(P0);
        premium.accrue(idB, alice);
        uint256 paidAfterWeekend = premium.escrowOf(idB, alice).paid;
        vm.warp(TUE_0930 + 1 days);
        feed.set(P0);
        premium.accrue(idB, alice);
        assertGt(premium.escrowOf(idB, alice).paid, paidAfterWeekend); // malam Selasa OVERNIGHT dari kalender, tanpa keeper
    }
}
