// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IOracle} from "morpho-blue/interfaces/IOracle.sol";
import {Regime, IVigilSessionOracle, IVigilRiskEngine, IVigilOracle} from "./interfaces/IVigil.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";

/// @title VigilOracle — implementasi Morpho IOracle dengan haircut ter-ramp dan kesadaran sesi (PRD §8.3).
/// @notice Immutable per pasar. Revert HANYA saat CORP_ACTION dan stale tak terduga (FR-16/17); feed yang beku
///         selama penutupan terjadwal adalah kondisi normal. Feed sudah total-return (× uiMultiplier) —
///         JANGAN PERNAH mengalikan multiplier lagi (T12).
contract VigilOracle is IOracle, IVigilOracle {
    uint256 public immutable SCALE_FACTOR;
    address public immutable FEED; // STOCK/USD
    address public immutable QUOTE_FEED; // USDG/USD, address(0) jika diasumsikan $1 (D1: pakai bila ada)
    address public immutable SEQ_UPTIME_FEED; // address(0) jika tidak tersedia (V8: tidak ada di Robinhood Chain)
    uint256 public immutable GRACE;
    uint256 public immutable QUOTE_MAX_AGE;
    address public immutable STOCK_TOKEN;
    IVigilSessionOracle public immutable SESSION;
    IVigilRiskEngine public immutable RISK;
    uint16 public immutable MARKET_HAIRCUT_CAP_BPS;

    error VigilPaused();
    error VigilStale();
    error VigilSequencerDown();
    error VigilBadAnswer();
    error NotRegistered();

    constructor(
        address stockToken,
        IVigilSessionOracle session,
        IVigilRiskEngine risk,
        address quoteFeed,
        address seqUptimeFeed,
        uint256 grace,
        uint256 quoteMaxAge,
        uint8 baseTokenDecimals,
        uint8 quoteTokenDecimals,
        uint16 marketHaircutCapBps
    ) {
        if (!session.isRegistered(stockToken)) revert NotRegistered();
        STOCK_TOKEN = stockToken;
        SESSION = session;
        RISK = risk;
        FEED = session.feedOf(stockToken);
        QUOTE_FEED = quoteFeed;
        SEQ_UPTIME_FEED = seqUptimeFeed;
        GRACE = grace;
        QUOTE_MAX_AGE = quoteMaxAge;
        MARKET_HAIRCUT_CAP_BPS = marketHaircutCapBps;
        uint256 quoteFeedDecimals = quoteFeed == address(0) ? 0 : IAggregatorV3(quoteFeed).decimals();
        // Morpho: exponent = 36 + quoteTokenDecimals + quoteFeedDecimals − baseTokenDecimals − baseFeedDecimals (§9.2)
        SCALE_FACTOR =
            10 ** (36 + quoteTokenDecimals + quoteFeedDecimals - baseTokenDecimals - IAggregatorV3(FEED).decimals());
    }

    function _rawPrice() internal view returns (uint256 p) {
        (, int256 a,,,) = IAggregatorV3(FEED).latestRoundData();
        if (a <= 0) revert VigilBadAnswer();
        p = uint256(a) * SCALE_FACTOR;
        if (QUOTE_FEED != address(0)) {
            (, int256 q,, uint256 qUpdated,) = IAggregatorV3(QUOTE_FEED).latestRoundData();
            if (q <= 0) revert VigilBadAnswer();
            if (block.timestamp - qUpdated > QUOTE_MAX_AGE) revert VigilStale();
            p = p / uint256(q);
        }
    }

    function _checkSequencer() internal view {
        if (SEQ_UPTIME_FEED == address(0)) return;
        (, int256 status, uint256 startedAt,,) = IAggregatorV3(SEQ_UPTIME_FEED).latestRoundData();
        if (status != 0 || block.timestamp - startedAt <= GRACE) revert VigilSequencerDown();
    }

    /// @dev Morpho IOracle.price(): harga 1 unit collateral dalam loan token, skala 1e36.
    function price() external view override(IOracle, IVigilOracle) returns (uint256) {
        _checkSequencer();
        uint256 p = _rawPrice();
        (Regime effective,,,) = SESSION.regimeOf(STOCK_TOKEN);
        if (effective == Regime.CORP_ACTION) revert VigilPaused();
        if (!SESSION.feedIsUsable(STOCK_TOKEN)) revert VigilStale();
        uint256 h = RISK.haircutBps(STOCK_TOKEN);
        if (h > MARKET_HAIRCUT_CAP_BPS) h = MARKET_HAIRCUT_CAP_BPS;
        return p * (10_000 - h) / 10_000;
    }

    /// Harga feed tanpa haircut dan tanpa pemeriksaan rezim — untuk transparansi dan perhitungan LTV internal.
    function unhaircutPrice() external view returns (uint256) {
        return _rawPrice();
    }

    function currentHaircutBps() external view returns (uint16) {
        uint256 h = RISK.haircutBps(STOCK_TOKEN);
        return uint16(h > MARKET_HAIRCUT_CAP_BPS ? MARKET_HAIRCUT_CAP_BPS : h);
    }

    function regime() external view returns (uint8) {
        (Regime effective,,,) = SESSION.regimeOf(STOCK_TOKEN);
        return uint8(effective);
    }
}
