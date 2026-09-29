// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Script, console2} from "forge-std/Script.sol";
import {IMorpho, MarketParams, Id} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VigilSessionOracle} from "../src/VigilSessionOracle.sol";
import {VigilRiskEngine} from "../src/VigilRiskEngine.sol";
import {VigilOracle} from "../src/VigilOracle.sol";
import {VigilPremium} from "../src/VigilPremium.sol";
import {VigilBackstop} from "../src/VigilBackstop.sol";
import {VigilPreLiquidation} from "../src/VigilPreLiquidation.sol";
import {VigilLossReporter} from "../src/VigilLossReporter.sol";
import {MockFeed} from "../src/mocks/MockFeed.sol";
import {VigilParams} from "./DeployLib.sol";

/// Adds a stock-token market to an existing Vigil deployment. Every step is skipped when already done, so a re-run
/// after a partial broadcast finishes the job instead of reverting AlreadySet. The caller holds guardian + calibrator.
library AddMarket {
    using MarketParamsLib for MarketParams;

    struct Core {
        IMorpho morpho;
        VigilSessionOracle session;
        VigilRiskEngine risk;
        VigilPremium premium;
        VigilPreLiquidation preLiq;
        VigilLossReporter lossReporter;
        VigilBackstop backstop;
        address usdg;
        address irm;
        uint256 lltv;
        uint256 targetLtv;
        uint256 coverageCap;
        VigilOracle template;
    }

    struct Ticker {
        string symbol;
        address stock;
        int256 feedInitial;
        address feed; // non-zero: reuse
        address oracle; // non-zero: reuse
        uint256 seed; // USDG (6 decimals) supplied by the caller when the market is new
    }

    struct Added {
        string symbol;
        address stock;
        address feed;
        address oracle;
        Id id;
    }

    function add(Core memory c, Ticker memory t, address caller) internal returns (Added memory a) {
        a.symbol = t.symbol;
        a.stock = t.stock;
        if (c.session.isRegistered(t.stock)) {
            a.feed = c.session.feedOf(t.stock);
        } else {
            a.feed = t.feed != address(0) ? t.feed : address(new MockFeed(8, t.feedInitial));
            c.session.registerAsset(t.stock, VigilParams.assetConfig(a.feed));
        }
        (,,,, uint64 surfaceAt) = c.risk.surfaces(t.stock);
        if (surfaceAt == 0) c.risk.setSurface(t.stock, VigilParams.surfaceFor(t.symbol));
        if (!c.risk.hasPremiumTable(t.stock)) {
            c.risk.setPremiumTables(t.stock, VigilParams.premiumTable(), VigilParams.bufferTable());
        }
        a.oracle = t.oracle != address(0)
            ? t.oracle
            : address(
                new VigilOracle(
                    t.stock,
                    c.session,
                    c.risk,
                    c.template.QUOTE_FEED(),
                    c.template.SEQ_UPTIME_FEED(),
                    c.template.GRACE(),
                    c.template.QUOTE_MAX_AGE(),
                    18,
                    6,
                    c.template.MARKET_HAIRCUT_CAP_BPS()
                )
            );
        MarketParams memory p = MarketParams(c.usdg, t.stock, a.oracle, c.irm, c.lltv);
        a.id = p.id();
        bool fresh = c.morpho.market(a.id).lastUpdate == 0;
        if (fresh) c.morpho.createMarket(p);
        if (c.premium.marketParams(a.id).oracle == address(0)) c.premium.registerMarket(p);
        if (c.preLiq.marketParams(a.id).oracle == address(0)) c.preLiq.registerMarket(p, c.targetLtv);
        if (c.backstop.coverageCapOf(a.id) == 0) c.backstop.setCoverageCap(a.id, c.coverageCap);
        if (!_lossReporterKnows(c, a.id)) c.lossReporter.registerMarket(p);
        if (fresh && t.seed > 0) {
            IERC20(c.usdg).approve(address(c.morpho), t.seed);
            c.morpho.supply(p, t.seed, 0, caller, "");
        }
    }

    /// LossReporter has no public getter for its registry. previewCover reverts NotRegistered() for an unknown id and
    /// may revert for other reasons (a stale oracle) on a known one, so only that exact selector means "not yet".
    function _lossReporterKnows(Core memory c, Id id) private view returns (bool) {
        try c.lossReporter.previewCover(id, address(0)) returns (uint256, uint256, bool, bool) {
            return true;
        } catch (bytes memory err) {
            bytes4 sel;
            if (err.length >= 4) {
                assembly {
                    sel := mload(add(err, 32))
                }
            }
            return sel != bytes4(keccak256("NotRegistered()"));
        }
    }
}

/// FOUNDRY_PROFILE=fork TICKERS=AMD,AMZN,NFLX,PLTR STOCK_AMD=0x… FEED_INITIAL_AMD=15523000000 … \
///   forge script script/AddMarkets.s.sol --rpc-url robinhood_testnet --broadcast --slow
contract AddMarkets is Script {
    function run() external {
        string memory json = vm.readFile(vm.envOr("MANIFEST", string("deployments/robinhood-testnet-46630.json")));
        AddMarket.Core memory c = AddMarket.Core({
            morpho: IMorpho(vm.parseJsonAddress(json, ".contracts.Morpho.address")),
            session: VigilSessionOracle(vm.parseJsonAddress(json, ".contracts.VigilSessionOracle.address")),
            risk: VigilRiskEngine(vm.parseJsonAddress(json, ".contracts.VigilRiskEngine.address")),
            premium: VigilPremium(vm.parseJsonAddress(json, ".contracts.VigilPremium.address")),
            preLiq: VigilPreLiquidation(vm.parseJsonAddress(json, ".contracts.VigilPreLiquidation.address")),
            lossReporter: VigilLossReporter(vm.parseJsonAddress(json, ".contracts.VigilLossReporter.address")),
            backstop: VigilBackstop(vm.parseJsonAddress(json, ".contracts.VigilBackstop.address")),
            usdg: vm.parseJsonAddress(json, ".contracts.USDG.address"),
            irm: vm.parseJsonAddress(json, ".contracts.MockIRM.address"),
            lltv: 0.86e18,
            targetLtv: 0.76e18,
            coverageCap: 100_000e6,
            template: VigilOracle(vm.parseJsonAddress(json, ".contracts.VigilOracle.address"))
        });
        string[] memory tickers = vm.envString("TICKERS", ",");
        uint256 seed = vm.envOr("SEED", uint256(10e6));
        vm.startBroadcast();
        address caller = msg.sender;
        for (uint256 i; i < tickers.length; ++i) {
            string memory s = tickers[i];
            AddMarket.Added memory a = AddMarket.add(
                c,
                AddMarket.Ticker({
                    symbol: s,
                    stock: vm.envAddress(string.concat("STOCK_", s)),
                    feedInitial: int256(vm.envUint(string.concat("FEED_INITIAL_", s))),
                    feed: vm.envOr(string.concat("FEED_", s), address(0)),
                    oracle: vm.envOr(string.concat("ORACLE_", s), address(0)),
                    seed: seed
                }),
                caller
            );
            console2.log(s, a.oracle, a.feed);
            console2.logBytes32(Id.unwrap(a.id));
        }
        vm.stopBroadcast();
    }
}
