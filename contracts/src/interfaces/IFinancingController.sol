// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

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
        DEFAULTED
    }

    struct MilestoneSpec {
        uint256 allocation; // USDG base units released when this milestone clears
        uint16 evidenceThreshold; // minimum evidence score (0..100)
        bytes32 checkpointCommitment; // hash of the off-chain checkpoint description
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
    error MilestoneAlreadyReleased();
    error MilestoneOutOfOrder();
    error EvidenceBelowThreshold();
    error EvidenceNotCompliant();
    error EvidenceConflictTooHigh();
    error EvidenceRiskTooHigh();
    error EvidenceStale();
    error ProofRequired();

    /// @notice Exporter proposes the facility: the nominated financier, fee, and milestone schedule.
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
    function evaluateAndReleaseMilestone(bytes32 shipmentId, uint8 milestoneIndex, uint32 seq)
        external;

    function getFacility(bytes32 shipmentId) external view returns (FacilityState memory);

    function getMilestone(bytes32 shipmentId, uint8 index)
        external
        view
        returns (MilestoneSpec memory);
}
