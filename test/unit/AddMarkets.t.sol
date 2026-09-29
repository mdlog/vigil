// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {Morpho} from "morpho-blue/Morpho.sol";
import {IMorpho, MarketParams, Id, Market} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
import {VigilCalendar} from "../../src/VigilCalendar.sol";
import {VigilSessionOracle} from "../../src/VigilSessionOracle.sol";
import {VigilRiskEngine} from "../../src/VigilRiskEngine.sol";
import {VigilOracle} from "../../src/VigilOracle.sol";
import {VigilPremium} from "../../src/VigilPremium.sol";
import {VigilBackstop} from "../../src/VigilBackstop.sol";
import {VigilPreLiquidation} from "../../src/VigilPreLiquidation.sol";
import {VigilLossReporter} from "../../src/VigilLossReporter.sol";
import {MockStockToken} from "../../src/mocks/MockStockToken.sol";
import {MockFeed} from "../../src/mocks/MockFeed.sol";
import {MockUSDG} from "../../src/mocks/MockUSDG.sol";
import {MockIRM} from "../../src/mocks/MockIRM.sol";
import {VigilParams} from "../../script/DeployLib.sol";
import {AddMarket} from "../../script/AddMarkets.s.sol";
import {CalendarFixture} from "../CalendarFixture.sol";

/// A v4-shaped deployment (one address holds guardian + calibrator, a TSLA market live), then four markets added.
contract AddMarketsTest is Test {
    using MarketParamsLib for MarketParams;

    uint64 constant FRI_1400 = 1722621600; // Friday 2 Aug 2024 14:00 ET — MARKET, feed fresh
    address ops = address(0x0B5);
    AddMarket.Core core;
    MockUSDG usdg;
    string[4] syms = ["AMD", "AMZN", "NFLX", "PLTR"];
    MockStockToken[4] stocks;

    function setUp() public {
        vm.warp(FRI_1400);
        usdg = new MockUSDG();
        MockIRM irm = new MockIRM(1585489599);
        IMorpho morpho = IMorpho(address(new Morpho(address(this))));
        morpho.enableIrm(address(irm));
        morpho.enableLltv(0.86e18);
        vm.startPrank(ops);
        VigilCalendar cal = new VigilCalendar(ops, CalendarFixture.closedDays(), CalendarFixture.halfDays());
        VigilSessionOracle so = new VigilSessionOracle(cal, usdg, ops, ops);
        VigilRiskEngine risk = new VigilRiskEngine(so, ops, ops);
        so.setRiskEngine(risk);
        MockStockToken tsla = new MockStockToken("Tesla (mock)", "TSLA");
        so.registerAsset(address(tsla), VigilParams.assetConfig(address(new MockFeed(8, 364e8))));
        risk.setSurface(address(tsla), VigilParams.surfaceFor("TSLA"));
        risk.setPremiumTables(address(tsla), VigilParams.premiumTable(), VigilParams.bufferTable());
        VigilOracle tslaOracle = new VigilOracle(address(tsla), so, risk, address(0), address(0), 0, 2 days, 18, 6, 500);
        MarketParams memory mT = MarketParams(address(usdg), address(tsla), address(tslaOracle), address(irm), 0.86e18);
        morpho.createMarket(mT);
        VigilBackstop backstop = new VigilBackstop(usdg, cal, ops);
        VigilPremium premium = new VigilPremium(morpho, so, risk, usdg, address(backstop), ops);
        VigilPreLiquidation preLiq = new VigilPreLiquidation(morpho, so, risk, premium, ops);
        VigilLossReporter lr = new VigilLossReporter(morpho, so, premium, backstop, ops);
        premium.setPreLiquidation(address(preLiq));
        premium.registerMarket(mT);
        preLiq.registerMarket(mT, 0.76e18);
        backstop.setLossReporter(address(lr));
        backstop.setCoverageCap(mT.id(), 100_000e6);
        lr.registerMarket(mT);
        vm.stopPrank();
        core = AddMarket.Core(
            morpho,
            so,
            risk,
            premium,
            preLiq,
            lr,
            backstop,
            address(usdg),
            address(irm),
            0.86e18,
            0.76e18,
            100_000e6,
            tslaOracle
        );
        for (uint256 i; i < 4; ++i) {
            stocks[i] = new MockStockToken(syms[i], syms[i]);
        }
        usdg.mint(ops, 1_000e6);
    }

    function _addAll() internal returns (AddMarket.Added[4] memory out) {
        vm.startPrank(ops);
        for (uint256 i; i < 4; ++i) {
            out[i] = AddMarket.add(
                core,
                AddMarket.Ticker(syms[i], address(stocks[i]), int256(100e8 + i * 1e8), address(0), address(0), 10e6),
                ops
            );
        }
        vm.stopPrank();
    }

    function test_addsFourPricedRegisteredSeededMarkets() public {
        AddMarket.Added[4] memory a = _addAll();
        for (uint256 i; i < 4; ++i) {
            assertTrue(core.session.isRegistered(address(stocks[i])), syms[i]);
            assertEq(core.session.feedOf(address(stocks[i])), a[i].feed);
            assertTrue(core.risk.hasPremiumTable(address(stocks[i])));
            (uint64 sigma,,,,) = core.risk.surfaces(address(stocks[i]));
            assertEq(sigma, VigilParams.surfaceFor(syms[i]).sigmaGapWad);
            VigilOracle o = VigilOracle(a[i].oracle);
            assertEq(o.STOCK_TOKEN(), address(stocks[i]));
            assertEq(o.MARKET_HAIRCUT_CAP_BPS(), core.template.MARKET_HAIRCUT_CAP_BPS());
            assertEq(o.QUOTE_MAX_AGE(), core.template.QUOTE_MAX_AGE());
            assertGt(o.price(), 0);
            Id id = a[i].id;
            Market memory m = core.morpho.market(id);
            assertGt(m.lastUpdate, 0);
            assertEq(m.totalSupplyAssets, 10e6);
            assertEq(core.premium.marketParams(id).oracle, a[i].oracle);
            assertEq(core.preLiq.marketParams(id).oracle, a[i].oracle);
            assertEq(core.backstop.coverageCapOf(id), 100_000e6);
        }
        assertEq(usdg.balanceOf(ops), 1_000e6 - 40e6);
    }

    function test_rerunIsNoop() public {
        AddMarket.Added[4] memory a = _addAll();
        uint256 before = usdg.balanceOf(ops);
        vm.startPrank(ops);
        for (uint256 i; i < 4; ++i) {
            AddMarket.Added memory b = AddMarket.add(
                core, AddMarket.Ticker(syms[i], address(stocks[i]), 1e8, a[i].feed, a[i].oracle, 10e6), ops
            );
            assertEq(Id.unwrap(b.id), Id.unwrap(a[i].id));
        }
        vm.stopPrank();
        assertEq(usdg.balanceOf(ops), before); // no second seed
    }

    /// A re-run that does not name the oracle already deployed for a registered asset would open a second market.
    function test_rerunWithoutTheOracleReverts() public {
        _addAll();
        vm.expectRevert(bytes("AddMarket: AMD is registered; pass its oracle (ORACLE_AMD)"));
        this.addOne(AddMarket.Ticker("AMD", address(stocks[0]), 1e8, address(0), address(0), 10e6));
    }

    /// External, so vm.expectRevert can catch the library's revert; the prank covers the calls it makes.
    function addOne(AddMarket.Ticker memory t) external returns (AddMarket.Added memory a) {
        vm.startPrank(ops);
        a = AddMarket.add(core, t, ops);
        vm.stopPrank();
    }

    /// A broadcast that stopped after createMarket: the re-run registers the market everywhere and seeds it.
    function test_rerunFinishesAndSeedsAMarketAPartialRunLeft() public {
        vm.startPrank(ops);
        core.session.registerAsset(address(stocks[0]), VigilParams.assetConfig(address(new MockFeed(8, 100e8))));
        core.risk.setSurface(address(stocks[0]), VigilParams.surfaceFor("AMD"));
        core.risk.setPremiumTables(address(stocks[0]), VigilParams.premiumTable(), VigilParams.bufferTable());
        VigilOracle o =
            new VigilOracle(address(stocks[0]), core.session, core.risk, address(0), address(0), 0, 2 days, 18, 6, 500);
        MarketParams memory p = MarketParams(address(usdg), address(stocks[0]), address(o), core.irm, 0.86e18);
        core.morpho.createMarket(p);
        vm.stopPrank();
        AddMarket.Added memory a =
            this.addOne(AddMarket.Ticker("AMD", address(stocks[0]), 1e8, address(0), address(o), 10e6));
        assertEq(Id.unwrap(a.id), Id.unwrap(p.id()));
        assertEq(core.premium.marketParams(a.id).oracle, address(o));
        assertEq(core.preLiq.marketParams(a.id).oracle, address(o));
        assertEq(core.backstop.coverageCapOf(a.id), 100_000e6);
        assertEq(core.morpho.market(a.id).totalSupplyAssets, 10e6);
    }

    /// An oracle given for reuse must price the ticker's own stock token.
    function test_reusedOracleMustPriceThatStock() public {
        _addAll();
        vm.expectRevert(bytes("AddMarket: the oracle given for AMD prices another token"));
        this.addOne(AddMarket.Ticker("AMD", address(stocks[0]), 1e8, address(0), address(core.template), 10e6));
    }

    /// Weeks later the new market's oracle reverts (stale feed); a re-run still sees the market as registered.
    function test_rerunAfterTheOracleWentStale() public {
        AddMarket.Added[4] memory a = _addAll();
        vm.warp(block.timestamp + 30 days);
        vm.expectRevert();
        VigilOracle(a[0].oracle).price();
        AddMarket.Added memory b =
            this.addOne(AddMarket.Ticker("AMD", address(stocks[0]), 1e8, address(0), a[0].oracle, 10e6));
        assertEq(Id.unwrap(b.id), Id.unwrap(a[0].id));
    }

    function test_leavesTheTslaMarketAlone() public {
        (uint64 sigmaBefore,,,, uint64 at) = core.risk.surfaces(core.template.STOCK_TOKEN());
        _addAll();
        (uint64 sigmaAfter,,,, uint64 at2) = core.risk.surfaces(core.template.STOCK_TOKEN());
        assertEq(sigmaAfter, sigmaBefore);
        assertEq(at2, at);
    }
}
