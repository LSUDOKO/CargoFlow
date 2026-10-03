// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {CargoFlowAccess} from "../src/access/CargoFlowAccess.sol";
import {ShipmentRegistry} from "../src/ShipmentRegistry.sol";
import {PolicyEngine} from "../src/PolicyEngine.sol";
import {EvidenceRegistry} from "../src/EvidenceRegistry.sol";
import {ReceivableVault} from "../src/ReceivableVault.sol";
import {FinancingController} from "../src/FinancingController.sol";
import {CoverPool} from "../src/CoverPool.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";
import {Groth16Verifier} from "../generated/Groth16Verifier.sol";
import {Roles} from "../src/libraries/Roles.sol";
import {ScriptBase} from "./ScriptBase.sol";

/// @notice Deploys the full CargoFlow core (v2: with the CoverPool) and writes
///         `deployments/<network>.json`. The manifest keeps every v1 key; v2 adds `contracts.coverPool`.
///
///   Local:    anvil &  then  forge script script/Deploy.s.sol --rpc-url local --broadcast
///   Testnet:  forge script script/Deploy.s.sol --rpc-url robinhood_testnet --broadcast
///
/// Uses the real USDG from `USDG_ADDRESS` on public networks; deploys a 6-decimal MockUSDG only on
/// the local chain. Operational role holders come from WORKER_ADDRESS / MONITOR_ADDRESS /
/// ARBITER_ADDRESS / MANAGER_ADDRESS (defaulting to anvil accounts locally, else the deployer).
contract Deploy is ScriptBase {
    struct Deployed {
        address access;
        address registry;
        address policies;
        address evidence;
        address vault;
        address controller;
        address verifier;
        address usdg;
        address coverPool;
    }

    function run() external returns (Deployed memory d) {
        uint256 pk = _deployerKey();
        address deployer = vm.addr(pk);

        address usdg = vm.envOr("USDG_ADDRESS", address(0));
        if (usdg == address(0) && !_isLocal()) revert("set USDG_ADDRESS for public networks");

        uint48 adminDelay = uint48(vm.envOr("ADMIN_TRANSFER_DELAY", _isLocal() ? 0 : 1 days));

        vm.startBroadcast(pk);
        if (usdg == address(0)) usdg = address(new MockUSDG());

        CargoFlowAccess access = new CargoFlowAccess(adminDelay, deployer);
        ShipmentRegistry registry = new ShipmentRegistry();
        PolicyEngine policies = new PolicyEngine(address(registry));
        EvidenceRegistry evidence = new EvidenceRegistry(address(access));
        ReceivableVault vault = new ReceivableVault(address(access), usdg);
        // the snarkjs-generated verifier for circuits/telemetry_epoch.circom, unless one is supplied
        address verifier = vm.envOr("VERIFIER_ADDRESS", address(0));
        if (verifier == address(0)) verifier = address(new Groth16Verifier());
        FinancingController controller = new FinancingController(
            address(access),
            address(registry),
            address(policies),
            address(evidence),
            address(vault),
            verifier
        );

        // Default cover reads facility state from the controller; it is granted no role at all.
        CoverPool coverPool = new CoverPool(address(access), address(controller));

        // The controller is the only contract that may drive the vault or mark proofs verified.
        access.grantRole(Roles.CONTROLLER_ROLE, address(controller));
        access.grantRole(Roles.PROOF_VERIFIER_ROLE, address(controller));

        access.grantRole(Roles.EVIDENCE_VERIFIER_ROLE, workerFor(deployer));
        access.grantRole(Roles.MONITOR_ROLE, monitorFor(deployer));
        access.grantRole(Roles.DISPUTE_ROLE, arbiterFor(deployer));
        access.grantRole(Roles.FACILITY_MANAGER_ROLE, managerFor(deployer));
        vm.stopBroadcast();

        d = Deployed({
            access: address(access),
            registry: address(registry),
            policies: address(policies),
            evidence: address(evidence),
            vault: address(vault),
            controller: address(controller),
            verifier: verifier,
            usdg: usdg,
            coverPool: address(coverPool)
        });
        _writeManifest(d, deployer);
    }

    function workerFor(address deployer) public view returns (address) {
        return _roleHolder("WORKER_ADDRESS", ANVIL_KEY_4, deployer);
    }

    function monitorFor(address deployer) public view returns (address) {
        return _roleHolder("MONITOR_ADDRESS", ANVIL_KEY_5, deployer);
    }

    function arbiterFor(address deployer) public view returns (address) {
        return _roleHolder("ARBITER_ADDRESS", ANVIL_KEY_6, deployer);
    }

    function managerFor(address deployer) public view returns (address) {
        return vm.envOr("MANAGER_ADDRESS", deployer);
    }

    function _roleHolder(string memory envName, string memory anvilKey, address fallbackAddr)
        internal
        view
        returns (address)
    {
        address fromEnv = vm.envOr(envName, address(0));
        if (fromEnv != address(0)) return fromEnv;
        return _isLocal() ? vm.addr(_parseKey(anvilKey)) : fallbackAddr;
    }

    function _writeManifest(Deployed memory d, address deployer) internal {
        string memory c = "contracts";
        vm.serializeAddress(c, "access", d.access);
        vm.serializeAddress(c, "shipmentRegistry", d.registry);
        vm.serializeAddress(c, "policyEngine", d.policies);
        vm.serializeAddress(c, "evidenceRegistry", d.evidence);
        vm.serializeAddress(c, "receivableVault", d.vault);
        vm.serializeAddress(c, "groth16Verifier", d.verifier);
        vm.serializeAddress(c, "coverPool", d.coverPool);
        string memory contractsJson = vm.serializeAddress(c, "financingController", d.controller);

        string memory root = "manifest";
        vm.serializeString(root, "network", _networkName());
        vm.serializeUint(root, "chainId", block.chainid);
        vm.serializeAddress(root, "usdg", d.usdg);
        vm.serializeAddress(root, "deployer", deployer);
        string memory out = vm.serializeString(root, "contracts", contractsJson);
        vm.writeJson(out, _manifestPath());
    }
}
