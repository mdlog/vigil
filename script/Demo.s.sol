// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Script, console2} from "forge-std/Script.sol";
import {IMorpho, MarketParams, Id, Position, Market} from "morpho-blue/interfaces/IMorpho.sol";
import {Morpho} from "morpho-blue/Morpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
import {MorphoBalancesLib} from "morpho-blue/libraries/periphery/MorphoBalancesLib.sol";
import {VigilDeployer} from "./DeployLib.sol";
import {ControlOracle} from "../src/mocks/ControlOracle.sol";
import {MockStockToken} from "../src/mocks/MockStockToken.sol";
import {MockFeed} from "../src/mocks/MockFeed.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";
import {MockIRM} from "../src/mocks/MockIRM.sol";

/// Demo (PRD §13): two identical NVDA/USDG markets at 86 % LLTV — A control (raw feed oracle), B Vigil — replayed on
/// two real Mondays: 5 Aug 2024 (−14.18 %) and 27 Jan 2025 (−12.49 %), then a member who is genuinely underwater
/// to show `liquidateWithCover`. Run without broadcasting:  forge script script/Demo.s.sol -vv
contract Demo is Script {
    using MarketParamsLib for MarketParams;
    using MorphoBalancesLib for IMorpho;

    IMorpho morpho;
    MockUSDG usdg;
    MockStockToken nvda;
    MockFeed feed;
    VigilDeployer.Deployed d;
    MarketParams mA;
    MarketParams mB;
    address supplier = address(0x5011);
    address alice = address(0xA1);
    address carol = address(0xCA201);
    address liquidator = address(0x11C);
    address underwriter = address(0x0DD);
    address admin = address(0xAD);

    function run() external {
        _replay(
            "5 August 2024   (NVDA 107.27 -> 92.06, -14.18%)",
            1722621600,
            1722628500,
            1722864600,
            10726999664,
            9205999756
        );
        _replay(
            "27 January 2025 (NVDA 142.62 -> 124.80, -12.49%)",
            1737745200,
            1737752100,
            1737988200,
            14261999512,
            12480000305
        );
        _coverCase();
    }

    function _deploy(uint64 t0, int256 px) internal {
        vm.warp(t0);
        usdg = new MockUSDG();
        nvda = new MockStockToken("NVIDIA (mock)", "NVDA");
        feed = new MockFeed(8, px);
        Morpho m = new Morpho(admin);
        morpho = IMorpho(address(m));
        address irm = address(new MockIRM(1585489599));
        vm.startPrank(admin);
        m.enableIrm(irm);
        m.enableLltv(0.86e18);
        vm.stopPrank();
        VigilDeployer dep = new VigilDeployer();
        d = dep.deploy(
            VigilDeployer.Config(
                morpho,
                irm,
                0.86e18,
                address(usdg),
                address(nvda),
                address(feed),
                address(0),
                admin,
                admin,
                admin,
                500,
                0.76e18,
                500_000e6
            )
        );
        mB = d.market;
        mA = MarketParams(address(usdg), address(nvda), address(new ControlOracle(address(feed), 18, 6)), irm, 0.86e18);
        m.createMarket(mA);
        usdg.mint(supplier, 2_000_000e6);
        vm.startPrank(supplier);
        usdg.approve(address(morpho), type(uint256).max);
        morpho.supply(mA, 1_000_000e6, 0, supplier, "");
        morpho.supply(mB, 1_000_000e6, 0, supplier, "");
        vm.stopPrank();
        usdg.mint(underwriter, 200_000e6);
        vm.startPrank(underwriter);
        usdg.approve(address(d.backstop), type(uint256).max);
        d.backstop.deposit(200_000e6, underwriter);
        vm.stopPrank();
        usdg.mint(liquidator, 5_000_000e6);
        vm.startPrank(liquidator);
        usdg.approve(address(morpho), type(uint256).max);
        usdg.approve(address(d.preLiq), type(uint256).max);
        usdg.approve(address(d.lossReporter), type(uint256).max);
        vm.stopPrank();
    }

    function _open(MarketParams memory m, address user, uint256 coll, uint256 ltv, bool join) internal {
        nvda.mint(user, coll);
        uint256 px = uint256(feed.answer()) * 1e16;
        uint256 debt = coll * px / 1e36 * ltv / 1e18;
        vm.startPrank(user);
        nvda.approve(address(morpho), type(uint256).max);
        morpho.supplyCollateral(m, coll, user, "");
        morpho.borrow(m, debt, 0, user, user);
        if (join) {
            usdg.mint(user, 20e6);
            usdg.approve(address(d.premium), type(uint256).max);
            d.premium.topUp(mB.id(), user, 20e6);
            morpho.setAuthorization(address(d.preLiq), true);
        }
        vm.stopPrank();
    }

    function _ltvPct(MarketParams memory m, address user) internal view returns (uint256) {
        Position memory p = morpho.position(m.id(), user);
        if (p.collateral == 0) return 0;
        uint256 px = uint256(feed.answer()) * 1e16;
        return morpho.expectedBorrowAssets(m, user) * 10_000 / (uint256(p.collateral) * px / 1e36);
    }

    struct R {
        uint256 ltvA0;
        uint256 ltvB0;
        uint256 disc;
        uint256 repaid;
        uint256 seized;
        uint256 ltvB1;
        uint256 hAtClose;
        uint256 hWeekend;
        uint256 premiumPaid;
        uint256 lossA;
        uint256 lossB;
    }

    R internal r;

    function _replay(string memory title, uint64 fri1400, uint64 fri1555, uint64 mon0930, int256 closePx, int256 openPx)
        internal
    {
        _deploy(fri1400, closePx);
        _open(mB, alice, 10e18, 0.86e18, true);
        _open(mA, carol, 10e18, 0.86e18, false);
        uint256 sA0 = morpho.market(mA.id()).totalSupplyAssets;
        uint256 sB0 = morpho.market(mB.id()).totalSupplyAssets;
        r.ltvA0 = _ltvPct(mA, carol);
        r.ltvB0 = _ltvPct(mB, alice);

        // Friday 15:00: pre-close window → soft unwind of the member (1.5 % discount)
        vm.warp(fri1400 + 1 hours);
        r.disc = d.preLiq.currentDiscountBps(mB.id(), alice);
        vm.prank(liquidator);
        (r.repaid, r.seized) = d.preLiq.preLiquidate(mB.id(), alice, type(uint256).max, "");
        r.ltvB1 = _ltvPct(mB, alice);
        r.hAtClose = d.oracle.currentHaircutBps();

        // the weekend is frozen, the premium flows
        feed.setAt(closePx, fri1555);
        vm.warp(fri1555 + 30 hours);
        d.premium.accrue(mB.id(), alice);
        r.premiumPaid = d.premium.totalPaid();
        r.hWeekend = d.oracle.currentHaircutBps();

        // Monday open: the gap prints; the liquidator acts in both markets
        vm.warp(mon0930 + 5 minutes);
        feed.set(openPx);
        uint256 collCarol = morpho.position(mA.id(), carol).collateral;
        vm.prank(liquidator);
        morpho.liquidate(mA, carol, collCarol, 0, "");
        vm.prank(liquidator);
        d.lossReporter.liquidateWithCover(mB.id(), alice, "");
        r.lossA = sA0 - morpho.market(mA.id()).totalSupplyAssets;
        uint256 sB1 = morpho.market(mB.id()).totalSupplyAssets;
        r.lossB = sB1 < sB0 ? sB0 - sB1 : 0;
        _print(title);
    }

    function _print(string memory title) internal view {
        console2.log("");
        console2.log("=== REPLAY:", title, "===");
        console2.log("                                    Market A (control) | Market B (Vigil)");
        console2.log("Initial LTV Friday 14:00 (bps)      ", r.ltvA0, "|", r.ltvB0);
        console2.log("Soft unwind Friday 15:00 (disc. bps) -                  |", r.disc);
        console2.log("  repaid USDG (6d) / seized NVDA(18d) -                  |", r.repaid, r.seized);
        console2.log("LTV after the unwind (bps)          ", r.ltvA0, "|", r.ltvB1);
        console2.log("Market oracle haircut 15:00 / wknd   0 / 0              |", r.hAtClose, r.hWeekend);
        console2.log("Weekend premium to backstop (6d)     0                  |", r.premiumPaid);
        console2.log("Socialized bad debt (USDG 6d)       ", r.lossA, "|", r.lossB);
        console2.log("Backstop used (USDG 6d)              -                  |", d.backstop.totalCovered());
    }

    /// A member still at max LTV when the gap prints (e.g. opened the position Monday morning) → covered by the backstop.
    function _coverCase() internal {
        uint64 fri1400 = 1722621600;
        _deploy(fri1400, 120e8);
        _open(mB, alice, 10e18, 0.86e18, true);
        vm.warp(1722864600 + 30 minutes); // Monday 10:00, inside the coverWindow
        feed.set(120e8 * 88 / 100);
        (uint256 shortfall, uint256 coverable, bool member, bool covered) = d.lossReporter.previewCover(mB.id(), alice);
        uint256 sB0 = morpho.market(mB.id()).totalSupplyAssets;
        uint256 bs0 = d.backstop.totalAssets();
        vm.prank(liquidator);
        (,, uint256 got) = d.lossReporter.liquidateWithCover(mB.id(), alice, "");
        console2.log("");
        console2.log("=== COVER: max-LTV member hit by the -12% gap, Monday 10:00 ===");
        console2.log("shortfall (USDG 6d)               ", shortfall);
        console2.log("coverable / member / regime covered", coverable, member, covered);
        console2.log("covered by the backstop (USDG 6d) ", got);
        console2.log("suppliers: totalSupplyAssets before/after ", sB0, morpho.market(mB.id()).totalSupplyAssets);
        console2.log("backstop: totalAssets before/after        ", bs0, d.backstop.totalAssets());
        console2.log("borrowShares alice after          ", morpho.position(mB.id(), alice).borrowShares);
    }
}
