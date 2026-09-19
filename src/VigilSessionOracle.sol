// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Regime, Session, IVigilCalendar, IVigilSessionOracle, IVigilRiskEngine} from "./interfaces/IVigil.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";
import {IStockToken} from "./interfaces/IStockToken.sol";

/// @title VigilSessionOracle — per-asset session regime, feed freshness, keeper attestations, premium index (PRD §8.1).
/// @notice The calendar is the source of truth; a keeper can only tighten and can never trigger
///         CORP_ACTION (the only regime that makes the oracle revert). Without a keeper the whole daily
///         cycle still runs from the calendar + feed freshness (G6).
contract VigilSessionOracle is IVigilSessionOracle, EIP712 {
    using SafeERC20 for IERC20;

    struct AssetConfig {
        address feed; // Chainlink AggregatorV3 (STOCK/USD)
        uint32 marketStaleSeconds; // silent for this long during MARKET → OVERNIGHT (rule 3). Per asset: AAPL can normally go 4+ h without an update.
        uint32 hardStaleMult; // hardStaleWindow = marketStaleSeconds × hardStaleMult
        uint32 corpActionPre; // seconds before effectiveAt
        uint32 corpActionPost; // seconds after effectiveAt
        uint16 corpActionJumpBps; // smallest multiplier jump treated as a corporate action (a small dividend does not block the oracle)
        bool registered;
    }

    struct Attestation {
        address asset;
        uint8 regime; // <= CLOSED
        uint64 closeAt; // <= the calendar closeAt (ad-hoc halt)
        uint64 nextOpen; // >= the calendar nextOpen
        uint64 issuedAt;
        uint64 deadline;
    }

    struct AttestState {
        uint8 regime;
        uint64 closeAt;
        uint64 nextOpen;
        uint64 issuedAt;
        uint64 since; // start of the chain of consecutive attestations: a renewal does not restart the tightening ramp
    }

    struct IndexState {
        uint256 index; // Σ π_ref × dt (WAD per unit notional)
        uint64 lastPoke;
        uint256 lastMultiplier; // last uiMultiplier seen after the post-effectiveAt window
    }

    bytes32 public constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(address asset,uint8 regime,uint64 closeAt,uint64 nextOpen,uint64 issuedAt,uint64 deadline)"
    );
    uint64 public constant MAX_ATTESTATION_AGE = 30 minutes;
    uint64 public constant MAX_CLOSED_HORIZON = 5 days;
    uint64 public constant MIN_POKE_INTERVAL = 15 minutes;
    uint256 internal constant MAX_SEGMENTS = 128; // ≈ 4 weeks of calendar segments without a poke

    IVigilCalendar public immutable calendar;
    IERC20 public immutable bountyToken; // USDG
    IVigilRiskEngine public risk; // one-shot init (circular dependency with the RiskEngine)
    address public guardian;
    address public keeperSigner;
    uint256 public pokeBountyAmount;

    mapping(address => AssetConfig) public configs;
    /// Whether the token exposes `oraclePaused()`. Robinhood's mainnet stock token does; the testnet tokens issued by
    /// the same registry (implementation `Stock`, Sep 2026) expose uiMultiplier/newUIMultiplier/effectiveAt but not
    /// oraclePaused, so it is probed once at registration and rule 1 is skipped where the token cannot express it
    /// (rule 2 — the effectiveAt window — still applies).
    mapping(address => bool) public hasOraclePaused;
    mapping(address => AttestState) public attestations;
    mapping(address => IndexState) internal idx;
    mapping(address => uint256) public bountyPool;

    event AssetRegistered(address indexed asset, address feed);
    event Attested(address indexed asset, uint8 regime, uint64 closeAt, uint64 nextOpen, address signer);
    event Poked(address indexed asset, uint256 index, uint64 upTo);
    event BountyFunded(address indexed asset, uint256 amount);
    event RolesSet(address guardian, address keeperSigner);

    error NotGuardian();
    error AlreadySet();
    error NotRegistered();
    error BadSignature();
    error Expired();
    error RegimeTooTight(); // the keeper tried CORP_ACTION
    error NotTightening();
    error StaleAttestation();
    error HorizonTooFar();

    constructor(IVigilCalendar calendar_, IERC20 bountyToken_, address guardian_, address keeperSigner_)
        EIP712("VigilSessionOracle", "1")
    {
        calendar = calendar_;
        bountyToken = bountyToken_;
        guardian = guardian_;
        keeperSigner = keeperSigner_;
    }

    // ───────────────────────── control ─────────────────────────

    modifier onlyGuardian() {
        if (msg.sender != guardian) revert NotGuardian();
        _;
    }

    function setRiskEngine(IVigilRiskEngine r) external onlyGuardian {
        if (address(risk) != address(0)) revert AlreadySet();
        risk = r;
    }

    function setRoles(address guardian_, address keeperSigner_) external onlyGuardian {
        guardian = guardian_;
        keeperSigner = keeperSigner_;
        emit RolesSet(guardian_, keeperSigner_);
    }

    function setPokeBounty(uint256 amount) external onlyGuardian {
        pokeBountyAmount = amount;
    }

    /// Per-asset configuration is immutable after registration (principle §7.2).
    function registerAsset(address asset, AssetConfig calldata cfg) external onlyGuardian {
        if (configs[asset].registered) revert AlreadySet();
        configs[asset] = cfg;
        configs[asset].registered = true;
        idx[asset].lastPoke = uint64(block.timestamp);
        idx[asset].lastMultiplier = IStockToken(asset).uiMultiplier();
        try IStockToken(asset).oraclePaused() returns (bool) {
            hasOraclePaused[asset] = true;
        } catch {}
        emit AssetRegistered(asset, cfg.feed);
    }

    function isRegistered(address asset) external view returns (bool) {
        return configs[asset].registered;
    }

    function feedOf(address asset) external view returns (address) {
        return configs[asset].feed;
    }

    // ───────────────────────── trustless derivation ─────────────────────────

    function _feedUpdatedAt(address feed) internal view returns (uint256 updatedAt) {
        (,,, updatedAt,) = IAggregatorV3(feed).latestRoundData();
    }

    function _jumpBps(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == 0) return 0;
        uint256 d = a > b ? a - b : b - a;
        return d * 10_000 / a;
    }

    /// @dev Rules 1–4 of §8.1. CORP_ACTION comes only from the token: oraclePaused(), or the effectiveAt window with a
    ///      multiplier jump ≥ corpActionJumpBps (pre: pending vs current; post: current vs lastMultiplier — V10b).
    /// @return derived the derived regime; @return s the calendar snapshot; @return since when the derived
    ///         tightening (above the calendar) started — used by the premium index for exact accrual.
    function _derived(address asset) internal view returns (Regime derived, Session memory s, uint64 since) {
        AssetConfig storage c = configs[asset];
        if (!c.registered) revert NotRegistered();
        s = calendar.sessionAt(uint64(block.timestamp));
        IStockToken t = IStockToken(asset);
        if (hasOraclePaused[asset] && t.oraclePaused()) return (Regime.CORP_ACTION, s, 0);
        uint256 eff = t.effectiveAt();
        if (eff != 0 && block.timestamp + c.corpActionPre >= eff && block.timestamp <= eff + c.corpActionPost) {
            uint256 cur = t.uiMultiplier();
            uint256 jump;
            if (block.timestamp < eff) {
                jump = _jumpBps(cur, t.newUIMultiplier());
            } else {
                uint256 last = idx[asset].lastMultiplier;
                jump = last == 0 ? 0 : _jumpBps(last, cur);
            }
            if (jump >= c.corpActionJumpBps) return (Regime.CORP_ACTION, s, uint64(eff - c.corpActionPre));
        }
        if (s.cal == Regime.MARKET) {
            // Silence is measured from max(updatedAt, lastOpen): a feed frozen since Friday gets a fresh grace
            // period at 09:30 Monday instead of being treated as broken the moment the market opens.
            uint256 ref = _feedUpdatedAt(c.feed);
            if (ref < s.lastOpen) ref = s.lastOpen;
            if (block.timestamp - ref > c.marketStaleSeconds) {
                return (Regime.OVERNIGHT, s, uint64(ref + c.marketStaleSeconds));
            }
        }
        return (s.cal, s, 0);
    }

    function _attestFresh(address asset) internal view returns (bool fresh, AttestState storage a) {
        a = attestations[asset];
        fresh = a.issuedAt != 0 && block.timestamp - a.issuedAt <= MAX_ATTESTATION_AGE;
    }

    /// @dev effective = max(derived, attested); closeAt = min; nextOpen = max — a keeper can only tighten (FR-3).
    function _effective(address asset)
        internal
        view
        returns (Regime effective, Session memory s, uint64 closeAt, uint64 nextOpen)
    {
        (effective, s, closeAt, nextOpen,) = _effectiveSince(asset);
    }

    /// @dev Like _effective, plus `tightSince`: when the effective regime started, if it is tighter than the calendar.
    function _effectiveSince(address asset)
        internal
        view
        returns (Regime effective, Session memory s, uint64 closeAt, uint64 nextOpen, uint64 tightSince)
    {
        Regime derived;
        uint64 since;
        (derived, s, since) = _derived(asset);
        effective = derived;
        tightSince = since;
        closeAt = s.closeAt;
        nextOpen = s.nextOpen;
        (bool fresh, AttestState storage a) = _attestFresh(asset);
        if (fresh) {
            // An attested regime applies from its closeAt (a scheduled halt); before that only the closing schedule
            // changes, so the haircut ramps towards the halt from the moment the attestation is issued — never a step.
            if (block.timestamp >= a.closeAt && Regime(a.regime) > effective) {
                effective = Regime(a.regime);
                tightSince = a.since;
            }
            if (a.closeAt < closeAt) {
                closeAt = a.closeAt;
                tightSince = a.since;
            }
            if (a.nextOpen > nextOpen) {
                nextOpen = a.nextOpen; // delayed open: a longer closure → tightening, ramped from the start of the chain
                tightSince = a.since;
            }
            if (nextOpen > closeAt + MAX_CLOSED_HORIZON) nextOpen = closeAt + MAX_CLOSED_HORIZON;
        }
    }

    function regimeOf(address asset)
        external
        view
        returns (Regime effective, Regime cal, uint64 closeAt, uint64 nextOpen)
    {
        Session memory s;
        (effective, s, closeAt, nextOpen) = _effective(asset);
        cal = s.cal;
    }

    function closureOf(address asset)
        external
        view
        returns (uint64 closeAt, uint64 nextOpen, bool inClosure, uint64 lastOpen, uint64 prevClose, uint64 tightSince)
    {
        (Regime effective, Session memory s, uint64 c, uint64 n, uint64 ts) = _effectiveSince(asset);
        return (c, n, effective != Regime.MARKET, s.lastOpen, s.prevClose, ts);
    }

    /// @dev FR-16/17: EXPECTED staleness (a feed frozen during a closure) ≠ UNEXPECTED staleness.
    function feedIsUsable(address asset) external view returns (bool) {
        (, Session memory s, uint64 closeAt,) = _effective(asset);
        AssetConfig storage c = configs[asset];
        uint256 updatedAt = _feedUpdatedAt(c.feed);
        uint256 hard = uint256(c.marketStaleSeconds) * c.hardStaleMult;
        if (s.cal == Regime.MARKET) {
            // the market should be open: silent for more than hardStaleWindow since max(updatedAt, lastOpen) = broken
            uint256 ref = updatedAt < s.lastOpen ? s.lastOpen : updatedAt;
            return block.timestamp - ref <= hard;
        }
        // market closed (calendar or keeper halt): the last price may not be older than closeAt − hardStaleWindow
        return updatedAt + hard >= closeAt;
    }

    // ───────────────────────── keeper attestations ─────────────────────────

    function hashAttestation(Attestation calldata a) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(
                abi.encode(ATTESTATION_TYPEHASH, a.asset, a.regime, a.closeAt, a.nextOpen, a.issuedAt, a.deadline)
            )
        );
    }

    function attest(Attestation calldata a, bytes calldata sig) external {
        if (!configs[a.asset].registered) revert NotRegistered();
        if (ECDSA.recover(hashAttestation(a), sig) != keeperSigner) revert BadSignature();
        if (block.timestamp > a.deadline || a.issuedAt > block.timestamp) revert Expired();
        if (a.regime > uint8(Regime.CLOSED)) revert RegimeTooTight(); // FR-33
        if (a.issuedAt <= attestations[a.asset].issuedAt) revert StaleAttestation();
        Session memory s = calendar.sessionAt(uint64(block.timestamp));
        if (a.closeAt > s.closeAt || a.nextOpen < s.nextOpen) revert NotTightening();
        if (a.closeAt < s.closeAt && a.regime < uint8(Regime.EXTENDED)) revert NotTightening(); // a halt must name a closed regime
        if (a.closeAt + MAX_CLOSED_HORIZON < block.timestamp) revert NotTightening();
        if (a.nextOpen > a.closeAt + MAX_CLOSED_HORIZON) revert HorizonTooFar();
        _poke(a.asset); // accrue the old regime up to now before the tightening takes effect
        (bool stillFresh, AttestState storage prev) = _attestFresh(a.asset);
        uint64 since = stillFresh ? prev.since : a.issuedAt;
        attestations[a.asset] = AttestState(a.regime, a.closeAt, a.nextOpen, a.issuedAt, since);
        emit Attested(a.asset, a.regime, a.closeAt, a.nextOpen, keeperSigner);
    }

    // ───────────────────────── premium index (FR-7) ─────────────────────────

    /// @dev Tightening above the calendar as a function of time τ — not of `block.timestamp` — so the accrual
    ///      integrand does not change once the tightening is gone (INV-7: `premiumIndex` is monotone and
    ///      independent of poke timing). An attestation is stored on-chain, so its window
    ///      [issuedAt, issuedAt + MAX_ATTESTATION_AGE) is exact and still counts after it stops being fresh.
    ///      A derived tightening (rule 3 / CORP_ACTION) depends on external state that cannot be reconstructed,
    ///      so it is persisted only by `_poke` and never enters a view.
    struct Tightening {
        Regime attested;
        uint64 attestedFrom;
        uint64 attestedUntil;
        Regime derived;
        uint64 derivedFrom;
    }

    function _tightening(address asset, uint64 from, bool withDerived) internal view returns (Tightening memory tg) {
        AttestState storage a = attestations[asset];
        if (a.issuedAt != 0) {
            tg.attested = Regime(a.regime);
            tg.attestedFrom = a.issuedAt;
            tg.attestedUntil = a.issuedAt + MAX_ATTESTATION_AGE;
        }
        if (withDerived && configs[asset].registered) {
            (Regime d, Session memory s, uint64 since) = _derived(asset);
            if (d > s.cal) {
                tg.derived = d;
                tg.derivedFrom = since > from ? since : from;
            }
        }
    }

    /// @dev Piecewise integration over the calendar segments since `from`; ≤ MAX_SEGMENTS segments per call.
    function _accrue(address asset, uint64 from, uint64 to, bool withDerived)
        internal
        view
        returns (uint256 acc, uint64 reached)
    {
        if (to <= from) return (0, from);
        Tightening memory tg = _tightening(asset, from, withDerived);
        uint64 t = from;
        for (uint256 i; i < MAX_SEGMENTS && t < to; ++i) {
            (uint256 add, uint64 end) = _segment(asset, t, to, tg);
            acc += add;
            t = end;
        }
        reached = t;
    }

    /// @dev Accrual of one calendar segment starting at `t` (cut at `to`): the regime at τ = max(calendar, the
    ///      tightening in force at τ), integrated per sub-interval between the tightening breakpoints.
    function _segment(address asset, uint64 t, uint64 to, Tightening memory tg)
        internal
        view
        returns (uint256 add, uint64 end)
    {
        Session memory s = calendar.sessionAt(t);
        end = s.segmentEnd < to ? s.segmentEnd : to;
        uint64 L = s.nextOpen - s.closeAt;
        uint64 x = t;
        while (x < end) {
            uint64 y = end;
            if (tg.attestedFrom > x && tg.attestedFrom < y) y = tg.attestedFrom;
            if (tg.attestedUntil > x && tg.attestedUntil < y) y = tg.attestedUntil;
            if (tg.derivedFrom > x && tg.derivedFrom < y) y = tg.derivedFrom;
            Regime r = s.cal;
            if (x >= tg.attestedFrom && x < tg.attestedUntil && tg.attested > r) r = tg.attested;
            if (x >= tg.derivedFrom && tg.derived > r) r = tg.derived;
            if (r != Regime.MARKET) add += risk.premiumRefRatePerSecond(asset, r, L) * (y - x);
            x = y;
        }
    }

    /// When the index was last persisted; `poke()` advances it by ≤ MAX_SEGMENTS segments per call.
    function lastPokeOf(address asset) external view returns (uint64) {
        return idx[asset].lastPoke;
    }

    function premiumIndex(address asset) external view returns (uint256) {
        IndexState storage st = idx[asset];
        (uint256 acc,) = _accrue(asset, st.lastPoke, uint64(block.timestamp), false);
        return st.index + acc;
    }

    function _poke(address asset) internal returns (bool advanced) {
        IndexState storage st = idx[asset];
        uint64 prev = st.lastPoke;
        (uint256 acc, uint64 reached) = _accrue(asset, prev, uint64(block.timestamp), true);
        st.index += acc;
        st.lastPoke = reached;
        AssetConfig storage c = configs[asset];
        uint256 eff = IStockToken(asset).effectiveAt();
        if (block.timestamp > eff + c.corpActionPost) st.lastMultiplier = IStockToken(asset).uiMultiplier();
        emit Poked(asset, st.index, reached);
        return reached >= prev + MIN_POKE_INTERVAL;
    }

    function poke(address asset) external {
        if (!configs[asset].registered) revert NotRegistered();
        bool advanced = _poke(asset);
        uint256 b = pokeBountyAmount;
        if (advanced && b != 0 && bountyPool[asset] >= b) {
            bountyPool[asset] -= b;
            bountyToken.safeTransfer(msg.sender, b);
        }
    }

    function fundBounty(address asset, uint256 amount) external {
        bountyToken.safeTransferFrom(msg.sender, address(this), amount);
        bountyPool[asset] += amount;
        emit BountyFunded(asset, amount);
    }
}
