// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Id} from "morpho-blue/interfaces/IMorpho.sol";

/// Urutan penting: makin besar makin ketat. Keeper hanya boleh menaikkan sampai CLOSED (FR-33).
enum Regime {
    MARKET,
    EXTENDED,
    OVERNIGHT,
    CLOSED,
    CORP_ACTION
}

/// Potret kalender pada satu timestamp (PRD §8.0).
struct Session {
    Regime cal;
    uint64 closeAt; // akhir sesi MARKET terakhir; jika sedang MARKET: akhir sesi ini (penutupan berikutnya)
    uint64 nextOpen; // awal sesi MARKET berikutnya
    uint64 lastOpen; // awal sesi MARKET saat ini (MARKET) / sesi yang berakhir di closeAt (lainnya)
    uint64 prevClose; // MARKET: akhir sesi sebelumnya (untuk ramp-out); lainnya: = closeAt
    uint64 segmentEnd; // batas berikutnya di mana rezim kalender berubah
}

interface IVigilCalendar {
    function sessionAt(uint64 ts) external view returns (Session memory);
    function isTradingDay(uint32 etDay) external view returns (bool);
    function etDayOf(uint64 ts) external pure returns (uint32 day, uint32 tod);
}

interface IVigilSessionOracle {
    function regimeOf(address asset)
        external
        view
        returns (Regime effective, Regime cal, uint64 closeAt, uint64 nextOpen);
    /// @dev tightSince = awal berlakunya pengetatan di atas kalender (attestation/derived); 0 jika murni kalender
    function closureOf(address asset)
        external
        view
        returns (uint64 closeAt, uint64 nextOpen, bool inClosure, uint64 lastOpen, uint64 prevClose, uint64 tightSince);
    function feedIsUsable(address asset) external view returns (bool);
    function premiumIndex(address asset) external view returns (uint256);
    function poke(address asset) external;
    function lastPokeOf(address asset) external view returns (uint64);
    function fundBounty(address asset, uint256 amount) external;
    function feedOf(address asset) external view returns (address);
    function calendar() external view returns (IVigilCalendar);
    function isRegistered(address asset) external view returns (bool);
}

interface IVigilRiskEngine {
    function haircutBps(address asset) external view returns (uint16);
    function targetHaircutBps(address asset) external view returns (uint16);
    function premiumRefRatePerSecond(address asset, Regime regime, uint64 closureLen) external view returns (uint256);
    function bufferMultiplierWad(address asset, uint256 bufferBps) external view returns (uint256);
    function preCloseWindow() external view returns (uint64);
    function eventActive(address asset, uint64 ts) external view returns (bool);
}

interface IVigilOracle {
    function price() external view returns (uint256);
    function unhaircutPrice() external view returns (uint256);
    function currentHaircutBps() external view returns (uint16);
    function regime() external view returns (uint8);
    function STOCK_TOKEN() external view returns (address);
    function MARKET_HAIRCUT_CAP_BPS() external view returns (uint16);
}

interface IVigilPremium {
    function isDelinquent(Id marketId, address borrower) external view returns (bool);
    function isMember(Id marketId, address borrower) external view returns (bool);
    function delinquentSince(Id marketId, address borrower) external view returns (uint64);
}

interface IVigilBackstop {
    function coverBadDebt(Id marketId, uint256 amount) external returns (uint256 covered);
    function coverageCap(Id marketId) external view returns (uint256);
    function asset() external view returns (address);
}
