// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// Subset ERC-8056 (Scaled UI Amount Extension) sebagaimana diekspos Robinhood Stock Token.
/// Diverifikasi on-chain 19 Sep 2026 pada NVDA mainnet (0xd060…9EEC): keempat fungsi ada;
/// setelah effectiveAt lewat, newUIMultiplier() == uiMultiplier() (V10b).
interface IStockToken is IERC20 {
    function uiMultiplier() external view returns (uint256);
    function newUIMultiplier() external view returns (uint256);
    function effectiveAt() external view returns (uint256);
    function oraclePaused() external view returns (bool);
}
