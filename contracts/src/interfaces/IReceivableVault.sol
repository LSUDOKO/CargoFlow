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

    error FacilityNotFound();
    error FacilityAlreadyExists();
    error InvalidFacility();
    error AlreadyFunded();

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

    function getFacility(bytes32 shipmentId) external view returns (Facility memory);
}
