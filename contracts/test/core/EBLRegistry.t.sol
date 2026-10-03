// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC721Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {CargoFlowAccess} from "../../src/access/CargoFlowAccess.sol";
import {Controlled} from "../../src/access/Controlled.sol";
import {EBLRegistry} from "../../src/EBLRegistry.sol";
import {IEBLRegistry} from "../../src/interfaces/IEBLRegistry.sol";
import {Roles} from "../../src/libraries/Roles.sol";

contract EBLRegistryTest is Test {
    CargoFlowAccess internal access;
    EBLRegistry internal ebl;

    address internal admin = makeAddr("admin");
    address internal carrier = makeAddr("carrier");
    address internal shipper = makeAddr("shipper");
    address internal consignee = makeAddr("consignee");
    address internal bank = makeAddr("bank");
    address internal stranger = makeAddr("stranger");

    bytes32 internal constant DOC = keccak256("BL-MAEU-2026-0001.pdf");

    function setUp() public {
        vm.warp(1_800_000_000);
        access = new CargoFlowAccess(0, admin);
        ebl = new EBLRegistry(address(access));
        vm.prank(admin);
        access.grantRole(Roles.CARRIER_ROLE, carrier);
    }

    function _issue() internal returns (uint256 tokenId) {
        vm.prank(carrier);
        tokenId = ebl.issue(DOC, shipper, consignee);
    }

    function test_metadata() public view {
        assertEq(ebl.name(), "CargoFlow Electronic Bill of Lading");
        assertEq(ebl.symbol(), "CFEBL");
        assertTrue(ebl.supportsInterface(0x80ac58cd)); // ERC-721
    }

    function test_carrierIssuesToShipper() public {
        vm.expectEmit(address(ebl));
        emit IEBLRegistry.BillIssued(1, carrier, shipper, consignee, DOC);
        uint256 id = _issue();
        assertEq(id, 1);
        assertEq(ebl.ownerOf(id), shipper);
        assertEq(ebl.tokenIdForDocument(DOC), 1);
        assertEq(ebl.totalIssued(), 1);
        IEBLRegistry.BillOfLading memory b = ebl.getBill(id);
        assertEq(b.documentHash, DOC);
        assertEq(b.issuer, carrier);
        assertEq(b.shipper, shipper);
        assertEq(b.consignee, consignee);
        assertEq(uint8(b.status), uint8(IEBLRegistry.TitleStatus.ISSUED));
        assertEq(b.issuedAt, block.timestamp);
        assertEq(b.closedAt, 0);
        assertEq(b.transfers, 0);
    }

    function test_toOrderBillHasNoConsignee() public {
        vm.prank(carrier);
        uint256 id = ebl.issue(DOC, shipper, address(0));
        assertEq(ebl.getBill(id).consignee, address(0));
    }

    function test_onlyCarrierIssues() public {
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(Controlled.Unauthorized.selector, Roles.CARRIER_ROLE, stranger)
        );
        ebl.issue(DOC, shipper, consignee);
    }

    function test_singularityOneTokenPerDocument() public {
        _issue();
        vm.prank(carrier);
        vm.expectRevert(IEBLRegistry.DocumentAlreadyIssued.selector);
        ebl.issue(DOC, stranger, consignee);
    }

    function test_rejectsInvalidIssue() public {
        vm.startPrank(carrier);
        vm.expectRevert(IEBLRegistry.InvalidBill.selector);
        ebl.issue(bytes32(0), shipper, consignee);
        vm.expectRevert(IEBLRegistry.InvalidBill.selector);
        ebl.issue(DOC, address(0), consignee);
        vm.stopPrank();
    }

    function test_endorsementChainIsCounted() public {
        uint256 id = _issue();
        vm.prank(shipper);
        ebl.transferFrom(shipper, bank, id);
        vm.prank(bank);
        ebl.transferFrom(bank, consignee, id);
        assertEq(ebl.ownerOf(id), consignee);
        assertEq(ebl.getBill(id).transfers, 2);
    }

    function test_onlyHolderOrApprovedTransfers() public {
        uint256 id = _issue();
        vm.prank(stranger);
        vm.expectRevert(
            abi.encodeWithSelector(IERC721Errors.ERC721InsufficientApproval.selector, stranger, id)
        );
        ebl.transferFrom(shipper, stranger, id);
        // the carrier has no power over a title it issued
        vm.prank(carrier);
        vm.expectRevert(
            abi.encodeWithSelector(IERC721Errors.ERC721InsufficientApproval.selector, carrier, id)
        );
        ebl.transferFrom(shipper, carrier, id);
    }

    function test_holderSurrendersToIssuerAndTitleFreezes() public {
        uint256 id = _issue();
        vm.prank(shipper);
        ebl.transferFrom(shipper, consignee, id);
        vm.warp(block.timestamp + 1 days);

        vm.expectEmit(address(ebl));
        emit IEBLRegistry.BillSurrendered(id, consignee, carrier);
        vm.prank(consignee);
        ebl.surrender(id);

        assertEq(ebl.ownerOf(id), carrier);
        IEBLRegistry.BillOfLading memory b = ebl.getBill(id);
        assertEq(uint8(b.status), uint8(IEBLRegistry.TitleStatus.SURRENDERED));
        assertEq(b.closedAt, block.timestamp);

        // frozen: not even the issuer can move it again
        vm.prank(carrier);
        vm.expectRevert(
            abi.encodeWithSelector(
                IEBLRegistry.TitleNotTransferable.selector, IEBLRegistry.TitleStatus.SURRENDERED
            )
        );
        ebl.transferFrom(carrier, stranger, id);
        vm.prank(carrier);
        vm.expectRevert(
            abi.encodeWithSelector(
                IEBLRegistry.TitleNotTransferable.selector, IEBLRegistry.TitleStatus.SURRENDERED
            )
        );
        ebl.surrender(id);
    }

    function test_onlyHolderSurrenders() public {
        uint256 id = _issue();
        vm.prank(stranger);
        vm.expectRevert(IEBLRegistry.NotHolder.selector);
        ebl.surrender(id);
        vm.prank(carrier);
        vm.expectRevert(IEBLRegistry.NotHolder.selector);
        ebl.surrender(id);
    }

    function test_issuerVoidsOnlyWhileHoldingALiveBill() public {
        uint256 id = _issue();
        vm.prank(carrier);
        vm.expectRevert(IEBLRegistry.NotHolder.selector);
        ebl.voidBill(id, "amend");
        vm.prank(shipper);
        vm.expectRevert(IEBLRegistry.NotIssuer.selector);
        ebl.voidBill(id, "amend");

        vm.prank(shipper);
        ebl.transferFrom(shipper, carrier, id); // returned for amendment
        vm.expectEmit(address(ebl));
        emit IEBLRegistry.BillVoided(id, carrier, "amend");
        vm.prank(carrier);
        ebl.voidBill(id, "amend");
        assertEq(uint8(ebl.getBill(id).status), uint8(IEBLRegistry.TitleStatus.VOID));

        vm.prank(carrier);
        vm.expectRevert(
            abi.encodeWithSelector(
                IEBLRegistry.TitleNotTransferable.selector, IEBLRegistry.TitleStatus.VOID
            )
        );
        ebl.voidBill(id, "again");
        vm.prank(carrier);
        vm.expectRevert(
            abi.encodeWithSelector(
                IEBLRegistry.TitleNotTransferable.selector, IEBLRegistry.TitleStatus.VOID
            )
        );
        ebl.transferFrom(carrier, shipper, id);
    }

    function test_unknownBill() public {
        vm.expectRevert(IEBLRegistry.BillNotFound.selector);
        ebl.getBill(7);
        vm.expectRevert(IEBLRegistry.BillNotFound.selector);
        ebl.surrender(7);
        vm.expectRevert(IEBLRegistry.BillNotFound.selector);
        ebl.voidBill(7, "");
        assertEq(ebl.tokenIdForDocument(DOC), 0);
    }

    function testFuzz_endorsementsKeepASingleHolder(uint8 hops, uint256 seed) public {
        hops = uint8(bound(hops, 1, 20));
        uint256 id = _issue();
        address holder = shipper;
        for (uint256 i; i < hops; ++i) {
            address next = address(uint160(uint256(keccak256(abi.encode(seed, i))) | 1));
            vm.prank(holder);
            ebl.transferFrom(holder, next, id);
            holder = next;
            assertEq(ebl.ownerOf(id), holder);
            assertEq(ebl.balanceOf(holder), 1);
        }
        assertEq(ebl.getBill(id).transfers, hops);
        vm.prank(holder);
        ebl.surrender(id);
        assertEq(ebl.ownerOf(id), carrier);
    }
}
