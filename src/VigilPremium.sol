// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IMorpho, MarketParams, Id, Position} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
import {MorphoBalancesLib} from "morpho-blue/libraries/periphery/MorphoBalancesLib.sol";
import {Regime, IVigilSessionOracle, IVigilRiskEngine, IVigilOracle, IVigilPremium} from "./interfaces/IVigil.sol";

/// @title VigilPremium — escrow USDG dan akrual premi sesi per posisi Morpho (PRD §8.4).
/// @notice due = borrowed × m(b) × Δindex. Index per aset (integral waktu pada b_ref) dari VigilSessionOracle;
///         m(b) di-sample pada setiap accrue. Premi mengalir ke VigilBackstop; sebagian kecil ke bounty poke.
///         Morpho permissionless: hanya peminjam yang opt-in (topUp + setAuthorization) yang menjadi member.
contract VigilPremium is IVigilPremium {
    using SafeERC20 for IERC20;
    using MarketParamsLib for MarketParams;
    using MorphoBalancesLib for IMorpho;

    struct MarketCfg {
        MarketParams params;
        bool registered;
    }

    struct Escrow {
        uint128 balance; // USDG tersedia
        uint128 owed; // premi jatuh tempo yang belum terbayar (escrow habis)
        uint256 lastIndex;
        uint256 multWad; // m(b) yang di-sample saat accrue terakhir
        uint256 paid; // total premi yang sudah dibayar
        uint64 delinquentSince;
        bool tracked;
    }

    uint16 public constant POKE_BOUNTY_BPS = 100; // 1% dari premi → bounty pool poke()
    uint64 public constant MIN_RESERVE_SECONDS = 7 days;
    uint64 public constant L_WEEKEND = 235_800;
    uint256 internal constant WAD = 1e18;

    IMorpho public immutable MORPHO;
    IVigilSessionOracle public immutable SESSION;
    IVigilRiskEngine public immutable RISK;
    IERC20 public immutable USDG;
    address public immutable BACKSTOP;
    address public preLiquidation; // one-shot (ketergantungan melingkar)
    address public guardian;

    mapping(Id => MarketCfg) internal markets;
    mapping(Id => mapping(address => Escrow)) internal escrows;
    uint256 public totalAccrued;
    uint256 public totalPaid;
    uint256 public totalBounty;

    event MarketRegistered(Id indexed id, address collateral, address oracle);
    event PremiumAccrued(Id indexed id, address indexed borrower, uint256 due, uint256 paid, uint256 owed);
    event EscrowToppedUp(Id indexed id, address indexed borrower, uint256 amount);
    event EscrowWithdrawn(Id indexed id, address indexed borrower, uint256 amount);
    event Delinquent(Id indexed id, address indexed borrower, bool delinquent);

    error NotGuardian();
    error AlreadySet();
    error NotRegistered();
    error BadMarket();
    error ReserveBreach();

    constructor(
        IMorpho morpho,
        IVigilSessionOracle session,
        IVigilRiskEngine risk,
        IERC20 usdg,
        address backstop,
        address guardian_
    ) {
        MORPHO = morpho;
        SESSION = session;
        RISK = risk;
        USDG = usdg;
        BACKSTOP = backstop;
        guardian = guardian_;
    }

    modifier onlyGuardian() {
        if (msg.sender != guardian) revert NotGuardian();
        _;
    }

    function transferGuardian(address g) external {
        if (msg.sender != guardian) revert NotGuardian();
        guardian = g;
    }

    function setPreLiquidation(address p) external onlyGuardian {
        if (preLiquidation != address(0)) revert AlreadySet();
        preLiquidation = p;
    }

    function registerMarket(MarketParams calldata p) external onlyGuardian {
        if (IVigilOracle(p.oracle).STOCK_TOKEN() != p.collateralToken || !SESSION.isRegistered(p.collateralToken)) {
            revert BadMarket();
        }
        Id id = p.id();
        if (markets[id].registered) revert AlreadySet();
        markets[id] = MarketCfg(p, true);
        // allowance untuk fundBounty; OZ safeApprove menolak bila sudah ≠ 0 (pasar kedua dst.)
        if (USDG.allowance(address(this), address(SESSION)) == 0) {
            USDG.safeApprove(address(SESSION), type(uint256).max);
        }
        emit MarketRegistered(id, p.collateralToken, p.oracle);
    }

    function marketParams(Id id) external view returns (MarketParams memory) {
        return markets[id].params;
    }

    function escrowOf(Id id, address borrower) external view returns (Escrow memory) {
        return escrows[id][borrower];
    }

    // ───────────────────────── akrual ─────────────────────────

    /// LIF Morpho: min(1.15, 1 / (1 − 0.3 × (1 − LLTV))) = min(1.15, 1/(0.3×LLTV + 0.7))
    function _lif(uint256 lltv) internal pure returns (uint256) {
        uint256 lif = WAD * WAD / (WAD - 0.3e18 * (WAD - lltv) / WAD);
        return lif > 1.15e18 ? 1.15e18 : lif;
    }

    /// b = 1 − LTV × LIF (bps), LTV pada harga tanpa haircut.
    function bufferBps(Id id, address borrower, uint256 borrowed) public view returns (uint256) {
        MarketCfg storage m = markets[id];
        Position memory p = MORPHO.position(id, borrower);
        if (p.collateral == 0) return 0;
        uint256 px = IVigilOracle(m.params.oracle).unhaircutPrice();
        uint256 collVal = uint256(p.collateral) * px / 1e36;
        if (collVal == 0) return 0;
        uint256 ltv = borrowed * WAD / collVal;
        uint256 x = ltv * _lif(m.params.lltv) / WAD;
        return x >= WAD ? 0 : (WAD - x) / 1e14;
    }

    /// Cadangan minimum: 7 hari × π_ref(CLOSED, L_akhir_pekan) × m(b) × notional.
    function minReserve(Id id, address borrower) public view returns (uint256) {
        MarketCfg storage m = markets[id];
        uint256 borrowed = MORPHO.expectedBorrowAssets(m.params, borrower);
        if (borrowed == 0) return 0;
        Escrow storage e = escrows[id][borrower];
        uint256 mult = e.tracked
            ? e.multWad
            : RISK.bufferMultiplierWad(m.params.collateralToken, bufferBps(id, borrower, borrowed));
        uint256 rate = RISK.premiumRefRatePerSecond(m.params.collateralToken, Regime.CLOSED, L_WEEKEND);
        return uint256(MIN_RESERVE_SECONDS) * rate * mult / WAD * borrowed / WAD;
    }

    function _accrue(Id id, address borrower) internal {
        MarketCfg storage m = markets[id];
        if (!m.registered) revert NotRegistered();
        address asset = m.params.collateralToken;
        Escrow storage e = escrows[id][borrower];
        SESSION.poke(asset); // persistenkan progres index agar akrual tidak pernah tertinggal
        uint256 idxNow = SESSION.premiumIndex(asset);
        uint256 borrowed = MORPHO.expectedBorrowAssets(m.params, borrower);
        if (e.tracked) {
            uint256 due = borrowed * e.multWad / WAD * (idxNow - e.lastIndex) / WAD;
            if (due > 0) {
                uint256 pay = due > e.balance ? e.balance : due;
                e.balance -= uint128(pay);
                e.owed += uint128(due - pay);
                e.paid += pay;
                totalAccrued += due;
                _forward(asset, pay);
                emit PremiumAccrued(id, borrower, due, pay, due - pay);
            }
        }
        e.tracked = true;
        e.lastIndex = idxNow;
        e.multWad = RISK.bufferMultiplierWad(asset, bufferBps(id, borrower, borrowed));
        _updateDelinquency(id, borrower, e, borrowed);
    }

    function _forward(address asset, uint256 pay) internal {
        if (pay == 0) return;
        uint256 bounty = pay * POKE_BOUNTY_BPS / 10_000;
        if (bounty > 0) {
            SESSION.fundBounty(asset, bounty);
            totalBounty += bounty;
        }
        USDG.safeTransfer(BACKSTOP, pay - bounty);
        totalPaid += pay;
    }

    function _updateDelinquency(Id id, address borrower, Escrow storage e, uint256 borrowed) internal {
        bool d = e.owed > 0 || (borrowed > 0 && e.balance < minReserve(id, borrower));
        if (d && e.delinquentSince == 0) {
            e.delinquentSince = uint64(block.timestamp);
            emit Delinquent(id, borrower, true);
        } else if (!d && e.delinquentSince != 0) {
            e.delinquentSince = 0;
            emit Delinquent(id, borrower, false);
        }
    }

    /// Permissionless — siapa pun boleh memanggil, terutama saat b posisi memburuk.
    function accrue(Id id, address borrower) external {
        _accrue(id, borrower);
    }

    function topUp(Id id, address onBehalf, uint256 amount) external {
        _accrue(id, onBehalf);
        USDG.safeTransferFrom(msg.sender, address(this), amount);
        Escrow storage e = escrows[id][onBehalf];
        e.balance += uint128(amount);
        if (e.owed > 0) {
            uint256 settle = e.owed > e.balance ? e.balance : e.owed;
            e.owed -= uint128(settle);
            e.balance -= uint128(settle);
            e.paid += settle;
            _forward(markets[id].params.collateralToken, settle);
        }
        _updateDelinquency(id, onBehalf, e, MORPHO.expectedBorrowAssets(markets[id].params, onBehalf));
        emit EscrowToppedUp(id, onBehalf, amount);
    }

    function withdrawUnused(Id id, uint256 amount) external {
        _accrue(id, msg.sender);
        Escrow storage e = escrows[id][msg.sender];
        if (amount > e.balance || e.owed > 0) revert ReserveBreach();
        uint256 borrowed = MORPHO.expectedBorrowAssets(markets[id].params, msg.sender);
        if (borrowed > 0 && e.balance - amount < minReserve(id, msg.sender)) revert ReserveBreach();
        e.balance -= uint128(amount);
        USDG.safeTransfer(msg.sender, amount);
        emit EscrowWithdrawn(id, msg.sender, amount);
    }

    // ───────────────────────── view ─────────────────────────

    function isDelinquent(Id id, address borrower) public view returns (bool) {
        Escrow storage e = escrows[id][borrower];
        if (!e.tracked) return true; // belum pernah opt-in
        if (e.owed > 0) return true;
        uint256 borrowed = MORPHO.expectedBorrowAssets(markets[id].params, borrower);
        if (borrowed == 0) return false;
        uint256 pendingDue =
            borrowed * e.multWad / WAD * (SESSION.premiumIndex(markets[id].params.collateralToken) - e.lastIndex) / WAD;
        return e.balance < pendingDue + minReserve(id, borrower);
    }

    function isMember(Id id, address borrower) external view returns (bool) {
        return
            preLiquidation != address(0) && MORPHO.isAuthorized(borrower, preLiquidation) && !isDelinquent(id, borrower);
    }

    function delinquentSince(Id id, address borrower) external view returns (uint64) {
        return escrows[id][borrower].delinquentSince;
    }
}
