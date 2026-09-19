// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ERC4626} from "@openzeppelin/contracts/token/ERC20/extensions/ERC4626.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Id} from "morpho-blue/interfaces/IMorpho.sol";
import {Regime, IVigilCalendar, IVigilBackstop} from "./interfaces/IVigil.sol";

/// @title VigilBackstop — the USDG first-loss tranche (ERC-4626) that receives premiums and covers members' bad debt (PRD §8.5).
/// @notice Exit only via request → 7-day cooldown → claim during MARKET, converted at the share price AT CLAIM TIME:
///         whoever carries the weekend risk cannot leave on Friday night, nor lock in Friday afternoon's price.
contract VigilBackstop is ERC4626, IVigilBackstop {
    using SafeERC20 for IERC20;

    struct Request {
        address owner;
        uint256 shares;
        uint64 readyAt;
        bool claimed;
    }

    uint64 public constant COOLDOWN = 7 days;

    IVigilCalendar public immutable CAL;
    address public guardian;
    address public lossReporter; // one-shot

    Request[] public requests;
    uint256 public escrowedShares;
    mapping(Id => uint256) public coverageCap;
    mapping(Id => uint256) public coveredSoFar;
    uint256 public totalCovered;

    event WithdrawRequested(uint256 indexed id, address indexed owner, uint256 shares, uint64 readyAt);
    event WithdrawClaimed(uint256 indexed id, address indexed owner, uint256 shares, uint256 assets);
    event BadDebtCovered(Id indexed marketId, uint256 requested, uint256 covered);
    event CoverageCapSet(Id indexed marketId, uint256 cap);

    error Disabled();
    error NotGuardian();
    error NotLossReporter();
    error AlreadySet();
    error NotReady();
    error NotMarket();
    error NotOwner();
    error AlreadyClaimed();

    constructor(IERC20 usdg, IVigilCalendar cal, address guardian_)
        ERC20("Vigil Backstop USDG", "vgUSDG")
        ERC4626(usdg)
    {
        CAL = cal;
        guardian = guardian_;
    }

    function _decimalsOffset() internal pure override returns (uint8) {
        return 6; // virtual shares: closes the inflation attack on a first-loss vault
    }

    // ───────────────────────── control ─────────────────────────

    function transferGuardian(address g) external {
        if (msg.sender != guardian) revert NotGuardian();
        guardian = g;
    }

    function setLossReporter(address r) external {
        if (msg.sender != guardian) revert NotGuardian();
        if (lossReporter != address(0)) revert AlreadySet();
        lossReporter = r;
    }

    function setCoverageCap(Id marketId, uint256 cap) external {
        if (msg.sender != guardian) revert NotGuardian();
        coverageCap[marketId] = cap;
        emit CoverageCapSet(marketId, cap);
    }

    // ───────────────────────── exit path ─────────────────────────

    function withdraw(uint256, address, address) public pure override returns (uint256) {
        revert Disabled();
    }

    function redeem(uint256, address, address) public pure override returns (uint256) {
        revert Disabled();
    }

    function maxWithdraw(address) public pure override returns (uint256) {
        return 0;
    }

    function maxRedeem(address) public pure override returns (uint256) {
        return 0;
    }

    function requestWithdraw(uint256 shares) external returns (uint256 id) {
        _transfer(msg.sender, address(this), shares); // shares are escrowed and keep absorbing losses
        escrowedShares += shares;
        id = requests.length;
        uint64 readyAt = uint64(block.timestamp) + COOLDOWN;
        requests.push(Request(msg.sender, shares, readyAt, false));
        emit WithdrawRequested(id, msg.sender, shares, readyAt);
    }

    function claimWithdraw(uint256 id) external returns (uint256 assets) {
        Request storage r = requests[id];
        if (r.owner != msg.sender) revert NotOwner();
        if (r.claimed) revert AlreadyClaimed();
        if (block.timestamp < r.readyAt) revert NotReady();
        if (CAL.sessionAt(uint64(block.timestamp)).cal != Regime.MARKET) revert NotMarket();
        assets = previewRedeem(r.shares); // price at claim time (FR-25)
        r.claimed = true;
        escrowedShares -= r.shares;
        _burn(address(this), r.shares);
        IERC20(asset()).safeTransfer(msg.sender, assets);
        emit WithdrawClaimed(id, msg.sender, r.shares, assets);
    }

    // ───────────────────────── cover ─────────────────────────

    function coverBadDebt(Id marketId, uint256 amount) external returns (uint256 covered) {
        if (msg.sender != lossReporter) revert NotLossReporter();
        uint256 capLeft =
            coverageCap[marketId] > coveredSoFar[marketId] ? coverageCap[marketId] - coveredSoFar[marketId] : 0;
        covered = amount;
        if (covered > capLeft) covered = capLeft;
        uint256 avail = totalAssets();
        if (covered > avail) covered = avail;
        coveredSoFar[marketId] += covered;
        totalCovered += covered;
        IERC20(asset()).safeTransfer(msg.sender, covered);
        emit BadDebtCovered(marketId, amount, covered);
    }

    function asset() public view override(ERC4626, IVigilBackstop) returns (address) {
        return ERC4626.asset();
    }

    function coverageCapOf(Id marketId) external view returns (uint256) {
        return coverageCap[marketId];
    }
}
