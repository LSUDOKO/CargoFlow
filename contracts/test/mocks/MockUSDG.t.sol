// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {MockUSDG} from "../../src/mocks/MockUSDG.sol";

contract MockUSDGTest is Test {
    MockUSDG internal usdg;

    function setUp() public {
        usdg = new MockUSDG();
    }

    function test_matchesRealUsdgMetadata() public view {
        assertEq(usdg.decimals(), 6);
        assertEq(usdg.symbol(), "USDG");
    }

    function test_anyoneCanMintOnTestnetMock() public {
        address user = makeAddr("user");
        usdg.mint(user, 40_000e6);
        assertEq(usdg.balanceOf(user), 40_000e6);
    }
}
