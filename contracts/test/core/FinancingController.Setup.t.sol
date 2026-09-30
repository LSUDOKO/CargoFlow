// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IFinancingController} from "../../src/interfaces/IFinancingController.sol";
import {IPolicyEngine} from "../../src/interfaces/IPolicyEngine.sol";
import {IReceivableVault} from "../../src/interfaces/IReceivableVault.sol";
import {ControllerBase} from "./ControllerBase.sol";

contract FinancingControllerSetupTest is ControllerBase {
    function test_createFacilityRecordsStateAndOpensVault() public {
        _registerAndSetPolicy();
        vm.expectEmit(true, true, true, true);
        emit IFinancingController.FacilityCreated(id, financier, exporter, COMMITTED, FEE_BPS, 5);
        IFinancingController.MilestoneSpec[] memory m = _milestones();
        vm.prank(exporter);
        controller.createFacility(id, financier, FEE_BPS, m);

        IFinancingController.FacilityState memory f = controller.getFacility(id);
        assertEq(uint8(f.status), uint8(IFinancingController.Status.CREATED));
        assertEq(f.financier, financier);
        assertEq(f.committed, COMMITTED);
        assertEq(f.feeBps, FEE_BPS);
        assertEq(f.milestoneCount, 5);
        assertEq(f.nextMilestone, 0);

        IReceivableVault.Facility memory vf = vault.getFacility(id);
        assertEq(vf.supplier, exporter, "advances can only ever go to the exporter");
        assertEq(vf.payer, buyer);
        assertEq(vf.committed, COMMITTED);
        assertEq(vf.invoiceValue, INVOICE);
        assertFalse(vf.funded);

        IFinancingController.MilestoneSpec memory m2 = controller.getMilestone(id, 2);
        assertEq(m2.allocation, TRANCHE);
        assertEq(m2.evidenceThreshold, 75);
    }

    function test_onlyExporterMayCreateFacility() public {
        _registerAndSetPolicy();
        IFinancingController.MilestoneSpec[] memory m = _milestones();
        vm.prank(stranger);
        vm.expectRevert(IFinancingController.NotExporter.selector);
        controller.createFacility(id, financier, FEE_BPS, m);
    }

    function test_policyMustBeRevealedFirst() public {
        bytes32 commitment = policies.hashPolicy(policy);
        vm.prank(exporter);
        id = registry.registerShipment(
            REF, buyer, keccak256("invoice.pdf"), keccak256("route"), commitment, INVOICE
        );
        IFinancingController.MilestoneSpec[] memory m = _milestones();
        vm.prank(exporter);
        vm.expectRevert(IPolicyEngine.PolicyNotSet.selector);
        controller.createFacility(id, financier, FEE_BPS, m);
    }

    function test_unknownShipmentReverts() public {
        IFinancingController.MilestoneSpec[] memory m = _milestones();
        vm.prank(exporter);
        vm.expectRevert();
        controller.createFacility(keccak256("missing"), financier, FEE_BPS, m);
    }

    function test_facilityCanOnlyBeCreatedOnce() public {
        _createFacility();
        IFinancingController.MilestoneSpec[] memory m = _milestones();
        vm.prank(exporter);
        vm.expectRevert(IFinancingController.FacilityAlreadyCreated.selector);
        controller.createFacility(id, financier, FEE_BPS, m);
    }

    function test_financierMustBeIndependentCounterparty() public {
        _registerAndSetPolicy();
        IFinancingController.MilestoneSpec[] memory m = _milestones();
        vm.startPrank(exporter);
        vm.expectRevert(IFinancingController.InvalidCounterparty.selector);
        controller.createFacility(id, address(0), FEE_BPS, m);
        vm.expectRevert(IFinancingController.InvalidCounterparty.selector);
        controller.createFacility(id, exporter, FEE_BPS, m);
        vm.expectRevert(IFinancingController.InvalidCounterparty.selector);
        controller.createFacility(id, buyer, FEE_BPS, m);
        vm.stopPrank();
    }

    function test_milestoneSetValidation() public {
        _registerAndSetPolicy();
        vm.startPrank(exporter);

        IFinancingController.MilestoneSpec[] memory none;
        vm.expectRevert(IFinancingController.InvalidMilestones.selector);
        controller.createFacility(id, financier, FEE_BPS, none);

        IFinancingController.MilestoneSpec[] memory tooMany =
            new IFinancingController.MilestoneSpec[](17);
        for (uint256 i; i < 17; ++i) {
            tooMany[i] = IFinancingController.MilestoneSpec(1e6, 75, bytes32(uint256(i + 1)));
        }
        vm.expectRevert(IFinancingController.InvalidMilestones.selector);
        controller.createFacility(id, financier, FEE_BPS, tooMany);

        IFinancingController.MilestoneSpec[] memory zeroAlloc = _milestones();
        zeroAlloc[1].allocation = 0;
        vm.expectRevert(IFinancingController.InvalidMilestones.selector);
        controller.createFacility(id, financier, FEE_BPS, zeroAlloc);

        IFinancingController.MilestoneSpec[] memory weakThreshold = _milestones();
        weakThreshold[0].evidenceThreshold = 74; // below the policy floor of 75
        vm.expectRevert(IFinancingController.InvalidMilestones.selector);
        controller.createFacility(id, financier, FEE_BPS, weakThreshold);

        IFinancingController.MilestoneSpec[] memory impossible = _milestones();
        impossible[0].evidenceThreshold = 101;
        vm.expectRevert(IFinancingController.InvalidMilestones.selector);
        controller.createFacility(id, financier, FEE_BPS, impossible);
        vm.stopPrank();
    }

    function test_vaultTermValidationBubblesUp() public {
        _registerAndSetPolicy();
        IFinancingController.MilestoneSpec[] memory m = _milestones();
        vm.prank(exporter);
        vm.expectRevert(IReceivableVault.InvalidFacility.selector); // fee above the 20% cap
        controller.createFacility(id, financier, 2_001, m);
    }

    function test_financierFundsFacilityExactlyOnce() public {
        _createFacility();
        vm.expectEmit(true, false, false, true);
        emit IFinancingController.StatusChanged(
            id, IFinancingController.Status.CREATED, IFinancingController.Status.FINANCED
        );
        vm.prank(financier);
        controller.depositCapital(id);

        assertEq(
            uint8(controller.getFacility(id).status), uint8(IFinancingController.Status.FINANCED)
        );
        assertEq(usdg.balanceOf(address(vault)), COMMITTED);
        assertEq(usdg.balanceOf(financier), 0);

        vm.prank(financier);
        vm.expectRevert(
            abi.encodeWithSelector(
                IFinancingController.InvalidState.selector, IFinancingController.Status.FINANCED
            )
        );
        controller.depositCapital(id);
    }

    function test_onlyDesignatedFinancierMayFund() public {
        _createFacility();
        vm.prank(stranger);
        vm.expectRevert(IFinancingController.NotFinancier.selector);
        controller.depositCapital(id);
    }

    function test_cannotFundUnknownFacility() public {
        vm.prank(financier);
        vm.expectRevert(IFinancingController.FacilityNotFound.selector);
        controller.depositCapital(keccak256("missing"));
    }

    function test_exporterOrManagerStartsTransit() public {
        _fund();
        vm.prank(exporter);
        controller.startTransit(id);
        assertEq(
            uint8(controller.getFacility(id).status), uint8(IFinancingController.Status.ACTIVE)
        );
    }

    function test_managerMayStartTransitToo() public {
        _fund();
        vm.prank(manager);
        controller.startTransit(id);
        assertEq(
            uint8(controller.getFacility(id).status), uint8(IFinancingController.Status.ACTIVE)
        );
    }

    function test_strangerCannotStartTransit() public {
        _fund();
        vm.prank(stranger);
        vm.expectRevert(IFinancingController.NotAuthorizedForShipment.selector);
        controller.startTransit(id);
    }

    function test_cannotStartTransitBeforeFunding() public {
        _createFacility();
        vm.prank(exporter);
        vm.expectRevert(
            abi.encodeWithSelector(
                IFinancingController.InvalidState.selector, IFinancingController.Status.CREATED
            )
        );
        controller.startTransit(id);
    }
}
