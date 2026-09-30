// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {console2} from "forge-std/console2.sol";
import {IFinancingController} from "../../src/interfaces/IFinancingController.sol";
import {IReceivableVault} from "../../src/interfaces/IReceivableVault.sol";
import {ControllerBase} from "../core/ControllerBase.sol";
import {CargoFlowHandler} from "./Handler.sol";

/// @notice Protocol-wide safety properties (docs/project/10 I1-I8, 16, 27) under random sequences.
contract CargoFlowInvariants is StdInvariant, ControllerBase {
    CargoFlowHandler internal handler;

    function setUp() public override {
        super.setUp();
        handler = new CargoFlowHandler(
            [
                address(registry),
                address(policies),
                address(evidence),
                address(vault),
                address(controller),
                address(usdg)
            ],
            [worker, monitor, arbiter, manager, financier, buyer, stranger]
        );
        // Duplicated selectors weight the fuzzer: mostly guided happy-path steps (so runs reach
        // DELIVERED/SETTLED/DEFAULTED), with hostile and out-of-order actions mixed in.
        bytes4[] memory selectors = new bytes4[](16);
        for (uint256 i; i < 8; ++i) {
            selectors[i] = CargoFlowHandler.advance.selector;
        }
        selectors[8] = CargoFlowHandler.pause.selector;
        selectors[9] = CargoFlowHandler.openDispute.selector;
        selectors[10] = CargoFlowHandler.attack.selector;
        selectors[11] = CargoFlowHandler.markDefaulted.selector;
        selectors[12] = CargoFlowHandler.resume.selector;
        selectors[13] = CargoFlowHandler.release.selector;
        selectors[14] = CargoFlowHandler.warp.selector;
        selectors[15] = CargoFlowHandler.settle.selector;
        targetSelector(FuzzSelector({addr: address(handler), selectors: selectors}));
        targetContract(address(handler));
    }

    /// Prints how deep the random runs actually got, so a green suite is not vacuous.
    function afterInvariant() public view {
        console2.log("tranches released:", handler.tranchesReleased());
        console2.log(
            "entered ACTIVE/PAUSED/DISPUTED:",
            handler.entered(3),
            handler.entered(4),
            handler.entered(5)
        );
        console2.log(
            "entered DELIVERED/SETTLED/DEFAULTED:",
            handler.entered(6),
            handler.entered(7),
            handler.entered(8)
        );
    }

    function _each(function(uint256, bytes32) internal view fn) internal view {
        for (uint256 i; i < handler.N(); ++i) {
            if (handler.created(i)) fn(i, handler.ids(i));
        }
    }

    /// I1: totalDrawn <= totalCommitted
    function invariant_drawnNeverExceedsCommitted() public view {
        _each(_checkDrawn);
    }

    function _checkDrawn(uint256, bytes32 sid) internal view {
        IReceivableVault.Facility memory f = vault.getFacility(sid);
        assertLe(f.drawn, f.committed, "I1 drawn > committed");
    }

    /// I6/I7: recipient and fee are fixed at creation
    function invariant_supplierAndFeeAreImmutable() public view {
        _each(_checkImmutables);
    }

    function _checkImmutables(uint256 i, bytes32 sid) internal view {
        IReceivableVault.Facility memory f = vault.getFacility(sid);
        assertEq(f.supplier, handler.exporters(i), "I6 supplier changed");
        assertEq(f.financier, financier, "financier changed");
        assertEq(f.payer, buyer, "payer changed");
        assertEq(f.feeBps, handler.fees(i), "I7 fee changed");
    }

    /// I8 + custody: until settlement the exporter holds exactly what was drawn
    function invariant_exporterBalanceMatchesAdvances() public view {
        _each(_checkExporterBalance);
    }

    function _checkExporterBalance(uint256 i, bytes32 sid) internal view {
        IReceivableVault.Facility memory f = vault.getFacility(sid);
        IFinancingController.Status st = controller.getFacility(sid).status;
        if (st != IFinancingController.Status.SETTLED) {
            assertEq(usdg.balanceOf(handler.exporters(i)), f.drawn, "advances != drawn");
        } else {
            uint256 fee = (f.drawn * f.feeBps) / 10_000;
            assertEq(usdg.balanceOf(handler.exporters(i)), f.invoiceValue - fee, "settled exporter");
        }
    }

    /// The vault never owes more than it holds: balance == sum of undrawn commitments of open facilities
    function invariant_vaultIsExactlySolvent() public view {
        uint256 owed;
        for (uint256 i; i < handler.N(); ++i) {
            if (!handler.created(i)) continue;
            IReceivableVault.Facility memory f = vault.getFacility(handler.ids(i));
            if (f.funded && !f.closed) owed += f.committed - f.drawn;
        }
        assertEq(usdg.balanceOf(address(vault)), owed, "vault balance != open undrawn commitments");
    }

    /// Operational accounts (AI monitor, evidence worker, arbiter, manager, strangers) never hold USDG
    function invariant_operationalAccountsNeverReceiveFunds() public view {
        assertEq(usdg.balanceOf(monitor), 0, "monitor received funds");
        assertEq(usdg.balanceOf(worker), 0, "worker received funds");
        assertEq(usdg.balanceOf(arbiter), 0, "arbiter received funds");
        assertEq(usdg.balanceOf(manager), 0, "manager received funds");
        assertEq(usdg.balanceOf(stranger), 0, "stranger received funds");
        assertEq(usdg.balanceOf(address(controller)), 0, "controller custodies funds");
    }

    /// I2-I5 + authorization: no action sequence broke a transition rule, and no hostile caller succeeded
    function invariant_noSafetyViolationsObserved() public view {
        assertEq(handler.violations(), 0, "a safety rule was broken during the run");
    }
}
