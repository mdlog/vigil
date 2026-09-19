// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {VigilCalendar} from "../../src/VigilCalendar.sol";
import {VigilSessionOracle} from "../../src/VigilSessionOracle.sol";
import {MockStockToken} from "../../src/mocks/MockStockToken.sol";
import {MockFeed} from "../../src/mocks/MockFeed.sol";
import {MockUSDG} from "../../src/mocks/MockUSDG.sol";
import {Regime, Session, IVigilRiskEngine} from "../../src/interfaces/IVigil.sol";
import {CalendarFixture} from "../CalendarFixture.sol";

/// Risk engine tiruan: rate per detik konstan per rezim (WAD/detik atas notional).
contract MockRisk is IVigilRiskEngine {
    function haircutBps(address) external pure returns (uint16) {
        return 0;
    }

    function targetHaircutBps(address) external pure returns (uint16) {
        return 0;
    }

    function premiumRefRatePerSecond(address, Regime r, uint64) external pure returns (uint256) {
        if (r == Regime.MARKET) return 0;
        if (r == Regime.EXTENDED) return 1e9;
        if (r == Regime.OVERNIGHT) return 2e9;
        return 4e9; // CLOSED / CORP_ACTION
    }

    function bufferMultiplierWad(address, uint256) external pure returns (uint256) {
        return 1e18;
    }

    function preCloseWindow() external pure returns (uint64) {
        return 5400;
    }

    function eventActive(address, uint64) external pure returns (bool) {
        return false;
    }
}

contract VigilSessionOracleTest is Test {
    uint64 constant FRI_1500 = 1722625200; // 2024-08-02 15:00 ET
    uint64 constant FRI_1555 = 1722628500;
    uint64 constant FRI_1600 = 1722628800;
    uint64 constant THU_2000 = 1722556800; // 2024-08-01 20:00 ET
    uint64 constant SAT_1200 = 1722700800;
    uint64 constant SUN_2100 = 1722819600;
    uint64 constant MON_0930 = 1722864600; // 2024-08-05
    uint64 constant MON_1600 = 1722888000;
    uint64 constant MON_2000 = 1722902400;
    uint64 constant MON_2100 = 1722906000;
    uint64 constant TUE_0400 = 1722931200;
    uint64 constant TUE_0930 = 1722951000;

    VigilCalendar cal;
    VigilSessionOracle so;
    MockStockToken nvda;
    MockFeed feed;
    MockUSDG usdg;
    MockRisk risk;
    address guardian = address(0xA11CE);
    uint256 keeperPk = 0xBEEF;
    address keeper;

    function setUp() public {
        vm.warp(FRI_1500);
        keeper = vm.addr(keeperPk);
        cal = new VigilCalendar(guardian, CalendarFixture.closedDays(), CalendarFixture.halfDays());
        usdg = new MockUSDG();
        nvda = new MockStockToken("NVIDIA (mock)", "NVDA");
        feed = new MockFeed(8, 100e8);
        risk = new MockRisk();
        so = new VigilSessionOracle(cal, usdg, guardian, keeper);
        vm.startPrank(guardian);
        so.setRiskEngine(risk);
        so.registerAsset(
            address(nvda),
            VigilSessionOracle.AssetConfig({
                feed: address(feed),
                marketStaleSeconds: 4 hours,
                hardStaleMult: 3,
                corpActionPre: 1 hours,
                corpActionPost: 1 hours,
                corpActionJumpBps: 100,
                registered: false
            })
        );
        vm.stopPrank();
    }

    function _regime() internal view returns (Regime e) {
        (e,,,) = so.regimeOf(address(nvda));
    }

    // ── rule 4: kalender ──
    function test_calendarPassthrough() public {
        assertEq(uint8(_regime()), uint8(Regime.MARKET));
        vm.warp(SAT_1200);
        assertEq(uint8(_regime()), uint8(Regime.CLOSED));
        vm.warp(MON_2100);
        feed.set(101e8);
        assertEq(uint8(_regime()), uint8(Regime.OVERNIGHT));
        (, Regime c, uint64 closeAt, uint64 nextOpen) = so.regimeOf(address(nvda));
        assertEq(uint8(c), uint8(Regime.OVERNIGHT));
        assertEq(nextOpen - closeAt, 63_000);
    }

    // ── rule 1: oraclePaused → CORP_ACTION ──
    function test_oraclePausedIsCorpAction() public {
        nvda.setOraclePaused(true);
        assertEq(uint8(_regime()), uint8(Regime.CORP_ACTION));
        vm.warp(SAT_1200);
        assertEq(uint8(_regime()), uint8(Regime.CORP_ACTION));
    }

    // ── rule 2: jendela effectiveAt dengan lompatan besar (split), termasuk post-window via lastMultiplier ──
    function test_scheduledSplit_corpActionWindow_prePostAndClears() public {
        uint256 eff = FRI_1500 + 2 hours;
        nvda.scheduleMultiplier(2e18, eff); // split 2:1 → lompatan 100%
        assertEq(uint8(_regime()), uint8(Regime.MARKET)); // di luar jendela pre (1 jam)
        vm.warp(eff - 1 hours);
        assertEq(uint8(_regime()), uint8(Regime.CORP_ACTION));
        vm.warp(eff);
        nvda.applyMultiplier(); // sekarang newUIMultiplier() == uiMultiplier() (V10b)
        assertEq(uint8(_regime()), uint8(Regime.CORP_ACTION)); // post: cur vs lastMultiplier
        vm.warp(eff + 1 hours);
        assertEq(uint8(_regime()), uint8(Regime.CORP_ACTION));
        vm.warp(eff + 1 hours + 1);
        assertEq(uint8(_regime()), uint8(Regime.EXTENDED)); // 18:00 ET Jumat = post-market
        so.poke(address(nvda)); // lastMultiplier diperbarui setelah jendela
        vm.warp(eff + 90 minutes);
        // jika jendela dibuka lagi tanpa perubahan multiplier, tidak ada CORP_ACTION
        nvda.scheduleMultiplier(2e18, eff + 3 hours);
        vm.warp(eff + 2 hours + 30 minutes);
        assertEq(uint8(_regime()), uint8(Regime.EXTENDED));
    }

    function test_smallDividendMultiplier_doesNotBlockOracle() public {
        uint256 eff = FRI_1500 + 30 minutes;
        nvda.scheduleMultiplier(1.0008e18, eff); // dividen 8 bps < ambang 100 bps
        assertEq(uint8(_regime()), uint8(Regime.MARKET));
        vm.warp(eff);
        nvda.applyMultiplier();
        assertEq(uint8(_regime()), uint8(Regime.MARKET));
    }

    // ── rule 3: feed diam saat MARKET → OVERNIGHT (perketat), dengan tenggang sejak lastOpen ──
    function test_staleDuringMarketTightens_withOpenGrace() public {
        feed.setAt(100e8, FRI_1500 - 5 hours); // diam 5 jam > 4 jam
        assertEq(uint8(_regime()), uint8(Regime.OVERNIGHT));
        assertTrue(so.feedIsUsable(address(nvda))); // < hardStaleWindow 12 jam
        // Senin pagi setelah beku sejak Jumat 15:55: tenggang baru dari 09:30
        feed.setAt(100e8, FRI_1555);
        vm.warp(MON_0930 + 1 hours);
        assertEq(uint8(_regime()), uint8(Regime.MARKET));
        assertTrue(so.feedIsUsable(address(nvda)));
        vm.warp(MON_0930 + 4 hours + 1);
        assertEq(uint8(_regime()), uint8(Regime.OVERNIGHT));
        assertTrue(so.feedIsUsable(address(nvda)));
        // Senin malam: harga terakhir (Jumat 15:55) lebih tua dari closeAt Senin − 12 jam → rusak (skenario 10c)
        vm.warp(MON_2100);
        assertFalse(so.feedIsUsable(address(nvda)));
    }

    // ── FR-17: feed beku sepanjang akhir pekan = stale yang diharapkan ──
    function test_weekendFreezeIsUsable_deadBeforeCloseIsNot() public {
        feed.setAt(100e8, FRI_1555);
        vm.warp(SUN_2100);
        assertTrue(so.feedIsUsable(address(nvda))); // INV-9
        vm.warp(MON_0930 - 1);
        assertTrue(so.feedIsUsable(address(nvda)));
        // feed mati Kamis 20:00 (20 jam sebelum close Jumat > hardStaleWindow 12 jam) → tak terduga (skenario 10b)
        feed.setAt(100e8, THU_2000);
        vm.warp(SAT_1200);
        assertFalse(so.feedIsUsable(address(nvda)));
    }

    // ── attestation: hanya memperketat, ≤ CLOSED, kedaluwarsa 30 menit ──
    function _sign(VigilSessionOracle.Attestation memory a) internal view returns (bytes memory) {
        bytes32 digest = so.hashAttestation(a);
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(keeperPk, digest);
        return abi.encodePacked(r, s, v);
    }

    function test_attest_tightensThenExpires() public {
        Session memory s = cal.sessionAt(FRI_1500);
        VigilSessionOracle.Attestation memory a = VigilSessionOracle.Attestation({
            asset: address(nvda),
            regime: uint8(Regime.CLOSED),
            closeAt: FRI_1500, // halt ad-hoc sekarang
            nextOpen: s.nextOpen,
            issuedAt: FRI_1500,
            deadline: FRI_1500 + 10 minutes
        });
        so.attest(a, _sign(a));
        (Regime e, Regime c, uint64 closeAt,) = so.regimeOf(address(nvda));
        assertEq(uint8(e), uint8(Regime.CLOSED));
        assertEq(uint8(c), uint8(Regime.MARKET));
        assertEq(closeAt, FRI_1500);
        (,, bool inClosure,,,) = so.closureOf(address(nvda));
        assertTrue(inClosure);
        vm.warp(FRI_1500 + 30 minutes + 1); // kedaluwarsa → kembali ke kalender (skenario 5)
        assertEq(uint8(_regime()), uint8(Regime.MARKET));
    }

    function test_attest_rejectsCorpActionLooseningReplayAndBadSigner() public {
        Session memory s = cal.sessionAt(FRI_1500);
        VigilSessionOracle.Attestation memory a = VigilSessionOracle.Attestation({
            asset: address(nvda),
            regime: uint8(Regime.CORP_ACTION),
            closeAt: s.closeAt,
            nextOpen: s.nextOpen,
            issuedAt: FRI_1500,
            deadline: FRI_1500 + 10 minutes
        });
        bytes memory sig = _sign(a);
        vm.expectRevert(VigilSessionOracle.RegimeTooTight.selector); // FR-33 / INV-11 / skenario 12
        so.attest(a, sig);

        a.regime = uint8(Regime.CLOSED);
        a.nextOpen = s.nextOpen - 1; // melonggarkan buka
        sig = _sign(a);
        vm.expectRevert(VigilSessionOracle.NotTightening.selector);
        so.attest(a, sig);

        a.nextOpen = s.nextOpen;
        a.closeAt = s.closeAt + 1; // memundurkan tutup
        sig = _sign(a);
        vm.expectRevert(VigilSessionOracle.NotTightening.selector);
        so.attest(a, sig);

        a.closeAt = s.closeAt;
        sig = _sign(a);
        so.attest(a, sig);
        vm.expectRevert(VigilSessionOracle.StaleAttestation.selector); // replay
        so.attest(a, sig);

        a.issuedAt = FRI_1500 + 1;
        (uint8 v, bytes32 r, bytes32 s2) = vm.sign(0xD00D, so.hashAttestation(a));
        vm.expectRevert(VigilSessionOracle.BadSignature.selector);
        so.attest(a, abi.encodePacked(r, s2, v));
    }

    // ── index premi: piecewise, tidak bergantung frekuensi poke (INV-7) ──
    function test_premiumIndex_piecewiseAndPokeIndependent() public {
        feed.set(100e8);
        // Jumat 15:00 → Senin 09:30: 1 jam MARKET (0) + 4 jam EXTENDED (1e9) + CLOSED Jum 20:00→Sen 04:00 (4e9) + 5,5 jam EXTENDED (1e9)
        uint256 expected = 4 hours * 1e9 + (56 hours) * 4e9 + uint256(5 hours + 30 minutes) * 1e9;
        vm.warp(MON_0930);
        assertEq(so.premiumIndex(address(nvda)), expected);
        // poke di tengah jalan tidak mengubah hasil
        vm.warp(SAT_1200);
        so.poke(address(nvda));
        vm.warp(SUN_2100);
        so.poke(address(nvda));
        vm.warp(MON_0930);
        assertEq(so.premiumIndex(address(nvda)), expected);
        // rezim MARKET tidak menambah index (feed hidup pada sesi Senin)
        vm.warp(MON_1600 - 1);
        feed.set(100e8); // feed hidup: tidak ada pengetatan rule 3
        assertEq(so.premiumIndex(address(nvda)), expected);
        // malam biasa: 4 jam EXTENDED + 8 jam OVERNIGHT + 5,5 jam EXTENDED
        vm.warp(TUE_0930);
        assertEq(
            so.premiumIndex(address(nvda)),
            expected + 4 hours * 1e9 + 8 hours * 2e9 + uint256(5 hours + 30 minutes) * 1e9
        );
    }

    /// Pengetatan rule 3 (feed diam saat MARKET) menambah premi hanya sejak ambang diam terlampaui.
    function test_premiumIndex_tighteningAppliesFromItsStart() public {
        feed.set(100e8);
        vm.warp(MON_0930);
        so.poke(address(nvda));
        uint256 base = so.premiumIndex(address(nvda));
        vm.warp(MON_0930 + 5 hours); // diam 5 jam sejak lastOpen → OVERNIGHT sejak 13:30
        assertEq(so.premiumIndex(address(nvda)), base + 1 hours * 2e9);
        // attestation halt CLOSED pada 14:30 (closeAt = sekarang) → CLOSED sejak issuedAt, OVERNIGHT antara 13:30–14:30
        Session memory s = cal.sessionAt(MON_0930 + 5 hours);
        VigilSessionOracle.Attestation memory a = VigilSessionOracle.Attestation({
            asset: address(nvda),
            regime: uint8(Regime.CLOSED),
            closeAt: MON_0930 + 5 hours,
            nextOpen: s.nextOpen,
            issuedAt: MON_0930 + 5 hours,
            deadline: MON_0930 + 6 hours
        });
        so.attest(a, _sign(a));
        vm.warp(MON_0930 + 5 hours + 20 minutes);
        assertEq(so.premiumIndex(address(nvda)), base + 1 hours * 2e9 + 20 minutes * 4e9);
    }

    function test_pokeBounty_paidFromPool() public {
        usdg.mint(address(this), 10e6);
        usdg.approve(address(so), 10e6);
        so.fundBounty(address(nvda), 10e6);
        vm.prank(guardian);
        so.setPokeBounty(1e6);
        vm.warp(FRI_1500 + 20 minutes);
        so.poke(address(nvda));
        assertEq(usdg.balanceOf(address(this)), 1e6);
        so.poke(address(nvda)); // < 15 menit sejak poke terakhir → tanpa bounty
        assertEq(usdg.balanceOf(address(this)), 1e6);
    }
}
