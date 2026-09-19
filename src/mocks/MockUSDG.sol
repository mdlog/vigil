// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// USDG tiruan: 6 desimal (diverifikasi on-chain 19 Sep 2026, mainnet 0x5fc5…d168), mintable.
contract MockUSDG is ERC20 {
    constructor() ERC20("Global Dollar (mock)", "USDG") {}

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
