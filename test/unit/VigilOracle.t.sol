// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Base} from "../Base.t.sol";
import {VigilOracle} from "../../src/VigilOracle.sol";
import {MockFeed} from "../../src/mocks/MockFeed.sol";
import {MockSequencerFeed} from "../../src/mocks/MockSequencerFeed.sol";
import {Regime} from "../../src/interfaces/IVigil.sol";

contract VigilOracleTest is Base {
    function test_scaleFactorAndPriceInMarket() public view {
        assertEq(vOracle.SCALE_FACTOR(), 1e16); // 36 + 6 − 18 − 8
        assertEq(vOracle.price(), 120e24); // 1e18 collateral → 120e6 USDG
        assertEq(vOracle.price(), cOracle.price()); // identical to the control during a regular session (D9)
        assertEq(vOracle.currentHaircutBps(), 0);
        assertEq(vOracle.regime(), uint8(Regime.MARKET));
    }

    function test_capBindsOutsideMarket() public {
        vm.warp(FRI_1530); // H = 977 → cap 500
        assertEq(vOracle.currentHaircutBps(), CAP_BPS);
        assertEq(vOracle.price(), 120e24 * 9_500 / 10_000);
        assertEq(vOracle.unhaircutPrice(), 120e24);
        vm.warp(SUN_2100);
        assertEq(vOracle.price(), 120e24 * 9_500 / 10_000); // INV-9: feed frozen over the weekend, no revert
    }

    function test_corpActionRevertsButRepayWorks() public {
        // an open position in Market B, then a corporate action
        uint256 debt = _open(mB, alice, 10e18, 0.5e18);
        nvda.setOraclePaused(true);
        vm.expectRevert(VigilOracle.VigilPaused.selector);
        vOracle.price();
        vm.startPrank(alice);
        vm.expectRevert(); // borrow needs the oracle
        morpho.borrow(mB, 1e6, 0, alice, alice);
        vm.expectRevert(); // withdrawCollateral needs the oracle
        morpho.withdrawCollateral(mB, 1e18, alice, alice);
        usdg.approve(address(morpho), type(uint256).max);
        morpho.repay(mB, debt / 2, 0, alice, ""); // repay does NOT need the oracle (scenario 4)
        vm.stopPrank();
        vm.prank(liquidator);
        vm.expectRevert();
        morpho.liquidate(mB, alice, 1e18, 0, "");
        vm.prank(supplier);
        morpho.supply(mB, 1e6, 0, supplier, ""); // supply keeps working
    }

    function test_unexpectedStaleReverts_expectedDoesNot() public {
        feed.setAt(P0, FRI_1555);
        vm.warp(SAT_1200);
        vOracle.price(); // frozen since Friday 15:55: expected
        vm.warp(MON_0930 + 1 hours);
        vOracle.price(); // grace period since the Monday open
        vm.warp(MON_2100); // the last price is older than Monday closeAt − 18 h → unexpected (10c)
        vm.expectRevert(VigilOracle.VigilStale.selector);
        vOracle.price();
        // the feed dies Thursday night before the weekend (10b)
        feed.setAt(P0, FRI_1600 - 20 hours);
        vm.warp(SAT_1200);
        vm.expectRevert(VigilOracle.VigilStale.selector);
        vOracle.price();
    }

    function test_sequencerFeedGrace() public {
        MockSequencerFeed seq = new MockSequencerFeed();
        VigilOracle o = new VigilOracle(address(nvda), so, risk, address(0), address(seq), 1 hours, 0, 18, 6, CAP_BPS);
        vm.warp(FRI_1400 + 2 hours);
        feed.set(P0);
        o.price(); // up since deploy (2 h > grace)
        seq.setStatus(1);
        vm.expectRevert(VigilOracle.VigilSequencerDown.selector); // sequencer down
        o.price();
        seq.setStatus(0);
        vm.expectRevert(VigilOracle.VigilSequencerDown.selector); // inside the grace period (scenario 6)
        o.price();
        vm.warp(block.timestamp + 1 hours + 1);
        feed.set(P0);
        o.price();
    }

    function test_quoteFeedDepegRaisesCollateralValueInUsdg() public {
        MockFeed q = new MockFeed(8, 0.99e8);
        VigilOracle o = new VigilOracle(address(nvda), so, risk, address(q), address(0), 0, 2 days, 18, 6, CAP_BPS);
        assertEq(o.SCALE_FACTOR(), 1e24); // +8 for the quote feed (§9.2)
        assertEq(o.price(), uint256(120e8) * 1e24 / uint256(99e6));
        vm.warp(FRI_1400 + 3 days); // quote feed stale > 2 days
        vm.expectRevert(VigilOracle.VigilStale.selector);
        o.price();
    }
}
