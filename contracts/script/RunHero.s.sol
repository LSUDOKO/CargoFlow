// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {FinancingController} from "../src/FinancingController.sol";
import {EvidenceRegistry} from "../src/EvidenceRegistry.sol";
import {PolicyEngine} from "../src/PolicyEngine.sol";
import {ShipmentRegistry} from "../src/ShipmentRegistry.sol";
import {ReceivableVault} from "../src/ReceivableVault.sol";
import {IFinancingController} from "../src/interfaces/IFinancingController.sol";
import {IPolicyEngine} from "../src/interfaces/IPolicyEngine.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";
import {ScriptBase} from "./ScriptBase.sol";

/// @notice Runs the hero scenario (docs/project/18-demo-script.md) as real transactions against a
///         deployed CargoFlow: fund -> M1 -> M2 -> thermal anomaly -> pause -> recovery -> M3-M5 -> settle.
///
///   forge script script/RunHero.s.sol --rpc-url local --broadcast
///
/// Locally the roles use anvil accounts. On a public network set DEMO_EXPORTER_KEY, DEMO_FINANCIER_KEY,
/// DEMO_BUYER_KEY, DEMO_WORKER_KEY, DEMO_MONITOR_KEY, DEMO_ARBITER_KEY (the worker/monitor/arbiter keys
/// must match the addresses granted at deploy time) and pre-fund the financier (40,000 USDG) and buyer
/// (100,000 USDG). A deliberately reverting transaction (the "blocked M3" moment) is not broadcast here;
/// the dashboard demonstrates it with a simulated call.
contract RunHero is ScriptBase {
    uint256 internal constant COMMITTED = 40_000e6;
    uint256 internal constant INVOICE = 100_000e6;
    uint256 internal constant TRANCHE = 8_000e6;
    uint16 internal constant FEE_BPS = 300;

    struct Keys {
        uint256 exporter;
        uint256 financier;
        uint256 buyer;
        uint256 worker;
        uint256 monitor;
        uint256 arbiter;
    }

    FinancingController internal controller;
    EvidenceRegistry internal evidence;
    ShipmentRegistry internal registry;
    PolicyEngine internal policies;
    ReceivableVault internal vault;
    MockUSDG internal usdg;
    bytes32 internal id;

    function run() external {
        _load();
        Keys memory k = _keys();
        address exporter = vm.addr(k.exporter);
        address financier = vm.addr(k.financier);
        address buyer = vm.addr(k.buyer);

        _ensureFunds(k, financier, buyer);
        uint256 financierBefore = usdg.balanceOf(financier);
        uint256 exporterBefore = usdg.balanceOf(exporter);

        // Scene 1: shipment + policy + facility
        IPolicyEngine.Policy memory policy = IPolicyEngine.Policy({
            minTempX100: 200,
            maxTempX100: 800,
            maxEvidenceAgeSec: 1800,
            maxRouteDeviationM: 25_000,
            minEvidenceScore: 75,
            maxConflictBps: 3000,
            maxRiskBps: 3500,
            requiresZK: false
        });
        bytes32 ref = keccak256(
            bytes(
                vm.envOr(
                    "SHIPMENT_REF", string.concat("CF-2026-SG01-", vm.toString(block.timestamp))
                )
            )
        );
        vm.startBroadcast(k.exporter);
        id = registry.registerShipment(
            ref,
            buyer,
            keccak256("invoice-CF-2026-SG01.pdf"),
            keccak256("IN-SG-route"),
            policies.hashPolicy(policy),
            INVOICE
        );
        policies.setPolicy(id, policy);
        controller.createFacility(id, financier, FEE_BPS, _milestones());
        vm.stopBroadcast();

        // Scene 2: funding
        vm.startBroadcast(k.financier);
        usdg.approve(address(vault), COMMITTED);
        controller.depositCapital(id);
        vm.stopBroadcast();

        vm.broadcast(k.exporter);
        controller.startTransit(id);

        // Scene 3: M1 and M2 clear
        _commit(k.worker, 0, 1, 94, 500);
        _release(k.exporter, 0, 1);
        _commit(k.worker, 1, 1, 96, 300);
        _release(k.exporter, 1, 1);

        // Scene 4: thermal excursion (5.2 -> 11.7 C): score 48, conflict 0.78 -> monitor pauses
        _commit(k.worker, 2, 1, 48, 7800);
        vm.broadcast(k.monitor);
        controller.pauseFinancing(id, keccak256("THERMAL_EXCURSION"));

        // Scene 5: secondary probe (4.6 C) verified, score 89 -> resume, delayed M3 releases
        _commit(k.worker, 2, 2, 89, 400);
        vm.broadcast(k.arbiter);
        controller.resumeByVerifier(id, keccak256("secondary-core-probe-attestation"));
        _release(k.exporter, 2, 2);

        // Scene 6: M4 and M5, delivery
        _commit(k.worker, 3, 1, 95, 200);
        _release(k.exporter, 3, 1);
        _commit(k.worker, 4, 1, 98, 100);
        _release(k.exporter, 4, 1);
        vm.broadcast(k.buyer);
        controller.markDelivered(id);

        // Scene 7: buyer pays 100,000 USDG
        vm.startBroadcast(k.buyer);
        usdg.approve(address(vault), INVOICE);
        controller.settle(id);
        vm.stopBroadcast();

        require(
            controller.getFacility(id).status == IFinancingController.Status.SETTLED, "not settled"
        );
        require(usdg.balanceOf(financier) == financierBefore + 1_200e6, "financier != +1,200 fee");
        require(usdg.balanceOf(exporter) == exporterBefore + 98_800e6, "exporter != 98,800");
        require(usdg.balanceOf(address(vault)) == 0, "vault not empty");
    }

    function _commit(
        uint256 workerKey,
        uint8 milestone,
        uint32 seq,
        uint32 score,
        uint32 conflictBps
    ) internal {
        vm.broadcast(workerKey);
        evidence.commitEpoch(
            id,
            milestone,
            seq,
            keccak256(abi.encode("epoch-root", id, milestone, seq)),
            uint64(block.timestamp - 600),
            uint64(block.timestamp - 60),
            score,
            conflictBps,
            1200,
            score >= 75
        );
    }

    function _release(uint256 callerKey, uint8 milestone, uint32 seq) internal {
        vm.broadcast(callerKey);
        controller.evaluateAndReleaseMilestone(id, milestone, seq);
    }

    function _milestones() internal pure returns (IFinancingController.MilestoneSpec[] memory m) {
        m = new IFinancingController.MilestoneSpec[](5);
        for (uint8 i; i < 5; ++i) {
            m[i] = IFinancingController.MilestoneSpec(
                TRANCHE, 75, keccak256(abi.encode("checkpoint", i))
            );
        }
    }

    function _ensureFunds(Keys memory k, address financier, address buyer) internal {
        if (_isLocal()) {
            // local MockUSDG is freely mintable
            vm.startBroadcast(k.financier);
            usdg.mint(financier, COMMITTED);
            vm.stopBroadcast();
            vm.startBroadcast(k.buyer);
            usdg.mint(buyer, INVOICE);
            vm.stopBroadcast();
        }
        require(usdg.balanceOf(financier) >= COMMITTED, "financier needs 40,000 USDG");
        require(usdg.balanceOf(buyer) >= INVOICE, "buyer needs 100,000 USDG");
    }

    function _load() internal {
        string memory json = vm.readFile(_manifestPath());
        controller =
            FinancingController(vm.parseJsonAddress(json, ".contracts.financingController"));
        evidence = EvidenceRegistry(vm.parseJsonAddress(json, ".contracts.evidenceRegistry"));
        registry = ShipmentRegistry(vm.parseJsonAddress(json, ".contracts.shipmentRegistry"));
        policies = PolicyEngine(vm.parseJsonAddress(json, ".contracts.policyEngine"));
        vault = ReceivableVault(vm.parseJsonAddress(json, ".contracts.receivableVault"));
        usdg = MockUSDG(vm.parseJsonAddress(json, ".usdg"));
    }

    function _keys() internal view returns (Keys memory k) {
        k.exporter = _demoKey("DEMO_EXPORTER_KEY", ANVIL_KEY_1);
        k.financier = _demoKey("DEMO_FINANCIER_KEY", ANVIL_KEY_2);
        k.buyer = _demoKey("DEMO_BUYER_KEY", ANVIL_KEY_3);
        k.worker = _demoKey("DEMO_WORKER_KEY", ANVIL_KEY_4);
        k.monitor = _demoKey("DEMO_MONITOR_KEY", ANVIL_KEY_5);
        k.arbiter = _demoKey("DEMO_ARBITER_KEY", ANVIL_KEY_6);
    }

    function _demoKey(string memory envName, string memory anvilKey)
        internal
        view
        returns (uint256)
    {
        string memory fromEnv = vm.envOr(envName, string(""));
        if (bytes(fromEnv).length != 0) return _parseKey(fromEnv);
        if (_isLocal()) return _parseKey(anvilKey);
        revert(string.concat("set ", envName));
    }
}
