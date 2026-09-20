// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IMorpho, MarketParams, Authorization, Signature, Id} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";

/// @title VigilMigrator — move a Morpho Blue supply position between two markets in one transaction.
/// @notice A supplier who wants to leave a plain-oracle market for a Vigil market would otherwise send two
///         transactions (withdraw, then supply). This contract does both atomically: it withdraws `shares` from
///         `from` on behalf of the caller, receives the assets, and supplies them to `to` for the caller.
///         The authorization Morpho requires for the withdrawal is granted inside the same call from an EIP-712
///         signature (`setAuthorizationWithSig`), so the whole migration is one signature plus one transaction.
/// @dev    Only the caller's own position can move (`onBehalf` is always `msg.sender` on both legs), the
///         contract never holds tokens between transactions, and it has no owner. Revoke the standing
///         authorization afterwards with `Morpho.setAuthorization(migrator, false)` if desired.
contract VigilMigrator {
    using SafeERC20 for IERC20;
    using MarketParamsLib for MarketParams;

    IMorpho public immutable MORPHO;

    event Migrated(
        address indexed supplier,
        Id indexed fromId,
        Id indexed toId,
        uint256 assets,
        uint256 sharesOut,
        uint256 sharesIn
    );

    error NotAuthorizer();
    error NotForThisContract();
    error LoanTokenMismatch();

    constructor(IMorpho morpho) {
        MORPHO = morpho;
    }

    /// @param from   market to leave
    /// @param to     market to join (same loan token)
    /// @param shares supply shares to withdraw from `from` (the whole position closes exactly when all are given)
    /// @param auth   EIP-712 authorization of `msg.sender` for this contract; ignored when already authorized
    /// @param sig    its signature
    function migrate(
        MarketParams calldata from,
        MarketParams calldata to,
        uint256 shares,
        Authorization calldata auth,
        Signature calldata sig
    ) external returns (uint256 assets, uint256 sharesIn) {
        if (from.loanToken != to.loanToken) revert LoanTokenMismatch();
        if (!MORPHO.isAuthorized(msg.sender, address(this))) {
            if (auth.authorizer != msg.sender) revert NotAuthorizer();
            if (auth.authorized != address(this) || !auth.isAuthorized) revert NotForThisContract();
            MORPHO.setAuthorizationWithSig(auth, sig);
        }
        (assets,) = MORPHO.withdraw(from, 0, shares, msg.sender, address(this));
        IERC20(to.loanToken).forceApprove(address(MORPHO), assets);
        (, sharesIn) = MORPHO.supply(to, assets, 0, msg.sender, "");
        emit Migrated(msg.sender, from.id(), to.id(), assets, shares, sharesIn);
    }
}
