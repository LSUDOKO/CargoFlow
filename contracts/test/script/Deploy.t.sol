// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {Deploy} from "../../script/Deploy.s.sol";
import {CargoFlowAccess} from "../../src/access/CargoFlowAccess.sol";
import {FinancingController} from "../../src/FinancingController.sol";
import {ReceivableVault} from "../../src/ReceivableVault.sol";
import {MockUSDG} from "../../src/mocks/MockUSDG.sol";
import {Groth16Verifier} from "../../generated/Groth16Verifier.sol";
import {Roles} from "../../src/libraries/Roles.sol";

contract DeployScriptTest is Test {
    // anvil account 0: a public, well-known dev key (never funded on a real network)
    string internal constant ANVIL_KEY =
        "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";
    string internal constant FILE = "deployments/test-deploy.json";

    Deploy internal deployScript;
    Deploy.Deployed internal d;
    address internal deployer;

    function setUp() public {
        // accepts the lowercase, un-prefixed form used in the repo's .env
        vm.setEnv("private_key", ANVIL_KEY);
        vm.setEnv("DEPLOYMENT_FILE", FILE);
        deployer = vm.addr(vm.parseUint(string.concat("0x", ANVIL_KEY)));
        deployScript = new Deploy();
        d = deployScript.run();
    }

    function tearDown() public {
        if (vm.exists(FILE)) vm.removeFile(FILE);
    }

    function test_controllerHoldsVaultAndProofRoles() public view {
        CargoFlowAccess access = CargoFlowAccess(d.access);
        assertTrue(access.hasRole(Roles.CONTROLLER_ROLE, d.controller));
        assertTrue(access.hasRole(Roles.PROOF_VERIFIER_ROLE, d.controller));
    }

    function test_deployerIsAdminButNotController() public view {
        CargoFlowAccess access = CargoFlowAccess(d.access);
        assertEq(access.defaultAdmin(), deployer);
        assertFalse(access.hasRole(Roles.CONTROLLER_ROLE, deployer), "admin must not custody");
        assertFalse(access.hasRole(Roles.PROOF_VERIFIER_ROLE, deployer));
    }

    function test_contractsAreWiredTogether() public view {
        assertEq(address(ReceivableVault(d.vault).USDG()), d.usdg);
        FinancingController c = FinancingController(d.controller);
        assertEq(address(c.VAULT()), d.vault);
        assertEq(address(c.EVIDENCE()), d.evidence);
        assertEq(address(c.REGISTRY()), d.registry);
        assertEq(address(c.POLICIES()), d.policies);
        assertEq(address(c.VERIFIER()), d.verifier);
    }

    function test_deploysTheRealGeneratedGroth16Verifier() public view {
        assertTrue(d.verifier.code.length > 0);
        // a verifier for the wrong circuit or an all-zero proof must not verify
        uint256[2] memory a;
        uint256[2][2] memory b;
        uint256[2] memory c;
        uint256[4] memory signals;
        assertFalse(Groth16Verifier(d.verifier).verifyProof(a, b, c, signals));
    }

    function test_localChainDeploysAMockUsdgWith6Decimals() public view {
        assertEq(MockUSDG(d.usdg).decimals(), 6);
    }

    function test_operationalRolesAreGranted() public view {
        CargoFlowAccess access = CargoFlowAccess(d.access);
        assertTrue(access.hasRole(Roles.EVIDENCE_VERIFIER_ROLE, deployScript.workerFor(deployer)));
        assertTrue(access.hasRole(Roles.MONITOR_ROLE, deployScript.monitorFor(deployer)));
        assertTrue(access.hasRole(Roles.DISPUTE_ROLE, deployScript.arbiterFor(deployer)));
        assertTrue(access.hasRole(Roles.FACILITY_MANAGER_ROLE, deployScript.managerFor(deployer)));
    }

    function test_writesManifestWithAddresses() public view {
        string memory json = vm.readFile(FILE);
        assertEq(vm.parseJsonAddress(json, ".contracts.financingController"), d.controller);
        assertEq(vm.parseJsonAddress(json, ".contracts.receivableVault"), d.vault);
        assertEq(vm.parseJsonAddress(json, ".contracts.groth16Verifier"), d.verifier);
        assertEq(vm.parseJsonAddress(json, ".usdg"), d.usdg);
        assertEq(vm.parseJsonUint(json, ".chainId"), block.chainid);
    }
}
