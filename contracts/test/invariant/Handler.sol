// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {ShipmentRegistry} from "../../src/ShipmentRegistry.sol";
import {PolicyEngine} from "../../src/PolicyEngine.sol";
import {EvidenceRegistry} from "../../src/EvidenceRegistry.sol";
import {ReceivableVault} from "../../src/ReceivableVault.sol";
import {FinancingController} from "../../src/FinancingController.sol";
import {IFinancingController} from "../../src/interfaces/IFinancingController.sol";
import {IPolicyEngine} from "../../src/interfaces/IPolicyEngine.sol";
import {MockUSDG} from "../../src/mocks/MockUSDG.sol";

/// @notice Drives the protocol with random (mostly legal, sometimes hostile) action sequences and
///         records any rule it sees broken in `violations`. Every action is wrapped so the handler
///         itself never reverts; the invariant suite asserts `violations == 0`.
contract CargoFlowHandler is Test {
    uint256 public constant N = 4;
    uint256 internal constant COMMITTED = 40_000e6;
    uint256 internal constant INVOICE = 100_000e6;

    ShipmentRegistry internal registry;
    PolicyEngine internal policies;
    EvidenceRegistry internal evidence;
    ReceivableVault internal vault;
    FinancingController internal controller;
    MockUSDG internal usdg;

    address internal worker;
    address internal monitor;
    address internal arbiter;
    address internal manager;
    address internal financier;
    address internal buyer;
    address internal stranger;

    IPolicyEngine.Policy internal policy;

    bytes32[4] public ids;
    bool[4] public created;
    address[4] public exporters;
    uint16[4] public fees;
    uint32[4] internal seqs;

    /// Incremented whenever an action breaks a safety rule. Must stay 0.
    uint256 public violations;

    /// Reachability evidence: how often each status was entered / tranches released.
    uint256[9] public entered;
    uint256 public tranchesReleased;

    struct Snap {
        IFinancingController.Status status;
        uint256 drawn;
        uint8 next;
    }

    constructor(
        address[6] memory core, // registry, policies, evidence, vault, controller, usdg
        address[7] memory actors // worker, monitor, arbiter, manager, financier, buyer, stranger
    ) {
        registry = ShipmentRegistry(core[0]);
        policies = PolicyEngine(core[1]);
        evidence = EvidenceRegistry(core[2]);
        vault = ReceivableVault(core[3]);
        controller = FinancingController(core[4]);
        usdg = MockUSDG(core[5]);
        (worker, monitor, arbiter, manager, financier, buyer, stranger) =
            (actors[0], actors[1], actors[2], actors[3], actors[4], actors[5], actors[6]);

        policy = IPolicyEngine.Policy({
            minTempX100: 200,
            maxTempX100: 800,
            maxEvidenceAgeSec: 1800,
            maxRouteDeviationM: 25_000,
            minEvidenceScore: 75,
            maxConflictBps: 3000,
            maxRiskBps: 3500,
            requiresZK: false
        });
    }

    // ------------------------------------------------------------------ actions

    function create(uint256 s, uint256 feeSeed) external {
        _create(bound(s, 0, N - 1), feeSeed);
    }

    function _create(uint256 s, uint256 feeSeed) internal {
        if (created[s]) return;
        address ex = address(uint160(0x1000 + s));
        bytes32 commitment = policies.hashPolicy(policy);
        bytes32 ref = keccak256(abi.encode("ref", s));

        vm.prank(ex);
        bytes32 id = registry.registerShipment(
            ref, buyer, keccak256("invoice"), keccak256("route"), commitment, INVOICE
        );
        vm.prank(ex);
        policies.setPolicy(id, policy);

        uint16 fee = uint16(bound(feeSeed, 0, 2_000));
        IFinancingController.MilestoneSpec[] memory m = new IFinancingController.MilestoneSpec[](5);
        for (uint256 i; i < 5; ++i) {
            m[i] = IFinancingController.MilestoneSpec(8_000e6, 75, keccak256(abi.encode(i)));
        }
        vm.prank(ex);
        controller.createFacility(id, financier, fee, m);

        usdg.mint(financier, COMMITTED);
        vm.prank(financier);
        controller.depositCapital(id);

        ids[s] = id;
        created[s] = true;
        exporters[s] = ex;
        fees[s] = fee;
    }

    function startTransit(uint256 s) external {
        s = bound(s, 0, N - 1);
        if (!created[s]) return;
        Snap memory pre = _pre(s);
        vm.prank(exporters[s]);
        try controller.startTransit(ids[s]) {} catch {}
        _post(s, pre);
    }

    function release(uint256 s, uint256 score, uint256 conflict, uint256 risk, bool compliant)
        external
    {
        _release(bound(s, 0, N - 1), score, conflict, risk, compliant);
    }

    /// Guided happy-path walker with occasional injected chaos. Keeps the run deep enough to reach
    /// DELIVERED / SETTLED / DEFAULTED so the invariants are exercised on real end states.
    function advance(uint256 s, uint256 seed) external {
        s = bound(s, 0, N - 1);
        if (!created[s]) return _create(s, seed);

        Snap memory pre = _pre(s);
        IFinancingController.Status st = pre.status;
        bool chaos = seed % 7 == 0;

        if (st == IFinancingController.Status.FINANCED) {
            vm.prank(exporters[s]);
            try controller.startTransit(ids[s]) {} catch {}
        } else if (st == IFinancingController.Status.ACTIVE) {
            if (pre.next < controller.getFacility(ids[s]).milestoneCount) {
                if (chaos) {
                    _release(s, seed, seed >> 8, seed >> 16, seed % 2 == 0);
                } else {
                    _release(s, 75 + (seed % 26), seed % 3_001, seed % 3_501, true);
                }
                return;
            }
            vm.prank(buyer);
            try controller.markDelivered(ids[s]) {} catch {}
        } else if (st == IFinancingController.Status.DELIVERED) {
            usdg.mint(buyer, INVOICE);
            vm.prank(buyer);
            try controller.settle(ids[s]) {} catch {}
        } else if (st == IFinancingController.Status.PAUSED) {
            vm.prank(arbiter);
            try controller.resumeByVerifier(ids[s], keccak256("BASIS")) {} catch {}
        } else if (st == IFinancingController.Status.DISPUTED) {
            vm.prank(arbiter);
            try controller.resolveDispute(ids[s], seed % 3 != 0, keccak256("RESOLUTION")) {}
                catch {}
        }
        _post(s, pre);
    }

    function _release(uint256 s, uint256 score, uint256 conflict, uint256 risk, bool compliant)
        internal
    {
        if (!created[s]) return;
        Snap memory pre = _pre(s);
        if (pre.next >= controller.getFacility(ids[s]).milestoneCount) return;

        uint32 seq = ++seqs[s];
        vm.prank(worker);
        try evidence.commitEpoch(
            ids[s],
            pre.next,
            seq,
            keccak256(abi.encode(ids[s], seq)),
            uint64(block.timestamp - 600),
            uint64(block.timestamp - 60),
            uint32(bound(score, 0, 100)),
            uint32(bound(conflict, 0, 10_000)),
            uint32(bound(risk, 0, 10_000)),
            compliant
        ) {}
        catch {
            return;
        }
        vm.prank(exporters[s]);
        try controller.evaluateAndReleaseMilestone(ids[s], pre.next, seq) {} catch {}
        _post(s, pre);
    }

    function pause(uint256 s, bool byArbiter) external {
        s = bound(s, 0, N - 1);
        if (!created[s]) return;
        Snap memory pre = _pre(s);
        vm.prank(byArbiter ? arbiter : monitor);
        try controller.pauseFinancing(ids[s], keccak256("REASON")) {} catch {}
        _post(s, pre);
    }

    function resume(uint256 s, bool byMonitor) external {
        s = bound(s, 0, N - 1);
        if (!created[s]) return;
        Snap memory pre = _pre(s);
        vm.prank(byMonitor ? monitor : arbiter);
        try controller.resumeByVerifier(ids[s], keccak256("BASIS")) {} catch {}
        // the AI monitor must never be able to resume
        if (byMonitor && pre.status == IFinancingController.Status.PAUSED) {
            if (controller.getFacility(ids[s]).status != IFinancingController.Status.PAUSED) {
                violations++;
            }
        }
        _post(s, pre);
    }

    function openDispute(uint256 s, uint256 who) external {
        s = bound(s, 0, N - 1);
        if (!created[s]) return;
        Snap memory pre = _pre(s);
        address[3] memory callers = [exporters[s], financier, arbiter];
        vm.prank(callers[bound(who, 0, 2)]);
        try controller.openDispute(ids[s], keccak256("DISPUTE")) {} catch {}
        _post(s, pre);
    }

    function resolveDispute(uint256 s, bool resumeIt) external {
        s = bound(s, 0, N - 1);
        if (!created[s]) return;
        Snap memory pre = _pre(s);
        vm.prank(arbiter);
        try controller.resolveDispute(ids[s], resumeIt, keccak256("RESOLUTION")) {} catch {}
        _post(s, pre);
    }

    function markDelivered(uint256 s) external {
        s = bound(s, 0, N - 1);
        if (!created[s]) return;
        Snap memory pre = _pre(s);
        vm.prank(buyer);
        try controller.markDelivered(ids[s]) {} catch {}
        _post(s, pre);
    }

    function settle(uint256 s) external {
        s = bound(s, 0, N - 1);
        if (!created[s]) return;
        Snap memory pre = _pre(s);
        usdg.mint(buyer, INVOICE);
        vm.prank(buyer);
        try controller.settle(ids[s]) {} catch {}
        _post(s, pre);
    }

    function markDefaulted(uint256 s) external {
        s = bound(s, 0, N - 1);
        if (!created[s]) return;
        Snap memory pre = _pre(s);
        vm.prank(arbiter);
        try controller.markDefaulted(ids[s], keccak256("DEFAULT")) {} catch {}
        _post(s, pre);
    }

    /// Hostile callers attempting to move money through every entry point. None may succeed.
    function attack(uint256 s, uint256 who, uint256 amount) external {
        s = bound(s, 0, N - 1);
        if (!created[s]) return;
        address[4] memory attackers = [stranger, monitor, worker, arbiter];
        address a = attackers[bound(who, 0, 3)];
        bytes32 id = ids[s];

        vm.prank(a);
        try vault.release(id, bound(amount, 1, COMMITTED)) {
            violations++;
        } catch {}
        vm.prank(a);
        try vault.settle(id) {
            violations++;
        } catch {}
        vm.prank(a);
        try vault.closeDefaulted(id) {
            violations++;
        } catch {}
        vm.prank(a);
        try controller.evaluateAndReleaseMilestone(id, 0, 1) {
            violations++;
        } catch {}
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 0, 3 hours));
    }

    // ------------------------------------------------------------------ rule checks

    function _pre(uint256 s) internal view returns (Snap memory snap) {
        IFinancingController.FacilityState memory f = controller.getFacility(ids[s]);
        snap = Snap(f.status, vault.getFacility(ids[s]).drawn, f.nextMilestone);
    }

    function _post(uint256 s, Snap memory pre) internal {
        Snap memory post = _pre(s);
        IFinancingController.Status st = pre.status;

        // I1/I2: draws and the milestone cursor only move forward
        if (post.drawn < pre.drawn || post.next < pre.next) violations++;
        // I8: a draw must advance the cursor by exactly one milestone and pay exactly one tranche
        if (post.drawn > pre.drawn) {
            if (post.next != pre.next + 1 || post.drawn - pre.drawn != 8_000e6) violations++;
            tranchesReleased++;
        }
        if (post.status != pre.status) entered[uint8(post.status)]++;
        // I3/I4/I5: only an ACTIVE facility can draw (paused, disputed, delivered, settled, defaulted cannot)
        if (st != IFinancingController.Status.ACTIVE && post.drawn != pre.drawn) violations++;
        if (st != IFinancingController.Status.ACTIVE && post.next != pre.next) violations++;
        // terminal states are absorbing
        if (
            (st == IFinancingController.Status.SETTLED
                    || st == IFinancingController.Status.DEFAULTED) && post.status != st
        ) violations++;
    }
}
