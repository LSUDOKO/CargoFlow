// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Controlled} from "./access/Controlled.sol";
import {IReceivableVault} from "./interfaces/IReceivableVault.sol";
import {Roles} from "./libraries/Roles.sol";

/// @title ReceivableVault
/// @notice The only contract that custodies USDG for a facility. It has no admin withdrawal path:
///         funds leave only as advances to the fixed supplier, or through the settlement / default
///         waterfalls. Every mutating call is restricted to the FinancingController.
contract ReceivableVault is Controlled, ReentrancyGuard, IReceivableVault {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_FEE_BPS = 2_000;
    uint256 internal constant BPS = 10_000;

    IERC20 public immutable USDG;

    mapping(bytes32 shipmentId => Facility) private _facilities;
    mapping(bytes32 shipmentId => bool) private _exists;

    constructor(address access, address usdg) Controlled(access) {
        if (usdg == address(0)) revert ZeroAddress();
        USDG = IERC20(usdg);
    }

    /// @inheritdoc IReceivableVault
    function openFacility(
        bytes32 shipmentId,
        address financier,
        address supplier,
        address payer,
        uint256 committed,
        uint256 invoiceValue,
        uint16 feeBps
    ) external onlyRole(Roles.CONTROLLER_ROLE) {
        if (_exists[shipmentId]) revert FacilityAlreadyExists();
        if (
            financier == address(0) || supplier == address(0) || payer == address(0)
                || committed == 0 || feeBps > MAX_FEE_BPS
                // the invoice must be able to repay principal plus the maximum possible fee
                || invoiceValue < committed + _fee(committed, feeBps)
        ) revert InvalidFacility();

        _exists[shipmentId] = true;
        _facilities[shipmentId] = Facility({
            financier: financier,
            supplier: supplier,
            payer: payer,
            committed: committed,
            drawn: 0,
            invoiceValue: invoiceValue,
            feeBps: feeBps,
            funded: false,
            paused: false,
            closed: false
        });

        emit FacilityOpened(shipmentId, financier, supplier, payer, committed, invoiceValue, feeBps);
    }

    /// @inheritdoc IReceivableVault
    function deposit(bytes32 shipmentId) external onlyRole(Roles.CONTROLLER_ROLE) nonReentrant {
        Facility storage f = _load(shipmentId);
        if (f.funded) revert AlreadyFunded();

        f.funded = true; // effects before the external token call
        USDG.safeTransferFrom(f.financier, address(this), f.committed);

        emit CapitalDeposited(shipmentId, f.financier, f.committed);
    }

    /// @inheritdoc IReceivableVault
    function release(bytes32 shipmentId, uint256 amount)
        external
        onlyRole(Roles.CONTROLLER_ROLE)
        nonReentrant
    {
        Facility storage f = _load(shipmentId);
        if (f.closed) revert FacilityClosed();
        if (!f.funded) revert NotFunded();
        if (f.paused) revert FacilityPaused();
        if (amount == 0) revert ZeroAmount();
        uint256 newDrawn = f.drawn + amount;
        if (newDrawn > f.committed) revert ExceedsCommittedFacility();

        f.drawn = newDrawn;
        USDG.safeTransfer(f.supplier, amount);

        emit AdvanceReleased(shipmentId, f.supplier, amount, newDrawn);
    }

    /// @inheritdoc IReceivableVault
    function settle(bytes32 shipmentId) external onlyRole(Roles.CONTROLLER_ROLE) nonReentrant {
        Facility storage f = _load(shipmentId);
        if (f.closed) revert FacilityClosed();
        if (!f.funded) revert NotFunded();

        f.closed = true;
        uint256 principal = f.drawn;
        uint256 fee = _fee(principal, f.feeBps);
        uint256 undrawn = f.committed - principal;
        // cannot underflow: openFacility required invoiceValue >= committed + fee(committed)
        uint256 residual = f.invoiceValue - principal - fee;

        USDG.safeTransferFrom(f.payer, address(this), f.invoiceValue);
        USDG.safeTransfer(f.financier, principal + fee + undrawn);
        USDG.safeTransfer(f.supplier, residual);

        emit FacilitySettled(shipmentId, principal, fee, residual, undrawn);
    }

    /// @inheritdoc IReceivableVault
    function closeDefaulted(bytes32 shipmentId)
        external
        onlyRole(Roles.CONTROLLER_ROLE)
        nonReentrant
    {
        Facility storage f = _load(shipmentId);
        if (f.closed) revert FacilityClosed();
        if (!f.funded) revert NotFunded();

        f.closed = true;
        uint256 undrawn = f.committed - f.drawn;
        if (undrawn > 0) USDG.safeTransfer(f.financier, undrawn);

        emit FacilityDefaulted(shipmentId, undrawn, f.drawn);
    }

    /// @inheritdoc IReceivableVault
    function setPaused(bytes32 shipmentId, bool paused) external onlyRole(Roles.CONTROLLER_ROLE) {
        _load(shipmentId).paused = paused;
        emit FacilityPauseSet(shipmentId, paused);
    }

    /// @inheritdoc IReceivableVault
    function getFacility(bytes32 shipmentId) external view returns (Facility memory) {
        if (!_exists[shipmentId]) revert FacilityNotFound();
        return _facilities[shipmentId];
    }

    function _load(bytes32 shipmentId) internal view returns (Facility storage f) {
        if (!_exists[shipmentId]) revert FacilityNotFound();
        f = _facilities[shipmentId];
    }

    /// @dev Floor division: rounding favours the exporter by at most 1 base unit (0.000001 USDG).
    function _fee(uint256 amount, uint16 feeBps) internal pure returns (uint256) {
        return (amount * feeBps) / BPS;
    }
}
