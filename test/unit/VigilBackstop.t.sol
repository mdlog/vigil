// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Base} from "../Base.t.sol";
import {VigilBackstop} from "../../src/VigilBackstop.sol";
import {Id} from "morpho-blue/interfaces/IMorpho.sol";

contract VigilBackstopTest is Base {
    uint64 constant THU_1000 = 1722521000 + 3600 * 0; // 2024-08-01 10:03 ET (Kamis, MARKET)

    function test_directExitsDisabled() public {
        assertEq(backstop.maxWithdraw(underwriter), 0);
        assertEq(backstop.maxRedeem(underwriter), 0);
        vm.startPrank(underwriter);
        vm.expectRevert(VigilBackstop.Disabled.selector);
        backstop.withdraw(1e6, underwriter, underwriter);
        vm.expectRevert(VigilBackstop.Disabled.selector);
        backstop.redeem(1e6, underwriter, underwriter);
        vm.stopPrank();
    }

    function test_requestThursday_claimOnlyAfterSevenDaysInMarket_atClaimPrice() public {
        vm.warp(THU_1000);
        uint256 shares = backstop.balanceOf(underwriter) / 2;
        vm.prank(underwriter);
        uint256 id = backstop.requestWithdraw(shares);
        assertEq(backstop.escrowedShares(), shares);
        vm.warp(FRI_1400); // < 7 hari — v1.0 (24 jam) akan meloloskan ini
        vm.prank(underwriter);
        vm.expectRevert(VigilBackstop.NotReady.selector);
        backstop.claimWithdraw(id);
        // kerugian akhir pekan: cover 50.000 USDG mengurangi harga share share yang di-escrow ikut menyerap
        vm.prank(address(lossReporter));
        uint256 got = backstop.coverBadDebt(idB, 50_000e6);
        assertEq(got, 50_000e6);
        vm.warp(THU_1000 + 7 days); // Kamis berikutnya 10:03 ET, MARKET
        uint256 assetsAtClaim = backstop.previewRedeem(shares);
        vm.prank(underwriter);
        uint256 assets = backstop.claimWithdraw(id);
        assertEq(assets, assetsAtClaim);
        assertApproxEqRel(assets, 75_000e6, 0.0001e18); // separuh dari (200k − 50k)
        assertEq(backstop.escrowedShares(), 0);
        vm.prank(underwriter);
        vm.expectRevert(VigilBackstop.AlreadyClaimed.selector);
        backstop.claimWithdraw(id);
    }

    function test_claimRejectedOutsideMarket() public {
        vm.warp(THU_1000);
        vm.prank(underwriter);
        uint256 id = backstop.requestWithdraw(1e6);
        vm.warp(THU_1000 + 7 days + 2 days + 2 hours); // Sabtu
        vm.prank(underwriter);
        vm.expectRevert(VigilBackstop.NotMarket.selector);
        backstop.claimWithdraw(id);
    }

    function test_coverRespectsCapAndAssetsAndCaller() public {
        vm.expectRevert(VigilBackstop.NotLossReporter.selector);
        backstop.coverBadDebt(idB, 1e6);
        vm.prank(guardian);
        backstop.setCoverageCap(idB, 30_000e6);
        vm.startPrank(address(lossReporter));
        assertEq(backstop.coverBadDebt(idB, 100_000e6), 30_000e6); // cap
        assertEq(backstop.coverBadDebt(idB, 1e6), 0); // cap habis
        vm.stopPrank();
        assertEq(backstop.totalCovered(), 30_000e6);
        assertEq(backstop.totalAssets(), 170_000e6);
    }
}
