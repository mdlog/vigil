// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// The ERC-8056 (Scaled UI Amount Extension) subset exposed by the Robinhood Stock Token.
/// Verified on-chain on 19 Sep 2026 against NVDA on mainnet (0xd060…9EEC): all four functions exist;
/// once effectiveAt has passed, newUIMultiplier() == uiMultiplier() (V10b). The testnet tokens of the same
/// registry (e.g. TSLA 0xC9f9…Bd4E, implementation `Stock`) lack oraclePaused(); VigilSessionOracle probes it.
interface IStockToken is IERC20 {
    function uiMultiplier() external view returns (uint256);
    function newUIMultiplier() external view returns (uint256);
    function effectiveAt() external view returns (uint256);
    function oraclePaused() external view returns (bool);
}
