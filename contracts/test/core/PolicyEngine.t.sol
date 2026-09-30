// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ShipmentRegistry} from "../../src/ShipmentRegistry.sol";
import {PolicyEngine} from "../../src/PolicyEngine.sol";
import {IPolicyEngine} from "../../src/interfaces/IPolicyEngine.sol";

contract PolicyEngineTest is Test {
    ShipmentRegistry internal registry;
    PolicyEngine internal engine;
    address internal exporter = makeAddr("exporter");
    address internal buyer = makeAddr("buyer");
    bytes32 internal shipmentId;
    IPolicyEngine.Policy internal coldChain;

    function setUp() public {
        registry = new ShipmentRegistry();
        engine = new PolicyEngine(address(registry));
        coldChain = IPolicyEngine.Policy({
            minTempX100: 200,
            maxTempX100: 800,
            maxEvidenceAgeSec: 1800,
            maxRouteDeviationM: 25_000,
            minEvidenceScore: 75,
            maxConflictBps: 3000,
            maxRiskBps: 3500,
            requiresZK: false
        });
        bytes32 commitment = engine.hashPolicy(coldChain);
        vm.prank(exporter);
        shipmentId = registry.registerShipment(
            keccak256("CF-2026-SG01"),
            buyer,
            keccak256("invoice"),
            keccak256("route"),
            commitment,
            100_000e6
        );
    }

    function test_exporterSetsPolicyMatchingCommitment() public {
        vm.expectEmit(true, false, false, true);
        emit IPolicyEngine.PolicySet(shipmentId, engine.hashPolicy(coldChain));
        vm.prank(exporter);
        engine.setPolicy(shipmentId, coldChain);

        IPolicyEngine.Policy memory p = engine.getPolicy(shipmentId);
        assertEq(p.minTempX100, 200);
        assertEq(p.maxTempX100, 800);
        assertEq(p.minEvidenceScore, 75);
        assertFalse(p.requiresZK);
    }

    function test_onlyExporterMaySetPolicy() public {
        vm.prank(buyer);
        vm.expectRevert(IPolicyEngine.NotExporter.selector);
        engine.setPolicy(shipmentId, coldChain);
    }

    function test_policyMustMatchCommittedHash() public {
        coldChain.maxTempX100 = 1200; // silently loosened policy
        vm.prank(exporter);
        vm.expectRevert(IPolicyEngine.PolicyCommitmentMismatch.selector);
        engine.setPolicy(shipmentId, coldChain);
    }

    function test_policyIsWriteOnce() public {
        vm.startPrank(exporter);
        engine.setPolicy(shipmentId, coldChain);
        vm.expectRevert(IPolicyEngine.PolicyAlreadySet.selector);
        engine.setPolicy(shipmentId, coldChain);
        vm.stopPrank();
    }

    function test_getPolicyBeforeSetReverts() public {
        vm.expectRevert(IPolicyEngine.PolicyNotSet.selector);
        engine.getPolicy(shipmentId);
        assertFalse(engine.isSet(shipmentId));
    }

    function test_unknownShipmentReverts() public {
        vm.prank(exporter);
        vm.expectRevert();
        engine.setPolicy(keccak256("missing"), coldChain);
    }

    function test_invalidPoliciesRejected() public {
        IPolicyEngine.Policy memory p = coldChain;

        p.minTempX100 = 800;
        p.maxTempX100 = 800;
        _expectInvalid(p);

        p = coldChain;
        p.minEvidenceScore = 101;
        _expectInvalid(p);

        p = coldChain;
        p.maxConflictBps = 10_001;
        _expectInvalid(p);

        p = coldChain;
        p.maxRiskBps = 10_001;
        _expectInvalid(p);
    }

    function test_frozenCargoAllowsNegativeTemperatures() public {
        IPolicyEngine.Policy memory frozen = coldChain;
        frozen.minTempX100 = -2500;
        frozen.maxTempX100 = -1500;
        bytes32 commitment = engine.hashPolicy(frozen);
        vm.prank(exporter);
        bytes32 id = registry.registerShipment(
            keccak256("CF-FROZEN"),
            buyer,
            keccak256("inv"),
            keccak256("route"),
            commitment,
            50_000e6
        );
        vm.prank(exporter);
        engine.setPolicy(id, frozen);
        assertEq(engine.getPolicy(id).minTempX100, -2500);
    }

    function _expectInvalid(IPolicyEngine.Policy memory p) internal {
        // commitment is re-registered so the hash check passes and validation is what rejects it
        vm.startPrank(exporter);
        bytes32 id = registry.registerShipment(
            keccak256(
                abi.encode("bad", p.minTempX100, p.minEvidenceScore, p.maxConflictBps, p.maxRiskBps)
            ),
            buyer,
            keccak256("inv"),
            keccak256("route"),
            engine.hashPolicy(p),
            1e6
        );
        vm.expectRevert(IPolicyEngine.InvalidPolicy.selector);
        engine.setPolicy(id, p);
        vm.stopPrank();
    }
}
