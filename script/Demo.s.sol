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

/// Demo (PRD §13): dua pasar identik NVDA/USDG LLTV 86% — A kontrol (oracle feed mentah), B Vigil — di-replay pada
/// dua Senin nyata: 5 Agu 2024 (−14,18%) dan 27 Jan 2025 (−12,49%), lalu kasus member yang benar-benar underwater
/// untuk menunjukkan `liquidateWithCover`. Jalankan tanpa broadcast:  forge script script/Demo.s.sol -vv
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
            "5 Agustus 2024  (NVDA 107.27 -> 92.06, -14.18%)",
            1722621600,
            1722628500,
            1722864600,
            10726999664,
            9205999756
        );
        _replay(
            "27 Januari 2025 (NVDA 142.62 -> 124.80, -12.49%)",
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

        // Jumat 15:00: jendela pre-close → soft unwind member (diskon 1,5%)
        vm.warp(fri1400 + 1 hours);
        r.disc = d.preLiq.currentDiscountBps(mB.id(), alice);
        vm.prank(liquidator);
        (r.repaid, r.seized) = d.preLiq.preLiquidate(mB.id(), alice, type(uint256).max, "");
        r.ltvB1 = _ltvPct(mB, alice);
        r.hAtClose = d.oracle.currentHaircutBps();

        // akhir pekan beku, premi mengalir
        feed.setAt(closePx, fri1555);
        vm.warp(fri1555 + 30 hours);
        d.premium.accrue(mB.id(), alice);
        r.premiumPaid = d.premium.totalPaid();
        r.hWeekend = d.oracle.currentHaircutBps();

        // Senin open: gap tercetak; likuidator bertindak di kedua pasar
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
        console2.log("                                    Market A (kontrol) | Market B (Vigil)");
        console2.log("LTV awal Jumat 14:00 (bps)          ", r.ltvA0, "|", r.ltvB0);
        console2.log("Soft unwind Jumat 15:00 (diskon bps) -                  |", r.disc);
        console2.log("  repaid USDG (6d) / seized NVDA(18d) -                  |", r.repaid, r.seized);
        console2.log("LTV setelah unwind (bps)            ", r.ltvA0, "|", r.ltvB1);
        console2.log("Haircut oracle pasar 15:00 / wknd    0 / 0              |", r.hAtClose, r.hWeekend);
        console2.log("Premi akhir pekan ke backstop (6d)   0                  |", r.premiumPaid);
        console2.log("Bad debt tersosialisasi (USDG 6d)   ", r.lossA, "|", r.lossB);
        console2.log("Backstop dipakai (USDG 6d)           -                  |", d.backstop.totalCovered());
    }

    /// Member yang tetap max-LTV saat gap tercetak (mis. membuka posisi Senin pagi) → cover dari backstop.
    function _coverCase() internal {
        uint64 fri1400 = 1722621600;
        _deploy(fri1400, 120e8);
        _open(mB, alice, 10e18, 0.86e18, true);
        vm.warp(1722864600 + 30 minutes); // Senin 10:00, dalam coverWindow
        feed.set(120e8 * 88 / 100);
        (uint256 shortfall, uint256 coverable, bool member, bool covered) = d.lossReporter.previewCover(mB.id(), alice);
        uint256 sB0 = morpho.market(mB.id()).totalSupplyAssets;
        uint256 bs0 = d.backstop.totalAssets();
        vm.prank(liquidator);
        (,, uint256 got) = d.lossReporter.liquidateWithCover(mB.id(), alice, "");
        console2.log("");
        console2.log("=== COVER: member max-LTV terkena gap -12% Senin 10:00 ===");
        console2.log("shortfall (USDG 6d)               ", shortfall);
        console2.log("coverable / member / rezim tercakup", coverable, member, covered);
        console2.log("dicover backstop (USDG 6d)        ", got);
        console2.log("pemasok: totalSupplyAssets sebelum/sesudah", sB0, morpho.market(mB.id()).totalSupplyAssets);
        console2.log("backstop: totalAssets sebelum/sesudah     ", bs0, d.backstop.totalAssets());
        console2.log("borrowShares alice sesudah        ", morpho.position(mB.id(), alice).borrowShares);
    }
}
