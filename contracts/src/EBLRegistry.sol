// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {ERC721} from "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import {Controlled} from "./access/Controlled.sol";
import {IEBLRegistry} from "./interfaces/IEBLRegistry.sol";
import {Roles} from "./libraries/Roles.sol";

/// @title EBLRegistry
/// @notice One ERC-721 token per electronic bill of lading (OpenZeppelin ERC721). Exclusive control
///         is the token's single owner; singularity is one token per document hash; integrity is the
///         immutable document hash plus the frozen state of a surrendered or voided bill. Only a live
///         (ISSUED) bill can change hands. No admin can move or burn a title.
/// @dev Designed around MLETR concepts; not a legal compliance claim (see docs/architecture.md).
contract EBLRegistry is ERC721, Controlled, IEBLRegistry {
    mapping(uint256 tokenId => BillOfLading) private _bills;
    mapping(bytes32 documentHash => uint256 tokenId) private _byDocument;
    uint256 public totalIssued;

    constructor(address access)
        ERC721("CargoFlow Electronic Bill of Lading", "CFEBL")
        Controlled(access)
    {}

    /// @inheritdoc IEBLRegistry
    function issue(bytes32 documentHash, address shipper, address consignee)
        external
        onlyRole(Roles.CARRIER_ROLE)
        returns (uint256 tokenId)
    {
        if (documentHash == 0 || shipper == address(0)) revert InvalidBill();
        if (_byDocument[documentHash] != 0) revert DocumentAlreadyIssued();

        tokenId = ++totalIssued;
        _byDocument[documentHash] = tokenId;
        _bills[tokenId] = BillOfLading({
            documentHash: documentHash,
            issuer: msg.sender,
            shipper: shipper,
            consignee: consignee,
            status: TitleStatus.ISSUED,
            issuedAt: uint64(block.timestamp),
            closedAt: 0,
            transfers: 0
        });
        // _mint, not _safeMint: issuing must never depend on a receiver callback
        _mint(shipper, tokenId);

        emit BillIssued(tokenId, msg.sender, shipper, consignee, documentHash);
    }

    /// @inheritdoc IEBLRegistry
    function surrender(uint256 tokenId) external {
        BillOfLading storage b = _load(tokenId);
        if (b.status != TitleStatus.ISSUED) revert TitleNotTransferable(b.status);
        if (_ownerOf(tokenId) != msg.sender) revert NotHolder();
        address issuer = b.issuer;
        // the transfer runs while the bill is still ISSUED, then the title freezes with the issuer
        _transfer(msg.sender, issuer, tokenId);
        b.status = TitleStatus.SURRENDERED;
        b.closedAt = uint64(block.timestamp);
        emit BillSurrendered(tokenId, msg.sender, issuer);
    }

    /// @inheritdoc IEBLRegistry
    function voidBill(uint256 tokenId, bytes32 reason) external {
        BillOfLading storage b = _load(tokenId);
        if (msg.sender != b.issuer) revert NotIssuer();
        if (b.status != TitleStatus.ISSUED) revert TitleNotTransferable(b.status);
        if (_ownerOf(tokenId) != msg.sender) revert NotHolder();
        b.status = TitleStatus.VOID;
        b.closedAt = uint64(block.timestamp);
        emit BillVoided(tokenId, msg.sender, reason);
    }

    /// @inheritdoc IEBLRegistry
    function getBill(uint256 tokenId) external view returns (BillOfLading memory) {
        return _load(tokenId);
    }

    /// @inheritdoc IEBLRegistry
    function tokenIdForDocument(bytes32 documentHash) external view returns (uint256) {
        return _byDocument[documentHash];
    }

    /// @dev Every movement after mint is an endorsement and is only possible for a live bill.
    function _update(address to, uint256 tokenId, address auth)
        internal
        override
        returns (address from)
    {
        BillOfLading storage b = _bills[tokenId];
        if (_ownerOf(tokenId) != address(0)) {
            if (b.status != TitleStatus.ISSUED) revert TitleNotTransferable(b.status);
            if (to == address(0)) revert InvalidBill(); // titles are never burnt
            b.transfers += 1;
        }
        return super._update(to, tokenId, auth);
    }

    function _load(uint256 tokenId) internal view returns (BillOfLading storage b) {
        b = _bills[tokenId];
        if (b.status == TitleStatus.NONE) revert BillNotFound();
    }
}
