// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Base} from "../Base.t.sol";
import {VigilPreLiquidation} from "../../src/VigilPreLiquidation.sol";
import {Position} from "morpho-blue/interfaces/IMorpho.sol";

contract VigilPreLiquidationTest is Base {
    function setUp() public override {
        super.setUp();
        usdg.mint(liquidator, 1_000_000e6);
        vm.prank(liquidator);
        usdg.approve(address(preLiq), type(uint256).max);
    }

    function test_INV12_softAlwaysTighterThanHard() public {
        uint64[6] memory ts = [FRI_1400, FRI_1500, FRI_1530, SAT_1200, MON_0930, MON_2100];
        for (uint256 i; i < ts.length; ++i) {
            vm.warp(ts[i]);
            feed.set(P0);
            assertGe(preLiq.softHaircutBps(idB), uint256(vOracle.currentHaircutBps()) + 200);
        }
    }

    function test_inactiveInMarket_activeInPreCloseWindow_dutchDiscount() public {
        _open(mB, alice, 10e18, 0.84e18); // di bawah LLTV 86%, di atas ambang soft (0,86 × 0,93 = 80%)
        _join(alice, 50e6);
        (bool ok,) = preLiq.isUnwindable(idB, alice);
        assertFalse(ok); // 14:00 MARKET, di luar jendela, tidak delinquent
        vm.warp(FRI_1430);
        (ok,) = preLiq.isUnwindable(idB, alice);
        assertTrue(ok);
        assertEq(preLiq.currentDiscountBps(idB, alice), 0); // Dutch mulai dari 0
        vm.warp(FRI_1500);
        assertEq(preLiq.currentDiscountBps(idB, alice), 150);
        vm.warp(FRI_1530);
        assertEq(preLiq.currentDiscountBps(idB, alice), 300);
        vm.warp(SAT_1200);
        assertEq(preLiq.currentDiscountBps(idB, alice), 300);
    }

    function test_unwindToTargetLtv_INV8() public {
        _open(mB, alice, 10e18, 0.84e18);
        _join(alice, 50e6);
        vm.warp(FRI_1500);
        (bool ok, uint256 maxRepay) = preLiq.isUnwindable(idB, alice);
        assertTrue(ok);
        uint256 ltvBefore = _ltv(mB, alice, 120e24);
        uint256 collBefore = _pos(mB, alice).collateral;
        vm.prank(liquidator);
        (uint256 repaid, uint256 seized) = preLiq.preLiquidate(idB, alice, type(uint256).max, "");
        assertEq(repaid, maxRepay);
        // unwinder menerima jaminan senilai repaid × (1 + 1,5%) pada harga tanpa haircut
        assertApproxEqRel(seized * 120e24 / 1e36, repaid * 10_150 / 10_000, 0.0001e18);
        assertEq(nvda.balanceOf(liquidator), seized);
        uint256 ltvAfter = _ltv(mB, alice, 120e24);
        assertLe(ltvAfter, 0.76e18 + 1e12); // INV-8: ≤ target
        assertLt(ltvAfter, ltvBefore);
        assertLt(_pos(mB, alice).collateral, collBefore);
        // sudah di target: tidak bisa di-unwind lagi
        (ok,) = preLiq.isUnwindable(idB, alice);
        assertFalse(ok);
    }

    function test_nonMemberCannotBeSoftUnwound_healthyPositionNot() public {
        _open(mB, bob, 10e18, 0.84e18); // tidak otorisasi (dan tidak escrow) → delinquent, tetapi withdrawCollateral gagal
        vm.warp(FRI_1500);
        (bool ok,) = preLiq.isUnwindable(idB, bob);
        assertTrue(ok); // delinquent = memenuhi syarat secara logika...
        vm.prank(liquidator);
        vm.expectRevert(); // ...tetapi Morpho menolak withdrawCollateral tanpa setAuthorization
        preLiq.preLiquidate(idB, bob, type(uint256).max, "");
        // posisi sehat (LTV 60%) member tidak tersentuh walau jendela terbuka
        _open(mB, alice, 10e18, 0.6e18);
        _join(alice, 50e6);
        (ok,) = preLiq.isUnwindable(idB, alice);
        assertFalse(ok);
    }

    function test_delinquentMemberUnwindableInMarket_discountFromDelinquency() public {
        _open(mB, alice, 10e18, 0.86e18); // m(b) = 1 → ≈3,5 bp per akhir pekan
        _join(alice, 1e6);
        // tiga akhir pekan menguras escrow 1 USDG; accrue pada Kamis 11:00 ET (MARKET, di luar jendela)
        vm.warp(FRI_1400 + 20 days - 3 hours);
        feed.set(P0);
        premium.accrue(idB, alice);
        assertTrue(premium.isDelinquent(idB, alice));
        (bool ok,) = preLiq.isUnwindable(idB, alice);
        assertTrue(ok);
        assertEq(preLiq.currentDiscountBps(idB, alice), 0); // Dutch dari saat delinquent
        vm.warp(block.timestamp + 30 minutes);
        assertEq(preLiq.currentDiscountBps(idB, alice), 150);
    }
}
