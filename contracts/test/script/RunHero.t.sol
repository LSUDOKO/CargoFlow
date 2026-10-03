// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../../script/Deploy.s.sol";
import {RunHero} from "../../script/RunHero.s.sol";

/// @notice Deploys v2 and runs the whole hero script in-process (both shipments, including the
///         place-based M4, the humidity breach and the covered default). The script asserts every
///         balance itself, so a green run means the story still holds end to end.
contract RunHeroScriptTest is Test {
    string internal constant FILE = "deployments/test-hero.json";

    function setUp() public {
        vm.warp(1_800_000_000);
        // chain id 31337: the scripts use the anvil dev keys, so no environment is needed
        Deploy d = new Deploy();
        d.useManifest(FILE);
        d.run();
    }

    function tearDown() public {
        if (vm.exists(FILE)) vm.removeFile(FILE);
    }

    function test_heroScriptRunsEndToEnd() public {
        RunHero hero = new RunHero();
        hero.useManifest(FILE);
        hero.run();
    }
}
