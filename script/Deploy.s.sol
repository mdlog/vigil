// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Script, console2} from "forge-std/Script.sol";
import {IMorpho, MarketParams} from "morpho-blue/interfaces/IMorpho.sol";
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

/// Deploy Vigil untuk satu pasar NVDA/USDG. Setiap kontrak di-deploy langsung dari EOA (< 24 KB masing-masing).
///
/// Env (opsional; kosong → mock / default):
///   MORPHO        Morpho Blue (mainnet Robinhood 0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010); kosong → deploy sendiri (Rencana B1)
///   IRM           mainnet AdaptiveCurveIRM 0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1; kosong → MockIRM
///   USDG          mainnet 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168; kosong → MockUSDG
///   STOCK_TOKEN   mainnet NVDA 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC; kosong → MockStockToken
///   FEED          mainnet Chainlink NVDA/USD 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15; kosong → MockFeed
///   USDG_FEED     mainnet USDG/USD 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2; kosong → asumsi $1
///   GUARDIAN / CALIBRATOR / KEEPER_SIGNER  default = deployer
///   LLTV (0.86e18), TARGET_LTV (0.76e18), CAP_BPS (500), COVERAGE_CAP (100000e6)
///
/// Testnet 46630 tidak memiliki Morpho, Chainlink, maupun stock token (verifikasi 19 Sep 2026) → semua mock:
///   forge script script/Deploy.s.sol --rpc-url robinhood_testnet --broadcast --private-key $PRIVATE_KEY
contract Deploy is Script {
    using MarketParamsLib for MarketParams;

    struct Cfg {
        address deployer;
        IMorpho morpho;
        address irm;
        uint256 lltv;
        address usdg;
        address stock;
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
        c.deployer = msg.sender;
        vm.startBroadcast();
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
        c.stock = vm.envOr("STOCK_TOKEN", address(0));
        if (c.stock == address(0)) c.stock = address(new MockStockToken("NVIDIA (mock)", "NVDA"));
        c.feed = vm.envOr("FEED", address(0));
        if (c.feed == address(0)) c.feed = address(new MockFeed(8, 120e8));
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
        risk.setSurface(c.stock, VigilParams.surface());
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
    }
}
