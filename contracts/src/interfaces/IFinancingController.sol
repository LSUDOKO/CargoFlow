// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IEvidenceRegistry} from "./IEvidenceRegistry.sol";
import {IReceivableVault} from "./IReceivableVault.sol";

interface IFinancingController {
    enum Status {
        NONE,
        CREATED,
        FINANCED,
        ACTIVE,
        PAUSED,
        DISPUTED,
        DELIVERED,
        SETTLED,
        DEFAULTED,
        CANCELLED // v3: closed before transit; any deposit returned to the financier
    }

    struct MilestoneSpec {
        uint256 allocation; // USDG base units released when this milestone clears
        uint16 evidenceThreshold; // minimum evidence score (0..100)
        bytes32 checkpointCommitment; // hash of the off-chain checkpoint description
        int32 latE6; // centre of the milestone's place, degrees x 1e6 (+-90e6)
        int32 lonE6; // degrees x 1e6 (+-180e6)
        uint32 radiusM; // 0 = no place condition (v1 behaviour), else 1_000..1_000_000 metres
    }

    struct FacilityState {
        Status status;
        address exporter;
        address financier;
        address buyer;
        uint256 committed;
        uint16 feeBps;
        uint8 milestoneCount;
        uint8 nextMilestone; // milestones release strictly in order, so this is the release cursor
        bytes32 pauseReason;
        uint64 pausedAt;
        uint32 pauseCount; // how many times the facility has been paused; bound into every proof context
    }

    event FacilityCreated(
        bytes32 indexed shipmentId,
        address indexed financier,
        address indexed exporter,
        uint256 committed,
        uint16 feeBps,
        uint8 milestoneCount
    );
    event StatusChanged(bytes32 indexed shipmentId, Status from, Status to);
    event FinancingPaused(
        bytes32 indexed shipmentId, bytes32 indexed reasonCode, address indexed pausedBy
    );
    event FinancingResumed(bytes32 indexed shipmentId, address indexed resumedBy, bytes32 basis);
    event DisputeOpened(bytes32 indexed shipmentId, address indexed openedBy, bytes32 reason);
    event DisputeResolved(
        bytes32 indexed shipmentId, address indexed resolvedBy, bool resumed, bytes32 resolutionRef
    );
    event DeliveryConfirmed(bytes32 indexed shipmentId, address indexed confirmedBy);
    event DefaultDeclared(bytes32 indexed shipmentId, address indexed declaredBy, bytes32 ref);
    event MilestoneAdvanceReleased(
        bytes32 indexed shipmentId,
        uint8 indexed milestoneIndex,
        bytes32 epochId,
        uint256 amount,
        uint256 totalDrawn
    );

    error FacilityNotFound();
    error FacilityAlreadyCreated();
    error NotExporter();
    error NotFinancier();
    error NotAuthorizedForShipment();
    error InvalidCounterparty();
    error InvalidMilestones();
    error InvalidState(Status current);
    error FacilityPaused();
    error NotAuthorizedToPause();
    error InvalidReason();
    error MilestonesIncomplete();
    error NotBuyer();
    error MilestoneAlreadyReleased();
    error MilestoneOutOfOrder();
    error EvidenceBelowThreshold();
    error EvidenceNotCompliant();
    error EvidenceConflictTooHigh();
    error EvidenceRiskTooHigh();
    error EvidenceStale();
    error ProofRequired();
    error InvalidProof();
    error InvalidProofContext();
    error StaleRecoveryEvidence();
    error InvalidMilestonePlace();
    error OutsideMilestonePlace();
    error EvidenceBelowPolicy();

    /// @notice Exporter proposes the facility: the nominated financier, fee, and milestone schedule.
    ///         A milestone with `radiusM > 0` only releases on evidence whose centroid lies within
    ///         `radiusM` of (latE6, lonE6). Coordinates are range-checked for every milestone and a
    ///         non-zero radius must be 1 km..1,000 km, else InvalidMilestonePlace.
    function createFacility(
        bytes32 shipmentId,
        address financier,
        uint16 feeBps,
        MilestoneSpec[] calldata milestones
    ) external;

    /// @notice The nominated financier funds the full commitment into the vault.
    function depositCapital(bytes32 shipmentId) external;

    /// @notice Exporter or facility manager opens the transit phase so milestones can clear.
    function startTransit(bytes32 shipmentId) external;

    /// @notice Releases the next milestone's tranche to the exporter if the committed evidence epoch
    ///         `(shipmentId, milestoneIndex, seq)` satisfies the policy. Callable by the exporter,
    ///         the financier or a facility manager; the recipient is fixed regardless of caller.
    ///         Policy checks come first (score, compliance, conflict, risk, age, then humidity and
    ///         shock maxima: EvidenceBelowPolicy), then the proof requirement, then the place: an epoch
    ///         that passes the policy but whose centroid is outside the milestone's place reverts
    ///         OutsideMilestonePlace and the milestone simply waits for later evidence.
    function evaluateAndReleaseMilestone(bytes32 shipmentId, uint8 milestoneIndex, uint32 seq)
        external;

    /// @notice Stops all future releases. Callable by the monitor (incl. the AI) or the arbiter.
    ///         Already released funds are never clawed back.
    function pauseFinancing(bytes32 shipmentId, bytes32 reasonCode) external;

    /// @notice Trusted-verifier recovery path: PAUSED -> ACTIVE, recording the basis (attestation hash).
    function resumeByVerifier(bytes32 shipmentId, bytes32 basis) external;

    /// @notice Zero-knowledge recovery: PAUSED -> ACTIVE when a Groth16 proof shows that the committed
    ///         recovery epoch (shipment, milestone, seq) holds readings all inside the policy range.
    ///         The caller supplies only the proof; every public signal is derived from chain state, so the
    ///         proof is bound to this facility, epoch, policy, pause, contract, chain and submitter.
    ///         The circuit proves only the temperature band, so the recovery epoch must also pass every
    ///         other policy check (including the humidity and shock limits) and lie inside the
    ///         milestone's place. Callable by the exporter or a facility manager.
    function resumeWithProof(
        bytes32 shipmentId,
        uint8 milestoneIndex,
        uint32 seq,
        uint256[2] calldata a,
        uint256[2][2] calldata b,
        uint256[2] calldata c
    ) external;

    /// @notice The context hash a proof for (shipmentId, epochId) must be generated against when
    ///         submitted by `submitter` during the current pause.
    function proofContext(bytes32 shipmentId, bytes32 epochId, address submitter)
        external
        view
        returns (uint256);

    /// @notice Exporter, financier or arbiter freezes the facility (ACTIVE|PAUSED -> DISPUTED).
    function openDispute(bytes32 shipmentId, bytes32 reason) external;

    /// @notice Arbiter outcome: resume normal operation, or default the facility.
    function resolveDispute(bytes32 shipmentId, bool resume, bytes32 resolutionRef) external;

    /// @notice Arbiter declares default from PAUSED, DISPUTED or DELIVERED (non-payment). The undrawn
    ///         commitment returns to the financier.
    function markDefaulted(bytes32 shipmentId, bytes32 ref) external;

    /// @notice Buyer (or a facility manager) confirms delivery once every milestone has released.
    ///         The exporter cannot confirm its own delivery.
    function markDelivered(bytes32 shipmentId) external;

    /// @notice Buyer pays the invoice in USDG; the vault runs the waterfall and the facility settles.
    function settle(bytes32 shipmentId) external;

    /// @notice Whether epoch (shipmentId, milestoneIndex, seq) satisfies the milestone's place.
    /// @return required False when the milestone has no place (then inside is true, distanceM 0).
    /// @return inside True when the epoch centroid is within the radius (inclusive).
    /// @return distanceM On-chain distance from the epoch centroid to the place, whole metres.
    function placeCheck(bytes32 shipmentId, uint8 milestoneIndex, uint32 seq)
        external
        view
        returns (bool required, bool inside, uint256 distanceM);

    /// @notice The vault this controller drives (read by the CoverPool).
    function VAULT() external view returns (IReceivableVault);

    /// @notice The evidence registry this controller reads (read by the CoverPool's parametric cover).
    function EVIDENCE() external view returns (IEvidenceRegistry);

    function getFacility(bytes32 shipmentId) external view returns (FacilityState memory);

    function getMilestone(bytes32 shipmentId, uint8 index)
        external
        view
        returns (MilestoneSpec memory);
}
