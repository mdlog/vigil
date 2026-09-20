// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Script, console2} from "forge-std/Script.sol";
import {VigilCalendar} from "../src/VigilCalendar.sol";
import {VigilSessionOracle} from "../src/VigilSessionOracle.sol";
import {VigilRiskEngine} from "../src/VigilRiskEngine.sol";
import {VigilBackstop} from "../src/VigilBackstop.sol";
import {VigilPremium} from "../src/VigilPremium.sol";
import {VigilPreLiquidation} from "../src/VigilPreLiquidation.sol";
import {VigilLossReporter} from "../src/VigilLossReporter.sol";

/// Hands every privileged role of a deployment to its final holders — the step between "deployed from an EOA" and
/// "may accept other people's funds". Reads the deployment manifest, prints the current holders next to the new ones,
/// and only broadcasts when every target is set and (unless ALLOW_EOA=true) has code, i.e. is a multisig or a
/// timelock, not a key on someone's laptop.
///
///   MANIFEST=deployments/robinhood-mainnet-4663.json GUARDIAN=0x… CALIBRATOR=0x… KEEPER_SIGNER=0x… \
///     forge script script/Handover.s.sol --rpc-url robinhood_mainnet            # dry run: prints the plan
///     … --broadcast                                                              # executes the seven calls
///
/// Roles (docs/DESIGN.md › Roles and trust assumptions):
///   guardian      — VigilCalendar.addHoliday/addHalfDay (≥ 7 days ahead), VigilSessionOracle.registerAsset/setRoles,
///                   VigilBackstop.setCoverageCap/setLossReporter, VigilPremium/PreLiquidation/LossReporter market
///                   registration; can never remove a holiday, change a price or pause the oracle.
///   calibrator    — VigilRiskEngine.setSurface (rate-limited, bounded delta) / setPremiumTables / scheduleEvent.
///   keeperSigner  — EIP-712 attestations that can only tighten the session regime (≤ CLOSED, 30-minute life).
///   KEEPER_SIGNER is the one role that is expected to be a hot key (it signs many small messages); the other two
///   should be a multisig with a timelock. All three may be the same address on a shadow launch.
contract Handover is Script {
    function run() external {
        string memory path = vm.envOr("MANIFEST", string("deployments/robinhood-testnet-46630.json"));
        string memory json = vm.readFile(path);
        VigilCalendar calendar = VigilCalendar(vm.parseJsonAddress(json, ".contracts.VigilCalendar.address"));
        VigilSessionOracle session =
            VigilSessionOracle(vm.parseJsonAddress(json, ".contracts.VigilSessionOracle.address"));
        VigilRiskEngine risk = VigilRiskEngine(vm.parseJsonAddress(json, ".contracts.VigilRiskEngine.address"));
        VigilBackstop backstop = VigilBackstop(vm.parseJsonAddress(json, ".contracts.VigilBackstop.address"));
        VigilPremium premium = VigilPremium(vm.parseJsonAddress(json, ".contracts.VigilPremium.address"));
        VigilPreLiquidation preLiq =
            VigilPreLiquidation(vm.parseJsonAddress(json, ".contracts.VigilPreLiquidation.address"));
        VigilLossReporter lossReporter =
            VigilLossReporter(vm.parseJsonAddress(json, ".contracts.VigilLossReporter.address"));

        address guardian = vm.envAddress("GUARDIAN");
        address calibrator = vm.envAddress("CALIBRATOR");
        address keeperSigner = vm.envAddress("KEEPER_SIGNER");
        bool allowEoa = vm.envOr("ALLOW_EOA", false);
        require(guardian != address(0) && calibrator != address(0) && keeperSigner != address(0), "role unset");
        if (!allowEoa) {
            require(guardian.code.length > 0, "GUARDIAN has no code (set ALLOW_EOA=true to hand over to a key)");
            require(calibrator.code.length > 0, "CALIBRATOR has no code (set ALLOW_EOA=true to hand over to a key)");
        }

        console2.log("== Handover plan for %s", path);
        console2.log("  calendar.guardian      %s -> %s", calendar.guardian(), guardian);
        console2.log("  session.guardian       %s -> %s", session.guardian(), guardian);
        console2.log("  session.keeperSigner   %s -> %s", session.keeperSigner(), keeperSigner);
        console2.log("  risk.calibrator        %s -> %s", risk.calibrator(), calibrator);
        console2.log("  risk.guardian          %s -> %s", risk.guardian(), guardian);
        console2.log("  backstop.guardian      %s -> %s", backstop.guardian(), guardian);
        console2.log("  premium.guardian       %s -> %s", premium.guardian(), guardian);
        console2.log("  preLiquidation.guardian %s -> %s", preLiq.guardian(), guardian);
        console2.log("  lossReporter.guardian  %s -> %s", lossReporter.guardian(), guardian);

        uint256 pk = vm.envOr("PRIVATE_KEY", uint256(0));
        if (pk != 0) vm.startBroadcast(pk);
        else vm.startBroadcast();
        calendar.setGuardian(guardian);
        session.setRoles(guardian, keeperSigner);
        risk.setRoles(calibrator, guardian);
        backstop.transferGuardian(guardian);
        premium.transferGuardian(guardian);
        preLiq.transferGuardian(guardian);
        lossReporter.transferGuardian(guardian);
        vm.stopBroadcast();

        require(calendar.guardian() == guardian && session.guardian() == guardian, "handover failed");
        require(risk.calibrator() == calibrator && session.keeperSigner() == keeperSigner, "handover failed");
        console2.log("== Handover complete (simulated unless --broadcast)");
    }
}
