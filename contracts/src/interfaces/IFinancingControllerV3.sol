// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IEBLRegistry} from "./IEBLRegistry.sol";
import {IFinancingController} from "./IFinancingController.sol";

/// @notice v3 additions to the FinancingController. Every v2 function, struct, event and error keeps
///         its signature; the Status enum only gains CANCELLED at the end.
interface IFinancingControllerV3 is IFinancingController {
    event FacilityCancelled(
        bytes32 indexed shipmentId, address indexed cancelledBy, uint256 refund
    );
    event TitleBound(bytes32 indexed shipmentId, uint256 indexed tokenId, address indexed exporter);
    event TitleReleased(bytes32 indexed shipmentId, uint256 indexed tokenId, address indexed to);

    error CancelNotAllowed();
    error TitleBindingDisabled();
    error TitleAlreadyBound();
    error InvalidTitle();

    /// @notice Closes a facility that never started transit. While CREATED (nothing deposited) the
    ///         exporter or the financier may cancel at any time. While FINANCED either of them may
    ///         cancel once CANCEL_TIMEOUT has passed since the deposit; the vault returns the whole
    ///         deposit to the financier. A bound bill of lading goes back to the exporter.
    function cancelFacility(bytes32 shipmentId) external;

    /// @notice Binds an electronic bill of lading to the facility (documents against payment). The
    ///         exporter, while CREATED or FINANCED, holding a live bill whose consignee is the buyer or
    ///         "to order"; the controller must be approved for the token. The bill is escrowed in the
    ///         controller: on settle it passes to the buyer in the same transaction as the payment, on
    ///         default it passes to the financier, on cancel it returns to the exporter.
    function bindTitle(bytes32 shipmentId, uint256 eblTokenId) external;

    /// @notice Whether a bill is bound to the facility (and still escrowed) and its token id.
    function titleOf(bytes32 shipmentId) external view returns (bool bound, uint256 tokenId);

    /// @notice When the financier deposited (0 if never).
    function financedAt(bytes32 shipmentId) external view returns (uint64);

    /// @notice Seconds after the deposit before a FINANCED facility can be cancelled.
    function CANCEL_TIMEOUT() external view returns (uint64);

    /// @notice The bill of lading registry (address(0) when title binding is disabled).
    function EBL() external view returns (IEBLRegistry);
}
