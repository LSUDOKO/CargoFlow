// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice v3 electronic bills of lading: one ERC-721 token per bill. Holding the token is holding
///         the title; an ERC-721 transfer is an endorsement and the token's Transfer events are its
///         possession history. Designed around MLETR concepts (exclusive control, singularity,
///         integrity); this is not a claim of legal compliance, which depends on the jurisdiction
///         and on a reliable-system assessment that code cannot grant.
interface IEBLRegistry {
    enum TitleStatus {
        NONE,
        ISSUED, // live title; transferable by its holder
        SURRENDERED, // returned to the issuing carrier at delivery; frozen with the issuer
        VOID // cancelled by the issuer while it held the bill; frozen
    }

    struct BillOfLading {
        bytes32 documentHash; // hash of the bill's document (singularity: one token per document)
        address issuer; // the carrier that issued it (CARRIER_ROLE at issue time)
        address shipper;
        address consignee; // address(0) = "to order"
        TitleStatus status;
        uint64 issuedAt;
        uint64 closedAt; // when surrendered or voided
        uint32 transfers; // endorsements so far (mint not counted)
    }

    event BillIssued(
        uint256 indexed tokenId,
        address indexed issuer,
        address indexed shipper,
        address consignee,
        bytes32 documentHash
    );
    event BillSurrendered(uint256 indexed tokenId, address indexed holder, address indexed issuer);
    event BillVoided(uint256 indexed tokenId, address indexed issuer, bytes32 reason);

    error InvalidBill();
    error DocumentAlreadyIssued();
    error BillNotFound();
    error NotHolder();
    error NotIssuer();
    error TitleNotTransferable(TitleStatus status);

    /// @notice A carrier (CARRIER_ROLE) issues the bill for `documentHash` and mints it to `shipper`.
    ///         Each document hash can be issued once. Token ids start at 1.
    function issue(bytes32 documentHash, address shipper, address consignee)
        external
        returns (uint256 tokenId);

    /// @notice The current holder surrenders the bill to its issuer (at delivery). The token moves to
    ///         the issuer and is frozen as SURRENDERED.
    function surrender(uint256 tokenId) external;

    /// @notice The issuer voids a live bill it currently holds (for example one returned for amendment).
    function voidBill(uint256 tokenId, bytes32 reason) external;

    /// @notice The stored bill; reverts BillNotFound for an unknown id.
    function getBill(uint256 tokenId) external view returns (BillOfLading memory);

    /// @notice The token issued for `documentHash`, or 0.
    function tokenIdForDocument(bytes32 documentHash) external view returns (uint256);
}
