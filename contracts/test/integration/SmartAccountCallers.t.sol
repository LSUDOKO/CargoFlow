// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC721} from "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import {ControllerBase} from "../core/ControllerBase.sol";
import {MockSmartAccount} from "../mocks/MockSmartAccount.sol";
import {IFinancingController} from "../../src/interfaces/IFinancingController.sol";
import {Roles} from "../../src/libraries/Roles.sol";

/// @notice Exporter and buyer are contract accounts (as a ZeroDev Kernel smart account would be),
///         driven by a separate bundler EOA so tx.origin never equals msg.sender. Every role-bearing
///         call works: nothing in CargoFlow depends on tx.origin or on the caller being an EOA.
contract SmartAccountCallersTest is ControllerBase {
    address internal bundler = makeAddr("bundler");
    address internal carrier = makeAddr("carrier");
    MockSmartAccount internal exporterAccount;
    MockSmartAccount internal buyerAccount;

    uint256[2] internal pa;
    uint256[2][2] internal pb;
    uint256[2] internal pc;

    function setUp() public override {
        exporterAccount = new MockSmartAccount(bundler);
        buyerAccount = new MockSmartAccount(bundler);
        exporter = address(exporterAccount);
        buyer = address(buyerAccount);
        super.setUp();
        vm.prank(admin);
        access.grantRole(Roles.CARRIER_ROLE, carrier);
    }

    function _asExporter(address target, bytes memory data) internal returns (bytes memory) {
        vm.prank(bundler, bundler); // msg.sender and tx.origin = the bundler EOA
        return exporterAccount.execute(target, 0, data);
    }

    function _asBuyer(address target, bytes memory data) internal returns (bytes memory) {
        vm.prank(bundler, bundler);
        return buyerAccount.execute(target, 0, data);
    }

    function test_accountsAreContracts() public view {
        assertGt(exporter.code.length, 0);
        assertGt(buyer.code.length, 0);
    }

    function test_contractExporterCreatesBindsAndContractBuyerDeliversAndSettles() public {
        // the exporter account registers the shipment, its policy and the facility
        bytes32 commitment = policies.hashPolicy(policy);
        id = abi.decode(
            _asExporter(
                address(registry),
                abi.encodeCall(
                    registry.registerShipment,
                    (REF, buyer, keccak256("inv"), keccak256("route"), commitment, INVOICE)
                )
            ),
            (bytes32)
        );
        _asExporter(address(policies), abi.encodeCall(policies.setPolicy, (id, policy)));
        _asExporter(
            address(controller),
            abi.encodeCall(controller.createFacility, (id, financier, FEE_BPS, _milestones()))
        );

        // a bill of lading issued to the exporter account and bound through it
        vm.prank(carrier);
        uint256 tokenId = ebl.issue(keccak256("BL-SA"), exporter, buyer);
        _asExporter(address(ebl), abi.encodeCall(IERC721.approve, (address(controller), tokenId)));
        _asExporter(address(controller), abi.encodeCall(controller.bindTitle, (id, tokenId)));
        assertEq(ebl.ownerOf(tokenId), address(controller));

        vm.prank(financier);
        controller.depositCapital(id);
        _asExporter(address(controller), abi.encodeCall(controller.startTransit, (id)));
        for (uint8 i; i < 5; ++i) {
            _commitEvidence(i, 1, 95, 300);
            _asExporter(
                address(controller),
                abi.encodeCall(controller.evaluateAndReleaseMilestone, (id, i, 1))
            );
        }
        assertEq(usdg.balanceOf(exporter), COMMITTED);

        // the buyer account confirms delivery, approves the vault and settles; the title follows
        _asBuyer(address(controller), abi.encodeCall(controller.markDelivered, (id)));
        _asBuyer(address(usdg), abi.encodeCall(IERC20.approve, (address(vault), INVOICE)));
        _asBuyer(address(controller), abi.encodeCall(controller.settle, (id)));
        assertEq(
            uint8(controller.getFacility(id).status), uint8(IFinancingController.Status.SETTLED)
        );
        assertEq(ebl.ownerOf(tokenId), buyer);
        assertEq(usdg.balanceOf(exporter), INVOICE - 1_200e6);
        // and can surrender the title to the carrier
        _asBuyer(address(ebl), abi.encodeCall(ebl.surrender, (tokenId)));
        assertEq(ebl.ownerOf(tokenId), carrier);
    }

    function test_contractExporterResumesWithProof() public {
        _pausedAfterAnomaly();
        _commitEvidence(2, 2, 92, 300);
        _asExporter(
            address(controller), abi.encodeCall(controller.resumeWithProof, (id, 2, 2, pa, pb, pc))
        );
        assertEq(
            uint8(controller.getFacility(id).status), uint8(IFinancingController.Status.ACTIVE)
        );
    }

    function test_contractExporterCancels() public {
        _createFacility();
        _asExporter(address(controller), abi.encodeCall(controller.cancelFacility, (id)));
        assertEq(
            uint8(controller.getFacility(id).status), uint8(IFinancingController.Status.CANCELLED)
        );
    }

    function test_strangerCannotDriveTheAccount() public {
        vm.prank(stranger);
        vm.expectRevert(MockSmartAccount.NotOwner.selector);
        buyerAccount.execute(address(controller), 0, abi.encodeCall(controller.settle, (id)));
    }
}
