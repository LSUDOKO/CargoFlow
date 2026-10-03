// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IFinancingController} from "./IFinancingController.sol";

/// @notice Default cover for a financed shipment. An insurer escrows cover in USDG; the financier
///         buys it by paying a premium straight to the insurer. If the facility settles the cover goes
///         back to the insurer; if it defaults the financier is made whole up to the cover, measured
///         against the principal already advanced to the exporter. Payouts are credited and pulled
///         with withdraw(), so no counterparty can block another's payment.
interface ICoverPool {
    enum CoverStatus {
        NONE,
        ACTIVE, // accepted; the escrowed amount backs the facility
        RELEASED, // facility settled; the whole amount was credited back to the insurer
        CLAIMED, // facility defaulted; min(amount, loss) credited to the financier, the rest to the insurer
        TRIGGERED // v3 parametric trigger met: outstanding principal to the financier, salvage to the
        // exporter, the rest to the insurer
    }

    struct Offer {
        uint256 amount; // escrowed cover, USDG base units
        uint16 premiumBps; // premium the financier pays on acceptance, of `amount`
    }

    struct Cover {
        address insurer;
        address financier;
        uint256 amount;
        uint256 premium; // paid to the insurer at acceptance
        CoverStatus status;
        uint256 financierPayout; // set when CLAIMED
        uint256 insurerReturn; // set when RELEASED or CLAIMED
    }

    event CoverOffered(
        bytes32 indexed shipmentId, address indexed insurer, uint256 amount, uint16 premiumBps
    );
    event OfferWithdrawn(bytes32 indexed shipmentId, address indexed insurer, uint256 amount);
    event CoverAccepted(
        bytes32 indexed shipmentId,
        address indexed insurer,
        address indexed financier,
        uint256 amount,
        uint256 premium
    );
    event CoverReleased(bytes32 indexed shipmentId, address indexed insurer, uint256 amount);
    event CoverClaimed(
        bytes32 indexed shipmentId,
        address indexed financier,
        address indexed insurer,
        uint256 loss,
        uint256 payout,
        uint256 remainder
    );
    event Withdrawn(address indexed account, uint256 amount);

    error InvalidCover();
    error InvalidState(IFinancingController.Status current);
    error InvalidCounterparty();
    error NotFinancier();
    error OfferExists();
    error OfferNotFound();
    error CoverAlreadyAccepted();
    error CoverNotActive();
    error NothingToWithdraw();
    error UnsupportedToken();

    /// @notice Insurer escrows `coverAmount` USDG (approve this pool first) as an offer to cover the
    ///         facility's default. Only while the facility is CREATED or FINANCED, before any cover is
    ///         accepted. 0 < coverAmount <= the facility's commitment; premiumBps <= 2_000 (20%). One
    ///         open offer per insurer per facility; the financier cannot insure itself.
    function offerCover(bytes32 shipmentId, uint256 coverAmount, uint16 premiumBps) external;

    /// @notice The insurer takes back its unaccepted offer, at any time.
    function withdrawOffer(bytes32 shipmentId) external;

    /// @notice The facility's financier accepts `insurer`'s offer while the facility is CREATED or
    ///         FINANCED, paying the premium (amount * premiumBps / 10_000) directly to the insurer
    ///         (approve this pool first). One accepted cover per facility.
    function acceptCover(bytes32 shipmentId, address insurer) external;

    /// @notice Once the facility is SETTLED, credits the whole cover back to the insurer. Anyone.
    function release(bytes32 shipmentId) external;

    /// @notice Once the facility is DEFAULTED, credits the financier min(cover, loss) where loss is the
    ///         principal drawn by the exporter, and credits the remainder to the insurer. Anyone; once.
    function claim(bytes32 shipmentId) external;

    /// @notice Pays the caller everything credited to it by release / claim.
    function withdraw() external;

    function getOffer(bytes32 shipmentId, address insurer) external view returns (Offer memory);

    function getCover(bytes32 shipmentId) external view returns (Cover memory);

    /// @notice USDG credited to `account` and not yet withdrawn.
    function claimable(address account) external view returns (uint256);

    function totalOpenOffers() external view returns (uint256);

    function totalActiveCover() external view returns (uint256);

    function totalClaimable() external view returns (uint256);
}
