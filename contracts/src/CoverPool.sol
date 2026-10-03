// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Controlled} from "./access/Controlled.sol";
import {ICoverPool} from "./interfaces/ICoverPool.sol";
import {ICoverPoolV3} from "./interfaces/ICoverPoolV3.sol";
import {IEvidenceRegistry} from "./interfaces/IEvidenceRegistry.sol";
import {IEvidenceRegistryV3} from "./interfaces/IEvidenceRegistryV3.sol";
import {IFinancingController} from "./interfaces/IFinancingController.sol";
import {IReceivableVault} from "./interfaces/IReceivableVault.sol";
import {Roles} from "./libraries/Roles.sol";

/// @title CoverPool
/// @notice Default cover for CargoFlow facilities. Immutable, with no admin and no role anywhere in
///         the protocol: it only reads facility state from the controller and vault, and it can never
///         touch capital escrowed in the vault. It holds exactly the open offers, the accepted covers
///         and the payouts credited but not yet withdrawn.
/// @dev Token assumption: USDG is a plain 6-decimal ERC-20 (no fee on transfer, no rebasing). The
///      pool does not rely on that silently: an offer whose transfer does not arrive in full reverts
///      UnsupportedToken. Payouts are pull-based (withdraw) so a frozen or reverting recipient can never
///      block the other party's payment.
///      v3 (additive): an offer may carry a parametric trigger proven from stored evidence epochs; a
///      cover is also released when its facility is CANCELLED; and the access contract's admin can
///      rescue tokens sent to the pool directly, never more than the untracked excess.
contract CoverPool is Controlled, ReentrancyGuard, Pausable, ICoverPoolV3 {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_PREMIUM_BPS = 2_000;
    uint256 internal constant BPS = 10_000;
    uint8 public constant MAX_TRIGGER_EPOCHS = 32;
    bytes32 internal constant DEFAULT_ADMIN_ROLE = 0x00;

    IFinancingController public immutable CONTROLLER;
    IReceivableVault public immutable VAULT;
    IERC20 public immutable USDG;
    IEvidenceRegistryV3 public immutable EVIDENCE;

    mapping(bytes32 shipmentId => mapping(address insurer => Offer)) private _offers;
    mapping(bytes32 shipmentId => Cover) private _covers;
    mapping(address account => uint256) private _claimable;
    mapping(bytes32 shipmentId => mapping(address insurer => ParametricTrigger)) private
        _offerTriggers;
    mapping(bytes32 shipmentId => ParametricCover) private _parametric;

    uint256 public totalOpenOffers;
    uint256 public totalActiveCover;
    uint256 public totalClaimable;

    constructor(address access, address controller) Controlled(access) {
        if (controller == address(0)) revert ZeroAddress();
        CONTROLLER = IFinancingController(controller);
        VAULT = CONTROLLER.VAULT();
        USDG = VAULT.USDG();
        EVIDENCE = IEvidenceRegistryV3(address(CONTROLLER.EVIDENCE()));
    }

    // ------------------------------------------------------------------ offers

    /// @inheritdoc ICoverPool
    function offerCover(bytes32 shipmentId, uint256 coverAmount, uint16 premiumBps)
        external
        nonReentrant
        whenNotPaused
    {
        _offer(shipmentId, coverAmount, premiumBps);
    }

    /// @inheritdoc ICoverPoolV3
    function offerParametricCover(
        bytes32 shipmentId,
        uint256 coverAmount,
        uint16 premiumBps,
        uint8 consecutiveFailedEpochs,
        uint256 salvageToExporter
    ) external nonReentrant whenNotPaused {
        if (
            consecutiveFailedEpochs == 0 || consecutiveFailedEpochs > MAX_TRIGGER_EPOCHS
                || salvageToExporter > coverAmount
        ) revert InvalidTrigger();
        _offerTriggers[shipmentId][msg.sender] = ParametricTrigger({
            consecutiveFailedEpochs: consecutiveFailedEpochs, salvageToExporter: salvageToExporter
        });
        _offer(shipmentId, coverAmount, premiumBps);
        emit ParametricTermsOffered(
            shipmentId, msg.sender, consecutiveFailedEpochs, salvageToExporter
        );
    }

    function _offer(bytes32 shipmentId, uint256 coverAmount, uint16 premiumBps) internal {
        IFinancingController.FacilityState memory f = CONTROLLER.getFacility(shipmentId);
        _requireBeforeTransit(f.status);
        if (coverAmount == 0 || coverAmount > f.committed || premiumBps > MAX_PREMIUM_BPS) {
            revert InvalidCover();
        }
        if (msg.sender == f.financier) revert InvalidCounterparty();
        if (_covers[shipmentId].status != CoverStatus.NONE) revert CoverAlreadyAccepted();
        Offer storage o = _offers[shipmentId][msg.sender];
        if (o.amount != 0) revert OfferExists();

        o.amount = coverAmount;
        o.premiumBps = premiumBps;
        totalOpenOffers += coverAmount;

        uint256 before = USDG.balanceOf(address(this));
        USDG.safeTransferFrom(msg.sender, address(this), coverAmount);
        if (USDG.balanceOf(address(this)) - before != coverAmount) revert UnsupportedToken();

        emit CoverOffered(shipmentId, msg.sender, coverAmount, premiumBps);
    }

    /// @inheritdoc ICoverPool
    function withdrawOffer(bytes32 shipmentId) external nonReentrant {
        Offer storage o = _offers[shipmentId][msg.sender];
        uint256 amount = o.amount;
        if (amount == 0) revert OfferNotFound();

        delete _offers[shipmentId][msg.sender];
        delete _offerTriggers[shipmentId][msg.sender];
        totalOpenOffers -= amount;
        USDG.safeTransfer(msg.sender, amount);

        emit OfferWithdrawn(shipmentId, msg.sender, amount);
    }

    // ------------------------------------------------------------------ acceptance

    /// @inheritdoc ICoverPool
    function acceptCover(bytes32 shipmentId, address insurer) external nonReentrant whenNotPaused {
        IFinancingController.FacilityState memory f = CONTROLLER.getFacility(shipmentId);
        if (msg.sender != f.financier) revert NotFinancier();
        _requireBeforeTransit(f.status);
        if (_covers[shipmentId].status != CoverStatus.NONE) revert CoverAlreadyAccepted();
        Offer memory o = _offers[shipmentId][insurer];
        if (o.amount == 0) revert OfferNotFound();

        uint256 premium = (o.amount * o.premiumBps) / BPS;
        delete _offers[shipmentId][insurer];
        ParametricTrigger memory t = _offerTriggers[shipmentId][insurer];
        if (t.consecutiveFailedEpochs != 0) {
            delete _offerTriggers[shipmentId][insurer];
            _parametric[shipmentId] = ParametricCover({
                consecutiveFailedEpochs: t.consecutiveFailedEpochs,
                salvageToExporter: t.salvageToExporter,
                epochFloor: EVIDENCE.epochCount(shipmentId),
                exporter: address(0),
                exporterSalvage: 0
            });
        }
        totalOpenOffers -= o.amount;
        totalActiveCover += o.amount;
        _covers[shipmentId] = Cover({
            insurer: insurer,
            financier: msg.sender,
            amount: o.amount,
            premium: premium,
            status: CoverStatus.ACTIVE,
            financierPayout: 0,
            insurerReturn: 0
        });

        // the premium goes straight from the financier to the insurer; it never sits in the pool
        if (premium != 0) USDG.safeTransferFrom(msg.sender, insurer, premium);

        emit CoverAccepted(shipmentId, insurer, msg.sender, o.amount, premium);
    }

    // ------------------------------------------------------------------ outcomes

    /// @inheritdoc ICoverPool
    function release(bytes32 shipmentId) external nonReentrant {
        Cover storage c = _active(shipmentId);
        IFinancingController.Status s = CONTROLLER.getFacility(shipmentId).status;
        // v3: a facility cancelled before transit releases its cover exactly like a settled one
        if (s != IFinancingController.Status.SETTLED && s != IFinancingController.Status.CANCELLED)
        {
            revert InvalidState(s);
        }

        uint256 amount = c.amount;
        c.status = CoverStatus.RELEASED;
        c.insurerReturn = amount;
        totalActiveCover -= amount;
        _credit(c.insurer, amount);

        emit CoverReleased(shipmentId, c.insurer, amount);
    }

    /// @inheritdoc ICoverPool
    function claim(bytes32 shipmentId) external nonReentrant {
        Cover storage c = _active(shipmentId);
        IFinancingController.Status s = CONTROLLER.getFacility(shipmentId).status;
        if (s != IFinancingController.Status.DEFAULTED) revert InvalidState(s);

        // the financier's loss is the principal advanced to the exporter and never repaid; the vault
        // already returned the undrawn commitment when the facility defaulted
        uint256 loss = VAULT.getFacility(shipmentId).drawn;
        uint256 amount = c.amount;
        uint256 payout = loss < amount ? loss : amount;
        uint256 remainder = amount - payout;

        c.status = CoverStatus.CLAIMED;
        c.financierPayout = payout;
        c.insurerReturn = remainder;
        totalActiveCover -= amount;
        if (payout != 0) _credit(c.financier, payout);
        if (remainder != 0) _credit(c.insurer, remainder);

        emit CoverClaimed(shipmentId, c.financier, c.insurer, loss, payout, remainder);
    }

    /// @inheritdoc ICoverPoolV3
    function triggerParametric(bytes32 shipmentId, bytes32[] calldata epochIds)
        external
        nonReentrant
    {
        Cover storage c = _active(shipmentId);
        ParametricCover storage p = _parametric[shipmentId];
        uint256 n = p.consecutiveFailedEpochs;
        if (n == 0) revert NotParametric();
        IFinancingController.FacilityState memory f = CONTROLLER.getFacility(shipmentId);
        if (
            f.status != IFinancingController.Status.ACTIVE
                && f.status != IFinancingController.Status.PAUSED
                && f.status != IFinancingController.Status.DISPUTED
        ) revert InvalidState(f.status);
        if (epochIds.length != n) revert TriggerNotMet();
        _requireConsecutiveFailures(shipmentId, epochIds, p.epochFloor);

        // nothing is repaid before settlement, so the outstanding principal is what was drawn
        uint256 amount = c.amount;
        uint256 outstanding = VAULT.getFacility(shipmentId).drawn;
        uint256 payout = outstanding < amount ? outstanding : amount;
        uint256 left = amount - payout;
        uint256 salvage = p.salvageToExporter < left ? p.salvageToExporter : left;
        uint256 remainder = left - salvage;

        c.status = CoverStatus.TRIGGERED;
        c.financierPayout = payout;
        c.insurerReturn = remainder;
        p.exporter = f.exporter;
        p.exporterSalvage = salvage;
        totalActiveCover -= amount;
        if (payout != 0) _credit(c.financier, payout);
        if (salvage != 0) _credit(f.exporter, salvage);
        if (remainder != 0) _credit(c.insurer, remainder);

        emit ParametricTriggered(
            shipmentId, msg.sender, epochIds[n - 1], payout, salvage, remainder
        );
    }

    /// @dev Each epoch belongs to the shipment, is non-compliant, was committed after the cover was
    ///      accepted, and the ids are consecutive in the shipment's commit order (so no compliant epoch
    ///      can sit between them).
    function _requireConsecutiveFailures(
        bytes32 shipmentId,
        bytes32[] calldata epochIds,
        uint32 epochFloor
    ) internal view {
        uint256 first = EVIDENCE.epochOrdinal(epochIds[0]);
        if (first <= epochFloor) revert TriggerNotMet();
        for (uint256 i; i < epochIds.length; ++i) {
            IEvidenceRegistry.EvidenceEpoch memory e = EVIDENCE.getEpoch(epochIds[i]);
            if (
                e.shipmentId != shipmentId || e.compliant
                    || EVIDENCE.epochOrdinal(epochIds[i]) != first + i
            ) revert TriggerNotMet();
        }
    }

    /// @inheritdoc ICoverPoolV3
    function rescue(address token, address to) external nonReentrant onlyRole(DEFAULT_ADMIN_ROLE) {
        if (to == address(0)) revert ZeroAddress();
        uint256 amount =
            token == address(USDG) ? untrackedUsdg() : IERC20(token).balanceOf(address(this));
        if (amount == 0) revert NothingToRescue();
        IERC20(token).safeTransfer(to, amount);
        emit Rescued(token, to, amount);
    }

    /// @inheritdoc ICoverPool
    function withdraw() external nonReentrant {
        uint256 amount = _claimable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        _claimable[msg.sender] = 0;
        totalClaimable -= amount;
        USDG.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    // ------------------------------------------------------------------ v3: circuit breaker

    /// @notice Guardian (PAUSER_ROLE) stops new risk from entering. Exits stay open.
    function pause() external onlyRole(Roles.PAUSER_ROLE) {
        _pause();
    }

    /// @notice Guardian (PAUSER_ROLE) lifts the circuit breaker.
    function unpause() external onlyRole(Roles.PAUSER_ROLE) {
        _unpause();
    }

    // ------------------------------------------------------------------ views

    /// @inheritdoc ICoverPool
    function getOffer(bytes32 shipmentId, address insurer) external view returns (Offer memory) {
        return _offers[shipmentId][insurer];
    }

    /// @inheritdoc ICoverPool
    function getCover(bytes32 shipmentId) external view returns (Cover memory) {
        return _covers[shipmentId];
    }

    /// @inheritdoc ICoverPool
    function claimable(address account) external view returns (uint256) {
        return _claimable[account];
    }

    /// @inheritdoc ICoverPoolV3
    function getOfferTrigger(bytes32 shipmentId, address insurer)
        external
        view
        returns (ParametricTrigger memory)
    {
        return _offerTriggers[shipmentId][insurer];
    }

    /// @inheritdoc ICoverPoolV3
    function getParametricCover(bytes32 shipmentId) external view returns (ParametricCover memory) {
        return _parametric[shipmentId];
    }

    /// @inheritdoc ICoverPoolV3
    function untrackedUsdg() public view returns (uint256) {
        uint256 tracked = totalOpenOffers + totalActiveCover + totalClaimable;
        uint256 balance = USDG.balanceOf(address(this));
        return balance > tracked ? balance - tracked : 0;
    }

    // ------------------------------------------------------------------ internals

    function _requireBeforeTransit(IFinancingController.Status s) internal pure {
        if (s != IFinancingController.Status.CREATED && s != IFinancingController.Status.FINANCED) {
            revert InvalidState(s);
        }
    }

    function _active(bytes32 shipmentId) internal view returns (Cover storage c) {
        c = _covers[shipmentId];
        if (c.status != CoverStatus.ACTIVE) revert CoverNotActive();
    }

    function _credit(address account, uint256 amount) internal {
        _claimable[account] += amount;
        totalClaimable += amount;
    }
}
