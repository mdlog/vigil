// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Regime, Session, IVigilCalendar, IVigilSessionOracle, IVigilRiskEngine} from "./interfaces/IVigil.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";
import {IStockToken} from "./interfaces/IStockToken.sol";

/// @title VigilSessionOracle — rezim sesi per aset, kesegaran feed, attestation keeper, index premi (PRD §8.1).
/// @notice Kalender adalah sumber kebenaran; keeper hanya bisa memperketat dan tidak pernah bisa memicu
///         CORP_ACTION (satu-satunya rezim yang membuat oracle revert). Tanpa keeper, seluruh siklus harian
///         tetap berjalan dari kalender + kesegaran feed (G6).
contract VigilSessionOracle is IVigilSessionOracle, EIP712 {
    using SafeERC20 for IERC20;

    struct AssetConfig {
        address feed; // Chainlink AggregatorV3 (STOCK/USD)
        uint32 marketStaleSeconds; // diam selama ini saat MARKET → OVERNIGHT (rule 3). Per-aset: AAPL bisa diam 4+ jam normal.
        uint32 hardStaleMult; // hardStaleWindow = marketStaleSeconds × hardStaleMult
        uint32 corpActionPre; // detik sebelum effectiveAt
        uint32 corpActionPost; // detik sesudah effectiveAt
        uint16 corpActionJumpBps; // lompatan multiplier minimum yang dianggap corporate action (dividen kecil tidak memblokir oracle)
        bool registered;
    }

    struct Attestation {
        address asset;
        uint8 regime; // <= CLOSED
        uint64 closeAt; // <= closeAt kalender (halt ad-hoc)
        uint64 nextOpen; // >= nextOpen kalender
        uint64 issuedAt;
        uint64 deadline;
    }

    struct AttestState {
        uint8 regime;
        uint64 closeAt;
        uint64 nextOpen;
        uint64 issuedAt;
    }

    struct IndexState {
        uint256 index; // Σ π_ref × dt (WAD per unit notional)
        uint64 lastPoke;
        uint256 lastMultiplier; // uiMultiplier terakhir yang dilihat setelah jendela post effectiveAt
    }

    bytes32 public constant ATTESTATION_TYPEHASH = keccak256(
        "Attestation(address asset,uint8 regime,uint64 closeAt,uint64 nextOpen,uint64 issuedAt,uint64 deadline)"
    );
    uint64 public constant MAX_ATTESTATION_AGE = 30 minutes;
    uint64 public constant MAX_CLOSED_HORIZON = 5 days;
    uint64 public constant MIN_POKE_INTERVAL = 15 minutes;
    uint256 internal constant MAX_SEGMENTS = 128; // ≈ 4 minggu segmen kalender tanpa poke

    IVigilCalendar public immutable calendar;
    IERC20 public immutable bountyToken; // USDG
    IVigilRiskEngine public risk; // one-shot init (ketergantungan melingkar dengan RiskEngine)
    address public guardian;
    address public keeperSigner;
    uint256 public pokeBountyAmount;

    mapping(address => AssetConfig) public configs;
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
    error RegimeTooTight(); // keeper mencoba CORP_ACTION
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

    // ───────────────────────── kendali ─────────────────────────

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

    /// Konfigurasi per aset immutable setelah registrasi (prinsip §7.2).
    function registerAsset(address asset, AssetConfig calldata cfg) external onlyGuardian {
        if (configs[asset].registered) revert AlreadySet();
        configs[asset] = cfg;
        configs[asset].registered = true;
        idx[asset].lastPoke = uint64(block.timestamp);
        idx[asset].lastMultiplier = IStockToken(asset).uiMultiplier();
        emit AssetRegistered(asset, cfg.feed);
    }

    function isRegistered(address asset) external view returns (bool) {
        return configs[asset].registered;
    }

    function feedOf(address asset) external view returns (address) {
        return configs[asset].feed;
    }

    // ───────────────────────── derivasi trustless ─────────────────────────

    function _feedUpdatedAt(address feed) internal view returns (uint256 updatedAt) {
        (,,, updatedAt,) = IAggregatorV3(feed).latestRoundData();
    }

    function _jumpBps(uint256 a, uint256 b) internal pure returns (uint256) {
        if (a == 0) return 0;
        uint256 d = a > b ? a - b : b - a;
        return d * 10_000 / a;
    }

    /// @dev Rule 1–4 §8.1. CORP_ACTION hanya dari token: oraclePaused(), atau jendela effectiveAt dengan lompatan
    ///      multiplier ≥ corpActionJumpBps (pre: pending vs current; post: current vs lastMultiplier — V10b).
    /// @return derived rezim hasil derivasi; @return s potret kalender; @return since sejak kapan pengetatan
    ///         derived (di atas kalender) berlaku — dipakai index premi agar akrual presisi.
    function _derived(address asset) internal view returns (Regime derived, Session memory s, uint64 since) {
        AssetConfig storage c = configs[asset];
        if (!c.registered) revert NotRegistered();
        s = calendar.sessionAt(uint64(block.timestamp));
        IStockToken t = IStockToken(asset);
        if (t.oraclePaused()) return (Regime.CORP_ACTION, s, 0);
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
            // Diam diukur sejak max(updatedAt, lastOpen): feed yang beku sejak Jumat mendapat masa tenggang
            // baru pada 09:30 Senin, bukan langsung dianggap rusak saat open.
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

    /// @dev effective = max(derived, attested); closeAt = min; nextOpen = max — keeper hanya memperketat (FR-3).
    function _effective(address asset)
        internal
        view
        returns (Regime effective, Session memory s, uint64 closeAt, uint64 nextOpen)
    {
        (effective, s, closeAt, nextOpen,) = _effectiveSince(asset);
    }

    /// @dev Seperti _effective, plus `tightSince`: awal berlakunya rezim efektif bila lebih ketat dari kalender.
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
            // Rezim attested berlaku sejak closeAt-nya (halt terjadwal); sebelum itu hanya jadwal tutup yang berubah,
            // sehingga haircut di-ramp menuju halt sejak attestation diterbitkan — tidak pernah step.
            if (block.timestamp >= a.closeAt && Regime(a.regime) > effective) {
                effective = Regime(a.regime);
                tightSince = a.issuedAt;
            }
            if (a.closeAt < closeAt) {
                closeAt = a.closeAt;
                tightSince = a.issuedAt;
            }
            if (a.nextOpen > nextOpen) nextOpen = a.nextOpen;
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

    /// @dev FR-16/17: stale yang DIHARAPKAN (feed beku selama penutupan) ≠ stale TAK TERDUGA.
    function feedIsUsable(address asset) external view returns (bool) {
        (, Session memory s, uint64 closeAt,) = _effective(asset);
        AssetConfig storage c = configs[asset];
        uint256 updatedAt = _feedUpdatedAt(c.feed);
        uint256 hard = uint256(c.marketStaleSeconds) * c.hardStaleMult;
        if (s.cal == Regime.MARKET) {
            // pasar seharusnya buka: diam lebih dari hardStaleWindow sejak max(updatedAt, lastOpen) = rusak
            uint256 ref = updatedAt < s.lastOpen ? s.lastOpen : updatedAt;
            return block.timestamp - ref <= hard;
        }
        // pasar tutup (kalender atau halt keeper): harga terakhir tidak boleh lebih tua dari closeAt − hardStaleWindow
        return updatedAt + hard >= closeAt;
    }

    // ───────────────────────── attestation keeper ─────────────────────────

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
        if (a.closeAt < s.closeAt && a.regime < uint8(Regime.EXTENDED)) revert NotTightening(); // halt harus menamai rezim tertutup
        if (a.closeAt + MAX_CLOSED_HORIZON < block.timestamp) revert NotTightening();
        if (a.nextOpen > a.closeAt + MAX_CLOSED_HORIZON) revert HorizonTooFar();
        _poke(a.asset); // akru rezim lama sampai sekarang sebelum pengetatan berlaku
        attestations[a.asset] = AttestState(a.regime, a.closeAt, a.nextOpen, a.issuedAt);
        emit Attested(a.asset, a.regime, a.closeAt, a.nextOpen, keeperSigner);
    }

    // ───────────────────────── index premi (FR-7) ─────────────────────────

    /// @dev Pengetatan di atas kalender sebagai fungsi waktu τ — bukan `block.timestamp` — agar integrand akrual
    ///      tidak berubah setelah pengetatannya lenyap (INV-7: `premiumIndex` monoton, bebas timing poke).
    ///      Attestation tersimpan on-chain → jendelanya [issuedAt, issuedAt + MAX_ATTESTATION_AGE) eksak, berlaku
    ///      juga setelah tidak lagi segar. Pengetatan turunan (rule 3 / CORP_ACTION) bergantung state eksternal
    ///      yang tidak bisa direkonstruksi → hanya dipersistenkan saat `_poke`, tidak pernah masuk view.
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

    /// @dev Integrasi piecewise atas segmen kalender sejak `from`; ≤ MAX_SEGMENTS segmen per panggilan.
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

    /// @dev Akrual satu segmen kalender mulai `t` (dipotong pada `to`): rezim pada τ = max(kalender, pengetatan
    ///      yang berlaku pada τ), diintegrasikan per sub-interval di antara titik potong pengetatan.
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

    /// Waktu terakhir index dipersistenkan; `poke()` memajukannya ≤ MAX_SEGMENTS segmen per panggilan.
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
