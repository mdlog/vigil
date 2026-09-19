// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Regime, Session, IVigilSessionOracle, IVigilRiskEngine} from "./interfaces/IVigil.sol";

/// @title VigilRiskEngine — per-asset risk surface: a ramped haircut as a function of the closure length L,
///        scheduled events, the reference premium table π_ref(L) and the buffer multiplier m(b) (PRD §6, §8.2).
/// @notice Calibrated off-chain; on-chain there is only lookup + interpolation, bounded and rate-limited. Every
///         ramp is computed purely from time (no transactions), so the price path never has a step (FR-9).
contract VigilRiskEngine is IVigilRiskEngine {
    struct Surface {
        uint64 sigmaGapWad; // close-to-open σ of a regular session (WAD)
        uint32 kTailBps; // tail multiplier, 1e4 = 1.0 (NVDA: 30_000)
        uint16 hFloorBps;
        uint16 hMaxBps;
        uint64 updatedAt;
    }

    struct ScheduledEvent {
        uint64 from;
        uint64 until;
        uint16 multBps; // 1e4 = 1.0; <= EVENT_MULT_MAX
    }

    /// π_ref per second (WAD over the debt notional) at b_ref, on a grid of L buckets (monotonically increasing).
    struct PremiumTable {
        uint64[4] lBucket;
        uint128[4] rateNoEvent;
        uint128[4] rateEvent;
    }

    /// Multiplier m(b): interpolated over b buckets (bps, increasing); mult decreases monotonically; m(b_ref) = 1e18.
    struct BufferTable {
        uint16[6] bBps;
        uint128[6] multWad;
    }

    uint16 public constant GLOBAL_H_MAX = 2_500;
    uint16 public constant MAX_DELTA_BPS = 200;
    uint64 public constant MIN_UPDATE_INTERVAL = 1 hours;
    uint64 public constant RAMP_SECONDS = 3_600;
    uint64 public constant PRE_CLOSE_WINDOW = 5_400;
    uint64 public constant EVENT_LEAD_TIME = 24 hours;
    uint64 public constant EVENT_MAX_LENGTH = 5 days;
    uint16 public constant EVENT_MULT_MAX = 50_000; // 5×
    uint32 public constant K_MAX_BPS = 100_000; // 10×
    uint64 public constant TAU_NIGHT = 63_000;
    uint64 public constant L_WEEKEND = 235_800;
    uint256 public constant PREMIUM_MAX_PER_SECOND = 1e12; // ≈ 8.6 %/day of the debt — hard cap
    uint256 public constant MULT_MAX = 20e18;
    uint256 internal constant WAD = 1e18;
    uint256 internal constant BPS = 10_000;

    IVigilSessionOracle public immutable SESSION;
    address public calibrator;
    address public guardian;

    mapping(address => Surface) public surfaces;
    mapping(address => Surface) public prevSurfaces;
    mapping(address => uint64) public rampStart;
    mapping(address => ScheduledEvent) public events;
    mapping(address => PremiumTable) internal premiumTables;
    mapping(address => BufferTable) internal bufferTables;
    mapping(address => bool) public hasPremiumTable;
    mapping(address => bool) public hasBufferTable;

    event SurfaceUpdated(address indexed asset, uint64 sigmaGapWad, uint32 kTailBps, uint16 hFloorBps, uint16 hMaxBps);
    event RampStarted(address indexed asset, uint256 fromBps, uint256 toBps, uint64 rampEnd);
    event EventScheduled(address indexed asset, uint64 from, uint64 until, uint16 multBps);
    event PremiumTablesUpdated(address indexed asset);
    event RolesSet(address calibrator, address guardian);

    error NotCalibrator();
    error NotGuardian();
    error AboveGlobalMax();
    error BadSurface();
    error DeltaTooLarge();
    error TooFrequent();
    error LeadTimeTooShort();
    error BadEvent();
    error EventInProgress();
    error BadTable();

    constructor(IVigilSessionOracle session, address calibrator_, address guardian_) {
        SESSION = session;
        calibrator = calibrator_;
        guardian = guardian_;
    }

    modifier onlyCalibrator() {
        if (msg.sender != calibrator) revert NotCalibrator();
        _;
    }

    function setRoles(address calibrator_, address guardian_) external {
        if (msg.sender != guardian) revert NotGuardian();
        calibrator = calibrator_;
        guardian = guardian_;
        emit RolesSet(calibrator_, guardian_);
    }

    // ───────────────────────── calibration (guarded) ─────────────────────────

    function setSurface(address asset, Surface calldata s) external onlyCalibrator {
        if (s.hMaxBps > GLOBAL_H_MAX) revert AboveGlobalMax();
        if (s.hFloorBps > s.hMaxBps || s.kTailBps > K_MAX_BPS || s.sigmaGapWad > WAD) revert BadSurface();
        Surface memory old = surfaces[asset];
        if (old.updatedAt != 0) {
            if (block.timestamp - old.updatedAt < MIN_UPDATE_INTERVAL) revert TooFrequent();
            uint256 hOld = closureHaircutBps(old, L_WEEKEND, BPS);
            uint256 hNew = closureHaircutBps(s, L_WEEKEND, BPS);
            uint256 d = hOld > hNew ? hOld - hNew : hNew - hOld;
            if (d > MAX_DELTA_BPS) revert DeltaTooLarge();
            prevSurfaces[asset] = old;
            rampStart[asset] = uint64(block.timestamp); // MIN_UPDATE_INTERVAL >= RAMP_SECONDS → the previous ramp has finished
            emit RampStarted(asset, hOld, hNew, uint64(block.timestamp) + RAMP_SECONDS);
        }
        surfaces[asset] = s;
        surfaces[asset].updatedAt = uint64(block.timestamp);
        emit SurfaceUpdated(asset, s.sigmaGapWad, s.kTailBps, s.hFloorBps, s.hMaxBps);
    }

    /// An event (earnings / scheduled corporate action) must be announced ≥ EVENT_LEAD_TIME ahead; it has its own ramp.
    function scheduleEvent(address asset, ScheduledEvent calldata e) external onlyCalibrator {
        if (e.from < block.timestamp + EVENT_LEAD_TIME) revert LeadTimeTooShort();
        if (e.until <= e.from || e.until - e.from > EVENT_MAX_LENGTH) revert BadEvent();
        if (e.multBps < BPS || e.multBps > EVENT_MULT_MAX) revert BadEvent();
        ScheduledEvent memory cur = events[asset];
        if (
            cur.until != 0 && block.timestamp + RAMP_SECONDS < cur.until + RAMP_SECONDS
                && block.timestamp + RAMP_SECONDS >= cur.from - RAMP_SECONDS
        ) {
            revert EventInProgress();
        }
        events[asset] = e;
        emit EventScheduled(asset, e.from, e.until, e.multBps);
    }

    function setPremiumTables(address asset, PremiumTable calldata p, BufferTable calldata b) external onlyCalibrator {
        for (uint256 i; i < 4; ++i) {
            if (p.rateNoEvent[i] > PREMIUM_MAX_PER_SECOND || p.rateEvent[i] > PREMIUM_MAX_PER_SECOND) {
                revert BadTable();
            }
            if (i > 0 && p.lBucket[i] <= p.lBucket[i - 1]) revert BadTable();
        }
        for (uint256 i; i < 6; ++i) {
            if (b.multWad[i] > MULT_MAX) revert BadTable();
            if (i > 0 && (b.bBps[i] <= b.bBps[i - 1] || b.multWad[i] > b.multWad[i - 1])) revert BadTable();
        }
        premiumTables[asset] = p;
        bufferTables[asset] = b;
        hasPremiumTable[asset] = true;
        hasBufferTable[asset] = true;
        emit PremiumTablesUpdated(asset);
    }

    // ───────────────────────── haircut ─────────────────────────

    function sqrt(uint256 x) internal pure returns (uint256 y) {
        if (x == 0) return 0;
        uint256 z = (x + 1) / 2;
        y = x;
        while (z < y) {
            y = z;
            z = (x / z + z) / 2;
        }
    }

    /// @dev H(L) = clamp(H_floor + k × σ_gap × eventMult × sqrt(L/τ_night), H_floor, min(H_max, GLOBAL_H_MAX)). Monotone in L (INV-2).
    function closureHaircutBps(Surface memory sf, uint64 L, uint256 eventMultBps) public pure returns (uint256 h) {
        uint256 scaleWad = sqrt(uint256(L) * WAD * WAD / TAU_NIGHT);
        uint256 sigmaEffWad = uint256(sf.sigmaGapWad) * eventMultBps / BPS * scaleWad / WAD;
        uint256 sigmaEffBps = sigmaEffWad / 1e14;
        h = uint256(sf.hFloorBps) + uint256(sf.kTailBps) * sigmaEffBps / BPS;
        uint256 cap = sf.hMaxBps < GLOBAL_H_MAX ? sf.hMaxBps : GLOBAL_H_MAX;
        if (h > cap) h = cap;
        if (h < sf.hFloorBps) h = sf.hFloorBps;
    }

    /// Event multiplier at time ts, ramped in (1 h before `from`) and out (1 h after `until`).
    function eventMultBpsAt(address asset, uint64 ts) public view returns (uint256) {
        ScheduledEvent memory e = events[asset];
        if (e.until == 0) return BPS;
        if (ts >= e.from && ts <= e.until) return e.multBps;
        if (ts < e.from && ts + RAMP_SECONDS >= e.from) {
            return BPS + (uint256(e.multBps) - BPS) * (ts + RAMP_SECONDS - e.from) / RAMP_SECONDS;
        }
        if (ts > e.until && ts - e.until < RAMP_SECONDS) {
            return uint256(e.multBps) - (uint256(e.multBps) - BPS) * (ts - e.until) / RAMP_SECONDS;
        }
        return BPS;
    }

    function eventActive(address asset, uint64 ts) external view returns (bool) {
        ScheduledEvent memory e = events[asset];
        return e.until != 0 && ts >= e.from && ts <= e.until;
    }

    /// @dev The shape of the haircut at `now`, as WAD ramp factors:
    ///      (fIn, L)        — the active/approaching CALENDAR closure, ramped from closeAt − PRE_CLOSE_WINDOW;
    ///      (fTight, Lt)    — the EFFECTIVE closure when it is tighter (keeper attestation / rule 3), ramped from
    ///                        `tightSince`; it only ever ADDS on top of the calendar shape, never subtracts
    ///                        (found by the fuzzer: a ramp restarted from zero at an attestation made the price
    ///                        jump up and then drop 500 bps when the calendar caught up — INV-3);
    ///      (fOut, Lprev)   — the ramp-out of the previous closure after the open.
    function _calShape(address asset)
        internal
        view
        returns (uint256 fIn, uint64 L, uint256 fTight, uint64 Lt, uint256 fOut, uint64 Lprev)
    {
        (uint64 closeAt, uint64 nextOpen, bool inClosure, uint64 lastOpen, uint64 prevClose, uint64 tightSince) =
            SESSION.closureOf(asset);
        Session memory cs = SESSION.calendar().sessionAt(uint64(block.timestamp));
        uint64 now_ = uint64(block.timestamp);
        // 1) calendar only
        if (cs.cal != Regime.MARKET) {
            L = cs.nextOpen - cs.closeAt;
            fIn = _ramp(now_, cs.closeAt > PRE_CLOSE_WINDOW ? cs.closeAt - PRE_CLOSE_WINDOW : 0);
        } else {
            if (
                cs.lastOpen != 0 && now_ >= cs.lastOpen && now_ - cs.lastOpen < RAMP_SECONDS
                    && cs.lastOpen > cs.prevClose
            ) {
                Lprev = cs.lastOpen - cs.prevClose;
                fOut = WAD - (uint256(now_ - cs.lastOpen) * WAD) / RAMP_SECONDS;
            }
            if (cs.closeAt > now_ && cs.closeAt - now_ <= PRE_CLOSE_WINDOW) {
                L = cs.nextOpen - cs.closeAt;
                fIn = _ramp(now_, cs.closeAt - PRE_CLOSE_WINDOW);
            }
        }
        // 2) effective tightening above the calendar (earlier halt, later open, tighter regime)
        bool tighter = inClosure && (cs.cal == Regime.MARKET || closeAt != cs.closeAt || nextOpen != cs.nextOpen);
        bool haltAhead = !inClosure && closeAt > now_ && closeAt < cs.closeAt && closeAt - now_ <= PRE_CLOSE_WINDOW;
        if (tighter || haltAhead) {
            Lt = nextOpen - closeAt;
            uint64 start = closeAt > PRE_CLOSE_WINDOW ? closeAt - PRE_CLOSE_WINDOW : 0;
            if (tightSince > start) start = tightSince; // a keeper halt / rule 3 ramps from the moment it takes effect
            fTight = _ramp(now_, start);
        }
        lastOpen;
        prevClose;
    }

    function _ramp(uint64 now_, uint64 start) internal pure returns (uint256) {
        if (now_ <= start) return 0;
        return now_ - start >= RAMP_SECONDS ? WAD : (uint256(now_ - start) * WAD) / RAMP_SECONDS;
    }

    function _shapedHaircut(
        Surface memory sf,
        uint256 fIn,
        uint64 L,
        uint256 fTight,
        uint64 Lt,
        uint256 fOut,
        uint64 Lprev,
        uint256 mult
    ) internal pure returns (uint256 h) {
        if (fIn != 0) h = closureHaircutBps(sf, L, mult) * fIn / WAD;
        if (fTight != 0) {
            // tightening = a ramped increment ON TOP OF the calendar level: h_cal + (H_tight − h_cal)·f
            uint256 ht = closureHaircutBps(sf, Lt, mult);
            if (ht > h) h += (ht - h) * fTight / WAD;
        }
        if (fOut != 0) {
            uint256 hp = closureHaircutBps(sf, Lprev, mult) * fOut / WAD;
            if (hp > h) h = hp;
        }
    }

    /// The unramped target: H(L) while closed or inside preCloseWindow, otherwise 0.
    function targetHaircutBps(address asset) external view returns (uint16) {
        Surface memory sf = surfaces[asset];
        if (sf.updatedAt == 0) return 0;
        (uint64 closeAt, uint64 nextOpen, bool inClosure,,,) = SESSION.closureOf(asset);
        if (!inClosure && (closeAt <= block.timestamp || closeAt - block.timestamp > PRE_CLOSE_WINDOW)) return 0;
        return uint16(closureHaircutBps(sf, nextOpen - closeAt, eventMultBpsAt(asset, uint64(block.timestamp))));
    }

    /// The reported haircut (already ramped against the calendar, events and surface changes).
    function haircutBps(address asset) external view returns (uint16) {
        Surface memory sf = surfaces[asset];
        if (sf.updatedAt == 0) return 0;
        (uint256 fIn, uint64 L, uint256 fTight, uint64 Lt, uint256 fOut, uint64 Lprev) = _calShape(asset);
        if (fIn == 0 && fTight == 0 && fOut == 0) return 0;
        uint256 mult = eventMultBpsAt(asset, uint64(block.timestamp));
        uint256 h = _shapedHaircut(sf, fIn, L, fTight, Lt, fOut, Lprev, mult);
        uint64 rs = rampStart[asset];
        if (rs != 0 && block.timestamp - rs < RAMP_SECONDS) {
            uint256 hp = _shapedHaircut(prevSurfaces[asset], fIn, L, fTight, Lt, fOut, Lprev, mult);
            uint256 p = (block.timestamp - rs) * WAD / RAMP_SECONDS;
            h = hp + (h * p) / WAD - (hp * p) / WAD; // lerp without underflow
        }
        if (h > GLOBAL_H_MAX) h = GLOBAL_H_MAX;
        return uint16(h);
    }

    // ───────────────────────── premium ─────────────────────────

    function _interp(uint256 x, uint256 x0, uint256 x1, uint256 y0, uint256 y1) internal pure returns (uint256) {
        if (x <= x0) return y0;
        if (x >= x1) return y1;
        if (y1 >= y0) return y0 + (y1 - y0) * (x - x0) / (x1 - x0);
        return y0 - (y0 - y1) * (x - x0) / (x1 - x0);
    }

    function premiumRefRatePerSecond(address asset, Regime regime, uint64 closureLen) external view returns (uint256) {
        if (regime == Regime.MARKET || !hasPremiumTable[asset]) return 0;
        PremiumTable storage t = premiumTables[asset];
        ScheduledEvent memory e = events[asset];
        bool ev = e.until != 0 && block.timestamp >= e.from && block.timestamp <= e.until;
        uint256 L = closureLen;
        if (L <= t.lBucket[0]) return ev ? t.rateEvent[0] : t.rateNoEvent[0];
        for (uint256 i = 1; i < 4; ++i) {
            if (L <= t.lBucket[i]) {
                return ev
                    ? _interp(L, t.lBucket[i - 1], t.lBucket[i], t.rateEvent[i - 1], t.rateEvent[i])
                    : _interp(L, t.lBucket[i - 1], t.lBucket[i], t.rateNoEvent[i - 1], t.rateNoEvent[i]);
            }
        }
        return ev ? t.rateEvent[3] : t.rateNoEvent[3];
    }

    function bufferMultiplierWad(address asset, uint256 bufferBps) external view returns (uint256) {
        if (!hasBufferTable[asset]) return WAD;
        BufferTable storage b = bufferTables[asset];
        if (bufferBps <= b.bBps[0]) return b.multWad[0];
        for (uint256 i = 1; i < 6; ++i) {
            if (bufferBps <= b.bBps[i]) {
                return _interp(bufferBps, b.bBps[i - 1], b.bBps[i], b.multWad[i - 1], b.multWad[i]);
            }
        }
        return b.multWad[5];
    }

    function preCloseWindow() external pure returns (uint64) {
        return PRE_CLOSE_WINDOW;
    }
}
