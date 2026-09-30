// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CargoFlowAccess} from "../../src/access/CargoFlowAccess.sol";
import {ShipmentRegistry} from "../../src/ShipmentRegistry.sol";
import {PolicyEngine} from "../../src/PolicyEngine.sol";
import {EvidenceRegistry} from "../../src/EvidenceRegistry.sol";
import {ReceivableVault} from "../../src/ReceivableVault.sol";
import {FinancingController} from "../../src/FinancingController.sol";
import {IFinancingController} from "../../src/interfaces/IFinancingController.sol";
import {IPolicyEngine} from "../../src/interfaces/IPolicyEngine.sol";
import {MockUSDG} from "../../src/mocks/MockUSDG.sol";
import {MockGroth16Verifier} from "../../src/mocks/MockGroth16Verifier.sol";
import {Roles} from "../../src/libraries/Roles.sol";

/// @dev Full protocol fixture wired exactly like the deploy script, with the hero shipment
///      CF-2026-SG01 (100k invoice, 40k facility, 5 x 8k tranches, 2-8 C policy).
abstract contract ControllerBase is Test {
    CargoFlowAccess internal access;
    ShipmentRegistry internal registry;
    PolicyEngine internal policies;
    EvidenceRegistry internal evidence;
    ReceivableVault internal vault;
    FinancingController internal controller;
    MockUSDG internal usdg;
    MockGroth16Verifier internal verifier;

    address internal admin = makeAddr("admin");
    address internal exporter = makeAddr("exporter");
    address internal financier = makeAddr("financier");
    address internal buyer = makeAddr("buyer");
    address internal worker = makeAddr("evidenceWorker");
    address internal monitor = makeAddr("aiMonitor");
    address internal arbiter = makeAddr("arbiter");
    address internal manager = makeAddr("manager");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant REF = keccak256("CF-2026-SG01");
    uint256 internal constant COMMITTED = 40_000e6;
    uint256 internal constant INVOICE = 100_000e6;
    uint256 internal constant TRANCHE = 8_000e6;
    uint16 internal constant FEE_BPS = 300;
    uint256 internal constant FIELD =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    bytes32 internal id;
    IPolicyEngine.Policy internal policy;

    function setUp() public virtual {
        vm.warp(1_800_000_000);
        access = new CargoFlowAccess(0, admin);
        usdg = new MockUSDG();
        registry = new ShipmentRegistry();
        policies = new PolicyEngine(address(registry));
        evidence = new EvidenceRegistry(address(access));
        vault = new ReceivableVault(address(access), address(usdg));
        verifier = new MockGroth16Verifier();
        controller = new FinancingController(
            address(access),
            address(registry),
            address(policies),
            address(evidence),
            address(vault),
            address(verifier)
        );

        vm.startPrank(admin);
        access.grantRole(Roles.CONTROLLER_ROLE, address(controller));
        access.grantRole(Roles.PROOF_VERIFIER_ROLE, address(controller));
        access.grantRole(Roles.EVIDENCE_VERIFIER_ROLE, worker);
        access.grantRole(Roles.MONITOR_ROLE, monitor);
        access.grantRole(Roles.DISPUTE_ROLE, arbiter);
        access.grantRole(Roles.FACILITY_MANAGER_ROLE, manager);
        vm.stopPrank();

        usdg.mint(financier, COMMITTED);
        usdg.mint(buyer, INVOICE);
        vm.prank(financier);
        usdg.approve(address(vault), type(uint256).max);
        vm.prank(buyer);
        usdg.approve(address(vault), type(uint256).max);

        policy = IPolicyEngine.Policy({
            minTempX100: 200,
            maxTempX100: 800,
            maxEvidenceAgeSec: 1800,
            maxRouteDeviationM: 25_000,
            minEvidenceScore: 75,
            maxConflictBps: 3000,
            maxRiskBps: 3500,
            requiresZK: false
        });
    }

    // --- lifecycle helpers ---------------------------------------------------------------

    function _registerAndSetPolicy() internal {
        bytes32 commitment = policies.hashPolicy(policy);
        vm.prank(exporter);
        id = registry.registerShipment(
            REF, buyer, keccak256("invoice.pdf"), keccak256("route"), commitment, INVOICE
        );
        vm.prank(exporter);
        policies.setPolicy(id, policy);
    }

    function _milestones() internal pure returns (IFinancingController.MilestoneSpec[] memory m) {
        m = new IFinancingController.MilestoneSpec[](5);
        for (uint8 i; i < 5; ++i) {
            m[i] = IFinancingController.MilestoneSpec({
                allocation: TRANCHE,
                evidenceThreshold: 75,
                checkpointCommitment: keccak256(abi.encode("checkpoint", i))
            });
        }
    }

    function _createFacility() internal {
        _registerAndSetPolicy();
        IFinancingController.MilestoneSpec[] memory m = _milestones();
        vm.prank(exporter);
        controller.createFacility(id, financier, FEE_BPS, m);
    }

    function _fund() internal {
        _createFacility();
        vm.prank(financier);
        controller.depositCapital(id);
    }

    function _activate() internal {
        _fund();
        vm.prank(exporter);
        controller.startTransit(id);
    }

    function _commitEvidence(uint8 milestone, uint32 seq, uint32 score, uint32 conflictBps)
        internal
        returns (bytes32 epochId)
    {
        vm.prank(worker);
        epochId = evidence.commitEpoch(
            id,
            milestone,
            seq,
            // a valid BN254 field element, as a real Poseidon root always is
            bytes32(uint256(keccak256(abi.encode("root", milestone, seq))) % FIELD),
            uint64(block.timestamp - 600),
            uint64(block.timestamp - 60),
            score,
            conflictBps,
            1200,
            score >= 75
        );
    }
}
