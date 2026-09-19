// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test, console2} from "forge-std/Test.sol";
import {IMorpho, MarketParams, Id, Market, Position} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
import {MorphoBalancesLib} from "morpho-blue/libraries/periphery/MorphoBalancesLib.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {VigilDeployer} from "../../script/DeployLib.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";
import {IStockToken} from "../../src/interfaces/IStockToken.sol";
import {Regime} from "../../src/interfaces/IVigil.sol";

/// Vigil di atas dependensi ASLI Robinhood Chain mainnet (4663) pada fork lokal: Morpho Blue, AdaptiveCurveIRM,
/// USDG (proxy Paxos), stock token NVDA (ERC-8056, uiMultiplier/effectiveAt/oraclePaused), feed Chainlink NVDA/USD
/// yang beku sejak Jumat 15:55 ET, dan feed USDG/USD. Tidak ada mock kecuali dua suntikan yang disebut eksplisit:
/// harga gap Senin (feed asli tidak bisa digerakkan) dan pembaruan feed USDG/USD setelah `vm.warp` (di chain nyata
/// feed itu terus diperbarui; di fork waktu maju tanpa oracle). Semua saldo dibuat dengan `deal` di salinan lokal.
///
///   FOUNDRY_FORK_TESTS=1 forge test --match-path test/fork/MainnetFork.t.sol -vv
/// RPC publik bukan archive (≈ 1 000 blok state): fork dipin ke blok terbaru; state yang sudah diambil di-cache Foundry.
contract MainnetForkTest is Test {
    using MarketParamsLib for MarketParams;
    using MorphoBalancesLib for IMorpho;

    // Alamat asli (PRD §18, diverifikasi on-chain 19 Sep 2026)
    address constant MORPHO = 0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010;
    address constant IRM = 0x2BD3d5965B26B51814AC95127B2b80dD6CcC0fa1;
    address constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address constant FEED = 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15;
    address constant USDG_FEED = 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2;

    uint256 constant LLTV = 0.86e18;
    uint256 constant COLLATERAL = 10e18;
    uint256 constant SUPPLY = 20_000e6;
    uint256 constant LP_DEPOSIT = 5_000e6;
    uint256 constant DROP_BPS = 1_418; // 5 Agu 2024

    bool enabled;
    IMorpho morpho = IMorpho(MORPHO);
    VigilDeployer.Deployed d;
    Id id;
    address alice = makeAddr("alice");
    address bob = makeAddr("bob");
    address erin = makeAddr("erin");
    address carol = makeAddr("carol");
    address dave = makeAddr("dave");
    uint256 keeperPk = 0xBEEF;

    function setUp() public {
        enabled = vm.envOr("FOUNDRY_FORK_TESTS", false);
        if (!enabled) return;
        uint256 pinned = vm.envOr("FORK_BLOCK", uint256(0));
        if (pinned == 0) vm.createSelectFork(vm.rpcUrl("robinhood_mainnet"));
        else vm.createSelectFork(vm.rpcUrl("robinhood_mainnet"), pinned);
        assertEq(block.chainid, 4663);
        VigilDeployer dep = new VigilDeployer();
        d = dep.deploy(
            VigilDeployer.Config({
                morpho: morpho,
                irm: IRM,
                lltv: LLTV,
                usdg: USDG,
                stockToken: NVDA,
                feed: FEED,
                usdgFeed: USDG_FEED,
                guardian: address(this),
                calibrator: address(this),
                keeperSigner: vm.addr(keeperPk),
                marketHaircutCapBps: 500,
                targetLtvWad: 0.76e18,
                coverageCap: 100_000e6
            })
        );
        id = d.market.id();
        console2.log("fork block %s, chain %s, ts %s", block.number, block.chainid, block.timestamp);
    }

    // ───────────────────────── helpers ─────────────────────────

    function _feed() internal view returns (int256 answer, uint256 updatedAt) {
        (, answer,, updatedAt,) = IAggregatorV3(FEED).latestRoundData();
    }

    /// Feed USDG/USD asli tidak bergerak saat `vm.warp`; di chain nyata ia diperbarui — suntik nilai asli dengan waktu sekarang.
    function _freshenQuoteFeed() internal {
        (uint80 r, int256 q,,, uint80 a) = IAggregatorV3(USDG_FEED).latestRoundData();
        vm.mockCall(
            USDG_FEED,
            abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector),
            abi.encode(r, q, block.timestamp, block.timestamp, a)
        );
    }

    /// Satu-satunya cara membuat gap di feed asli: suntik jawaban baru dengan `updatedAt` sekarang.
    function _gapFeed(int256 answer) internal {
        (uint80 r,,,, uint80 a) = IAggregatorV3(FEED).latestRoundData();
        vm.mockCall(
            FEED,
            abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector),
            abi.encode(r, answer, block.timestamp, block.timestamp, a)
        );
    }

    function _open(address user, uint256 ltvWad) internal returns (uint256 debt) {
        deal(NVDA, user, COLLATERAL);
        uint256 coll = IERC20(NVDA).balanceOf(user); // ERC-8056: saldo tampil × uiMultiplier
        debt = coll * d.oracle.price() / 1e36 * ltvWad / 1e18;
        vm.startPrank(user);
        IERC20(NVDA).approve(MORPHO, coll);
        morpho.supplyCollateral(d.market, coll, user, "");
        morpho.borrow(d.market, debt, 0, user, user);
        vm.stopPrank();
    }

    function _join(address user) internal {
        uint256 topUp = d.premium.minReserve(id, user) * 2 + 1e6;
        deal(USDG, user, topUp);
        vm.startPrank(user);
        morpho.setAuthorization(address(d.preLiq), true);
        IERC20(USDG).approve(address(d.premium), topUp);
        d.premium.topUp(id, user, topUp);
        vm.stopPrank();
        assertTrue(d.premium.isMember(id, user), "member");
    }

    function _ltv(address user) internal view returns (uint256) {
        Position memory p = morpho.position(id, user);
        uint256 debt = morpho.expectedBorrowAssets(d.market, user);
        uint256 collVal = uint256(p.collateral) * d.oracle.price() / 1e36;
        return collVal == 0 ? 0 : debt * 10_000 / collVal;
    }

    // ───────────────────────── tests ─────────────────────────

    /// Feed Chainlink asli beku sejak close terakhir: itu keadaan NORMAL, oracle tetap memberi harga ter-haircut,
    /// dan `unhaircutPrice` = feed NVDA/USD ÷ feed USDG/USD pada skala 1e36 (18 → 6 desimal).
    function test_fork_frozenRealFeedIsUsableAndHaircutApplies() public {
        vm.skip(!enabled);
        (int256 answer, uint256 updatedAt) = _feed();
        (Regime eff, Regime cal_, uint64 closeAt,) = d.session.regimeOf(NVDA);
        console2.log("real NVDA/USD %s (8d) updatedAt %s; regime eff=%s", uint256(answer), updatedAt, uint8(eff));
        assertTrue(d.session.feedIsUsable(NVDA), "frozen feed must be usable");
        uint256 raw = d.oracle.unhaircutPrice();
        (, int256 q,,,) = IAggregatorV3(USDG_FEED).latestRoundData();
        uint256 expected = uint256(answer) * 1e16 * 1e8 / uint256(q); // feed 8d → 1e36 skala 18/6, dibagi USDG/USD
        assertApproxEqRel(raw, expected, 1e14, "unhaircut price follows the real feeds");
        uint256 h = d.oracle.currentHaircutBps();
        assertLe(h, 500);
        assertApproxEqRel(d.oracle.price(), raw * (10_000 - h) / 10_000, 1e12, "price = raw * (1 - haircut)");
        if (cal_ != Regime.MARKET) {
            assertLe(updatedAt, closeAt, "outside MARKET the last update predates the close");
            assertEq(h, 500, "weekend/overnight: engine haircut above the market cap");
        }
    }

    /// Token ERC-8056 asli: uiMultiplier != 1 (dividen), effectiveAt lampau, oraclePaused false → bukan CORP_ACTION;
    /// oraclePaused() dari token (disuntik) adalah satu-satunya jalur yang membuat price() revert.
    function test_fork_realStockTokenFlagsDriveCorpAction() public {
        vm.skip(!enabled);
        IStockToken t = IStockToken(NVDA);
        console2.log("uiMultiplier %s effectiveAt %s paused %s", t.uiMultiplier(), t.effectiveAt(), t.oraclePaused());
        assertGt(t.uiMultiplier(), 1e18);
        (Regime eff,,,) = d.session.regimeOf(NVDA);
        assertTrue(eff != Regime.CORP_ACTION);
        d.session.poke(NVDA);
        d.oracle.price(); // tidak revert
        vm.mockCall(NVDA, abi.encodeWithSelector(IStockToken.oraclePaused.selector), abi.encode(true));
        (eff,,,) = d.session.regimeOf(NVDA);
        assertEq(uint8(eff), uint8(Regime.CORP_ACTION));
        vm.expectRevert();
        d.oracle.price();
        vm.clearMockedCalls();
    }

    struct Cycle {
        uint256 supplyBefore;
        uint256 bobLtvAfterUnwind;
        uint256 priceOpen;
        uint256 priceGap;
        uint256 backstopBefore;
        uint256 erinCovered;
        uint256 bobCovered;
    }

    Cycle c;

    /// Siklus penuh di atas Morpho + IRM + USDG + NVDA asli: posisi dibuka pada harga ter-haircut, Bob di-unwind
    /// sebelum open, lalu Senin 09:30 ET feed asli masih beku (grace 6 jam) → gap −14,18 % disuntik → Erin dicover
    /// backstop, Bob tidak butuh cover, pemasok utuh.
    function test_fork_weekendGapCycleOnRealMorpho() public {
        vm.skip(!enabled);
        (, Regime cal_,, uint64 nextOpen) = d.session.regimeOf(NVDA);
        vm.skip(cal_ == Regime.MARKET, "run this on a weekend/overnight: the fork must start inside a closure");
        _positions();
        _unwindBob();
        _mondayOpen(nextOpen);
        _gapAndLiquidate();
        assertGt(c.erinCovered, 0, "erin covered by the backstop");
        assertEq(c.bobCovered, 0, "bob needs no cover after the unwind");
        assertGe(morpho.market(id).totalSupplyAssets, c.supplyBefore, "suppliers never lose assets");
        assertLt(d.backstop.totalAssets(), c.backstopBefore);
        vm.clearMockedCalls();
    }

    function _positions() internal {
        deal(USDG, alice, SUPPLY);
        vm.startPrank(alice);
        IERC20(USDG).approve(MORPHO, SUPPLY);
        morpho.supply(d.market, SUPPLY, 0, alice, "");
        vm.stopPrank();
        c.supplyBefore = morpho.market(id).totalSupplyAssets;
        uint256 bobDebt = _open(bob, 0.859e18);
        uint256 erinDebt = _open(erin, 0.859e18);
        console2.log("bob debt %s erin debt %s (6d), LTV %s bps", bobDebt, erinDebt, _ltv(bob));
        _join(bob);
        _join(erin);
        deal(USDG, carol, LP_DEPOSIT);
        vm.startPrank(carol);
        IERC20(USDG).approve(address(d.backstop), LP_DEPOSIT);
        d.backstop.deposit(LP_DEPOSIT, carol);
        vm.stopPrank();
    }

    /// Soft unwind Bob selama penutupan (jendela aktif, diskon maksimum).
    function _unwindBob() internal {
        (bool ok, uint256 maxRepay) = d.preLiq.isUnwindable(id, bob);
        assertTrue(ok && maxRepay > 0, "unwindable");
        deal(USDG, dave, 10_000e6);
        vm.startPrank(dave);
        IERC20(USDG).approve(address(d.preLiq), maxRepay);
        d.preLiq.preLiquidate(id, bob, maxRepay, "");
        IERC20(USDG).approve(address(d.lossReporter), type(uint256).max);
        vm.stopPrank();
        c.bobLtvAfterUnwind = _ltv(bob);
        console2.log("bob LTV after unwind %s bps", c.bobLtvAfterUnwind);
        assertLt(c.bobLtvAfterUnwind, 8_000);
    }

    /// Senin 09:30 ET: kalender MARKET, feed asli masih Jumat → dalam grace 6 jam. Haircut akhir pekan di-ramp-OUT
    /// selama satu jam setelah open (bukan dilepas seketika): +10 menit engine ≈ 977·(50/60) > cap → oracle 500;
    /// +45 menit engine ≈ 977·(15/60) ≈ 244 bps — gap Senin pagi datang saat jaminan masih terdiskon.
    function _mondayOpen(uint64 nextOpen) internal {
        vm.warp(uint256(nextOpen) + 10 minutes);
        _freshenQuoteFeed();
        (Regime eff,,,) = d.session.regimeOf(NVDA);
        assertEq(uint8(eff), uint8(Regime.MARKET));
        assertTrue(d.session.feedIsUsable(NVDA), "frozen-since-Friday feed is inside the Monday grace");
        assertApproxEqAbs(uint256(d.risk.haircutBps(NVDA)), uint256(814), 6, "ramp-out 10 min after open");
        assertEq(d.oracle.currentHaircutBps(), 500, "still capped 10 min after open");
        vm.warp(uint256(nextOpen) + 45 minutes);
        assertApproxEqAbs(uint256(d.oracle.currentHaircutBps()), uint256(244), 6, "partial haircut 45 min after open");
        c.priceOpen = d.oracle.price();
        console2.log("monday +45min: oracle haircut %s bps, price %s", d.oracle.currentHaircutBps(), c.priceOpen);
    }

    function _gapAndLiquidate() internal {
        (int256 answer,) = _feed();
        _gapFeed(answer * int256(10_000 - DROP_BPS) / 10_000);
        c.priceGap = d.oracle.price();
        assertLt(c.priceGap, c.priceOpen);
        (uint256 shortfall,, bool member, bool covered) = d.lossReporter.previewCover(id, erin);
        console2.log("erin shortfall %s (6d) member=%s covered=%s", shortfall, member, covered);
        assertGt(shortfall, 0);
        assertTrue(member && covered, "cover window after open");
        c.backstopBefore = d.backstop.totalAssets();
        vm.startPrank(dave);
        (,, c.erinCovered) = d.lossReporter.liquidateWithCover(id, erin, "");
        (,, c.bobCovered) = d.lossReporter.liquidateWithCover(id, bob, "");
        vm.stopPrank();
        console2.log("erin covered %s bob covered %s", c.erinCovered, c.bobCovered);
        console2.log("backstop %s -> %s", c.backstopBefore, d.backstop.totalAssets());
    }
}
