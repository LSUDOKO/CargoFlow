// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {FHE, euint64, euint128, externalEuint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";

/// @title ConfidentialInvoiceTerms
/// @notice Encrypted commercial terms for a CargoFlow shipment, on Fhenix CoFHE (Arbitrum Sepolia).
///
///         The CargoFlow facility on Robinhood Chain is public: commitment, fee, milestones and every
///         evidence epoch. What a trade finance desk will not publish is the commercial side: the
///         exporter's invoice margin and the cold-chain penalty schedule agreed with the buyer. This
///         contract keeps those as FHE ciphertexts keyed by the CargoFlow shipment id and computes the
///         penalty owed for a public number of excursion hours without decrypting anything:
///
///             penalty = min(penaltyPerHour * excursionHours, penaltyCap)
///
///         Who can decrypt (CoFHE ACL, via FHE.allow):
///           - margin:           exporter and financier (the buyer has no business seeing supplier margin)
///           - penalty schedule: exporter, financier and buyer
///           - computed penalty: exporter, financier and buyer
///         Decryption is off-chain through CoFHE SDK ACPs (decryptForView).
///
///         There is no bridge to Robinhood Chain. The link is the shipment id plus `termsCommitment`,
///         a public hash of the ciphertext handles that the CargoFlow dashboard shows next to the
///         facility. `excursionHours` is a public input taken from CargoFlow's public evidence epochs;
///         every computation records who supplied it and the value, so any party can check it against
///         the Robinhood chain and recompute.
contract ConfidentialInvoiceTerms {
    struct Terms {
        address exporter;
        address financier;
        address buyer;
        euint64 marginBps; // invoice margin, basis points
        euint64 penaltyPerHour; // USDG base units (6 decimals) per excursion hour
        euint64 penaltyCap; // USDG base units
        euint64 penalty; // last computed penalty (0 handle until computed)
        uint32 excursionHours; // public input of the last computation
        uint64 setAt;
        uint64 computedAt;
        bool financierAcknowledged;
        bool buyerAcknowledged;
    }

    /// @notice The address CargoFlow uses to report excursion hours (its monitor key on this chain).
    ///         It may compute penalties alongside the three parties; it can never decrypt anything.
    address public immutable REPORTER;

    /// @notice Upper bound on the public excursion-hours input (one year of continuous excursion).
    uint32 public constant MAX_EXCURSION_HOURS = 8760;

    mapping(bytes32 shipmentId => Terms) internal _terms;

    /// @notice keccak256 of the shipment id, the parties and the three term ciphertext handles. Public,
    ///         so the CargoFlow dashboard can show that terms exist and have not changed.
    mapping(bytes32 shipmentId => bytes32) public termsCommitment;

    event TermsSet(
        bytes32 indexed shipmentId,
        address indexed exporter,
        address indexed financier,
        address buyer,
        bytes32 termsCommitment
    );
    event TermsAcknowledged(
        bytes32 indexed shipmentId, address indexed party, bytes32 termsCommitment
    );
    event PenaltyComputed(
        bytes32 indexed shipmentId,
        address indexed computedBy,
        uint32 excursionHours,
        bytes32 penaltyHandle
    );

    error ZeroAddress();
    error DuplicateParty();
    error TermsAlreadySet();
    error TermsNotSet();
    error NotParty();
    error NotAuthorized();
    error ExcursionHoursTooHigh();

    constructor(address reporter) {
        REPORTER = reporter; // address(0) disables the reporter; the parties can still compute
    }

    /// @notice The exporter stores the encrypted terms for `shipmentId`, once. Each value is an
    ///         encrypted input produced by the CoFHE SDK for this contract and the caller.
    function setTerms(
        bytes32 shipmentId,
        address financier,
        address buyer,
        externalEuint64 marginBps,
        bytes calldata marginProof,
        externalEuint64 penaltyPerHour,
        bytes calldata rateProof,
        externalEuint64 penaltyCap,
        bytes calldata capProof
    ) external {
        if (financier == address(0) || buyer == address(0)) {
            revert ZeroAddress();
        }
        if (financier == msg.sender || buyer == msg.sender || financier == buyer) {
            revert DuplicateParty();
        }
        Terms storage t = _terms[shipmentId];
        if (t.exporter != address(0)) revert TermsAlreadySet();

        euint64 margin = FHE.asEuint64(marginBps, marginProof);
        euint64 rate = FHE.asEuint64(penaltyPerHour, rateProof);
        euint64 cap = FHE.asEuint64(penaltyCap, capProof);

        // the contract keeps using the values; the parties may decrypt them
        FHE.allowThis(margin);
        FHE.allowThis(rate);
        FHE.allowThis(cap);
        FHE.allow(margin, msg.sender);
        FHE.allow(margin, financier);
        _allowParties(rate, msg.sender, financier, buyer);
        _allowParties(cap, msg.sender, financier, buyer);

        t.exporter = msg.sender;
        t.financier = financier;
        t.buyer = buyer;
        t.marginBps = margin;
        t.penaltyPerHour = rate;
        t.penaltyCap = cap;
        t.setAt = uint64(block.timestamp);

        bytes32 commitment = keccak256(
            abi.encode(
                block.chainid,
                address(this),
                shipmentId,
                msg.sender,
                financier,
                buyer,
                euint64.unwrap(margin),
                euint64.unwrap(rate),
                euint64.unwrap(cap)
            )
        );
        termsCommitment[shipmentId] = commitment;
        emit TermsSet(shipmentId, msg.sender, financier, buyer, commitment);
    }

    /// @notice The financier or the buyer records that it has seen (decrypted) and accepts the terms
    ///         behind the current commitment.
    function acknowledge(bytes32 shipmentId) external {
        Terms storage t = _terms[shipmentId];
        if (t.exporter == address(0)) revert TermsNotSet();
        if (msg.sender == t.financier) t.financierAcknowledged = true;
        else if (msg.sender == t.buyer) t.buyerAcknowledged = true;
        else revert NotParty();
        emit TermsAcknowledged(shipmentId, msg.sender, termsCommitment[shipmentId]);
    }

    /// @notice Computes min(penaltyPerHour * excursionHours, penaltyCap) under encryption and stores it,
    ///         readable by the exporter, financier and buyer. The multiplication runs in 128 bits, so it
    ///         cannot wrap (64-bit rate x 32-bit hours < 2^96), and the result is <= cap < 2^64.
    ///         Callable by any of the three parties or the reporter; recomputing overwrites the result.
    function computePenalty(bytes32 shipmentId, uint32 excursionHours)
        external
        returns (euint64 penalty)
    {
        Terms storage t = _terms[shipmentId];
        if (t.exporter == address(0)) revert TermsNotSet();
        if (
            msg.sender != t.exporter && msg.sender != t.financier && msg.sender != t.buyer
                && (REPORTER == address(0) || msg.sender != REPORTER)
        ) revert NotAuthorized();
        if (excursionHours > MAX_EXCURSION_HOURS) revert ExcursionHoursTooHigh();

        euint128 raw =
            FHE.mul(FHE.asEuint128(t.penaltyPerHour), FHE.asEuint128(uint256(excursionHours)));
        euint128 capped = FHE.min(raw, FHE.asEuint128(t.penaltyCap));
        penalty = FHE.asEuint64(capped);

        FHE.allowThis(penalty);
        _allowParties(penalty, t.exporter, t.financier, t.buyer);

        t.penalty = penalty;
        t.excursionHours = excursionHours;
        t.computedAt = uint64(block.timestamp);
        emit PenaltyComputed(shipmentId, msg.sender, excursionHours, euint64.unwrap(penalty));
    }

    // ---------------------------------------------------------------- views

    function parties(bytes32 shipmentId)
        external
        view
        returns (address exporter, address financier, address buyer)
    {
        Terms storage t = _terms[shipmentId];
        return (t.exporter, t.financier, t.buyer);
    }

    /// @notice Ciphertext handles (decrypt off-chain with an ACP if you are allowed).
    function handles(bytes32 shipmentId)
        external
        view
        returns (euint64 marginBps, euint64 penaltyPerHour, euint64 penaltyCap, euint64 penalty)
    {
        Terms storage t = _terms[shipmentId];
        return (t.marginBps, t.penaltyPerHour, t.penaltyCap, t.penalty);
    }

    function status(bytes32 shipmentId)
        external
        view
        returns (
            uint64 setAt,
            uint64 computedAt,
            uint32 excursionHours,
            bool financierAcknowledged,
            bool buyerAcknowledged
        )
    {
        Terms storage t = _terms[shipmentId];
        return
            (t.setAt, t.computedAt, t.excursionHours, t.financierAcknowledged, t.buyerAcknowledged);
    }

    function _allowParties(euint64 v, address a, address b, address c) private {
        FHE.allow(v, a);
        FHE.allow(v, b);
        FHE.allow(v, c);
    }
}
