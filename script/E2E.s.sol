// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Script, console2} from "forge-std/Script.sol";
import {IMorpho, MarketParams, Id, Market, Position} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
import {MorphoBalancesLib} from "morpho-blue/libraries/periphery/MorphoBalancesLib.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VigilSessionOracle} from "../src/VigilSessionOracle.sol";
import {VigilOracle} from "../src/VigilOracle.sol";
import {VigilPremium} from "../src/VigilPremium.sol";
import {VigilBackstop} from "../src/VigilBackstop.sol";
import {VigilPreLiquidation} from "../src/VigilPreLiquidation.sol";
import {VigilLossReporter} from "../src/VigilLossReporter.sol";
import {MockStockToken} from "../src/mocks/MockStockToken.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {MockFeed} from "../src/mocks/MockFeed.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Regime} from "../src/interfaces/IVigil.sol";

/// End-to-end against a real deployment (testnet 46630 or an Anvil fork of it): five actors run the full cycle
/// supply → borrow → member → backstop → keeper attestation → soft unwind → Monday gap (replay of 5 Aug 2024)
/// → liquidateWithCover, with a `require` in every phase — if one fails in simulation, nothing is broadcast.
///
/// USDG is the real one: Paxos's testnet Global Dollar (0x7E955252E15c84f5768B83c41a71F9eba181802F, 100 USDG per
/// wallet per day from faucet.paxos.com), so the deployer must hold USDG_NEEDED before the run and hands it to the
/// actors in phase 0. The amounts are sized to a few faucet claims; the NVDA collateral is a mock and is minted.
///
/// Env: PRIVATE_KEY (deployer = keeperSigner, from .env), E2E_MANIFEST (default deployments/robinhood-testnet-46630.json),
///      E2E_FEED_DROP_BPS (default 1418 = −14.18 %, NVDA 5 Aug 2024).
///   forge script script/E2E.s.sol --rpc-url robinhood_testnet --broadcast --slow --gas-estimate-multiplier 200 -vv
/// (the multiplier: index accrual depends on real block time, which runs later than the simulation timestamp)
contract E2E is Script {
    using MarketParamsLib for MarketParams;
    using MorphoBalancesLib for IMorpho;

    uint256 constant SUPPLY = 120e6;
    uint256 constant COLLATERAL = 0.15e18; // per member: ≈ 55 USDG of TSLA at 364, ≈ 44.6 USDG borrowed at the haircut price
    uint256 constant LTV_WAD = 0.859e18;
    uint256 constant LP_DEPOSIT = 50e6;
    uint256 constant LIQUIDATOR_USDG = 95e6; // unwind repay ≈ 14 + both liquidations ≈ 75 USDG
    uint256 constant ESCROW_FUND = 1e6; // per member; the 7-day reserve on a ~45 USDG debt is well under 0.1 USDG
    uint256 constant USDG_NEEDED = SUPPLY + LP_DEPOSIT + LIQUIDATOR_USDG + 2 * ESCROW_FUND; // 267 USDG
    uint256 constant GAS_MONEY = 0.0001 ether;
    int256 feedBase; // the feed's answer at the start of the run; restored in phase 9

    IMorpho morpho;
    VigilSessionOracle session;
    VigilOracle oracle;
    VigilPremium premium;
    VigilBackstop backstop;
    VigilPreLiquidation preLiq;
    VigilLossReporter lossReporter;
    IERC20 stock; // the collateral: Robinhood's testnet stock token (real, transferred from the deployer) or a mock (minted)
    bool realStock;
    string symbol;
    MockFeed feed;
    IERC20 usdg;
    MarketParams market;
    Id id;

    struct Actor {
        string name;
        uint256 pk;
        address addr;
    }

    Actor alice; // USDG supplier
    Actor bob; // member unwound before the gap
    Actor erin; // max-LTV member who is not unwound → cover
    Actor carol; // backstop LP
    Actor dave; // unwinder & liquidator

    struct Result {
        uint256 bobDebt0;
        uint256 erinDebt0;
        uint256 bobLtv0;
        uint256 erinLtv0;
        uint256 bobLtvAfterUnwind;
        uint256 unwindRepaid;
        uint256 unwindSeized;
        uint256 unwindDiscountBps;
        uint256 priceBefore;
        uint256 priceAfter;
        uint256 erinShortfall;
        uint256 erinCovered;
        uint256 bobCovered;
        uint256 supplyBefore;
        uint256 supplyAfter;
        uint256 backstopBefore;
        uint256 backstopAfter;
        uint256 totalCoveredBefore;
        uint256 totalCoveredAfter;
        uint256 closureLenBefore;
        uint256 closureLenAfter;
        uint256 feedGapCents;
    }

    Result r;

    function run() external {
        uint256 deployerPk = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerPk);
        _load();
        _actors();
        // the ticker's worst weekend gap in calibrator/report_full.md — both fell on Monday 5 Aug 2024
        uint256 defaultDrop = keccak256(bytes(symbol)) == keccak256("TSLA") ? 1081 : 1418;
        uint256 dropBps = vm.envOr("E2E_FEED_DROP_BPS", defaultDrop);

        // ── phase 0: gas money and USDG for the throwaway actors ─────────────────────────────────
        require(usdg.balanceOf(deployer) >= USDG_NEEDED, "deployer needs USDG_NEEDED (faucet.paxos.com)");
        if (realStock) {
            require(stock.balanceOf(deployer) >= 2 * COLLATERAL, "deployer needs the collateral (Robinhood faucet)");
        }
        console2.log("[E2E] feed base %s cents", uint256(feedBase) / 1e6);
        console2.log(
            "[E2E] phase 0 fund: deployer %s funds 5 ephemeral actors with gas and %s USDG", deployer, USDG_NEEDED / 1e6
        );
        vm.startBroadcast(deployerPk);
        payable(alice.addr).transfer(GAS_MONEY);
        payable(bob.addr).transfer(GAS_MONEY);
        payable(erin.addr).transfer(GAS_MONEY);
        payable(carol.addr).transfer(GAS_MONEY);
        payable(dave.addr).transfer(GAS_MONEY);
        require(usdg.transfer(alice.addr, SUPPLY), "usdg transfer");
        require(usdg.transfer(bob.addr, ESCROW_FUND), "usdg transfer");
        require(usdg.transfer(erin.addr, ESCROW_FUND), "usdg transfer");
        require(usdg.transfer(carol.addr, LP_DEPOSIT), "usdg transfer");
        require(usdg.transfer(dave.addr, LIQUIDATOR_USDG), "usdg transfer");
        if (realStock) {
            require(stock.transfer(bob.addr, COLLATERAL), "stock transfer");
            require(stock.transfer(erin.addr, COLLATERAL), "stock transfer");
        }
        vm.stopBroadcast();

        // ── phase 1: supply ──────────────────────────────────────────────────────────────────────
        r.supplyBefore = _market().totalSupplyAssets;
        vm.startBroadcast(alice.pk);
        usdg.approve(address(morpho), SUPPLY);
        morpho.supply(market, SUPPLY, 0, alice.addr, "");
        vm.stopBroadcast();
        require(_market().totalSupplyAssets >= r.supplyBefore + SUPPLY, "supply not credited");
        console2.log("[E2E] phase 1 supply: alice supplied %s USDG", SUPPLY / 1e6);

        // ── phase 2: borrow at the haircut oracle price ──────────────────────────────────────────
        r.priceBefore = oracle.price();
        r.bobDebt0 = _borrow(bob);
        r.erinDebt0 = _borrow(erin);
        r.bobLtv0 = _ltv(bob.addr);
        r.erinLtv0 = _ltv(erin.addr);
        require(r.bobLtv0 > 8_500 && r.bobLtv0 < 8_600, "bob ltv");
        console2.log(
            "[E2E] phase 2 borrow: bob %s USDG, erin %s USDG (6d) at oracle price %s cents (haircut applied)",
            r.bobDebt0,
            r.erinDebt0,
            r.priceBefore / 1e22
        );
        console2.log("[E2E] collateral %s %s (18d) per member", COLLATERAL, symbol);

        // ── phase 3: Vigil membership ────────────────────────────────────────────────────────────
        _join(bob);
        _join(erin);
        require(premium.isMember(id, bob.addr) && premium.isMember(id, erin.addr), "membership");
        console2.log("[E2E] phase 3 member: bob and erin authorized PreLiquidation and funded premium escrow");

        // ── phase 4: backstop ────────────────────────────────────────────────────────────────────
        vm.startBroadcast(carol.pk);
        usdg.approve(address(backstop), LP_DEPOSIT);
        uint256 shares = backstop.deposit(LP_DEPOSIT, carol.addr);
        backstop.requestWithdraw(shares / 10);
        vm.stopBroadcast();
        r.backstopBefore = backstop.totalAssets();
        r.totalCoveredBefore = backstop.totalCovered();
        require(r.backstopBefore >= LP_DEPOSIT, "backstop deposit");
        console2.log(
            "[E2E] phase 4 backstop: carol deposited %s USDG, requested 10%% exit (7-day cooldown)", LP_DEPOSIT / 1e6
        );

        // ── phase 5: keeper attestation (open delayed by 1 h) ───────────────────────────────────
        (,, uint64 closeAt, uint64 nextOpen) = session.regimeOf(address(stock));
        r.closureLenBefore = nextOpen - closeAt;
        VigilSessionOracle.Attestation memory a = VigilSessionOracle.Attestation({
            asset: address(stock),
            regime: uint8(Regime.CLOSED),
            closeAt: closeAt,
            nextOpen: nextOpen + 1 hours,
            issuedAt: uint64(block.timestamp),
            deadline: uint64(block.timestamp + 20 minutes)
        });
        (uint8 v, bytes32 rr, bytes32 ss) = vm.sign(deployerPk, session.hashAttestation(a));
        vm.startBroadcast(deployerPk);
        session.attest(a, abi.encodePacked(rr, ss, v)); // attest() persists the index (internal poke) before it takes effect
        vm.stopBroadcast();
        (,, closeAt, nextOpen) = session.regimeOf(address(stock));
        r.closureLenAfter = nextOpen - closeAt;
        require(r.closureLenAfter == r.closureLenBefore + 1 hours, "attestation not applied");
        console2.log(
            "[E2E] phase 5 keeper: attested delayed open, closure %s -> %s (tenths of an hour)",
            r.closureLenBefore / 360,
            r.closureLenAfter / 360
        );

        // ── phase 6: soft unwind of Bob to the target LTV ────────────────────────────────────────
        (bool ok, uint256 maxRepay) = preLiq.isUnwindable(id, bob.addr);
        require(ok && maxRepay > 0, "bob not unwindable");
        r.unwindDiscountBps = preLiq.currentDiscountBps(id, bob.addr);
        vm.startBroadcast(dave.pk);
        usdg.approve(address(preLiq), maxRepay);
        (r.unwindRepaid, r.unwindSeized) = preLiq.preLiquidate(id, bob.addr, maxRepay, "");
        vm.stopBroadcast();
        r.bobLtvAfterUnwind = _ltv(bob.addr);
        require(r.bobLtvAfterUnwind < r.bobLtv0, "unwind did not lower ltv");
        console2.log(
            "[E2E] phase 6 unwind: dave repaid %s USDG (6d) for bob at %s bps discount, bob LTV %s bps",
            r.unwindRepaid,
            r.unwindDiscountBps,
            r.bobLtvAfterUnwind
        );

        // ── phase 7: Monday gap — replay of 5 Aug 2024 ───────────────────────────────────────────
        int256 gapped = feedBase * int256(10_000 - dropBps) / 10_000;
        vm.startBroadcast(dave.pk);
        feed.set(gapped);
        vm.stopBroadcast();
        r.priceAfter = oracle.price();
        require(r.priceAfter < r.priceBefore, "price did not drop");
        (r.erinShortfall,,,) = lossReporter.previewCover(id, erin.addr);
        require(r.erinShortfall > 0, "expected a shortfall for erin");
        r.feedGapCents = uint256(gapped) / 1e6;
        console2.log(
            "[E2E] phase 7 gap: feed -%s bps, oracle price %s -> %s cents",
            dropBps,
            r.priceBefore / 1e22,
            r.priceAfter / 1e22
        );

        // ── phase 8: liquidation with cover ──────────────────────────────────────────────────────
        vm.startBroadcast(dave.pk);
        usdg.approve(address(lossReporter), type(uint256).max);
        (,, r.erinCovered) = lossReporter.liquidateWithCover(id, erin.addr, "");
        (,, r.bobCovered) = lossReporter.liquidateWithCover(id, bob.addr, "");
        vm.stopBroadcast();
        r.supplyAfter = _market().totalSupplyAssets;
        r.backstopAfter = backstop.totalAssets();
        r.totalCoveredAfter = backstop.totalCovered();
        require(r.erinCovered > 0, "erin should be covered");
        require(r.bobCovered == 0, "bob should not need cover");
        require(r.supplyAfter >= r.supplyBefore + SUPPLY, "suppliers lost assets");
        // the backstop pays the cover + the liquidator bounty (COVER_BOUNTY_BPS = 10) and receives member premiums in between
        uint256 paid = r.totalCoveredAfter - r.totalCoveredBefore;
        require(paid >= r.erinCovered && paid <= r.erinCovered + r.erinCovered / 1_000 + 1, "backstop accounting");
        require(r.backstopAfter < r.backstopBefore, "backstop did not pay");
        console2.log(
            "[E2E] phase 8 liquidate: erin shortfall %s covered %s (6d), bob covered %s, suppliers untouched",
            r.erinShortfall,
            r.erinCovered,
            r.bobCovered
        );

        // ── phase 9: restore the feed ────────────────────────────────────────────────────────────
        vm.startBroadcast(dave.pk);
        feed.set(feedBase);
        vm.stopBroadcast();
        require(oracle.price() == r.priceBefore, "feed not restored");
        console2.log("[E2E] phase 9 restore: feed back to %s cents", uint256(feedBase) / 1e6);
        _summary();
    }

    // ───────────────────────── helpers ─────────────────────────

    function _load() internal {
        string memory path = vm.envOr("E2E_MANIFEST", string("deployments/robinhood-testnet-46630.json"));
        string memory json = vm.readFile(path);
        morpho = IMorpho(vm.parseJsonAddress(json, ".contracts.Morpho.address"));
        session = VigilSessionOracle(vm.parseJsonAddress(json, ".contracts.VigilSessionOracle.address"));
        oracle = VigilOracle(vm.parseJsonAddress(json, ".contracts.VigilOracle.address"));
        premium = VigilPremium(vm.parseJsonAddress(json, ".contracts.VigilPremium.address"));
        backstop = VigilBackstop(vm.parseJsonAddress(json, ".contracts.VigilBackstop.address"));
        preLiq = VigilPreLiquidation(vm.parseJsonAddress(json, ".contracts.VigilPreLiquidation.address"));
        lossReporter = VigilLossReporter(vm.parseJsonAddress(json, ".contracts.VigilLossReporter.address"));
        realStock = vm.keyExistsJson(json, ".contracts.StockToken");
        stock = IERC20(
            vm.parseJsonAddress(json, realStock ? ".contracts.StockToken.address" : ".contracts.MockStockToken.address")
        );
        symbol = IERC20Metadata(address(stock)).symbol();
        feed = MockFeed(vm.parseJsonAddress(json, ".contracts.MockFeed.address"));
        usdg = IERC20(
            vm.parseJsonAddress(
                json,
                vm.keyExistsJson(json, ".contracts.USDG") ? ".contracts.USDG.address" : ".contracts.MockUSDG.address"
            )
        );
        id = Id.wrap(vm.parseJsonBytes32(json, ".market.id"));
        market = morpho.idToMarketParams(id);
        require(market.oracle == address(oracle), "manifest market/oracle mismatch");
        feedBase = feed.answer();
        require(feedBase > 0, "feed has no price");
    }

    function _actors() internal {
        alice = _actor("alice");
        bob = _actor("bob");
        erin = _actor("erin");
        carol = _actor("carol");
        dave = _actor("dave");
    }

    /// A throwaway wallet per run (label + timestamp); the key is never printed.
    function _actor(string memory name) internal returns (Actor memory a) {
        uint256 pk = uint256(keccak256(abi.encodePacked("vigil-e2e", name, block.timestamp, block.number)));
        a = Actor({name: name, pk: pk, addr: vm.addr(pk)});
        console2.log("[E2E] actor %s = %s", name, a.addr);
    }

    function _market() internal view returns (Market memory) {
        return morpho.market(id);
    }

    function _borrow(Actor memory who) internal returns (uint256 debt) {
        uint256 px = oracle.price();
        debt = COLLATERAL * px / 1e36 * LTV_WAD / 1e18;
        vm.startBroadcast(who.pk);
        if (!realStock) MockStockToken(address(stock)).mint(who.addr, COLLATERAL);
        stock.approve(address(morpho), COLLATERAL);
        morpho.supplyCollateral(market, COLLATERAL, who.addr, "");
        morpho.borrow(market, debt, 0, who.addr, who.addr);
        vm.stopBroadcast();
    }

    function _join(Actor memory who) internal {
        uint256 reserve = premium.minReserve(id, who.addr);
        uint256 topUp = ESCROW_FUND;
        require(topUp >= reserve * 2, "escrow fund below twice the reserve");
        vm.startBroadcast(who.pk);
        morpho.setAuthorization(address(preLiq), true);
        usdg.approve(address(premium), topUp);
        premium.topUp(id, who.addr, topUp);
        vm.stopBroadcast();
    }

    function _ltv(address who) internal view returns (uint256 bps) {
        Position memory p = morpho.position(id, who);
        uint256 debt = morpho.expectedBorrowAssets(market, who);
        if (p.collateral == 0) return 0;
        uint256 collVal = uint256(p.collateral) * oracle.price() / 1e36;
        return collVal == 0 ? 0 : debt * 10_000 / collVal;
    }

    function _summary() internal view {
        console2.log("");
        console2.log(
            "=== E2E SUMMARY (%s) ===", vm.envOr("E2E_MANIFEST", string("deployments/robinhood-testnet-46630.json"))
        );
        console2.log("oracle price before / during gap   %s / %s cents", r.priceBefore / 1e22, r.priceAfter / 1e22);
        console2.log("feed during gap %s cents", r.feedGapCents);
        console2.log(
            "closure length before / attested   %s / %s tenths of an hour",
            r.closureLenBefore / 360,
            r.closureLenAfter / 360
        );
        console2.log("bob  debt %s (6d), LTV %s -> unwound to %s bps", r.bobDebt0, r.bobLtv0, r.bobLtvAfterUnwind);
        console2.log("     unwind repaid %s (6d), discount %s bps", r.unwindRepaid, r.unwindDiscountBps);
        console2.log("erin debt %s (6d), LTV %s bps, not unwound", r.erinDebt0, r.erinLtv0);
        console2.log("erin shortfall %s -> covered %s (6d)", r.erinShortfall, r.erinCovered);
        console2.log("bob  covered %s (unwind made cover unnecessary)", r.bobCovered);
        console2.log("suppliers totalSupplyAssets %s -> %s (6d)", r.supplyBefore, r.supplyAfter);
        console2.log("backstop totalAssets %s -> %s (6d)", r.backstopBefore, r.backstopAfter);
        console2.log(
            "backstop totalCovered delta %s (cover + 0.1%% bounty)", r.totalCoveredAfter - r.totalCoveredBefore
        );
    }
}
