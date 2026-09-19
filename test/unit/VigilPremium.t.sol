// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Base} from "../Base.t.sol";
import {VigilPremium} from "../../src/VigilPremium.sol";
import {Regime} from "../../src/interfaces/IVigil.sol";
import {MarketParams} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";

contract VigilPremiumTest is Base {
    using MarketParamsLib for MarketParams;

    function test_bufferBpsAtMaxLtv() public {
        _open(mB, alice, 10e18, 0.86e18);
        uint256 debt = _debt(mB, alice);
        assertApproxEqAbs(premium.bufferBps(idB, alice, debt), 1_023, 2); // b = 1 − 0,86 × 1,0438 (§6.5)
        assertEq(risk.bufferMultiplierWad(address(nvda), 1_023), 1e18);
    }

    function test_accrualEqualsBorrowedTimesMultTimesDeltaIndex() public {
        _open(mB, alice, 10e18, 0.5e18); // b ≈ 47,8% → m(b) = 0,21 (clamp)
        _join(alice, 100e6);
        uint256 idx0 = so.premiumIndex(address(nvda));
        uint256 debt = _debt(mB, alice);
        vm.warp(MON_0930);
        uint256 dIdx = so.premiumIndex(address(nvda)) - idx0;
        uint256 expectedDue = debt * 0.21e18 / 1e18 * dIdx / 1e18;
        assertGt(expectedDue, 0);
        uint256 bsBefore = usdg.balanceOf(address(backstop));
        premium.accrue(idB, alice);
        VigilPremium.Escrow memory e = premium.escrowOf(idB, alice);
        assertApproxEqRel(e.paid, expectedDue, 0.001e18); // bunga 5%/thn menambah utang sedikit selama akhir pekan
        assertEq(usdg.balanceOf(address(backstop)) - bsBefore, e.paid - e.paid / 100); // 99% ke backstop
        assertEq(so.bountyPool(address(nvda)), e.paid / 100); // 1% bounty poke
        assertEq(premium.totalAccrued(), e.paid);
        assertEq(premium.totalPaid(), e.paid);
    }

    function test_accrualIndependentOfCallFrequency() public {
        _open(mB, alice, 10e18, 0.5e18);
        _open(mB, bob, 10e18, 0.5e18);
        _join(alice, 100e6);
        _join(bob, 100e6);
        vm.warp(SAT_1200);
        premium.accrue(idB, alice);
        vm.warp(SUN_2100);
        premium.accrue(idB, alice);
        vm.warp(MON_0930);
        premium.accrue(idB, alice);
        premium.accrue(idB, bob);
        // hanya sampling notional (bunga 5%/thn) yang berbeda, bukan integral waktu (INV-7)
        assertApproxEqRel(premium.escrowOf(idB, alice).paid, premium.escrowOf(idB, bob).paid, 0.001e18);
    }

    function test_membershipAndDelinquency() public {
        _open(mB, alice, 10e18, 0.86e18); // max-LTV: m(b) = 1, premi ≈ 3,5 bp/akhir pekan atas ~1.032 USDG
        _open(mB, bob, 10e18, 0.5e18);
        assertFalse(premium.isMember(idB, bob)); // tidak pernah opt-in
        assertTrue(premium.isDelinquent(idB, bob));
        _join(alice, 1e6); // 1 USDG ≥ cadangan 7 hari (≈0,92 USDG)
        assertTrue(premium.isMember(idB, alice));
        assertFalse(premium.isDelinquent(idB, alice));
        assertGt(premium.minReserve(idB, alice), 0);
        // tidak boleh menarik di bawah cadangan
        vm.prank(alice);
        vm.expectRevert(VigilPremium.ReserveBreach.selector);
        premium.withdrawUnused(idB, 100e6);
        // escrow yang terkuras setelah 3 akhir pekan → delinquent → bukan member; topUp memulihkan
        vm.warp(FRI_1400 + 21 days);
        assertTrue(premium.isDelinquent(idB, alice));
        premium.accrue(idB, alice);
        assertGt(premium.escrowOf(idB, alice).owed, 0);
        assertFalse(premium.isMember(idB, alice));
        assertGt(premium.delinquentSince(idB, alice), 0);
        usdg.mint(alice, 1_000e6);
        vm.prank(alice);
        premium.topUp(idB, alice, 1_000e6);
        assertEq(premium.escrowOf(idB, alice).owed, 0);
        assertTrue(premium.isMember(idB, alice));
        assertEq(premium.delinquentSince(idB, alice), 0);
    }

    function test_noPremiumDuringMarket() public {
        _open(mB, alice, 10e18, 0.5e18);
        _join(alice, 100e6);
        vm.warp(FRI_1400 + 1 hours);
        premium.accrue(idB, alice);
        assertEq(premium.escrowOf(idB, alice).paid, 0); // FR-19
    }

    /// Dua pasar Vigil (mis. NVDA 86% dan 77%) pada satu VigilPremium — approve ke SESSION hanya sekali.
    function test_registerSecondMarketDoesNotRevert() public {
        morpho.enableLltv(0.77e18);
        MarketParams memory m2 = MarketParams(address(usdg), address(nvda), address(vOracle), address(irm), 0.77e18);
        morpho.createMarket(m2);
        vm.prank(guardian);
        premium.registerMarket(m2);
        assertEq(premium.marketParams(m2.id()).lltv, 0.77e18);
    }
}
