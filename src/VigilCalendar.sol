// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Regime, Session, IVigilCalendar} from "./interfaces/IVigil.sol";

/// @title VigilCalendar — kalender sesi bursa AS (ET) yang deterministik dari block.timestamp (PRD §8.0, FR-32).
/// @notice Transisi DST 2022–2030 di-hardcode (D11). Libur/early-close hanya bisa DITAMBAH oleh guardian untuk
///         tanggal > hari ini + 7 (memperketat), tidak pernah dihapus. Di luar tabel DST diperlakukan sebagai EST.
contract VigilCalendar is IVigilCalendar {
    uint32 public constant MARKET_OPEN = 34_200; // 09:30 ET
    uint32 public constant MARKET_CLOSE = 57_600; // 16:00 ET
    uint32 public constant HALF_CLOSE = 46_800; // 13:00 ET (early close)
    uint32 public constant EXT_OPEN = 14_400; // 04:00 ET (pre-market)
    uint32 public constant EXT_CLOSE = 72_000; // 20:00 ET (akhir post-market)
    uint32 internal constant DAY = 86_400;
    uint64 internal constant EST_OFFSET = 5 hours;
    uint64 internal constant EDT_OFFSET = 4 hours;

    uint8 public constant KIND_OPEN = 0;
    uint8 public constant KIND_CLOSED = 1;
    uint8 public constant KIND_HALF = 2;

    address public guardian;
    /// indeks hari ET (hari sejak 1970-01-01, tanggal ET) → jenis hari
    mapping(uint32 => uint8) public dayKind;

    event HolidayAdded(uint32 indexed etDay, uint8 kind);
    event GuardianSet(address indexed guardian);

    error NotGuardian();
    error TooSoon();
    error BadKind();
    error CannotLoosen();

    constructor(address guardian_, uint32[] memory closedDays, uint32[] memory halfDays) {
        guardian = guardian_;
        for (uint256 i; i < closedDays.length; ++i) {
            dayKind[closedDays[i]] = KIND_CLOSED;
        }
        for (uint256 i; i < halfDays.length; ++i) {
            dayKind[halfDays[i]] = KIND_HALF;
        }
    }

    // ───────────────────────── kendali (hanya memperketat) ─────────────────────────

    function addHoliday(uint32 etDay, uint8 kind) external {
        if (msg.sender != guardian) revert NotGuardian();
        if (kind != KIND_CLOSED && kind != KIND_HALF) revert BadKind();
        (uint32 today,) = etDayOf(uint64(block.timestamp));
        if (etDay <= today + 7) revert TooSoon();
        if (dayKind[etDay] == KIND_CLOSED) revert CannotLoosen();
        dayKind[etDay] = kind;
        emit HolidayAdded(etDay, kind);
    }

    function setGuardian(address g) external {
        if (msg.sender != guardian) revert NotGuardian();
        guardian = g;
        emit GuardianSet(g);
    }

    // ───────────────────────── waktu ET ─────────────────────────

    /// @dev Awal DST = Minggu ke-2 Maret 02:00 EST (07:00 UTC); akhir = Minggu ke-1 November 02:00 EDT (06:00 UTC).
    function isDst(uint64 utc) public pure returns (bool) {
        if (utc < 1647154800) return false;
        if (utc < 1667714400) return true; // 2022
        if (utc < 1678604400) return false;
        if (utc < 1699164000) return true; // 2023
        if (utc < 1710054000) return false;
        if (utc < 1730613600) return true; // 2024
        if (utc < 1741503600) return false;
        if (utc < 1762063200) return true; // 2025
        if (utc < 1772953200) return false;
        if (utc < 1793512800) return true; // 2026
        if (utc < 1805007600) return false;
        if (utc < 1825567200) return true; // 2027
        if (utc < 1836457200) return false;
        if (utc < 1857016800) return true; // 2028
        if (utc < 1867906800) return false;
        if (utc < 1888466400) return true; // 2029
        if (utc < 1899356400) return false;
        if (utc < 1919916000) return true; // 2030
        return false;
    }

    function etOffset(uint64 utc) public pure returns (uint64) {
        return isDst(utc) ? EDT_OFFSET : EST_OFFSET;
    }

    /// @return day indeks hari ET; @return tod detik sejak tengah malam ET
    function etDayOf(uint64 utc) public pure returns (uint32 day, uint32 tod) {
        uint64 et = utc - etOffset(utc);
        day = uint32(et / DAY);
        tod = uint32(et % DAY);
    }

    /// @dev Batas sesi tidak pernah jatuh pada 02:00 (jam transisi DST), sehingga pemetaan ini tidak ambigu.
    function toUtc(uint32 day, uint32 tod) public pure returns (uint64) {
        uint64 est = uint64(day) * DAY + tod + EST_OFFSET;
        return isDst(est) ? est - 1 hours : est;
    }

    // ───────────────────────── hari perdagangan ─────────────────────────

    function isTradingDay(uint32 day) public view returns (bool) {
        uint8 dow = uint8((day + 3) % 7); // 0 = Senin (1970-01-01 adalah Kamis)
        return dow < 5 && dayKind[day] != KIND_CLOSED;
    }

    function closeTodOf(uint32 day) public view returns (uint32) {
        return dayKind[day] == KIND_HALF ? HALF_CLOSE : MARKET_CLOSE;
    }

    function nextTradingDay(uint32 day) public view returns (uint32 d) {
        d = day + 1;
        while (!isTradingDay(d)) ++d;
    }

    function prevTradingDay(uint32 day) public view returns (uint32 d) {
        d = day - 1;
        while (!isTradingDay(d)) --d;
    }

    // ───────────────────────── sesi ─────────────────────────

    function sessionAt(uint64 ts) public view returns (Session memory s) {
        (uint32 day, uint32 tod) = etDayOf(ts);
        if (isTradingDay(day)) {
            uint32 closeTod = closeTodOf(day);
            if (tod >= MARKET_OPEN && tod < closeTod) {
                uint32 p = prevTradingDay(day);
                s.cal = Regime.MARKET;
                s.closeAt = toUtc(day, closeTod);
                s.nextOpen = toUtc(nextTradingDay(day), MARKET_OPEN);
                s.lastOpen = toUtc(day, MARKET_OPEN);
                s.prevClose = toUtc(p, closeTodOf(p));
                s.segmentEnd = s.closeAt;
            } else if (tod >= EXT_OPEN && tod < MARKET_OPEN) {
                uint32 p = prevTradingDay(day);
                s.cal = Regime.EXTENDED; // pre-market
                s.closeAt = toUtc(p, closeTodOf(p));
                s.nextOpen = toUtc(day, MARKET_OPEN);
                s.lastOpen = toUtc(p, MARKET_OPEN);
                s.prevClose = s.closeAt;
                s.segmentEnd = s.nextOpen;
            } else if (tod >= closeTod && tod < EXT_CLOSE) {
                s.cal = Regime.EXTENDED; // post-market
                s.closeAt = toUtc(day, closeTod);
                s.nextOpen = toUtc(nextTradingDay(day), MARKET_OPEN);
                s.lastOpen = toUtc(day, MARKET_OPEN);
                s.prevClose = s.closeAt;
                s.segmentEnd = toUtc(day, EXT_CLOSE);
            } else if (tod >= EXT_CLOSE) {
                uint32 n = nextTradingDay(day);
                s.cal = (n == day + 1) ? Regime.OVERNIGHT : Regime.CLOSED;
                s.closeAt = toUtc(day, closeTod);
                s.nextOpen = toUtc(n, MARKET_OPEN);
                s.lastOpen = toUtc(day, MARKET_OPEN);
                s.prevClose = s.closeAt;
                s.segmentEnd = toUtc(n, EXT_OPEN);
            } else {
                uint32 p = prevTradingDay(day);
                s.cal = (p == day - 1) ? Regime.OVERNIGHT : Regime.CLOSED; // dini hari
                s.closeAt = toUtc(p, closeTodOf(p));
                s.nextOpen = toUtc(day, MARKET_OPEN);
                s.lastOpen = toUtc(p, MARKET_OPEN);
                s.prevClose = s.closeAt;
                s.segmentEnd = toUtc(day, EXT_OPEN);
            }
            return s;
        }
        uint32 p2 = prevTradingDay(day);
        uint32 n2 = nextTradingDay(day);
        s.cal = Regime.CLOSED;
        s.closeAt = toUtc(p2, closeTodOf(p2));
        s.nextOpen = toUtc(n2, MARKET_OPEN);
        s.lastOpen = toUtc(p2, MARKET_OPEN);
        s.prevClose = s.closeAt;
        s.segmentEnd = toUtc(n2, EXT_OPEN);
    }
}
