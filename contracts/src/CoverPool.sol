// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Controlled} from "./access/Controlled.sol";
import {ICoverPool} from "./interfaces/ICoverPool.sol";
import {IFinancingController} from "./interfaces/IFinancingController.sol";
import {IReceivableVault} from "./interfaces/IReceivableVault.sol";

/// @title CoverPool
/// @notice Default cover for CargoFlow facilities. Immutable, with no admin and no role anywhere in
///         the protocol: it only reads facility state from the controller and vault, and it can never
///         touch capital escrowed in the vault. It holds exactly the open offers, the accepted covers
///         and the payouts credited but not yet withdrawn.
/// @dev Token assumption: USDG is a plain 6-decimal ERC-20 (no fee on transfer, no rebasing). The
///      pool does not rely on that silently: an offer whose transfer does not arrive in full reverts
///      UnsupportedToken. Payouts are pull-based (withdraw) so a frozen or reverting recipient can never
///      block the other party's payment.
contract CoverPool is Controlled, ReentrancyGuard, ICoverPool {
    using SafeERC20 for IERC20;

    uint16 public constant MAX_PREMIUM_BPS = 2_000;
    uint256 internal constant BPS = 10_000;

    IFinancingController public immutable CONTROLLER;
    IReceivableVault public immutable VAULT;
    IERC20 public immutable USDG;

    mapping(bytes32 shipmentId => mapping(address insurer => Offer)) private _offers;
    mapping(bytes32 shipmentId => Cover) private _covers;
    mapping(address account => uint256) private _claimable;

    uint256 public totalOpenOffers;
    uint256 public totalActiveCover;
    uint256 public totalClaimable;

    constructor(address access, address controller) Controlled(access) {
        if (controller == address(0)) revert ZeroAddress();
        CONTROLLER = IFinancingController(controller);
        VAULT = CONTROLLER.VAULT();
        USDG = VAULT.USDG();
    }

    // ------------------------------------------------------------------ offers

    /// @inheritdoc ICoverPool
    function offerCover(bytes32 shipmentId, uint256 coverAmount, uint16 premiumBps)
        external
        nonReentrant
    {
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
        totalOpenOffers -= amount;
        USDG.safeTransfer(msg.sender, amount);

        emit OfferWithdrawn(shipmentId, msg.sender, amount);
    }

    // ------------------------------------------------------------------ acceptance

    /// @inheritdoc ICoverPool
    function acceptCover(bytes32 shipmentId, address insurer) external nonReentrant {
        IFinancingController.FacilityState memory f = CONTROLLER.getFacility(shipmentId);
        if (msg.sender != f.financier) revert NotFinancier();
        _requireBeforeTransit(f.status);
        if (_covers[shipmentId].status != CoverStatus.NONE) revert CoverAlreadyAccepted();
        Offer memory o = _offers[shipmentId][insurer];
        if (o.amount == 0) revert OfferNotFound();

        uint256 premium = (o.amount * o.premiumBps) / BPS;
        delete _offers[shipmentId][insurer];
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
        if (s != IFinancingController.Status.SETTLED) revert InvalidState(s);

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

    /// @inheritdoc ICoverPool
    function withdraw() external nonReentrant {
        uint256 amount = _claimable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        _claimable[msg.sender] = 0;
        totalClaimable -= amount;
        USDG.safeTransfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
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
