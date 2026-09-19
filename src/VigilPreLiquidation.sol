// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IMorpho, MarketParams, Id, Position} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
import {MorphoBalancesLib} from "morpho-blue/libraries/periphery/MorphoBalancesLib.sol";
import {Regime, IVigilSessionOracle, IVigilRiskEngine, IVigilOracle, IVigilPremium} from "./interfaces/IVigil.sol";

/// @title VigilPreLiquidation — soft unwind sadar-sesi (pola Morpho PreLiquidation, opt-in via setAuthorization) (PRD §8.6).
/// @notice Ambang: LTV pada harga × (1 − H_soft) ≥ LLTV, dengan H_soft = max(H, cap + softMargin) — selalu lebih ketat
///         dari likuidasi keras (FR-34). Diskon Dutch berbasis WAKTU (FCFS, tanpa priority fee) mulai dari 0.
contract VigilPreLiquidation {
    using SafeERC20 for IERC20;
    using MarketParamsLib for MarketParams;
    using MorphoBalancesLib for IMorpho;

    struct MarketCfg {
        MarketParams params;
        uint256 targetLtvWad;
        bool registered;
    }

    uint16 public constant MAX_UNWIND_DISCOUNT_BPS = 300;
    uint64 public constant UNWIND_RAMP = 3_600;
    uint16 public constant SOFT_MARGIN_BPS = 200;
    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;

    IMorpho public immutable MORPHO;
    IVigilSessionOracle public immutable SESSION;
    IVigilRiskEngine public immutable RISK;
    IVigilPremium public immutable PREMIUM;
    address public guardian;
    mapping(Id => MarketCfg) internal markets;

    event MarketRegistered(Id indexed id, uint256 targetLtvWad);
    event Unwound(
        Id indexed id,
        address indexed borrower,
        address indexed unwinder,
        uint256 repaid,
        uint256 seized,
        uint256 discountBps
    );

    error NotGuardian();
    error AlreadySet();
    error NotRegistered();
    error NotUnwindable();
    error ZeroRepay();
    error BadTarget();

    constructor(
        IMorpho morpho,
        IVigilSessionOracle session,
        IVigilRiskEngine risk,
        IVigilPremium premium,
        address guardian_
    ) {
        MORPHO = morpho;
        SESSION = session;
        RISK = risk;
        PREMIUM = premium;
        guardian = guardian_;
    }

    function transferGuardian(address g) external {
        if (msg.sender != guardian) revert NotGuardian();
        guardian = g;
    }

    function registerMarket(MarketParams calldata p, uint256 targetLtvWad) external {
        if (msg.sender != guardian) revert NotGuardian();
        if (targetLtvWad >= p.lltv) revert BadTarget();
        Id id = p.id();
        if (markets[id].registered) revert AlreadySet();
        markets[id] = MarketCfg(p, targetLtvWad, true);
        emit MarketRegistered(id, targetLtvWad);
    }

    function marketParams(Id id) external view returns (MarketParams memory) {
        return markets[id].params;
    }

    // ───────────────────────── ambang ─────────────────────────

    function softHaircutBps(Id id) public view returns (uint256) {
        MarketCfg storage m = markets[id];
        uint256 floor_ = uint256(IVigilOracle(m.params.oracle).MARKET_HAIRCUT_CAP_BPS()) + SOFT_MARGIN_BPS;
        uint256 h = RISK.haircutBps(m.params.collateralToken);
        return h > floor_ ? h : floor_;
    }

    /// Aktif di jendela pre-close, selama penutupan (termasuk halt keeper), atau saat delinquent.
    function _window(Id id) internal view returns (bool active, uint64 windowStart) {
        address asset = markets[id].params.collateralToken;
        (uint64 closeAt, uint64 nextOpen, bool inClosure,,, uint64 tightSince) = SESSION.closureOf(asset);
        uint64 pre = RISK.preCloseWindow();
        if (inClosure) {
            windowStart = closeAt > pre ? closeAt - pre : 0;
            if (tightSince > windowStart) windowStart = tightSince;
            if (windowStart > block.timestamp) windowStart = uint64(block.timestamp);
            return (true, windowStart);
        }
        if (closeAt > block.timestamp && closeAt - block.timestamp <= pre) return (true, closeAt - pre);
        nextOpen; // unused
        return (false, 0);
    }

    function currentDiscountBps(Id id, address borrower) public view returns (uint256) {
        (bool active, uint64 ws) = _window(id);
        if (!active) {
            ws = PREMIUM.delinquentSince(id, borrower);
            if (ws == 0) return 0;
        }
        uint256 elapsed = block.timestamp > ws ? block.timestamp - ws : 0;
        if (elapsed >= UNWIND_RAMP) return MAX_UNWIND_DISCOUNT_BPS;
        return uint256(MAX_UNWIND_DISCOUNT_BPS) * elapsed / UNWIND_RAMP;
    }

    /// R = (D − target×Cv) / (1 − target×(1+d)); unwind parsial sampai LTV = target (FR-30).
    function _maxRepay(uint256 debt, uint256 collVal, uint256 target, uint256 dBps) internal pure returns (uint256) {
        uint256 floorDebt = target * collVal / WAD;
        if (debt <= floorDebt) return 0;
        uint256 denom = WAD - target * (BPS + dBps) / BPS;
        uint256 r = (debt - floorDebt) * WAD / denom;
        return r > debt ? debt : r;
    }

    /// @return ltvSoft LTV pada harga × (1 − H_soft) (WAD); @return debt utang; @return collVal nilai jaminan tanpa haircut
    function _softLtv(Id id, address borrower) internal view returns (uint256 ltvSoft, uint256 debt, uint256 collVal) {
        MarketCfg storage m = markets[id];
        debt = MORPHO.expectedBorrowAssets(m.params, borrower);
        Position memory p = MORPHO.position(id, borrower);
        if (debt == 0 || p.collateral == 0) return (0, debt, 0);
        uint256 pxRaw = IVigilOracle(m.params.oracle).unhaircutPrice();
        collVal = uint256(p.collateral) * pxRaw / 1e36;
        uint256 collValSoft = collVal * (BPS - softHaircutBps(id)) / BPS;
        ltvSoft = collValSoft == 0 ? type(uint256).max : debt * WAD / collValSoft;
    }

    function isUnwindable(Id id, address borrower) public view returns (bool, uint256 maxRepay) {
        MarketCfg storage m = markets[id];
        if (!m.registered) return (false, 0);
        (bool active,) = _window(id);
        bool delinquent = PREMIUM.isDelinquent(id, borrower);
        if (!active && !delinquent) return (false, 0);
        (uint256 ltvSoft, uint256 debt, uint256 collVal) = _softLtv(id, borrower);
        if (debt == 0 || collVal == 0) return (false, 0);
        if (!delinquent && ltvSoft < m.params.lltv) return (false, 0);
        maxRepay = _maxRepay(debt, collVal, m.targetLtvWad, currentDiscountBps(id, borrower));
        return (maxRepay > 0, maxRepay);
    }

    /// Unwinder membayar `repay` USDG dan menerima jaminan senilai repay × (1 + diskon) pada harga tanpa haircut.
    function preLiquidate(Id id, address borrower, uint256 repayAssets, bytes calldata)
        external
        returns (uint256 repaid, uint256 seized)
    {
        MarketCfg storage m = markets[id];
        (bool ok, uint256 maxRepay) = isUnwindable(id, borrower);
        if (!ok) revert NotUnwindable();
        repaid = repayAssets > maxRepay ? maxRepay : repayAssets;
        if (repaid == 0) revert ZeroRepay();
        uint256 d = currentDiscountBps(id, borrower);
        uint256 pxRaw = IVigilOracle(m.params.oracle).unhaircutPrice();
        seized = repaid * (BPS + d) / BPS * 1e36 / pxRaw;
        IERC20(m.params.loanToken).safeTransferFrom(msg.sender, address(this), repaid);
        IERC20(m.params.loanToken).safeApprove(address(MORPHO), repaid);
        MORPHO.repay(m.params, repaid, 0, borrower, "");
        MORPHO.withdrawCollateral(m.params, seized, borrower, msg.sender); // butuh setAuthorization dari peminjam
        emit Unwound(id, borrower, msg.sender, repaid, seized, d);
    }
}
