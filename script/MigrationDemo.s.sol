// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Script, console2} from "forge-std/Script.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IMorpho, MarketParams, Authorization, Signature, Id} from "morpho-blue/interfaces/IMorpho.sol";
import {MarketParamsLib} from "morpho-blue/libraries/MarketParamsLib.sol";
import {AUTHORIZATION_TYPEHASH} from "morpho-blue/libraries/ConstantsLib.sol";
import {Morpho} from "morpho-blue/Morpho.sol";
import {ControlOracle} from "../src/mocks/ControlOracle.sol";
import {VigilMigrator} from "../src/periphery/VigilMigrator.sol";

/// The "migration" demo on a live deployment: a plain-oracle TSLA/USDG market at 62.5 % LLTV stands in for the
/// markets that exist on mainnet today; a supplier parks 20 USDG there, then moves the whole position into the
/// Vigil market (86 %) in one transaction through VigilMigrator.
///
///   PHASE=setup   deploys ControlOracle + VigilMigrator, enables LLTV 62.5 % on the (self-deployed) Morpho,
///                 creates the legacy market and supplies 20 USDG to it from the deployer
///   PHASE=migrate signs the Morpho authorization with PRIVATE_KEY and migrates the deployer's position
///                 (the dashboard's Lend tab does the same from a wallet)
///
///   FOUNDRY_PROFILE=fork forge script script/MigrationDemo.s.sol --rpc-url robinhood_testnet --broadcast -vv
contract MigrationDemo is Script {
    using MarketParamsLib for MarketParams;

    uint256 constant LEGACY_LLTV = 0.625e18; // what the stock-token markets on mainnet use today
    uint256 constant SUPPLY = 20e6;

    struct Cfg {
        IMorpho morpho;
        address usdg;
        address stock;
        address feed;
        address irm;
        address vigilOracle;
        uint256 pk;
        address me;
        string json;
    }

    Cfg internal c;

    function run() external {
        string memory path = vm.envOr("MANIFEST", string("deployments/robinhood-testnet-46630.json"));
        c.json = vm.readFile(path);
        c.morpho = IMorpho(vm.parseJsonAddress(c.json, ".contracts.Morpho.address"));
        c.usdg = vm.parseJsonAddress(c.json, ".contracts.USDG.address");
        c.stock = vm.parseJsonAddress(c.json, ".contracts.StockToken.address");
        c.feed = vm.parseJsonAddress(c.json, ".contracts.MockFeed.address");
        c.irm = vm.parseJsonAddress(c.json, ".contracts.MockIRM.address");
        c.vigilOracle = vm.parseJsonAddress(c.json, ".contracts.VigilOracle.address");
        require(Id.unwrap(_vigil().id()) == vm.parseJsonBytes32(c.json, ".market.id"), "manifest market id mismatch");
        c.pk = vm.envUint("PRIVATE_KEY");
        c.me = vm.addr(c.pk);
        if (keccak256(bytes(vm.envOr("PHASE", string("setup")))) == keccak256("setup")) _setup();
        else _migrate();
    }

    function _vigil() internal view returns (MarketParams memory) {
        return MarketParams(c.usdg, c.stock, c.vigilOracle, c.irm, 0.86e18);
    }

    function _setup() internal {
        vm.startBroadcast(c.pk);
        ControlOracle legacyOracle = new ControlOracle(c.feed, 18, 6);
        VigilMigrator migrator = new VigilMigrator(c.morpho);
        if (!c.morpho.isLltvEnabled(LEGACY_LLTV)) Morpho(address(c.morpho)).enableLltv(LEGACY_LLTV);
        MarketParams memory legacy = MarketParams(c.usdg, c.stock, address(legacyOracle), c.irm, LEGACY_LLTV);
        c.morpho.createMarket(legacy);
        IERC20(c.usdg).approve(address(c.morpho), SUPPLY);
        c.morpho.supply(legacy, SUPPLY, 0, c.me, "");
        vm.stopBroadcast();
        console2.log("LegacyOracle  %s", address(legacyOracle));
        console2.log("VigilMigrator %s", address(migrator));
        console2.log("legacy market id:");
        console2.logBytes32(Id.unwrap(legacy.id()));
        console2.log("supplied %s USDG (6d) to the legacy market from %s", SUPPLY, c.me);
    }

    function _migrate() internal {
        VigilMigrator migrator = VigilMigrator(vm.parseJsonAddress(c.json, ".contracts.VigilMigrator.address"));
        MarketParams memory legacy = MarketParams(
            c.usdg, c.stock, vm.parseJsonAddress(c.json, ".contracts.LegacyOracle.address"), c.irm, LEGACY_LLTV
        );
        uint256 shares = c.morpho.position(legacy.id(), c.me).supplyShares;
        require(shares > 0, "nothing to migrate");
        Authorization memory a = Authorization({
            authorizer: c.me,
            authorized: address(migrator),
            isAuthorized: true,
            nonce: c.morpho.nonce(c.me),
            deadline: block.timestamp + 1 hours
        });
        bytes32 digest = keccak256(
            bytes.concat("\x19\x01", c.morpho.DOMAIN_SEPARATOR(), keccak256(abi.encode(AUTHORIZATION_TYPEHASH, a)))
        );
        (uint8 v, bytes32 r, bytes32 s) = vm.sign(c.pk, digest);
        vm.startBroadcast(c.pk);
        (uint256 assets, uint256 sharesIn) = migrator.migrate(legacy, _vigil(), shares, a, Signature(v, r, s));
        vm.stopBroadcast();
        console2.log("migrated %s USDG (6d): %s shares out, %s shares in", assets, shares, sharesIn);
    }
}
