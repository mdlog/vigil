// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {Morpho} from "morpho-blue/Morpho.sol";
import {IMorpho, MarketParams, Id, Position, Market} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
import {MorphoBalancesLib} from "morpho-blue/libraries/periphery/MorphoBalancesLib.sol";
import {VigilCalendar} from "../src/VigilCalendar.sol";
import {VigilSessionOracle} from "../src/VigilSessionOracle.sol";
import {VigilRiskEngine} from "../src/VigilRiskEngine.sol";
import {VigilOracle} from "../src/VigilOracle.sol";
import {ControlOracle} from "../src/mocks/ControlOracle.sol";
import {VigilPremium} from "../src/VigilPremium.sol";
import {VigilBackstop} from "../src/VigilBackstop.sol";
import {VigilPreLiquidation} from "../src/VigilPreLiquidation.sol";
import {VigilLossReporter} from "../src/VigilLossReporter.sol";
import {MockStockToken} from "../src/mocks/MockStockToken.sol";
import {MockFeed} from "../src/mocks/MockFeed.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";
import {MockIRM} from "../src/mocks/MockIRM.sol";
import {Regime} from "../src/interfaces/IVigil.sol";
import {CalendarFixture} from "./CalendarFixture.sol";

/// Harness: the real Morpho Blue (from source, Plan B1) + Market A (control) and Market B (Vigil) for NVDA/USDG.
abstract contract Base is Test {
    using MarketParamsLib for MarketParams;
    using MorphoBalancesLib for IMorpho;

    // Time anchor (Friday 2024-08-02, ET) — used by the historical replays.
    uint64 constant FRI_1400 = 1722621600;
    uint64 constant FRI_1430 = 1722623400;
    uint64 constant FRI_1500 = 1722625200;
    uint64 constant FRI_1530 = 1722627000;
    uint64 constant FRI_1555 = 1722628500;
    uint64 constant FRI_1600 = 1722628800;
    uint64 constant SAT_1200 = 1722700800;
    uint64 constant SUN_2100 = 1722819600;
    uint64 constant MON_0930 = 1722864600;
    uint64 constant MON_1600 = 1722888000;
    uint64 constant MON_2100 = 1722906000;
    uint64 constant TUE_0930 = 1722951000;

    uint256 constant LLTV = 0.86e18;
    uint16 constant CAP_BPS = 500;
    int256 constant P0 = 120e8; // $120, 8 decimals

    IMorpho morpho;
    MockIRM irm;
    VigilCalendar cal;
    VigilSessionOracle so;
    VigilRiskEngine risk;
    VigilOracle vOracle;
    ControlOracle cOracle;
    VigilPremium premium;
    VigilBackstop backstop;
    VigilPreLiquidation preLiq;
    VigilLossReporter lossReporter;
    address underwriter = address(0x0DD);
    MockStockToken nvda;
    MockFeed feed;
    MockUSDG usdg;
    MarketParams mA; // control
    MarketParams mB; // Vigil
    Id idA;
    Id idB;

    address guardian = address(0xA11CE);
    address calibrator = address(0xCA11);
    uint256 keeperPk = 0xBEEF;
    address keeper;
    address supplier = address(0x5011);
    address alice = address(0xA1); // member borrower
    address bob = address(0xB0B); // non-member borrower
    address liquidator = address(0x11C);

    function setUp() public virtual {
        vm.warp(FRI_1400);
        keeper = vm.addr(keeperPk);
        usdg = new MockUSDG();
        nvda = new MockStockToken("NVIDIA (mock)", "NVDA");
        feed = new MockFeed(8, P0);
        irm = new MockIRM(1585489599); // ≈ 5 %/year, per second (WAD)
        morpho = IMorpho(address(new Morpho(address(this))));
        morpho.enableIrm(address(irm));
        morpho.enableLltv(LLTV);

        cal = new VigilCalendar(guardian, CalendarFixture.closedDays(), CalendarFixture.halfDays());
        so = new VigilSessionOracle(cal, usdg, guardian, keeper);
        risk = new VigilRiskEngine(so, calibrator, guardian);
        vm.startPrank(guardian);
        so.setRiskEngine(risk);
        so.registerAsset(
            address(nvda), VigilSessionOracle.AssetConfig(address(feed), 6 hours, 3, 1 hours, 1 hours, 100, false)
        );
        vm.stopPrank();
        vm.startPrank(calibrator);
        risk.setSurface(address(nvda), VigilRiskEngine.Surface(0.016e18, 30_000, 50, 2_500, 0));
        // π_ref from calibrator/report.md (NVDA, t-fit/empirical, per second over the debt, WAD):
        // night 0.06 bp/63,000 s ≈ 9.5e7; weekend ~3.5 bp/235,800 s ≈ 1.48e9; long ~4 bp/322,200 s ≈ 1.24e9
        risk.setPremiumTables(
            address(nvda),
            VigilRiskEngine.PremiumTable({
                lBucket: [uint64(63_000), 149_400, 235_800, 322_200],
                rateNoEvent: [uint128(9.5e7), 8e8, 1.48e9, 1.24e9],
                rateEvent: [uint128(2.7e10), 2.7e10, 2.7e10, 2.7e10] // earnings ≈ 17 bp/63,000 s
            }),
            VigilRiskEngine.BufferTable({
                bBps: [uint16(400), 600, 800, 1_023, 1_500, 2_000],
                multWad: [uint128(6.24e18), 2.97e18, 1.68e18, 1e18, 0.42e18, 0.21e18]
            })
        );
        vm.stopPrank();

        vOracle = new VigilOracle(address(nvda), so, risk, address(0), address(0), 0, 0, 18, 6, CAP_BPS);
        cOracle = new ControlOracle(address(feed), 18, 6);
        mA = MarketParams(address(usdg), address(nvda), address(cOracle), address(irm), LLTV);
        mB = MarketParams(address(usdg), address(nvda), address(vOracle), address(irm), LLTV);
        idA = mA.id();
        idB = mB.id();
        morpho.createMarket(mA);
        morpho.createMarket(mB);

        // the Vigil economics (Market B only)
        backstop = new VigilBackstop(usdg, cal, guardian);
        premium = new VigilPremium(morpho, so, risk, usdg, address(backstop), guardian);
        preLiq = new VigilPreLiquidation(morpho, so, risk, premium, guardian);
        lossReporter = new VigilLossReporter(morpho, so, premium, backstop, guardian);
        vm.startPrank(guardian);
        premium.setPreLiquidation(address(preLiq));
        premium.registerMarket(mB);
        preLiq.registerMarket(mB, 0.76e18); // targetLtv = LLTV − 10 %
        backstop.setLossReporter(address(lossReporter));
        backstop.setCoverageCap(idB, 500_000e6);
        lossReporter.registerMarket(mB);
        vm.stopPrank();
        // the underwriter funds the backstop
        usdg.mint(underwriter, 200_000e6);
        vm.startPrank(underwriter);
        usdg.approve(address(backstop), type(uint256).max);
        backstop.deposit(200_000e6, underwriter);
        vm.stopPrank();

        // supplier liquidity in both markets
        usdg.mint(supplier, 3_000_000e6);
        vm.startPrank(supplier);
        usdg.approve(address(morpho), type(uint256).max);
        morpho.supply(mA, 1_000_000e6, 0, supplier, "");
        morpho.supply(mB, 1_000_000e6, 0, supplier, "");
        vm.stopPrank();
    }

    // ── helpers ──

    /// Deposit collateral and borrow up to the target LTV (WAD) at the current feed price.
    function _open(MarketParams memory m, address user, uint256 collateral, uint256 ltvWad)
        internal
        returns (uint256 debt)
    {
        nvda.mint(user, collateral);
        uint256 px = uint256(feed.answer()) * 1e16; // 1e36 scale (stock 18, usdg 6, feed 8)
        debt = collateral * px / 1e36 * ltvWad / 1e18;
        vm.startPrank(user);
        nvda.approve(address(morpho), type(uint256).max);
        morpho.supplyCollateral(m, collateral, user, "");
        morpho.borrow(m, debt, 0, user, user);
        vm.stopPrank();
    }

    /// Catch the premium index up after a large time jump (a daily keeper does this in production).
    function _catchUp() internal {
        for (uint256 i; i < 32 && so.lastPokeOf(address(nvda)) + 1 days < block.timestamp; ++i) {
            so.poke(address(nvda));
        }
    }

    /// Member opt-in: premium escrow + soft-unwind authorization.
    function _join(address user, uint256 escrowAmount) internal {
        usdg.mint(user, escrowAmount);
        vm.startPrank(user);
        usdg.approve(address(premium), type(uint256).max);
        premium.topUp(idB, user, escrowAmount);
        morpho.setAuthorization(address(preLiq), true);
        vm.stopPrank();
    }

    function _ltv(MarketParams memory m, address user, uint256 pxScaled) internal view returns (uint256) {
        Position memory p = morpho.position(m.id(), user);
        uint256 debt = morpho.expectedBorrowAssets(m, user);
        return debt * 1e18 / (uint256(p.collateral) * pxScaled / 1e36); // WAD
    }

    function _pos(MarketParams memory m, address user) internal view returns (Position memory) {
        return morpho.position(m.id(), user);
    }

    function _mkt(MarketParams memory m) internal view returns (Market memory) {
        return morpho.market(m.id());
    }

    function _debt(MarketParams memory m, address user) internal view returns (uint256) {
        return morpho.expectedBorrowAssets(m, user);
    }
}
