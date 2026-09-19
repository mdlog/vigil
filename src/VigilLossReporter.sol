// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {IMorpho, MarketParams, Id, Position} from "morpho-blue/interfaces/IMorpho.sol";
import {IMorphoLiquidateCallback} from "morpho-blue/interfaces/IMorphoCallbacks.sol";
import {IOracle} from "morpho-blue/interfaces/IOracle.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
import {MorphoBalancesLib} from "morpho-blue/libraries/periphery/MorphoBalancesLib.sol";
import {Regime, IVigilSessionOracle, IVigilPremium, IVigilBackstop} from "./interfaces/IVigil.sol";

interface IVigilLiquidateCallback {
    /// Called after the collateral is received; the callee must send `repaidAssets` of loan token to the LossReporter.
    function onVigilLiquidate(uint256 repaidAssets, uint256 seizedAssets, bytes calldata data) external;
}

/// @title VigilLossReporter — `liquidateWithCover`: the backstop repays a member borrower's shortfall BEFORE the
///        seizure, in the same transaction, so Morpho never realizes bad debt (PRD §8.7, FR-37).
/// @dev Morpho Blue zeroes borrowShares and reduces totalSupplyAssets inside liquidate() as soon as collateral == 0;
///      there is no post-liquidation state to "prove", and supplying afterwards does not make the old suppliers whole.
contract VigilLossReporter is IMorphoLiquidateCallback {
    using SafeERC20 for IERC20;
    using MarketParamsLib for MarketParams;
    using MorphoBalancesLib for IMorpho;

    struct MarketCfg {
        MarketParams params;
        bool registered;
    }

    uint64 public constant COVER_WINDOW = 1 hours; // bad debt printed at the open is still covered
    uint16 public constant COVER_BOUNTY_BPS = 10;
    uint256 public constant DUST = 1e3; // 0.001 USDG: rounding margin so a full seizure leaves no bad debt
    uint256 internal constant WAD = 1e18;

    IMorpho public immutable MORPHO;
    IVigilSessionOracle public immutable SESSION;
    IVigilPremium public immutable PREMIUM;
    IVigilBackstop public immutable BACKSTOP;
    IERC20 public immutable USDG;
    address public guardian;
    mapping(Id => MarketCfg) internal markets;

    // liquidation transaction context (set and cleared within one tx)
    address internal currentLiquidator;
    address internal currentCollateral;
    bytes internal currentData;

    event Covered(
        Id indexed id,
        address indexed borrower,
        address indexed liquidator,
        uint256 shortfall,
        uint256 covered,
        uint256 bounty,
        uint8 regime
    );
    event MarketRegistered(Id indexed id);

    error NotGuardian();
    error AlreadySet();
    error NotRegistered();
    error NotMember();
    error NotCovered();
    error NotMorpho();

    constructor(
        IMorpho morpho,
        IVigilSessionOracle session,
        IVigilPremium premium,
        IVigilBackstop backstop,
        address guardian_
    ) {
        MORPHO = morpho;
        SESSION = session;
        PREMIUM = premium;
        BACKSTOP = backstop;
        USDG = IERC20(backstop.asset());
        guardian = guardian_;
    }

    function transferGuardian(address g) external {
        if (msg.sender != guardian) revert NotGuardian();
        guardian = g;
    }

    function registerMarket(MarketParams calldata p) external {
        if (msg.sender != guardian) revert NotGuardian();
        Id id = p.id();
        if (markets[id].registered) revert AlreadySet();
        markets[id] = MarketCfg(p, true);
        emit MarketRegistered(id);
    }

    function _lif(uint256 lltv) internal pure returns (uint256) {
        uint256 lif = WAD * WAD / (WAD - 0.3e18 * (WAD - lltv) / WAD);
        return lif > 1.15e18 ? 1.15e18 : lif;
    }

    function regimeCovered(address asset) public view returns (bool) {
        (Regime eff,,,) = SESSION.regimeOf(asset);
        if (eff != Regime.MARKET) return true;
        (,,, uint64 lastOpen,,) = SESSION.closureOf(asset);
        return block.timestamp - lastOpen <= COVER_WINDOW;
    }

    /// Shortfall = debt − what a full seizure repays at the market's oracle price (with the LIF).
    function previewCover(Id id, address borrower)
        public
        view
        returns (uint256 shortfall, uint256 coverable, bool member, bool covered)
    {
        MarketCfg storage m = markets[id];
        if (!m.registered) revert NotRegistered();
        uint256 px = IOracle(m.params.oracle).price();
        uint256 debt = MORPHO.expectedBorrowAssets(m.params, borrower);
        Position memory p = MORPHO.position(id, borrower);
        uint256 maxRepayable = uint256(p.collateral) * px / 1e36 * WAD / _lif(m.params.lltv);
        shortfall = debt > maxRepayable ? debt - maxRepayable : 0;
        member = PREMIUM.isMember(id, borrower);
        covered = regimeCovered(m.params.collateralToken);
        if (shortfall > 0 && member && covered) {
            uint256 need = shortfall + DUST;
            uint256 capLeft = BACKSTOP.coverageCap(id);
            coverable = need > capLeft ? capLeft : need;
        }
    }

    /// Liquidate `borrower`'s position with backstop cover when a member & the regime is covered. Optional `data` → callback.
    function liquidateWithCover(Id id, address borrower, bytes calldata data)
        external
        returns (uint256 seized, uint256 repaid, uint256 covered)
    {
        MarketCfg storage m = markets[id];
        if (!m.registered) revert NotRegistered();
        (uint256 shortfall,, bool member, bool regimeOk) = previewCover(id, borrower);
        uint256 bounty;
        if (shortfall > 0) {
            if (!member) revert NotMember();
            if (!regimeOk) revert NotCovered();
            (covered, bounty) = _cover(m.params, id, borrower, shortfall + DUST);
        }
        currentLiquidator = msg.sender;
        currentCollateral = m.params.collateralToken;
        currentData = data;
        (seized, repaid) = _liquidate(m.params, id, borrower);
        if (bounty > 0) USDG.safeTransfer(msg.sender, bounty);
        _emitCovered(m.params.collateralToken, id, borrower, shortfall, covered, bounty);
        delete currentLiquidator;
        delete currentCollateral;
        delete currentData;
    }

    function _cover(MarketParams memory params, Id id, address borrower, uint256 need)
        internal
        returns (uint256 covered, uint256 bounty)
    {
        uint256 bountyWanted = need * COVER_BOUNTY_BPS / 10_000;
        uint256 got = BACKSTOP.coverBadDebt(id, need + bountyWanted);
        if (got >= need) {
            covered = need;
            bounty = got - need;
        } else {
            covered = got; // cap / backstop assets exhausted: partial cover, no bounty
        }
        if (covered > 0) {
            USDG.safeApprove(address(MORPHO), covered);
            MORPHO.repay(params, covered, 0, borrower, "");
        }
    }

    /// After the cover: if the remaining debt ≤ what a full seizure repays → repay all of it through
    /// repaidShares (collateral left > 0, bad debt never realized). Otherwise (partial cover) → seize all the
    /// collateral; the remaining bad debt is socialized by Morpho — recorded in the event, not hidden.
    function _liquidate(MarketParams memory params, Id id, address borrower)
        internal
        returns (uint256 seized, uint256 repaid)
    {
        Position memory p = MORPHO.position(id, borrower);
        uint256 debt = MORPHO.expectedBorrowAssets(params, borrower);
        uint256 px = IOracle(params.oracle).price();
        uint256 maxRepayable = uint256(p.collateral) * px / 1e36 * WAD / _lif(params.lltv);
        if (debt <= maxRepayable) return MORPHO.liquidate(params, borrower, 0, p.borrowShares, abi.encode(id));
        return MORPHO.liquidate(params, borrower, p.collateral, 0, abi.encode(id));
    }

    function _emitCovered(address asset, Id id, address borrower, uint256 shortfall, uint256 covered, uint256 bounty)
        internal
    {
        (Regime eff,,,) = SESSION.regimeOf(asset);
        emit Covered(id, borrower, msg.sender, shortfall, covered, bounty, uint8(eff));
    }

    /// Morpho calls this after transferring the collateral to this contract and before pulling the loan token.
    function onMorphoLiquidate(uint256 repaidAssets, bytes calldata) external {
        if (msg.sender != address(MORPHO)) revert NotMorpho();
        IERC20 coll = IERC20(currentCollateral);
        uint256 seized = coll.balanceOf(address(this));
        coll.safeTransfer(currentLiquidator, seized);
        if (currentData.length > 0) {
            IVigilLiquidateCallback(currentLiquidator).onVigilLiquidate(repaidAssets, seized, currentData);
        } else {
            USDG.safeTransferFrom(currentLiquidator, address(this), repaidAssets);
        }
        USDG.safeApprove(address(MORPHO), 0);
        USDG.safeApprove(address(MORPHO), repaidAssets);
    }
}
