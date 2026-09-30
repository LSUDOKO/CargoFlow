// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Controlled} from "./access/Controlled.sol";
import {IEvidenceRegistry} from "./interfaces/IEvidenceRegistry.sol";
import {IFinancingController} from "./interfaces/IFinancingController.sol";
import {IPolicyEngine} from "./interfaces/IPolicyEngine.sol";
import {IReceivableVault} from "./interfaces/IReceivableVault.sol";
import {IShipmentRegistry} from "./interfaces/IShipmentRegistry.sol";
import {Roles} from "./libraries/Roles.sol";

/// @title FinancingController
/// @notice The facility state machine. It is the only caller the vault obeys, and every transition
///         is gated by explicit actors and on-chain evidence. Nothing off-chain (backend, AI monitor)
///         can move USDG: they can only commit evidence or request a pause.
contract FinancingController is Controlled, ReentrancyGuard, IFinancingController {
    uint8 public constant MAX_MILESTONES = 16;
    uint16 private constant MAX_SCORE = 100;

    IShipmentRegistry public immutable REGISTRY;
    IPolicyEngine public immutable POLICIES;
    IEvidenceRegistry public immutable EVIDENCE;
    IReceivableVault public immutable VAULT;

    mapping(bytes32 shipmentId => FacilityState) private _facilities;
    mapping(bytes32 shipmentId => MilestoneSpec[]) private _milestones;

    constructor(address access, address registry, address policies, address evidence, address vault)
        Controlled(access)
    {
        if (
            registry == address(0) || policies == address(0) || evidence == address(0)
                || vault == address(0)
        ) revert ZeroAddress();
        REGISTRY = IShipmentRegistry(registry);
        POLICIES = IPolicyEngine(policies);
        EVIDENCE = IEvidenceRegistry(evidence);
        VAULT = IReceivableVault(vault);
    }

    // ------------------------------------------------------------------ setup

    /// @inheritdoc IFinancingController
    function createFacility(
        bytes32 shipmentId,
        address financier,
        uint16 feeBps,
        MilestoneSpec[] calldata milestones
    ) external nonReentrant {
        IShipmentRegistry.Shipment memory s = REGISTRY.getShipment(shipmentId);
        if (msg.sender != s.exporter) revert NotExporter();
        if (_facilities[shipmentId].status != Status.NONE) revert FacilityAlreadyCreated();
        if (financier == address(0) || financier == s.exporter || financier == s.buyer) {
            revert InvalidCounterparty();
        }
        IPolicyEngine.Policy memory policy = POLICIES.getPolicy(shipmentId);

        uint256 count = milestones.length;
        if (count == 0 || count > MAX_MILESTONES) revert InvalidMilestones();
        uint256 committed;
        MilestoneSpec[] storage stored = _milestones[shipmentId];
        for (uint256 i; i < count; ++i) {
            MilestoneSpec calldata m = milestones[i];
            if (
                m.allocation == 0 || m.evidenceThreshold < policy.minEvidenceScore
                    || m.evidenceThreshold > MAX_SCORE
            ) revert InvalidMilestones();
            committed += m.allocation;
            stored.push(m);
        }

        _facilities[shipmentId] = FacilityState({
            status: Status.CREATED,
            exporter: s.exporter,
            financier: financier,
            buyer: s.buyer,
            committed: committed,
            feeBps: feeBps,
            milestoneCount: uint8(count),
            nextMilestone: 0,
            pauseReason: bytes32(0),
            pausedAt: 0
        });

        VAULT.openFacility(
            shipmentId, financier, s.exporter, s.buyer, committed, s.invoiceValue, feeBps
        );

        emit FacilityCreated(shipmentId, financier, s.exporter, committed, feeBps, uint8(count));
        emit StatusChanged(shipmentId, Status.NONE, Status.CREATED);
    }

    /// @inheritdoc IFinancingController
    function depositCapital(bytes32 shipmentId) external nonReentrant {
        FacilityState storage f = _load(shipmentId);
        if (msg.sender != f.financier) revert NotFinancier();
        _requireStatus(f, Status.CREATED);

        VAULT.deposit(shipmentId);
        _setStatus(shipmentId, f, Status.FINANCED);
    }

    /// @inheritdoc IFinancingController
    function startTransit(bytes32 shipmentId) external nonReentrant {
        FacilityState storage f = _load(shipmentId);
        if (msg.sender != f.exporter && !_hasRole(Roles.FACILITY_MANAGER_ROLE, msg.sender)) {
            revert NotAuthorizedForShipment();
        }
        _requireStatus(f, Status.FINANCED);
        _setStatus(shipmentId, f, Status.ACTIVE);
    }

    // ------------------------------------------------------------------ release

    /// @inheritdoc IFinancingController
    function evaluateAndReleaseMilestone(bytes32 shipmentId, uint8 milestoneIndex, uint32 seq)
        external
        nonReentrant
    {
        FacilityState storage f = _load(shipmentId);
        if (
            msg.sender != f.exporter && msg.sender != f.financier
                && !_hasRole(Roles.FACILITY_MANAGER_ROLE, msg.sender)
        ) revert NotAuthorizedForShipment();
        if (f.status == Status.PAUSED) revert FacilityPaused();
        _requireStatus(f, Status.ACTIVE);

        if (milestoneIndex >= f.milestoneCount) revert InvalidMilestones();
        if (milestoneIndex < f.nextMilestone) revert MilestoneAlreadyReleased();
        if (milestoneIndex > f.nextMilestone) revert MilestoneOutOfOrder();

        bytes32 epochId = EVIDENCE.epochIdFor(shipmentId, milestoneIndex, seq);
        IEvidenceRegistry.EvidenceEpoch memory e = EVIDENCE.getEpoch(epochId);
        MilestoneSpec storage m = _milestones[shipmentId][milestoneIndex];
        _requireEvidencePasses(POLICIES.getPolicy(shipmentId), m, e);

        f.nextMilestone = milestoneIndex + 1;
        VAULT.release(shipmentId, m.allocation);

        emit MilestoneAdvanceReleased(
            shipmentId, milestoneIndex, epochId, m.allocation, VAULT.getFacility(shipmentId).drawn
        );
    }

    function _requireEvidencePasses(
        IPolicyEngine.Policy memory p,
        MilestoneSpec storage m,
        IEvidenceRegistry.EvidenceEpoch memory e
    ) internal view {
        if (e.score < m.evidenceThreshold) revert EvidenceBelowThreshold();
        if (!e.compliant) revert EvidenceNotCompliant();
        if (e.conflictBps > p.maxConflictBps) revert EvidenceConflictTooHigh();
        if (e.riskBps > p.maxRiskBps) revert EvidenceRiskTooHigh();
        if (p.maxEvidenceAgeSec != 0 && block.timestamp > uint256(e.endTime) + p.maxEvidenceAgeSec)
        {
            revert EvidenceStale();
        }
        if (p.requiresZK && !e.proofVerified) revert ProofRequired();
    }

    // ------------------------------------------------------------------ views

    /// @inheritdoc IFinancingController
    function getFacility(bytes32 shipmentId) external view returns (FacilityState memory) {
        return _load(shipmentId);
    }

    /// @inheritdoc IFinancingController
    function getMilestone(bytes32 shipmentId, uint8 index)
        external
        view
        returns (MilestoneSpec memory)
    {
        FacilityState storage f = _load(shipmentId);
        if (index >= f.milestoneCount) revert InvalidMilestones();
        return _milestones[shipmentId][index];
    }

    // ------------------------------------------------------------------ internals

    function _load(bytes32 shipmentId) internal view returns (FacilityState storage f) {
        f = _facilities[shipmentId];
        if (f.status == Status.NONE) revert FacilityNotFound();
    }

    function _requireStatus(FacilityState storage f, Status expected) internal view {
        if (f.status != expected) revert InvalidState(f.status);
    }

    function _setStatus(bytes32 shipmentId, FacilityState storage f, Status to) internal {
        Status from = f.status;
        f.status = to;
        emit StatusChanged(shipmentId, from, to);
    }
}
