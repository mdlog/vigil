// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {VigilCalendar} from "../../src/VigilCalendar.sol";
import {VigilSessionOracle} from "../../src/VigilSessionOracle.sol";
import {MockStockToken} from "../../src/mocks/MockStockToken.sol";
import {MockStockTokenLegacy} from "../../src/mocks/MockStockTokenLegacy.sol";
import {MockFeed} from "../../src/mocks/MockFeed.sol";
import {MockUSDG} from "../../src/mocks/MockUSDG.sol";
import {Regime, Session, IVigilRiskEngine} from "../../src/interfaces/IVigil.sol";
import {CalendarFixture} from "../CalendarFixture.sol";

/// A mock risk engine: a constant per-second rate per regime (WAD/second over the notional).
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

    // ── rule 4: calendar ──
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

    // ── rule 2: the effectiveAt window with a large jump (split), including the post-window via lastMultiplier ──
    function test_scheduledSplit_corpActionWindow_prePostAndClears() public {
        uint256 eff = FRI_1500 + 2 hours;
        nvda.scheduleMultiplier(2e18, eff); // 2:1 split → a 100 % jump
        assertEq(uint8(_regime()), uint8(Regime.MARKET)); // outside the pre window (1 h)
        vm.warp(eff - 1 hours);
        assertEq(uint8(_regime()), uint8(Regime.CORP_ACTION));
        vm.warp(eff);
        nvda.applyMultiplier(); // now newUIMultiplier() == uiMultiplier() (V10b)
        assertEq(uint8(_regime()), uint8(Regime.CORP_ACTION)); // post: cur vs lastMultiplier
        vm.warp(eff + 1 hours);
        assertEq(uint8(_regime()), uint8(Regime.CORP_ACTION));
        vm.warp(eff + 1 hours + 1);
        assertEq(uint8(_regime()), uint8(Regime.EXTENDED)); // 18:00 ET Friday = post-market
        so.poke(address(nvda)); // lastMultiplier is refreshed after the window
        vm.warp(eff + 90 minutes);
        // if the window opens again without a multiplier change, no CORP_ACTION
        nvda.scheduleMultiplier(2e18, eff + 3 hours);
        vm.warp(eff + 2 hours + 30 minutes);
        assertEq(uint8(_regime()), uint8(Regime.EXTENDED));
    }

    function test_smallDividendMultiplier_doesNotBlockOracle() public {
        uint256 eff = FRI_1500 + 30 minutes;
        nvda.scheduleMultiplier(1.0008e18, eff); // an 8 bps dividend < the 100 bps threshold
        assertEq(uint8(_regime()), uint8(Regime.MARKET));
        vm.warp(eff);
        nvda.applyMultiplier();
        assertEq(uint8(_regime()), uint8(Regime.MARKET));
    }

    // ── rule 3: a silent feed during MARKET → OVERNIGHT (tighten), with a grace period since lastOpen ──
    function test_staleDuringMarketTightens_withOpenGrace() public {
        feed.setAt(100e8, FRI_1500 - 5 hours); // silent 5 h > 4 h
        assertEq(uint8(_regime()), uint8(Regime.OVERNIGHT));
        assertTrue(so.feedIsUsable(address(nvda))); // < the 12 h hardStaleWindow
        // Monday morning after being frozen since Friday 15:55: a fresh grace period from 09:30
        feed.setAt(100e8, FRI_1555);
        vm.warp(MON_0930 + 1 hours);
        assertEq(uint8(_regime()), uint8(Regime.MARKET));
        assertTrue(so.feedIsUsable(address(nvda)));
        vm.warp(MON_0930 + 4 hours + 1);
        assertEq(uint8(_regime()), uint8(Regime.OVERNIGHT));
        assertTrue(so.feedIsUsable(address(nvda)));
        // Monday night: the last price (Friday 15:55) is older than Monday closeAt − 12 h → broken (scenario 10c)
        vm.warp(MON_2100);
        assertFalse(so.feedIsUsable(address(nvda)));
    }

    // ── FR-17: a feed frozen all weekend = expected staleness ──
    function test_weekendFreezeIsUsable_deadBeforeCloseIsNot() public {
        feed.setAt(100e8, FRI_1555);
        vm.warp(SUN_2100);
        assertTrue(so.feedIsUsable(address(nvda))); // INV-9
        vm.warp(MON_0930 - 1);
        assertTrue(so.feedIsUsable(address(nvda)));
        // the feed dies Thursday 20:00 (20 h before the Friday close > the 12 h hardStaleWindow) → unexpected (scenario 10b)
        feed.setAt(100e8, THU_2000);
        vm.warp(SAT_1200);
        assertFalse(so.feedIsUsable(address(nvda)));
    }

    // ── attestation: tighten only, ≤ CLOSED, expires after 30 minutes ──
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
            closeAt: FRI_1500, // an ad-hoc halt now
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
        vm.warp(FRI_1500 + 30 minutes + 1); // expired → back to the calendar (scenario 5)
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
        vm.expectRevert(VigilSessionOracle.RegimeTooTight.selector); // FR-33 / INV-11 / scenario 12
        so.attest(a, sig);

        a.regime = uint8(Regime.CLOSED);
        a.nextOpen = s.nextOpen - 1; // loosens the open
        sig = _sign(a);
        vm.expectRevert(VigilSessionOracle.NotTightening.selector);
        so.attest(a, sig);

        a.nextOpen = s.nextOpen;
        a.closeAt = s.closeAt + 1; // pushes the close back
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

    // ── premium index: piecewise, independent of poke frequency (INV-7) ──
    function test_premiumIndex_piecewiseAndPokeIndependent() public {
        feed.set(100e8);
        // Friday 15:00 → Monday 09:30: 1 h MARKET (0) + 4 h EXTENDED (1e9) + CLOSED Fri 20:00 → Mon 04:00 (4e9) + 5.5 h EXTENDED (1e9)
        uint256 expected = 4 hours * 1e9 + (56 hours) * 4e9 + uint256(5 hours + 30 minutes) * 1e9;
        vm.warp(MON_0930);
        assertEq(so.premiumIndex(address(nvda)), expected);
        // a poke halfway through does not change the result
        vm.warp(SAT_1200);
        so.poke(address(nvda));
        vm.warp(SUN_2100);
        so.poke(address(nvda));
        vm.warp(MON_0930);
        assertEq(so.premiumIndex(address(nvda)), expected);
        // the MARKET regime adds nothing to the index (a live feed during the Monday session)
        vm.warp(MON_1600 - 1);
        feed.set(100e8); // a live feed: no rule-3 tightening
        assertEq(so.premiumIndex(address(nvda)), expected);
        // an ordinary night: 4 h EXTENDED + 8 h OVERNIGHT + 5.5 h EXTENDED
        vm.warp(TUE_0930);
        assertEq(
            so.premiumIndex(address(nvda)),
            expected + 4 hours * 1e9 + 8 hours * 2e9 + uint256(5 hours + 30 minutes) * 1e9
        );
    }

    /// A rule-3 tightening (a silent feed during MARKET) adds premium only from the moment the silence threshold is crossed.
    function test_premiumIndex_tighteningAppliesFromItsStart() public {
        feed.set(100e8);
        vm.warp(MON_0930);
        so.poke(address(nvda));
        uint256 base = so.premiumIndex(address(nvda));
        vm.warp(MON_0930 + 5 hours); // silent 5 h since lastOpen → OVERNIGHT since 13:30
        so.poke(address(nvda)); // the derived tightening enters the index when persisted
        assertEq(so.premiumIndex(address(nvda)), base + 1 hours * 2e9);
        // a CLOSED halt attestation at 14:30 (closeAt = now) → CLOSED since issuedAt, OVERNIGHT between 13:30–14:30
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

    /// INV-7: an attestation that expires without a poke must not remove a segment that has already accrued —
    /// the attestation window is stored on-chain, so the accrual is exact and independent of poke timing.
    /// (Shrunk sequence from the fuzzer, 19 Sep 2026: attest an EXTENDED halt +1 s → +328 s → +2,467 s.)
    function test_premiumIndex_monotoneAcrossAttestationExpiry() public {
        Session memory s = cal.sessionAt(FRI_1500);
        VigilSessionOracle.Attestation memory a = VigilSessionOracle.Attestation({
            asset: address(nvda),
            regime: uint8(Regime.EXTENDED),
            closeAt: FRI_1500 + 1,
            nextOpen: s.nextOpen,
            issuedAt: FRI_1500,
            deadline: FRI_1500 + 63
        });
        so.attest(a, _sign(a));
        vm.warp(FRI_1500 + 328);
        uint256 i1 = so.premiumIndex(address(nvda));
        assertEq(i1, 328 * 1e9, "EXTENDED since issuedAt");
        vm.warp(FRI_1500 + 2467); // > MAX_ATTESTATION_AGE: the attestation is no longer fresh
        uint256 i2 = so.premiumIndex(address(nvda));
        assertGe(i2, i1, "INV-7: the index view dropped after the attestation expired");
        assertEq(i2, 30 minutes * 1e9, "the full attestation window, then the calendar (MARKET = 0)");
        so.poke(address(nvda)); // persists without changing the value: exact, independent of poke timing
        assertEq(so.premiumIndex(address(nvda)), 30 minutes * 1e9);
        assertEq(uint8(_regime()), uint8(Regime.MARKET)); // the price regime is back on the calendar
    }

    /// INV-7 for a derived tightening (rule 3): the feed history cannot be reconstructed once the feed updates,
    /// so the view carries only what can be proven (calendar + attestations); `poke` persists the tightening
    /// currently observed, and the persisted value never drops when that tightening disappears.
    function test_premiumIndex_derivedTighteningPersistsOnPokeOnly_andNeverReverts() public {
        feed.set(100e8);
        vm.warp(MON_0930);
        so.poke(address(nvda));
        uint256 base = so.premiumIndex(address(nvda));
        vm.warp(MON_0930 + 5 hours); // silent 5 h since lastOpen → OVERNIGHT since 13:30 (rule 3)
        assertEq(so.premiumIndex(address(nvda)), base, "view: the derived tightening is not persisted yet");
        so.poke(address(nvda));
        uint256 persisted = so.premiumIndex(address(nvda));
        assertEq(
            persisted, base + 1 hours * 2e9, "poke: OVERNIGHT accrues from the silence threshold, not from lastPoke"
        );
        feed.set(100e8); // the feed is live again: the tightening disappears, what was persisted must not drop
        assertEq(so.premiumIndex(address(nvda)), persisted, "INV-7: the index dropped after the feed updated");
        vm.warp(MON_0930 + 5 hours + 30 minutes);
        assertEq(so.premiumIndex(address(nvda)), persisted, "MARKET with a live feed adds nothing to the index");
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
        so.poke(address(nvda)); // < 15 minutes since the last poke → no bounty
        assertEq(usdg.balanceOf(address(this)), 1e6);
    }

    // ── tokens without oraclePaused() (Robinhood's testnet stock tokens) ──
    function test_registerAsset_probesOraclePausedSupport() public {
        assertTrue(so.hasOraclePaused(address(nvda)));
        MockStockTokenLegacy tsla = new MockStockTokenLegacy("Tesla", "TSLA");
        MockFeed tslaFeed = new MockFeed(8, 364e8);
        vm.prank(guardian);
        so.registerAsset(
            address(tsla),
            VigilSessionOracle.AssetConfig({
                feed: address(tslaFeed),
                marketStaleSeconds: 4 hours,
                hardStaleMult: 3,
                corpActionPre: 1 hours,
                corpActionPost: 1 hours,
                corpActionJumpBps: 100,
                registered: false
            })
        );
        assertFalse(so.hasOraclePaused(address(tsla)));
        // rule 1 cannot be expressed by the token, so the calendar regime comes through — no revert
        vm.warp(FRI_1500);
        (Regime e,,,) = so.regimeOf(address(tsla));
        assertEq(uint8(e), uint8(Regime.MARKET));
        // rule 2 (effectiveAt window with a large multiplier jump) still applies
        uint256 eff = FRI_1500 + 30 minutes;
        tsla.scheduleMultiplier(2e18, eff);
        (e,,,) = so.regimeOf(address(tsla));
        assertEq(uint8(e), uint8(Regime.CORP_ACTION));
    }
}
