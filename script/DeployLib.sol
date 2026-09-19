// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IMorpho, MarketParams} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
import {VigilCalendar} from "../src/VigilCalendar.sol";
import {VigilSessionOracle} from "../src/VigilSessionOracle.sol";
import {VigilRiskEngine} from "../src/VigilRiskEngine.sol";
import {VigilOracle} from "../src/VigilOracle.sol";
import {VigilPremium} from "../src/VigilPremium.sol";
import {VigilBackstop} from "../src/VigilBackstop.sol";
import {VigilPreLiquidation} from "../src/VigilPreLiquidation.sol";
import {VigilLossReporter} from "../src/VigilLossReporter.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// Calibration parameters & shared configuration for Deploy and Demo (numbers from calibrator/report.md, PRD §6.6).
library VigilParams {
    function surface() internal pure returns (VigilRiskEngine.Surface memory) {
        return
            VigilRiskEngine.Surface({
                sigmaGapWad: 0.016e18, kTailBps: 30_000, hFloorBps: 50, hMaxBps: 2_500, updatedAt: 0
            });
    }

    function premiumTable() internal pure returns (VigilRiskEngine.PremiumTable memory) {
        return VigilRiskEngine.PremiumTable({
            lBucket: [uint64(63_000), 149_400, 235_800, 322_200],
            rateNoEvent: [uint128(9.5e7), 8e8, 1.48e9, 1.24e9],
            rateEvent: [uint128(2.7e10), 2.7e10, 2.7e10, 2.7e10]
        });
    }

    function bufferTable() internal pure returns (VigilRiskEngine.BufferTable memory) {
        return VigilRiskEngine.BufferTable({
            bBps: [uint16(400), 600, 800, 1_023, 1_500, 2_000],
            multWad: [uint128(6.24e18), 2.97e18, 1.68e18, 1e18, 0.42e18, 0.21e18]
        });
    }

    function assetConfig(address feed) internal pure returns (VigilSessionOracle.AssetConfig memory) {
        // Chainlink feeds on Robinhood Chain: 24 h heartbeat, 0.5 % deviation, no heartbeat outside market hours (V7/V7b).
        // AAPL was seen silent for 4.7 h inside a session → marketStaleSeconds 6 h, hardStaleMult 3 (18 h).
        return VigilSessionOracle.AssetConfig({
            feed: feed,
            marketStaleSeconds: 6 hours,
            hardStaleMult: 3,
            corpActionPre: 1 hours,
            corpActionPost: 1 hours,
            corpActionJumpBps: 100,
            registered: false
        });
    }

    /// NYSE holidays & early closes 2024–2028 (ET day indices). V15 done 19 Sep 2026: matches nyse.com
    /// (2026–2028 on the current page; 2024–2025 via Wayback snapshots of May 2024 & Mar 2025; 9 Jan 2025 via the ICE/NYSE release).
    function closedDays() internal pure returns (uint32[] memory d) {
        uint32[50] memory c = [
            uint32(19723),
            19737,
            19772,
            19811,
            19870,
            19893,
            19908,
            19968,
            20055,
            20082,
            20089,
            20097,
            20108,
            20136,
            20196,
            20234,
            20258,
            20273,
            20332,
            20419,
            20447,
            20454,
            20472,
            20500,
            20546,
            20598,
            20623,
            20637,
            20703,
            20783,
            20812,
            20819,
            20836,
            20864,
            20903,
            20969,
            20987,
            21004,
            21067,
            21147,
            21176,
            21200,
            21235,
            21288,
            21333,
            21354,
            21369,
            21431,
            21511,
            21543
        ];
        d = new uint32[](c.length);
        for (uint256 i; i < c.length; ++i) {
            d[i] = c[i];
        }
    }

    function halfDays() internal pure returns (uint32[] memory d) {
        uint32[11] memory h = [uint32(19907), 20056, 20081, 20272, 20420, 20446, 20784, 20811, 21148, 21368, 21512];
        d = new uint32[](h.length);
        for (uint256 i; i < h.length; ++i) {
            d[i] = h[i];
        }
    }
}

/// Deploys + wires all of Vigil for one asset/market, used by Demo.s.sol (local simulation). A separate contract,
/// not a library: forge forbids `address(this)` in a script contract, while this contract acts as the interim
/// guardian & calibrator before the roles are handed to their final addresses. Never broadcast; the creation
/// code of 8 contracts makes it > 24 KB, so it is marked `IS_SCRIPT` to keep `forge build --sizes` from flagging it.
contract VigilDeployer {
    using MarketParamsLib for MarketParams;

    bool public constant IS_SCRIPT = true;

    struct Config {
        IMorpho morpho;
        address irm;
        uint256 lltv;
        address usdg;
        address stockToken;
        address feed;
        address usdgFeed; // address(0) → $1 assumed
        address guardian;
        address calibrator;
        address keeperSigner;
        uint16 marketHaircutCapBps;
        uint256 targetLtvWad;
        uint256 coverageCap;
    }

    struct Deployed {
        VigilCalendar calendar;
        VigilSessionOracle session;
        VigilRiskEngine risk;
        VigilOracle oracle;
        VigilBackstop backstop;
        VigilPremium premium;
        VigilPreLiquidation preLiq;
        VigilLossReporter lossReporter;
        MarketParams market;
    }

    function deploy(Config memory c) external returns (Deployed memory d) {
        d.calendar = new VigilCalendar(address(this), VigilParams.closedDays(), VigilParams.halfDays());
        d.session = new VigilSessionOracle(d.calendar, IERC20(c.usdg), address(this), c.keeperSigner);
        d.risk = new VigilRiskEngine(d.session, address(this), address(this));
        d.session.setRiskEngine(d.risk);
        d.session.registerAsset(c.stockToken, VigilParams.assetConfig(c.feed));
        d.risk.setSurface(c.stockToken, VigilParams.surface());
        d.risk.setPremiumTables(c.stockToken, VigilParams.premiumTable(), VigilParams.bufferTable());
        d.oracle = new VigilOracle(
            c.stockToken, d.session, d.risk, c.usdgFeed, address(0), 0, 2 days, 18, 6, c.marketHaircutCapBps
        );
        d.market = MarketParams(c.usdg, c.stockToken, address(d.oracle), c.irm, c.lltv);
        c.morpho.createMarket(d.market);
        d.backstop = new VigilBackstop(IERC20(c.usdg), d.calendar, address(this));
        d.premium = new VigilPremium(c.morpho, d.session, d.risk, IERC20(c.usdg), address(d.backstop), address(this));
        d.preLiq = new VigilPreLiquidation(c.morpho, d.session, d.risk, d.premium, address(this));
        d.lossReporter = new VigilLossReporter(c.morpho, d.session, d.premium, d.backstop, address(this));
        d.premium.setPreLiquidation(address(d.preLiq));
        d.premium.registerMarket(d.market);
        d.preLiq.registerMarket(d.market, c.targetLtvWad);
        d.backstop.setLossReporter(address(d.lossReporter));
        d.backstop.setCoverageCap(d.market.id(), c.coverageCap);
        d.lossReporter.registerMarket(d.market);
        // hand-over of the roles (§8.9)
        d.calendar.setGuardian(c.guardian);
        d.session.setRoles(c.guardian, c.keeperSigner);
        d.risk.setRoles(c.calibrator, c.guardian);
        d.backstop.transferGuardian(c.guardian);
        d.premium.transferGuardian(c.guardian);
        d.preLiq.transferGuardian(c.guardian);
        d.lossReporter.transferGuardian(c.guardian);
    }
}
