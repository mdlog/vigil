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
import {MockFeed} from "../src/mocks/MockFeed.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";
import {Regime} from "../src/interfaces/IVigil.sol";

/// End-to-end against a real deployment (testnet 46630 or an Anvil fork of it): five actors run the full cycle
/// supply → borrow → member → backstop → keeper attestation → soft unwind → Monday gap (replay of 5 Aug 2024)
/// → liquidateWithCover, with a `require` in every phase — if one fails in simulation, nothing is broadcast.
///
/// Env: PRIVATE_KEY (deployer = keeperSigner, from .env), E2E_MANIFEST (default deployments/robinhood-testnet-46630.json),
///      E2E_FEED_DROP_BPS (default 1418 = −14.18 %, NVDA 5 Aug 2024).
///   forge script script/E2E.s.sol --rpc-url robinhood_testnet --broadcast --slow --gas-estimate-multiplier 200 -vv
/// (the multiplier: index accrual depends on real block time, which runs later than the simulation timestamp)
contract E2E is Script {
    using MarketParamsLib for MarketParams;
    using MorphoBalancesLib for IMorpho;

    uint256 constant SUPPLY = 10_000e6;
    uint256 constant COLLATERAL = 10e18;
    uint256 constant LTV_WAD = 0.859e18;
    uint256 constant LP_DEPOSIT = 5_000e6;
    uint256 constant LIQUIDATOR_USDG = 5_000e6;
    uint256 constant GAS_MONEY = 0.0001 ether;
    int256 constant FEED_BASE = 120e8;

    IMorpho morpho;
    VigilSessionOracle session;
    VigilOracle oracle;
    VigilPremium premium;
    VigilBackstop backstop;
    VigilPreLiquidation preLiq;
    VigilLossReporter lossReporter;
    MockStockToken nvda;
    MockFeed feed;
    MockUSDG usdg;
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
        uint256 dropBps = vm.envOr("E2E_FEED_DROP_BPS", uint256(1418));

        // ── phase 0: gas money for the throwaway actors ──────────────────────────────────────────
        console2.log("[E2E] phase 0 fund: deployer %s funds 5 ephemeral actors", deployer);
        vm.startBroadcast(deployerPk);
        payable(alice.addr).transfer(GAS_MONEY);
        payable(bob.addr).transfer(GAS_MONEY);
        payable(erin.addr).transfer(GAS_MONEY);
        payable(carol.addr).transfer(GAS_MONEY);
        payable(dave.addr).transfer(GAS_MONEY);
        vm.stopBroadcast();

        // ── phase 1: supply ──────────────────────────────────────────────────────────────────────
        r.supplyBefore = _market().totalSupplyAssets;
        vm.startBroadcast(alice.pk);
        usdg.mint(alice.addr, SUPPLY);
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

        // ── phase 3: Vigil membership ────────────────────────────────────────────────────────────
        _join(bob);
        _join(erin);
        require(premium.isMember(id, bob.addr) && premium.isMember(id, erin.addr), "membership");
        console2.log("[E2E] phase 3 member: bob and erin authorized PreLiquidation and funded premium escrow");

        // ── phase 4: backstop ────────────────────────────────────────────────────────────────────
        vm.startBroadcast(carol.pk);
        usdg.mint(carol.addr, LP_DEPOSIT);
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
        (,, uint64 closeAt, uint64 nextOpen) = session.regimeOf(address(nvda));
        r.closureLenBefore = nextOpen - closeAt;
        VigilSessionOracle.Attestation memory a = VigilSessionOracle.Attestation({
            asset: address(nvda),
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
        (,, closeAt, nextOpen) = session.regimeOf(address(nvda));
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
        usdg.mint(dave.addr, LIQUIDATOR_USDG);
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
        int256 gapped = FEED_BASE * int256(10_000 - dropBps) / 10_000;
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
        feed.set(FEED_BASE);
        vm.stopBroadcast();
        require(oracle.price() == r.priceBefore, "feed not restored");
        console2.log("[E2E] phase 9 restore: feed back to 120.00");
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
        nvda = MockStockToken(vm.parseJsonAddress(json, ".contracts.MockStockToken.address"));
        feed = MockFeed(vm.parseJsonAddress(json, ".contracts.MockFeed.address"));
        usdg = MockUSDG(vm.parseJsonAddress(json, ".contracts.MockUSDG.address"));
        id = Id.wrap(vm.parseJsonBytes32(json, ".market.id"));
        market = morpho.idToMarketParams(id);
        require(market.oracle == address(oracle), "manifest market/oracle mismatch");
        require(uint256(feed.answer()) == uint256(FEED_BASE), "feed must start at 120.00");
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
        nvda.mint(who.addr, COLLATERAL);
        nvda.approve(address(morpho), COLLATERAL);
        morpho.supplyCollateral(market, COLLATERAL, who.addr, "");
        morpho.borrow(market, debt, 0, who.addr, who.addr);
        vm.stopBroadcast();
    }

    function _join(Actor memory who) internal {
        uint256 reserve = premium.minReserve(id, who.addr);
        uint256 topUp = reserve * 2 + 1e6;
        vm.startBroadcast(who.pk);
        morpho.setAuthorization(address(preLiq), true);
        usdg.mint(who.addr, topUp);
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
