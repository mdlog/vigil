// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {Base} from "../Base.t.sol";
import {VigilSessionOracle} from "../../src/VigilSessionOracle.sol";
import {VigilRiskEngine} from "../../src/VigilRiskEngine.sol";
import {VigilOracle} from "../../src/VigilOracle.sol";
import {VigilPreLiquidation} from "../../src/VigilPreLiquidation.sol";
import {MockFeed} from "../../src/mocks/MockFeed.sol";
import {MockStockToken} from "../../src/mocks/MockStockToken.sol";
import {Regime} from "../../src/interfaces/IVigil.sol";
import {Id} from "morpho-blue/interfaces/IMorpho.sol";

/// Random actions against the system; keeps ghost state for INV-3 and INV-7.
contract Handler is Test {
    VigilSessionOracle so;
    VigilRiskEngine risk;
    VigilOracle vOracle;
    VigilPreLiquidation preLiq;
    MockFeed feed;
    MockStockToken nvda;
    Id idB;
    address calibrator;
    uint256 keeperPk;

    uint256 public stepViolations;
    uint256 public lastIndex;
    uint256 public actions;
    uint64 public constant START = 1722621600; // 2024-08-02 14:00 ET
    uint64 public constant END = START + 21 days;

    constructor(
        VigilSessionOracle so_,
        VigilRiskEngine risk_,
        VigilOracle o_,
        VigilPreLiquidation p_,
        MockFeed f_,
        MockStockToken n_,
        Id id_,
        address cal_,
        uint256 pk_
    ) {
        so = so_;
        risk = risk_;
        vOracle = o_;
        preLiq = p_;
        feed = f_;
        nvda = n_;
        idB = id_;
        calibrator = cal_;
        keeperPk = pk_;
    }

    function _price() internal view returns (bool ok, uint256 p) {
        try vOracle.price() returns (uint256 x) {
            return (true, x);
        } catch {
            return (false, 0);
        }
    }

    /// INV-3: with a constant feed the price never jumps by more than the ramp rate allows.
    function warp(uint32 dt) external {
        dt = uint32(bound(dt, 1, 6 hours));
        if (block.timestamp + dt > END) return;
        (bool ok0, uint256 p0) = _price();
        vm.warp(block.timestamp + dt);
        (bool ok1, uint256 p1) = _price();
        if (ok0 && ok1 && p0 > p1) {
            // INV-3 / FR-11: a price DECREASE never jumps (an increase — e.g. the haircut released when an
            // attestation expires — does not affect solvency and may be immediate)
            uint256 d = p0 - p1;
            uint256 maxBps = 2 + 2 * uint256(2_500) * dt / 3_600; // two stacked ramps + rounding
            if (d * 10_000 > p0 * maxBps) stepViolations++;
        }
        _track();
    }

    function setFeed(uint16 pct) external {
        pct = uint16(bound(pct, 6_000, 14_000));
        feed.set(int256(uint256(120e8) * pct / 10_000));
        _track();
    }

    function attest(uint8 regime, uint32 ttl, uint32 haltIn) external {
        regime = uint8(bound(regime, 0, 4)); // 4 = CORP_ACTION must be rejected
        ttl = uint32(bound(ttl, 1 minutes, 40 minutes));
        var_attest(regime, ttl, uint32(bound(haltIn, 0, 4 hours)));
        _track();
    }

    function var_attest(uint8 regime, uint32 ttl, uint32 haltIn) internal {
        (,, uint64 closeAt, uint64 nextOpen) = so.regimeOf(address(nvda));
        uint64 c = closeAt;
        if (closeAt > block.timestamp && closeAt - block.timestamp > haltIn) c = uint64(block.timestamp + haltIn);
        VigilSessionOracle.Attestation memory a = VigilSessionOracle.Attestation({
            asset: address(nvda),
            regime: regime,
            closeAt: c,
            nextOpen: nextOpen,
            issuedAt: uint64(block.timestamp),
            deadline: uint64(block.timestamp + ttl)
        });
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(keeperPk, so.hashAttestation(a));
        try so.attest(a, abi.encodePacked(r, s, v)) {} catch {}
    }

    function calibrate(uint64 sigma) external {
        sigma = uint64(bound(sigma, 0.01e18, 0.024e18));
        vm.prank(calibrator);
        try risk.setSurface(address(nvda), VigilRiskEngine.Surface(sigma, 30_000, 50, 2_500, 0)) {} catch {}
        _track();
    }

    function scheduleEvent(uint32 startIn, uint16 mult) external {
        startIn = uint32(bound(startIn, 24 hours, 3 days));
        mult = uint16(bound(mult, 10_000, 50_000));
        vm.prank(calibrator);
        try risk.scheduleEvent(
            address(nvda),
            VigilRiskEngine.ScheduledEvent(
                uint64(block.timestamp + startIn), uint64(block.timestamp + startIn + 17 hours), mult
            )
        ) {}
            catch {}
        _track();
    }

    function poke() external {
        so.poke(address(nvda));
        _track();
    }

    function _track() internal {
        uint256 i = so.premiumIndex(address(nvda));
        if (i < lastIndex) stepViolations += 1_000_000; // INV-7 violated
        lastIndex = i;
        actions++;
    }
}

contract InvariantsTest is Base {
    Handler handler;

    function setUp() public override {
        super.setUp();
        handler = new Handler(so, risk, vOracle, preLiq, feed, nvda, idB, calibrator, keeperPk);
        targetContract(address(handler));
    }

    function invariant_INV3_noPriceStepWithConstantFeed_INV7_indexMonotone() public view {
        assertEq(handler.stepViolations(), 0);
    }

    function invariant_INV4_haircutBounded() public view {
        assertLe(risk.haircutBps(address(nvda)), 2_500);
        assertLe(vOracle.currentHaircutBps(), CAP_BPS);
    }

    function invariant_INV12_softTighterThanHard() public view {
        assertGe(preLiq.softHaircutBps(idB), uint256(vOracle.currentHaircutBps()) + 200);
    }

    function invariant_INV1_effectiveNeverLooserThanCalendar() public view {
        (Regime eff, Regime cal_,,) = so.regimeOf(address(nvda));
        assertGe(uint8(eff), uint8(cal_));
    }

    function invariant_INV11_corpActionOnlyFromToken() public view {
        (Regime eff,,,) = so.regimeOf(address(nvda));
        if (eff == Regime.CORP_ACTION) assertTrue(nvda.oraclePaused() || nvda.effectiveAt() != 0);
    }

    function invariant_closureBounded() public view {
        (uint64 closeAt, uint64 nextOpen,,,,) = so.closureOf(address(nvda));
        assertLe(nextOpen - closeAt, 5 days);
    }
}
