// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

interface IReceivableVault {
    struct Facility {
        address financier;
        address supplier; // the only address that can ever receive an advance
        address payer; // the buyer who settles the invoice
        uint256 committed;
        uint256 drawn;
        uint256 invoiceValue;
        uint16 feeBps;
        bool funded;
        bool paused;
        bool closed;
    }

    event FacilityOpened(
        bytes32 indexed shipmentId,
        address indexed financier,
        address indexed supplier,
        address payer,
        uint256 committed,
        uint256 invoiceValue,
        uint16 feeBps
    );
    event CapitalDeposited(bytes32 indexed shipmentId, address indexed financier, uint256 amount);
    event AdvanceReleased(
        bytes32 indexed shipmentId, address indexed supplier, uint256 amount, uint256 totalDrawn
    );
    event FacilityPauseSet(bytes32 indexed shipmentId, bool paused);
    event FacilitySettled(
        bytes32 indexed shipmentId,
        uint256 principal,
        uint256 fee,
        uint256 residual,
        uint256 undrawnRefund
    );

    error FacilityNotFound();
    error FacilityAlreadyExists();
    error InvalidFacility();
    error AlreadyFunded();
    error NotFunded();
    error FacilityClosed();
    error FacilityPaused();
    error ExceedsCommittedFacility();
    error ZeroAmount();

    function openFacility(
        bytes32 shipmentId,
        address financier,
        address supplier,
        address payer,
        uint256 committed,
        uint256 invoiceValue,
        uint16 feeBps
    ) external;

    /// @notice Pulls the full committed amount from the financier (who approved this vault).
    function deposit(bytes32 shipmentId) external;

    /// @notice Sends `amount` to the facility's fixed supplier. Reverts if paused, unfunded, or if
    ///         cumulative draws would exceed the commitment.
    function release(bytes32 shipmentId, uint256 amount) external;

    /// @notice Defence-in-depth pause: a paused facility cannot release regardless of controller bugs.
    function setPaused(bytes32 shipmentId, bool paused) external;

    /// @notice Pulls the invoice from the payer and runs the waterfall:
    ///         principal + fee + undrawn commitment -> financier, the remainder -> supplier.
    function settle(bytes32 shipmentId) external;

    function getFacility(bytes32 shipmentId) external view returns (Facility memory);
}
