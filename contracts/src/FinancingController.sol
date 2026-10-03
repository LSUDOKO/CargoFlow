// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Controlled} from "./access/Controlled.sol";
import {IEvidenceRegistry} from "./interfaces/IEvidenceRegistry.sol";
import {IFinancingController} from "./interfaces/IFinancingController.sol";
import {IPolicyEngine} from "./interfaces/IPolicyEngine.sol";
import {IReceivableVault} from "./interfaces/IReceivableVault.sol";
import {IGroth16Verifier} from "./interfaces/IGroth16Verifier.sol";
import {IShipmentRegistry} from "./interfaces/IShipmentRegistry.sol";
import {GeoDistance} from "./libraries/GeoDistance.sol";
import {ProofContext} from "./libraries/ProofContext.sol";
import {Roles} from "./libraries/Roles.sol";

/// @title FinancingController
/// @notice The facility state machine. It is the only caller the vault obeys, and every transition
///         is gated by explicit actors and on-chain evidence. Nothing off-chain (backend, AI monitor)
///         can move USDG: they can only commit evidence or request a pause.
contract FinancingController is Controlled, ReentrancyGuard, IFinancingController {
    uint8 public constant MAX_MILESTONES = 16;
    uint16 private constant MAX_SCORE = 100;
    uint32 public constant MIN_RADIUS_M = 1_000;
    uint32 public constant MAX_RADIUS_M = 1_000_000;

    IShipmentRegistry public immutable REGISTRY;
    IPolicyEngine public immutable POLICIES;
    IEvidenceRegistry public immutable EVIDENCE;
    IReceivableVault public immutable VAULT;
    IGroth16Verifier public immutable VERIFIER;

    mapping(bytes32 shipmentId => FacilityState) private _facilities;
    mapping(bytes32 shipmentId => MilestoneSpec[]) private _milestones;

    constructor(
        address access,
        address registry,
        address policies,
        address evidence,
        address vault,
        address verifier
    ) Controlled(access) {
        if (
            registry == address(0) || policies == address(0) || evidence == address(0)
                || vault == address(0) || verifier == address(0)
        ) revert ZeroAddress();
        REGISTRY = IShipmentRegistry(registry);
        POLICIES = IPolicyEngine(policies);
        EVIDENCE = IEvidenceRegistry(evidence);
        VAULT = IReceivableVault(vault);
        VERIFIER = IGroth16Verifier(verifier);
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
        for (uint256 i; i < count; ++i) {
            MilestoneSpec calldata m = milestones[i];
            if (
                m.allocation == 0 || m.evidenceThreshold < policy.minEvidenceScore
                    || m.evidenceThreshold > MAX_SCORE
            ) revert InvalidMilestones();
            if (
                !GeoDistance.isValidCoordinate(m.latE6, m.lonE6)
                    || (m.radiusM != 0 && (m.radiusM < MIN_RADIUS_M || m.radiusM > MAX_RADIUS_M))
            ) revert InvalidMilestonePlace();
            committed += m.allocation;
            _milestones[shipmentId].push(m);
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
            pausedAt: 0,
            pauseCount: 0
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
        IPolicyEngine.Policy memory policy = POLICIES.getPolicy(shipmentId);
        _requireEvidencePasses(policy, m, e);
        if (policy.requiresZK && !e.proofVerified) revert ProofRequired();
        _requireAtPlace(m, e);

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
        if (
            (p.maxHumidityX100 != 0 && e.maxHumidityX100 > p.maxHumidityX100)
                || (p.maxShockX100 != 0 && e.maxShockX100 > p.maxShockX100)
        ) revert EvidenceBelowPolicy();
    }

    /// @dev Checked after the policy so OutsideMilestonePlace means "healthy evidence, wrong place".
    function _requireAtPlace(MilestoneSpec storage m, IEvidenceRegistry.EvidenceEpoch memory e)
        internal
        view
    {
        uint32 r = m.radiusM;
        if (r != 0 && !GeoDistance.withinRadius(e.latE6, e.lonE6, m.latE6, m.lonE6, r)) {
            revert OutsideMilestonePlace();
        }
    }

    // ------------------------------------------------------------------ zero-knowledge recovery

    /// @inheritdoc IFinancingController
    function resumeWithProof(
        bytes32 shipmentId,
        uint8 milestoneIndex,
        uint32 seq,
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c
    ) external nonReentrant {
        FacilityState storage f = _load(shipmentId);
        if (msg.sender != f.exporter && !_hasRole(Roles.FACILITY_MANAGER_ROLE, msg.sender)) {
            revert NotAuthorizedForShipment();
        }
        _requireStatus(f, Status.PAUSED);
        if (milestoneIndex >= f.milestoneCount) revert InvalidMilestones();
        if (milestoneIndex != f.nextMilestone) revert MilestoneOutOfOrder();

        bytes32 epochId = EVIDENCE.epochIdFor(shipmentId, milestoneIndex, seq);
        IEvidenceRegistry.EvidenceEpoch memory e = EVIDENCE.getEpoch(epochId);
        // the recovery evidence must have been committed strictly after this pause began
        if (e.committedAt <= f.pausedAt) revert StaleRecoveryEvidence();

        IPolicyEngine.Policy memory policy = POLICIES.getPolicy(shipmentId);
        MilestoneSpec storage m = _milestones[shipmentId][milestoneIndex];
        _requireEvidencePasses(policy, m, e);
        _requireAtPlace(m, e);

        uint256[4] memory signals =
            _publicSignals(shipmentId, epochId, e.merkleRoot, policy, f.pauseCount);
        if (!VERIFIER.verifyProof(a, b, c, signals)) revert InvalidProof();

        EVIDENCE.markProofVerified(epochId);
        _resume(shipmentId, f);
        emit FinancingResumed(shipmentId, msg.sender, epochId);
    }

    /// @inheritdoc IFinancingController
    function proofContext(bytes32 shipmentId, bytes32 epochId, address submitter)
        external
        view
        returns (uint256)
    {
        return _context(shipmentId, epochId, submitter, _load(shipmentId).pauseCount);
    }

    /// @dev [contextHash, merkleRoot, minTemp, maxTemp]: derived entirely from chain state.
    function _publicSignals(
        bytes32 shipmentId,
        bytes32 epochId,
        bytes32 root,
        IPolicyEngine.Policy memory policy,
        uint32 pauseCount
    ) internal view returns (uint256[4] memory s) {
        uint256 r = uint256(root);
        if (r >= ProofContext.SNARK_SCALAR_FIELD) revert InvalidProofContext();
        (uint256 lo, bool loOk) = ProofContext.offsetTemp(policy.minTempX100);
        (uint256 hi, bool hiOk) = ProofContext.offsetTemp(policy.maxTempX100);
        if (!loOk || !hiOk) revert InvalidProofContext();
        s[0] = _context(shipmentId, epochId, msg.sender, pauseCount);
        s[1] = r;
        s[2] = lo;
        s[3] = hi;
    }

    function _context(bytes32 shipmentId, bytes32 epochId, address submitter, uint32 pauseCount)
        internal
        view
        returns (uint256)
    {
        return ProofContext.compute(
            block.chainid,
            address(VERIFIER),
            address(this),
            shipmentId,
            epochId,
            REGISTRY.getShipment(shipmentId).policyCommitment,
            submitter,
            pauseCount
        );
    }

    // ------------------------------------------------------------------ delivery / settlement

    /// @inheritdoc IFinancingController
    function markDelivered(bytes32 shipmentId) external nonReentrant {
        FacilityState storage f = _load(shipmentId);
        if (msg.sender != f.buyer && !_hasRole(Roles.FACILITY_MANAGER_ROLE, msg.sender)) {
            revert NotAuthorizedForShipment();
        }
        _requireStatus(f, Status.ACTIVE);
        if (f.nextMilestone != f.milestoneCount) revert MilestonesIncomplete();

        _setStatus(shipmentId, f, Status.DELIVERED);
        emit DeliveryConfirmed(shipmentId, msg.sender);
    }

    /// @inheritdoc IFinancingController
    function settle(bytes32 shipmentId) external nonReentrant {
        FacilityState storage f = _load(shipmentId);
        if (msg.sender != f.buyer) revert NotBuyer();
        _requireStatus(f, Status.DELIVERED);

        _setStatus(shipmentId, f, Status.SETTLED);
        VAULT.settle(shipmentId);
    }

    // ------------------------------------------------------------------ pause / dispute / default

    /// @inheritdoc IFinancingController
    function pauseFinancing(bytes32 shipmentId, bytes32 reasonCode) external nonReentrant {
        if (!_hasRole(Roles.MONITOR_ROLE, msg.sender) && !_hasRole(Roles.DISPUTE_ROLE, msg.sender))
        {
            revert NotAuthorizedToPause();
        }
        if (reasonCode == 0) revert InvalidReason();
        FacilityState storage f = _load(shipmentId);
        _requireStatus(f, Status.ACTIVE);

        f.pauseReason = reasonCode;
        f.pausedAt = uint64(block.timestamp);
        f.pauseCount += 1;
        VAULT.setPaused(shipmentId, true);
        _setStatus(shipmentId, f, Status.PAUSED);

        emit FinancingPaused(shipmentId, reasonCode, msg.sender);
    }

    /// @inheritdoc IFinancingController
    function resumeByVerifier(bytes32 shipmentId, bytes32 basis)
        external
        onlyRole(Roles.DISPUTE_ROLE)
        nonReentrant
    {
        if (basis == 0) revert InvalidReason();
        FacilityState storage f = _load(shipmentId);
        _requireStatus(f, Status.PAUSED);

        _resume(shipmentId, f);
        emit FinancingResumed(shipmentId, msg.sender, basis);
    }

    /// @inheritdoc IFinancingController
    function openDispute(bytes32 shipmentId, bytes32 reason) external nonReentrant {
        FacilityState storage f = _load(shipmentId);
        if (
            msg.sender != f.exporter && msg.sender != f.financier
                && !_hasRole(Roles.DISPUTE_ROLE, msg.sender)
        ) revert NotAuthorizedForShipment();
        if (reason == 0) revert InvalidReason();
        if (f.status != Status.ACTIVE && f.status != Status.PAUSED) revert InvalidState(f.status);

        VAULT.setPaused(shipmentId, true);
        _setStatus(shipmentId, f, Status.DISPUTED);

        emit DisputeOpened(shipmentId, msg.sender, reason);
    }

    /// @inheritdoc IFinancingController
    function resolveDispute(bytes32 shipmentId, bool resume, bytes32 resolutionRef)
        external
        onlyRole(Roles.DISPUTE_ROLE)
        nonReentrant
    {
        FacilityState storage f = _load(shipmentId);
        _requireStatus(f, Status.DISPUTED);

        if (resume) {
            _resume(shipmentId, f);
        } else {
            _default(shipmentId, f);
        }
        emit DisputeResolved(shipmentId, msg.sender, resume, resolutionRef);
    }

    /// @inheritdoc IFinancingController
    function markDefaulted(bytes32 shipmentId, bytes32 ref)
        external
        onlyRole(Roles.DISPUTE_ROLE)
        nonReentrant
    {
        FacilityState storage f = _load(shipmentId);
        if (
            f.status != Status.PAUSED && f.status != Status.DISPUTED && f.status != Status.DELIVERED
        ) {
            revert InvalidState(f.status);
        }
        _default(shipmentId, f);
        emit DefaultDeclared(shipmentId, msg.sender, ref);
    }

    function _resume(bytes32 shipmentId, FacilityState storage f) internal {
        f.pauseReason = bytes32(0);
        f.pausedAt = 0;
        VAULT.setPaused(shipmentId, false);
        _setStatus(shipmentId, f, Status.ACTIVE);
    }

    function _default(bytes32 shipmentId, FacilityState storage f) internal {
        VAULT.closeDefaulted(shipmentId);
        _setStatus(shipmentId, f, Status.DEFAULTED);
    }

    // ------------------------------------------------------------------ views

    /// @inheritdoc IFinancingController
    function getFacility(bytes32 shipmentId) external view returns (FacilityState memory) {
        return _load(shipmentId);
    }

    /// @inheritdoc IFinancingController
    function placeCheck(bytes32 shipmentId, uint8 milestoneIndex, uint32 seq)
        external
        view
        returns (bool required, bool inside, uint256 distanceM)
    {
        FacilityState storage f = _load(shipmentId);
        if (milestoneIndex >= f.milestoneCount) revert InvalidMilestones();
        MilestoneSpec storage m = _milestones[shipmentId][milestoneIndex];
        if (m.radiusM == 0) return (false, true, 0);
        IEvidenceRegistry.EvidenceEpoch memory e =
            EVIDENCE.getEpoch(EVIDENCE.epochIdFor(shipmentId, milestoneIndex, seq));
        distanceM = GeoDistance.distanceM(e.latE6, e.lonE6, m.latE6, m.lonE6);
        return (true, distanceM <= m.radiusM, distanceM);
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
