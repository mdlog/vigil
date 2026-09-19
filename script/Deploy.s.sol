// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Script, console2} from "forge-std/Script.sol";
import {IMorpho, MarketParams} from "morpho-blue/interfaces/IMorpho.sol";
import {Regime} from "../src/interfaces/IVigil.sol";
import {Morpho} from "morpho-blue/Morpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VigilParams} from "./DeployLib.sol";
import {VigilCalendar} from "../src/VigilCalendar.sol";
import {VigilSessionOracle} from "../src/VigilSessionOracle.sol";
import {VigilRiskEngine} from "../src/VigilRiskEngine.sol";
import {VigilOracle} from "../src/VigilOracle.sol";
import {VigilPremium} from "../src/VigilPremium.sol";
import {VigilBackstop} from "../src/VigilBackstop.sol";
import {VigilPreLiquidation} from "../src/VigilPreLiquidation.sol";
import {VigilLossReporter} from "../src/VigilLossReporter.sol";
import {MockStockToken} from "../src/mocks/MockStockToken.sol";
import {MockFeed} from "../src/mocks/MockFeed.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";
import {MockIRM} from "../src/mocks/MockIRM.sol";

/// Deploys Vigil for one NVDA/USDG market. Every contract is deployed directly from the EOA (< 24 KB each).
///
/// Env (optional; empty → mock / default):
///   MORPHO        Morpho Blue (Robinhood mainnet 0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010); empty → deploy our own (Plan B1)
///   IRM           mainnet AdaptiveCurveIRM 0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1; empty → MockIRM
///   USDG          mainnet 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168; empty → MockUSDG
///   STOCK_TOKEN   mainnet NVDA 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC (testnet: Robinhood TSLA
///                 0xC9f9c86933092BbbfFF3CCb4b105A4A94bf3Bd4E); empty → MockStockToken
///   SYMBOL        ticker of the collateral, picks the calibrated surface (NVDA default, TSLA, AAPL)
///   FEED          mainnet Chainlink NVDA/USD 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15; empty → MockFeed
///   FEED_INITIAL  initial answer of the MockFeed, 8 decimals (default 120e8)
///   USDG_FEED     mainnet USDG/USD 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2; empty → $1 assumed
///   GUARDIAN / CALIBRATOR / KEEPER_SIGNER  default = deployer
///   LLTV (0.86e18), TARGET_LTV (0.76e18), CAP_BPS (500), COVERAGE_CAP (100000e6)
///
/// Testnet 46630 has no Morpho, Chainlink or stock tokens (verified 19 Sep 2026) → everything is mocked.
///   PRIVATE_KEY   the deployer key, set in .env (gitignored; see .env.example); alternative: --private-key
///   forge script script/Deploy.s.sol --rpc-url robinhood_testnet --broadcast
contract Deploy is Script {
    using MarketParamsLib for MarketParams;

    struct Cfg {
        address deployer;
        IMorpho morpho;
        address irm;
        uint256 lltv;
        address usdg;
        address stock;
        string symbol;
        address feed;
        address usdgFeed;
        address guardian;
        address calibrator;
        address keeperSigner;
        uint16 capBps;
        uint256 targetLtv;
        uint256 coverageCap;
    }

    Cfg internal c;
    VigilCalendar calendar;
    VigilSessionOracle session;
    VigilRiskEngine risk;
    VigilOracle oracle;
    VigilBackstop backstop;
    VigilPremium premium;
    VigilPreLiquidation preLiq;
    VigilLossReporter lossReporter;
    MarketParams market;

    function run() external {
        // PRIVATE_KEY from .env (forge loads it automatically); empty → the sender comes from --private-key/--account/--sender.
        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        if (pk != 0) {
            c.deployer = vm.addr(pk);
            vm.startBroadcast(pk);
        } else {
            c.deployer = msg.sender;
            vm.startBroadcast();
        }
        _resolveDependencies();
        _deployCore();
        _deployEconomy();
        _handover();
        vm.stopBroadcast();
        _log();
    }

    function _resolveDependencies() internal {
        c.morpho = IMorpho(vm.envOr("MORPHO", address(0)));
        c.irm = vm.envOr("IRM", address(0));
        c.lltv = vm.envOr("LLTV", uint256(0.86e18));
        if (address(c.morpho) == address(0)) {
            Morpho m = new Morpho(c.deployer);
            c.morpho = IMorpho(address(m));
            if (c.irm == address(0)) c.irm = address(new MockIRM(1585489599));
            m.enableIrm(c.irm);
            m.enableLltv(c.lltv);
            console2.log("Morpho Blue (deploy sendiri):", address(c.morpho));
        }
        c.usdg = vm.envOr("USDG", address(0));
        if (c.usdg == address(0)) c.usdg = address(new MockUSDG());
        c.symbol = vm.envOr("SYMBOL", string("NVDA"));
        c.stock = vm.envOr("STOCK_TOKEN", address(0));
        if (c.stock == address(0)) c.stock = address(new MockStockToken("NVIDIA (mock)", "NVDA"));
        c.feed = vm.envOr("FEED", address(0));
        if (c.feed == address(0)) c.feed = address(new MockFeed(8, int256(vm.envOr("FEED_INITIAL", uint256(120e8)))));
        c.usdgFeed = vm.envOr("USDG_FEED", address(0));
        c.guardian = vm.envOr("GUARDIAN", c.deployer);
        c.calibrator = vm.envOr("CALIBRATOR", c.deployer);
        c.keeperSigner = vm.envOr("KEEPER_SIGNER", c.deployer);
        c.capBps = uint16(vm.envOr("CAP_BPS", uint256(500)));
        c.targetLtv = vm.envOr("TARGET_LTV", uint256(0.76e18));
        c.coverageCap = vm.envOr("COVERAGE_CAP", uint256(100_000e6));
    }

    function _deployCore() internal {
        calendar = new VigilCalendar(c.deployer, VigilParams.closedDays(), VigilParams.halfDays());
        session = new VigilSessionOracle(calendar, IERC20(c.usdg), c.deployer, c.keeperSigner);
        risk = new VigilRiskEngine(session, c.deployer, c.deployer);
        session.setRiskEngine(risk);
        session.registerAsset(c.stock, VigilParams.assetConfig(c.feed));
        risk.setSurface(c.stock, VigilParams.surfaceFor(c.symbol));
        risk.setPremiumTables(c.stock, VigilParams.premiumTable(), VigilParams.bufferTable());
        oracle = new VigilOracle(c.stock, session, risk, c.usdgFeed, address(0), 0, 2 days, 18, 6, c.capBps);
        market = MarketParams(c.usdg, c.stock, address(oracle), c.irm, c.lltv);
        c.morpho.createMarket(market);
    }

    function _deployEconomy() internal {
        backstop = new VigilBackstop(IERC20(c.usdg), calendar, c.deployer);
        premium = new VigilPremium(c.morpho, session, risk, IERC20(c.usdg), address(backstop), c.deployer);
        preLiq = new VigilPreLiquidation(c.morpho, session, risk, premium, c.deployer);
        lossReporter = new VigilLossReporter(c.morpho, session, premium, backstop, c.deployer);
        premium.setPreLiquidation(address(preLiq));
        premium.registerMarket(market);
        preLiq.registerMarket(market, c.targetLtv);
        backstop.setLossReporter(address(lossReporter));
        backstop.setCoverageCap(market.id(), c.coverageCap);
        lossReporter.registerMarket(market);
    }

    function _handover() internal {
        if (c.guardian == c.deployer && c.calibrator == c.deployer) return;
        calendar.setGuardian(c.guardian);
        session.setRoles(c.guardian, c.keeperSigner);
        risk.setRoles(c.calibrator, c.guardian);
        backstop.transferGuardian(c.guardian);
        premium.transferGuardian(c.guardian);
        preLiq.transferGuardian(c.guardian);
        lossReporter.transferGuardian(c.guardian);
    }

    function _log() internal view {
        console2.log("Collateral          ", c.symbol, c.stock);
        console2.log("Loan token (USDG)   ", c.usdg);
        console2.log("VigilCalendar       ", address(calendar));
        console2.log("VigilSessionOracle  ", address(session));
        console2.log("VigilRiskEngine     ", address(risk));
        console2.log("VigilOracle         ", address(oracle));
        console2.log("VigilBackstop       ", address(backstop));
        console2.log("VigilPremium        ", address(premium));
        console2.log("VigilPreLiquidation ", address(preLiq));
        console2.log("VigilLossReporter   ", address(lossReporter));
        console2.log("Market id:");
        console2.logBytes32(bytes32(abi.encode(market.id())));
        // post-deploy sanity: the oracle must price from the wired feeds right away (reverts only on CORP_ACTION or a stale feed)
        (uint8 eff, uint8 cal,,) = _regime();
        console2.log("Regime effective / calendar:", eff, cal);
        try oracle.price() returns (uint256 p) {
            console2.log("oracle.price() (1e36 scale):", p);
            console2.log("unhaircutPrice():", oracle.unhaircutPrice());
        } catch {
            console2.log("oracle.price() REVERTS right now (stale feed or CORP_ACTION) - check MainnetPreflight");
        }
    }

    function _regime() internal view returns (uint8, uint8, uint64, uint64) {
        (Regime e, Regime cal, uint64 closeAt, uint64 nextOpen) = session.regimeOf(c.stock);
        return (uint8(e), uint8(cal), closeAt, nextOpen);
    }
}
