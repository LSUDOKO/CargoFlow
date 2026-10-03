// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Test} from "forge-std/Test.sol";
import {CoverPool} from "../../src/CoverPool.sol";
import {ShipmentRegistry} from "../../src/ShipmentRegistry.sol";
import {PolicyEngine} from "../../src/PolicyEngine.sol";
import {EvidenceRegistry} from "../../src/EvidenceRegistry.sol";
import {FinancingController} from "../../src/FinancingController.sol";
import {IEvidenceRegistry} from "../../src/interfaces/IEvidenceRegistry.sol";
import {IFinancingController} from "../../src/interfaces/IFinancingController.sol";
import {IPolicyEngine} from "../../src/interfaces/IPolicyEngine.sol";
import {MockUSDG} from "../../src/mocks/MockUSDG.sol";

/// @notice Drives several covered facilities through random offer / withdraw / accept sequences and
///         random lifecycles that end in settlement or default, with release, claim and withdraw
///         called by anyone at any time. Never reverts itself; ghost state feeds the invariants.
contract CoverPoolHandler is Test {
    uint256 public constant N = 3;
    uint256 public constant INSURERS = 3;
    uint256 internal constant COMMITTED = 40_000e6;
    uint256 internal constant INVOICE = 100_000e6;

    CoverPool internal pool;
    ShipmentRegistry internal registry;
    PolicyEngine internal policies;
    EvidenceRegistry internal evidence;
    FinancingController internal controller;
    MockUSDG internal usdg;

    address internal worker;
    address internal monitor;
    address internal arbiter;
    address public financier;
    address internal buyer;
    address public stranger;

    IPolicyEngine.Policy internal policy;

    bytes32[3] public ids;
    bool[3] public created;
    address[3] internal exporters;
    uint32[3] internal seqs;
    address[3] public insurers;

    /// How many times a cover paid out (release or claim succeeded). Must never exceed 1.
    uint256[3] public payouts;
    /// Incremented when a hostile call succeeds or a withdrawal pays the wrong amount. Must stay 0.
    uint256 public violations;
    /// Reachability evidence for the run summary.
    uint256 public offersMade;
    uint256 public offersWithdrawn;
    uint256 public coversAccepted;
    uint256 public coversReleased;
    uint256 public coversClaimed;
    uint256 public withdrawals;

    constructor(
        address[6] memory core, // pool, registry, policies, evidence, controller, usdg
        address[6] memory actors // worker, monitor, arbiter, financier, buyer, stranger
    ) {
        pool = CoverPool(core[0]);
        registry = ShipmentRegistry(core[1]);
        policies = PolicyEngine(core[2]);
        evidence = EvidenceRegistry(core[3]);
        controller = FinancingController(core[4]);
        usdg = MockUSDG(core[5]);
        (worker, monitor, arbiter, financier, buyer, stranger) =
            (actors[0], actors[1], actors[2], actors[3], actors[4], actors[5]);
        for (uint256 i; i < INSURERS; ++i) {
            // forge-lint: disable-next-line(unsafe-typecast)
            insurers[i] = address(uint160(0xC0FE0 + i)); // small constant + i < 3
            vm.prank(insurers[i]);
            usdg.approve(address(pool), type(uint256).max);
        }
        vm.startPrank(financier);
        usdg.approve(address(pool), type(uint256).max);
        usdg.approve(address(controller.VAULT()), type(uint256).max);
        vm.stopPrank();
        vm.prank(buyer);
        usdg.approve(address(controller.VAULT()), type(uint256).max);

        policy = IPolicyEngine.Policy({
            minTempX100: 200,
            maxTempX100: 800,
            maxEvidenceAgeSec: 1800,
            maxRouteDeviationM: 25_000,
            minEvidenceScore: 75,
            maxConflictBps: 3000,
            maxRiskBps: 3500,
            requiresZK: false,
            maxHumidityX100: 8500,
            maxShockX100: 500
        });
    }

    // ------------------------------------------------------------------ facility lifecycle

    function create(uint256 s) external {
        _create(bound(s, 0, N - 1));
    }

    function _create(uint256 s) internal {
        if (created[s]) return;
        // forge-lint: disable-next-line(unsafe-typecast)
        address ex = address(uint160(0xE000 + s)); // s < N
        bytes32 commitment = policies.hashPolicy(policy);
        vm.prank(ex);
        bytes32 id = registry.registerShipment(
            keccak256(abi.encode("cover-ref", s)),
            buyer,
            keccak256("invoice"),
            keccak256("route"),
            commitment,
            INVOICE
        );
        vm.prank(ex);
        policies.setPolicy(id, policy);
        IFinancingController.MilestoneSpec[] memory m = new IFinancingController.MilestoneSpec[](5);
        for (uint256 i; i < 5; ++i) {
            m[i] = IFinancingController.MilestoneSpec({
                allocation: 8_000e6,
                evidenceThreshold: 75,
                checkpointCommitment: keccak256(abi.encode(i)),
                latE6: 0,
                lonE6: 0,
                radiusM: 0
            });
        }
        vm.prank(ex);
        controller.createFacility(id, financier, 300, m);
        ids[s] = id;
        created[s] = true;
        exporters[s] = ex;
    }

    /// Guided walker: FINANCED -> ACTIVE -> milestones -> DELIVERED -> SETTLED, or a default.
    function progress(uint256 s, uint256 seed) external {
        s = bound(s, 0, N - 1);
        if (!created[s]) return;
        bytes32 id = ids[s];
        IFinancingController.FacilityState memory f = controller.getFacility(id);
        // linger before transit so offers and acceptances get a chance to land
        if (f.status == IFinancingController.Status.CREATED) {
            if (seed % 3 != 0) return;
            usdg.mint(financier, COMMITTED);
            vm.prank(financier);
            try controller.depositCapital(id) {} catch {}
        } else if (f.status == IFinancingController.Status.FINANCED) {
            if (seed % 3 != 0) return;
            vm.prank(exporters[s]);
            try controller.startTransit(id) {} catch {}
        } else if (f.status == IFinancingController.Status.ACTIVE) {
            if (seed % 13 == 0) return _default(s);
            if (f.nextMilestone < f.milestoneCount) {
                _releaseNext(s, f.nextMilestone);
            } else {
                vm.prank(buyer);
                try controller.markDelivered(id) {} catch {}
            }
        } else if (f.status == IFinancingController.Status.DELIVERED) {
            if (seed % 4 == 0) return _default(s); // non-payment
            usdg.mint(buyer, INVOICE);
            vm.prank(buyer);
            try controller.settle(id) {} catch {}
        } else if (f.status == IFinancingController.Status.PAUSED) {
            _default(s);
        }
    }

    function _releaseNext(uint256 s, uint8 milestone) internal {
        uint32 seq = ++seqs[s];
        vm.prank(worker);
        try evidence.commitEpoch(
            ids[s],
            milestone,
            seq,
            keccak256(abi.encode(ids[s], seq)),
            uint64(block.timestamp - 600),
            uint64(block.timestamp - 60),
            95,
            300,
            1200,
            true,
            IEvidenceRegistry.EpochTelemetry({
                latE6: 18_950_000, lonE6: 72_950_000, maxHumidityX100: 6500, maxShockX100: 30
            })
        ) {}
        catch {
            return;
        }
        vm.prank(exporters[s]);
        try controller.evaluateAndReleaseMilestone(ids[s], milestone, seq) {} catch {}
    }

    function _default(uint256 s) internal {
        bytes32 id = ids[s];
        if (controller.getFacility(id).status == IFinancingController.Status.ACTIVE) {
            vm.prank(monitor);
            try controller.pauseFinancing(id, keccak256("SHOCK_LIMIT")) {} catch {}
        }
        vm.prank(arbiter);
        try controller.markDefaulted(id, keccak256("DEFAULT")) {} catch {}
    }

    // ------------------------------------------------------------------ cover actions

    function offer(uint256 s, uint256 who, uint256 amount, uint256 bps) external {
        s = bound(s, 0, N - 1);
        _create(s);
        address ins = insurers[bound(who, 0, INSURERS - 1)];
        amount = bound(amount, 0, COMMITTED + 1); // sometimes invalid on purpose
        usdg.mint(ins, amount);
        vm.prank(ins);
        try pool.offerCover(ids[s], amount, uint16(bound(bps, 0, 2_100))) {
            offersMade++;
        } catch {}
    }

    function withdrawOffer(uint256 s, uint256 who) external {
        s = bound(s, 0, N - 1);
        address ins = insurers[bound(who, 0, INSURERS - 1)];
        vm.prank(ins);
        try pool.withdrawOffer(ids[s]) {
            offersWithdrawn++;
        } catch {}
    }

    function accept(uint256 s, uint256 who) external {
        s = bound(s, 0, N - 1);
        if (!created[s]) return;
        // prefer an insurer that actually has an open offer, starting from a random one
        who = bound(who, 0, INSURERS - 1);
        address ins = insurers[who];
        for (uint256 i; i < INSURERS; ++i) {
            address cand = insurers[(who + i) % INSURERS];
            if (pool.getOffer(ids[s], cand).amount != 0) {
                ins = cand;
                break;
            }
        }
        usdg.mint(financier, 8_000e6); // enough for the largest possible premium
        vm.prank(financier);
        try pool.acceptCover(ids[s], ins) {
            coversAccepted++;
        } catch {}
    }

    function release(uint256 s) external {
        s = bound(s, 0, N - 1);
        vm.prank(stranger);
        try pool.release(ids[s]) {
            payouts[s]++;
            coversReleased++;
        } catch {}
    }

    function claim(uint256 s) external {
        s = bound(s, 0, N - 1);
        vm.prank(stranger);
        try pool.claim(ids[s]) {
            payouts[s]++;
            coversClaimed++;
        } catch {}
    }

    function withdraw(uint256 who) external {
        who = bound(who, 0, INSURERS + 1);
        address a = who < INSURERS ? insurers[who] : (who == INSURERS ? financier : stranger);
        uint256 credited = pool.claimable(a);
        uint256 before = usdg.balanceOf(a);
        vm.prank(a);
        try pool.withdraw() {
            withdrawals++;
            // a withdrawal pays exactly what was credited
            if (usdg.balanceOf(a) - before != credited) violations++;
        } catch {}
    }

    /// Hostile callers: accepting someone else's facility, or withdrawing someone else's offer.
    function attack(uint256 s, uint256 who) external {
        s = bound(s, 0, N - 1);
        if (!created[s]) return;
        address ins = insurers[bound(who, 0, INSURERS - 1)];
        uint256 offered = pool.getOffer(ids[s], ins).amount;
        vm.prank(stranger);
        try pool.acceptCover(ids[s], ins) {
            violations++; // a non-financier accepted cover
        } catch {}
        vm.prank(stranger);
        try pool.withdrawOffer(ids[s]) {} catch {}
        if (pool.getOffer(ids[s], ins).amount != offered) violations++;
    }

    function warp(uint256 secs) external {
        vm.warp(block.timestamp + bound(secs, 0, 1 hours));
    }
}
