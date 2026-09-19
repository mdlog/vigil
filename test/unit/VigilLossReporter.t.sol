// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Base} from "../Base.t.sol";
import {VigilLossReporter} from "../../src/VigilLossReporter.sol";
import {Position, Market} from "morpho-blue/interfaces/IMorpho.sol";

contract VigilLossReporterTest is Base {
    function setUp() public override {
        super.setUp();
        usdg.mint(liquidator, 1_000_000e6);
        vm.startPrank(liquidator);
        usdg.approve(address(lossReporter), type(uint256).max);
        usdg.approve(address(morpho), type(uint256).max);
        vm.stopPrank();
    }

    /// A max-LTV position opened Friday afternoon (regular session, haircut 0), then a −12 % gap (beyond the
    /// 10.23 % bad-debt threshold) prints 30 minutes after the Monday open — the shape of 27 Jan 2025.
    function _underwater(address who, bool join) internal {
        _open(mB, who, 10e18, 0.86e18);
        if (join) _join(who, 5e6);
        vm.warp(MON_0930 + 30 minutes);
        feed.set(P0 * 88 / 100);
    }

    function test_liquidateWithCover_supplierWhole_INV13() public {
        _underwater(alice, true);
        (uint256 shortfall, uint256 coverable, bool member, bool covered) = lossReporter.previewCover(idB, alice);
        assertGt(shortfall, 0);
        assertTrue(member);
        assertTrue(covered); // inside the 1 h coverWindow after the open
        assertEq(coverable, shortfall + lossReporter.DUST());
        uint256 supplyBefore = _mkt(mB).totalSupplyAssets;
        uint256 bsBefore = usdg.balanceOf(address(backstop));
        uint256 liqUsdgBefore = usdg.balanceOf(liquidator);
        vm.prank(liquidator);
        (uint256 seized, uint256 repaid, uint256 got) = lossReporter.liquidateWithCover(idB, alice, "");
        Position memory p = _pos(mB, alice);
        assertEq(p.borrowShares, 0);
        assertGt(p.collateral, 0); // collateral dust remains → Morpho never takes the bad-debt path
        assertGe(_mkt(mB).totalSupplyAssets, supplyBefore); // INV-13
        assertEq(got, shortfall + lossReporter.DUST());
        uint256 bounty = got * 10 / 10_000;
        assertApproxEqAbs(bsBefore - usdg.balanceOf(address(backstop)), got + bounty, 2);
        assertEq(nvda.balanceOf(liquidator), seized);
        assertApproxEqAbs(liqUsdgBefore - usdg.balanceOf(liquidator), repaid - bounty, 2); // pays repaid, receives the bounty
        assertEq(backstop.totalCovered(), got + bounty);
    }

    function test_directMorphoLiquidation_socializesLoss() public {
        _underwater(alice, true);
        uint256 supplyBefore = _mkt(mB).totalSupplyAssets;
        uint256 coll = _pos(mB, alice).collateral;
        vm.prank(liquidator);
        morpho.liquidate(mB, alice, coll, 0, "");
        assertEq(_pos(mB, alice).borrowShares, 0);
        assertLt(_mkt(mB).totalSupplyAssets, supplyBefore); // the suppliers lose (scenario 11, control side)
        assertEq(backstop.totalCovered(), 0);
    }

    function test_nonMemberNotCovered() public {
        _underwater(bob, false);
        vm.prank(liquidator);
        vm.expectRevert(VigilLossReporter.NotMember.selector);
        lossReporter.liquidateWithCover(idB, bob, "");
    }

    function test_outsideCoverWindowNotCovered() public {
        _underwater(alice, true);
        vm.warp(MON_0930 + 2 hours); // MARKET, > 1 h after the open
        vm.prank(liquidator);
        vm.expectRevert(VigilLossReporter.NotCovered.selector);
        lossReporter.liquidateWithCover(idB, alice, "");
        vm.warp(MON_2100); // regime ≠ MARKET → covered again
        (,,, bool covered) = lossReporter.previewCover(idB, alice);
        assertTrue(covered);
    }

    function test_partialCoverWhenCapExhausted_recordsResidual() public {
        _underwater(alice, true);
        (uint256 shortfall,,,) = lossReporter.previewCover(idB, alice);
        vm.prank(guardian);
        backstop.setCoverageCap(idB, shortfall / 2);
        uint256 supplyBefore = _mkt(mB).totalSupplyAssets;
        vm.prank(liquidator);
        (,, uint256 got) = lossReporter.liquidateWithCover(idB, alice, "");
        assertLt(got, shortfall);
        assertEq(_pos(mB, alice).borrowShares, 0);
        assertEq(_pos(mB, alice).collateral, 0); // the seizedAssets = coll path
        uint256 loss = supplyBefore - _mkt(mB).totalSupplyAssets;
        assertGt(loss, 0);
        assertLt(loss, shortfall); // half absorbed by the backstop
    }

    function test_healthyPositionCannotBeLiquidated() public {
        vm.warp(MON_0930);
        feed.set(P0);
        _open(mB, alice, 10e18, 0.5e18);
        _join(alice, 5e6);
        vm.prank(liquidator);
        vm.expectRevert(); // Morpho: healthy position
        lossReporter.liquidateWithCover(idB, alice, "");
    }
}
