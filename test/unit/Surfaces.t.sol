// SPDX-License-Identifier: MIT
pragma solidity ^0.8.19;

import {Test} from "forge-std/Test.sol";
import {VigilParams} from "../../script/DeployLib.sol";
import {VigilRiskEngine} from "../../src/VigilRiskEngine.sol";

contract SurfacesTest is Test {
    function surfaceOf(string memory s) external pure returns (VigilRiskEngine.Surface memory) {
        return VigilParams.surfaceFor(s);
    }

    function test_everyRobinhoodTestnetTickerHasASurface() public view {
        string[7] memory t = ["NVDA", "TSLA", "AAPL", "AMD", "AMZN", "NFLX", "PLTR"];
        for (uint256 i; i < t.length; ++i) {
            VigilRiskEngine.Surface memory s = this.surfaceOf(t[i]);
            assertGt(s.sigmaGapWad, 0, t[i]);
            assertLt(s.sigmaGapWad, 0.1e18, t[i]); // a night σ above 10 % would be a data error
            assertEq(s.kTailBps, 30_000);
            assertEq(s.hFloorBps, 50);
            assertEq(s.hMaxBps, 2_500);
        }
        assertEq(this.surfaceOf("TSLA").sigmaGapWad, 0.0176e18); // the live market must not move
    }

    function test_unknownTickerReverts() public {
        vm.expectRevert(bytes("VigilParams: no surface for symbol"));
        this.surfaceOf("GME");
    }
}
