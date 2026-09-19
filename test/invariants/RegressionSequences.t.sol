// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Base} from "../Base.t.sol";
import {Handler} from "./Invariants.t.sol";

/// Sekuens shrunk yang pernah ditemukan fuzzer (19 Sep 2026), dipin sebagai regresi deterministik.
contract RegressionSequencesTest is Base {
    Handler handler;

    function setUp() public override {
        super.setUp();
        handler = new Handler(so, risk, vOracle, preLiq, feed, nvda, idB, calibrator, keeperPk);
    }

    /// INV-7: attestation yang kedaluwarsa tanpa poke menghapus segmen index dari view.
    function test_inv7_indexNeverDropsWhenAttestationExpires() public {
        handler.attest(1, 3, 1);
        handler.warp(328);
        handler.warp(599423739);
        assertEq(handler.stepViolations(), 0);
    }

    /// INV-3: attestation CLOSED di tengah EXTENDED me-reset ramp haircut ke nol → harga naik lalu turun 500 bps.
    function test_inv3_tighteningMidClosureNeverStepsPrice() public {
        handler.warp(322);
        handler.warp(243);
        handler.warp(441060);
        handler.warp(11912);
        handler.attest(103, 18, 20081);
        handler.warp(87);
        assertEq(handler.stepViolations(), 0);
    }
}
