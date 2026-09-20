// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Script, console2} from "forge-std/Script.sol";
import {IMorpho} from "morpho-blue/interfaces/IMorpho.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {VigilCalendar} from "../src/VigilCalendar.sol";
import {VigilParams} from "./DeployLib.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {IStockToken} from "../src/interfaces/IStockToken.sol";
import {Regime, Session} from "../src/interfaces/IVigil.sol";

interface IFeedDescription {
    function description() external view returns (string memory);
}

interface IUsdgFreeze {
    function isFrozen(address) external view returns (bool);
}

interface IStockRegistry {
    function ACCESS_CONTROLLED_REGISTRY() external view returns (address);
}

interface IAccessControlsRegistry {
    function isBlocked(address) external view returns (bool);
    function paused() external view returns (bool);
}

/// Go / no-go checks for a Vigil deployment on Robinhood Chain mainnet (4663), read-only — nothing is broadcast.
/// Every dependency Deploy.s.sol will wire is probed the way the contracts will use it, and the run ends with
/// PREFLIGHT PASS or reverts with the list of failures, so it can gate a deployment in CI or by hand:
///
///   FOUNDRY_PROFILE=fork forge script script/MainnetPreflight.s.sol --rpc-url robinhood_mainnet -vv
///
/// Env (all optional; defaults are the mainnet addresses verified on 19–20 Sep 2026, see docs/VERIFICATION.md › On-chain verification):
///   MORPHO, IRM, USDG, STOCK_TOKEN, FEED, USDG_FEED, SYMBOL, LLTV, CAP_BPS, COVERAGE_CAP, DEPLOYER,
///   MIN_ETH (wei the deployer must hold, default 0.005 ether), EXPECT_CHAIN_ID (default 4663).
contract MainnetPreflight is Script {
    uint256 internal fails;
    uint256 internal checks;

    function _check(bool ok, string memory what) internal {
        checks++;
        if (ok) {
            console2.log("  PASS  %s", what);
        } else {
            fails++;
            console2.log("  FAIL  %s", what);
        }
    }

    function _warn(string memory what) internal pure {
        console2.log("  WARN  %s", what);
    }

    struct Cfg {
        uint256 expectChain;
        address morpho;
        address irm;
        address usdg;
        address stock;
        address feed;
        address usdgFeed;
        string symbol;
        uint256 lltv;
        uint256 capBps;
        uint256 coverageCap;
        address deployer;
        uint256 minEth;
    }

    Cfg internal c;

    function run() external {
        c.expectChain = vm.envOr("EXPECT_CHAIN_ID", uint256(4663));
        c.morpho = vm.envOr("MORPHO", address(0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010));
        c.irm = vm.envOr("IRM", address(0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1));
        c.usdg = vm.envOr("USDG", address(0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168));
        c.stock = vm.envOr("STOCK_TOKEN", address(0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC));
        c.feed = vm.envOr("FEED", address(0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15));
        c.usdgFeed = vm.envOr("USDG_FEED", address(0x61B7e5650328764B076A108EFF5fa7282a1B9aD2));
        c.symbol = vm.envOr("SYMBOL", string("NVDA"));
        c.lltv = vm.envOr("LLTV", uint256(0.86e18));
        c.capBps = vm.envOr("CAP_BPS", uint256(500));
        c.coverageCap = vm.envOr("COVERAGE_CAP", uint256(0));
        c.deployer = vm.envOr("DEPLOYER", vm.addr(vm.envOr("PRIVATE_KEY", uint256(1))));
        c.minEth = vm.envOr("MIN_ETH", uint256(0.005 ether));

        console2.log("== Vigil mainnet pre-flight, block %s, timestamp %s", block.number, block.timestamp);
        _checkChainAndMorpho();
        _checkUsdg();
        _checkStock();
        VigilCalendar cal = new VigilCalendar(c.deployer, VigilParams.closedDays(), VigilParams.halfDays()); // simulation only
        _checkFeeds(cal);
        _checkParams(cal);
        _checkDeployer();
        console2.log("== %s checks, %s failed", checks, fails);
        require(fails == 0, "PREFLIGHT FAIL");
        console2.log("PREFLIGHT PASS");
    }

    function _checkChainAndMorpho() internal {
        _check(block.chainid == c.expectChain, "chain id is the expected one (4663 = Robinhood Chain mainnet)");
        _check(c.morpho.code.length > 0, "Morpho Blue has code");
        _check(IMorpho(c.morpho).isIrmEnabled(c.irm), "IRM is enabled on Morpho (AdaptiveCurveIRM)");
        _check(IMorpho(c.morpho).isLltvEnabled(c.lltv), "LLTV is enabled on Morpho");
    }

    /// The loan token, the premium currency and the backstop asset.
    function _checkUsdg() internal {
        _check(c.usdg.code.length > 0, "USDG has code");
        _check(IERC20Metadata(c.usdg).decimals() == 6, "USDG has 6 decimals (VigilOracle is built for 6)");
        try IUsdgFreeze(c.usdg).isFrozen(c.deployer) returns (bool frozen) {
            _check(!frozen, "USDG: deployer is not frozen (T13)");
        } catch {
            _warn("USDG exposes no isFrozen(address) - T13 not applicable here");
        }
    }

    /// The ERC-8056 surface Vigil reads, and the registry that can block transfers.
    function _checkStock() internal {
        _check(c.stock.code.length > 0, "stock token has code");
        string memory sym = IERC20Metadata(c.stock).symbol();
        _check(
            keccak256(bytes(sym)) == keccak256(bytes(c.symbol)),
            string.concat("stock token symbol matches SYMBOL=", c.symbol)
        );
        _check(IERC20Metadata(c.stock).decimals() == 18, "stock token has 18 decimals (VigilOracle is built for 18)");
        IStockToken t = IStockToken(c.stock);
        _check(t.uiMultiplier() > 0, "uiMultiplier() readable and non-zero");
        _check(t.newUIMultiplier() > 0, "newUIMultiplier() readable");
        t.effectiveAt(); // reverts if absent
        _check(true, "effectiveAt() readable");
        try t.oraclePaused() returns (bool p) {
            _check(!p, "oraclePaused() supported and currently false (rule 1 available)");
        } catch {
            _warn("oraclePaused() not supported by this token: rule 1 will be skipped (VigilSessionOracle probes it)");
        }
        try IStockRegistry(c.stock).ACCESS_CONTROLLED_REGISTRY() returns (address reg) {
            IAccessControlsRegistry r = IAccessControlsRegistry(reg);
            _check(!r.paused(), "stock-token registry is not paused");
            _check(!r.isBlocked(c.deployer), "stock-token registry does not block the deployer");
            _check(
                !r.isBlocked(c.morpho), "stock-token registry does not block Morpho (collateral must move in and out)"
            );
        } catch {
            _warn("stock token exposes no ACCESS_CONTROLLED_REGISTRY() - transfer-restriction check skipped");
        }
    }

    /// Decimals, description and freshness judged the way feedIsUsable will judge it.
    function _checkFeeds(VigilCalendar cal) internal {
        _check(IAggregatorV3(c.feed).decimals() == 8, "stock feed has 8 decimals");
        (, int256 answer,, uint256 updatedAt,) = IAggregatorV3(c.feed).latestRoundData();
        _check(answer > 0, "stock feed answer > 0");
        Session memory s = cal.sessionAt(uint64(block.timestamp));
        uint256 hard = 6 hours * 3; // VigilParams.assetConfig: marketStaleSeconds x hardStaleMult
        bool usable = s.cal == Regime.MARKET
            ? block.timestamp - (updatedAt < s.lastOpen ? s.lastOpen : updatedAt) <= hard
            : updatedAt + hard >= s.closeAt;
        _check(usable, "stock feed would be usable under Vigil's staleness rules right now");
        console2.log(
            "        feed %s = %s (8d), updatedAt %s",
            IFeedDescription(c.feed).description(),
            uint256(answer),
            updatedAt
        );
        console2.log(
            "        calendar regime now: %s (0 MARKET .. 3 CLOSED), closeAt %s nextOpen %s",
            uint8(s.cal),
            s.closeAt,
            s.nextOpen
        );
        if (c.usdgFeed == address(0)) {
            _warn("no USDG/USD feed: the oracle will assume $1");
            return;
        }
        _check(IAggregatorV3(c.usdgFeed).decimals() == 8, "USDG/USD feed has 8 decimals");
        (, int256 q,, uint256 qAt,) = IAggregatorV3(c.usdgFeed).latestRoundData();
        _check(q > 0.98e8 && q < 1.02e8, "USDG/USD feed within 2 % of $1");
        _check(block.timestamp - qAt <= 2 days, "USDG/USD feed younger than QUOTE_MAX_AGE (2 days)");
    }

    function _checkParams(VigilCalendar cal) internal {
        VigilParams.surfaceFor(c.symbol); // reverts when there is no calibrated surface
        _check(true, string.concat("calibrated surface exists for ", c.symbol));
        _check(c.capBps > 0 && c.capBps <= 2_500, "CAP_BPS within (0, 2500]");
        if (c.coverageCap == 0) {
            _warn("COVERAGE_CAP = 0: shadow launch, the backstop covers nothing until the guardian raises it");
        }
        uint32[] memory closed = VigilParams.closedDays();
        (uint32 today,) = cal.etDayOf(uint64(block.timestamp));
        _check(closed[closed.length - 1] >= today + 90, "embedded NYSE calendar reaches at least 90 days ahead");
    }

    function _checkDeployer() internal {
        _check(c.deployer.balance >= c.minEth, "deployer holds MIN_ETH for the deployment (24 tx, ~25 M gas)");
        console2.log(
            "        deployer %s: %s wei ETH, %s USDG (6d)",
            c.deployer,
            c.deployer.balance,
            IERC20Metadata(c.usdg).balanceOf(c.deployer)
        );
    }
}
