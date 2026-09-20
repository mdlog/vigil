// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Base} from "../Base.t.sol";
import {IMorpho, MarketParams, Authorization, Signature, Id} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
import {AUTHORIZATION_TYPEHASH} from "morpho-blue/libraries/ConstantsLib.sol";
import {VigilMigrator} from "../../src/periphery/VigilMigrator.sol";

/// A supplier moves a whole supply position from the control market (A) to the Vigil market (B) in one
/// transaction: the authorization is granted inside the call with an EIP-712 signature, so no prior
/// setAuthorization transaction is needed and nothing but the caller's own position can move.
contract VigilMigratorTest is Base {
    using MarketParamsLib for MarketParams;

    VigilMigrator migrator;
    uint256 constant LP_KEY = 0xA11CE;
    address lp;

    function setUp() public override {
        super.setUp();
        migrator = new VigilMigrator(morpho);
        lp = vm.addr(LP_KEY);
        usdg.mint(lp, 20e6);
        vm.startPrank(lp);
        usdg.approve(address(morpho), 20e6);
        morpho.supply(mA, 20e6, 0, lp, "");
        vm.stopPrank();
    }

    function _auth(bool isAuthorized) internal view returns (Authorization memory a, Signature memory s) {
        a = Authorization({
            authorizer: lp,
            authorized: address(migrator),
            isAuthorized: isAuthorized,
            nonce: morpho.nonce(lp),
            deadline: block.timestamp + 1 hours
        });
        bytes32 digest = keccak256(
            bytes.concat("\x19\x01", morpho.DOMAIN_SEPARATOR(), keccak256(abi.encode(AUTHORIZATION_TYPEHASH, a)))
        );
        (s.v, s.r, s.s) = vm.sign(LP_KEY, digest);
    }

    function test_migrate_movesWholePositionInOneCall() public {
        uint256 sharesA = _pos(mA, lp).supplyShares;
        assertGt(sharesA, 0);
        (Authorization memory a, Signature memory s) = _auth(true);
        vm.prank(lp);
        (uint256 assets, uint256 sharesB) = migrator.migrate(mA, mB, sharesA, a, s);
        assertApproxEqAbs(assets, 20e6, 1, "whole supply moved (Morpho may round 1 wei down)");
        assertEq(_pos(mA, lp).supplyShares, 0, "old position closed");
        assertEq(_pos(mB, lp).supplyShares, sharesB, "new position credited to the caller");
        assertGt(sharesB, 0);
        assertEq(usdg.balanceOf(address(migrator)), 0, "migrator keeps nothing");
        assertTrue(morpho.isAuthorized(lp, address(migrator)));
    }

    function test_migrate_reusesExistingAuthorizationWithoutSignature() public {
        vm.prank(lp);
        morpho.setAuthorization(address(migrator), true);
        uint256 sharesA = _pos(mA, lp).supplyShares;
        Authorization memory a; // empty: not needed, must be ignored
        Signature memory s;
        vm.prank(lp);
        migrator.migrate(mA, mB, sharesA, a, s);
        assertEq(_pos(mA, lp).supplyShares, 0);
    }

    function test_migrate_revertsForSomeoneElsesPosition() public {
        (Authorization memory a, Signature memory s) = _auth(true);
        vm.prank(address(0xBAD));
        vm.expectRevert(VigilMigrator.NotAuthorizer.selector);
        migrator.migrate(mA, mB, 1, a, s);
    }

    function test_migrate_revertsAcrossLoanTokens() public {
        MarketParams memory other = mB;
        other.loanToken = address(nvda);
        (Authorization memory a, Signature memory s) = _auth(true);
        vm.prank(lp);
        vm.expectRevert(VigilMigrator.LoanTokenMismatch.selector);
        migrator.migrate(mA, other, 1, a, s);
    }
}
