// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {FinancingController} from "../src/FinancingController.sol";
import {EvidenceRegistry} from "../src/EvidenceRegistry.sol";
import {PolicyEngine} from "../src/PolicyEngine.sol";
import {ShipmentRegistry} from "../src/ShipmentRegistry.sol";
import {ReceivableVault} from "../src/ReceivableVault.sol";
import {CoverPool} from "../src/CoverPool.sol";
import {ICoverPool} from "../src/interfaces/ICoverPool.sol";
import {EBLRegistry} from "../src/EBLRegistry.sol";
import {IEBLRegistry} from "../src/interfaces/IEBLRegistry.sol";
import {IEvidenceRegistry} from "../src/interfaces/IEvidenceRegistry.sol";
import {IFinancingController} from "../src/interfaces/IFinancingController.sol";
import {IPolicyEngine} from "../src/interfaces/IPolicyEngine.sol";
import {MockUSDG} from "../src/mocks/MockUSDG.sol";
import {ScriptBase} from "./ScriptBase.sol";

/// @notice Runs the hero scenario (docs/project/18-demo-script.md) as real transactions against a
///         deployed CargoFlow v3:
///
///   CF-2026-SG01  fund -> M1 -> M2 -> thermal anomaly -> pause -> recovery -> M3
///                 -> M4 is place-based (Singapore, 25 km): evidence from the Malacca Strait waits,
///                    evidence from the Singapore approach releases
///                 -> M5 humidity breach (92% > 85%) -> pause -> inspection -> fresh evidence -> M5
///                 -> delivery -> settle
///   CF-2026-SG02  insurer offers 20,000 USDG cover, financier buys it (500 premium) -> fund -> M1, M2
///                 -> shock breach -> pause -> default -> claim: the financier recovers its 16,000 loss
///   CF-2026-SG03  (v3) electronic bill of lading: the carrier issues it to the exporter, the exporter
///                 binds it to the facility (escrowed in the controller) -> M1..M5 -> delivery -> the
///                 buyer pays and receives the title in the same transaction -> surrenders it
///   CF-2026-SG04  (v3) parametric cover (3 consecutive failed epochs, 2,000 salvage): M1, M2 -> three
///                 non-compliant epochs -> anyone triggers: financier 16,000, exporter 2,000, insurer
///                 2,000, without waiting for a default
///   CF-2026-SG05  (v3) a facility that never starts: covered, then cancelled by the exporter -> the
///                 cover is released back to the insurer
///
///   forge script script/RunHero.s.sol --rpc-url local --broadcast
///
/// Locally the roles use anvil accounts. On a public network set DEMO_EXPORTER_KEY, DEMO_FINANCIER_KEY,
/// DEMO_BUYER_KEY, DEMO_WORKER_KEY, DEMO_MONITOR_KEY, DEMO_ARBITER_KEY, DEMO_INSURER_KEY,
/// DEMO_CARRIER_KEY (the worker/monitor/arbiter/carrier keys must match the addresses granted at
/// deploy time) and pre-fund the financier (161,250 USDG), the buyer (200,000 USDG) and the insurer
/// (50,000 USDG). Deliberately
/// reverting transactions (the "blocked M3" and "M4 waits" moments) are not broadcast; the script
/// shows them with on-chain reads instead.
contract RunHero is ScriptBase {
    uint256 internal constant COMMITTED = 40_000e6;
    uint256 internal constant INVOICE = 100_000e6;
    uint256 internal constant TRANCHE = 8_000e6;
    uint16 internal constant FEE_BPS = 300;
    uint256 internal constant COVER = 20_000e6;
    uint16 internal constant PREMIUM_BPS = 250;
    uint256 internal constant PREMIUM = 500e6;
    uint256 internal constant SALVAGE = 2_000e6;
    uint256 internal constant SMALL_COVER = 10_000e6;
    uint256 internal constant SMALL_PREMIUM = 250e6;
    uint256 internal constant FINANCIER_FUNDS = 4 * COMMITTED + 2 * PREMIUM + SMALL_PREMIUM;
    uint256 internal constant BUYER_FUNDS = 2 * INVOICE;
    uint256 internal constant INSURER_FUNDS = 2 * COVER + SMALL_COVER;

    uint16 internal constant HUMIDITY = 6500;
    uint16 internal constant SHOCK = 30;
    int32 internal constant JNPT_LAT = 18_950_000;
    int32 internal constant JNPT_LON = 72_950_000;
    int32 internal constant SIN_LAT = 1_264_000; // Pasir Panjang terminal
    int32 internal constant SIN_LON = 103_840_000;
    uint32 internal constant SIN_RADIUS_M = 25_000;

    struct Keys {
        uint256 exporter;
        uint256 financier;
        uint256 buyer;
        uint256 worker;
        uint256 monitor;
        uint256 arbiter;
        uint256 insurer;
        uint256 carrier;
    }

    FinancingController internal controller;
    EvidenceRegistry internal evidence;
    ShipmentRegistry internal registry;
    PolicyEngine internal policies;
    ReceivableVault internal vault;
    CoverPool internal pool;
    EBLRegistry internal ebl;
    MockUSDG internal usdg;
    bytes32 internal id;

    function run() external {
        _load();
        Keys memory k = _keys();
        _ensureFunds(k);
        _settledShipment(k);
        _coveredDefault(k);
        _titleBoundShipment(k);
        _parametricPayout(k);
        _cancelledFacility(k);
    }

    // ------------------------------------------------------------------ CF-2026-SG01

    function _settledShipment(Keys memory k) internal {
        address exporter = vm.addr(k.exporter);
        address financier = vm.addr(k.financier);
        uint256 financierBefore = usdg.balanceOf(financier);
        uint256 exporterBefore = usdg.balanceOf(exporter);

        // Scene 1: shipment + policy + facility (M4 bound to Singapore)
        id = _openFacility(k, "CF-2026-SG01-", _milestonesWithSingaporeM4());

        // Scene 2: funding
        vm.startBroadcast(k.financier);
        usdg.approve(address(vault), COMMITTED);
        controller.depositCapital(id);
        vm.stopBroadcast();
        vm.broadcast(k.exporter);
        controller.startTransit(id);

        // Scene 3: M1 and M2 clear
        _commit(k.worker, 0, 1, 94, 500);
        _release(k.exporter, 0, 1);
        _commit(k.worker, 1, 1, 96, 300);
        _release(k.exporter, 1, 1);

        // Scene 4: thermal excursion (5.2 -> 11.7 C): score 48, conflict 0.78 -> monitor pauses
        _commit(k.worker, 2, 1, 48, 7800);
        vm.broadcast(k.monitor);
        controller.pauseFinancing(id, keccak256("THERMAL_EXCURSION"));

        // Scene 5: secondary probe (4.6 C) verified, score 89 -> resume, delayed M3 releases
        _commit(k.worker, 2, 2, 89, 400);
        vm.broadcast(k.arbiter);
        controller.resumeByVerifier(id, keccak256("secondary-core-probe-attestation"));
        _release(k.exporter, 2, 2);

        // Scene 6: M4 is place-based. Healthy evidence from the Malacca Strait (~300 km out) waits:
        // the release would revert OutsideMilestonePlace, the facility stays ACTIVE, nothing pauses.
        _commitT(k.worker, 3, 1, 95, 200, _tel(2_500_000, 101_500_000, HUMIDITY, SHOCK));
        (bool required, bool inside, uint256 distanceM) = controller.placeCheck(id, 3, 1);
        require(required && !inside && distanceM > SIN_RADIUS_M, "M4 should wait outside Singapore");
        require(
            controller.getFacility(id).status == IFinancingController.Status.ACTIVE, "not active"
        );
        // ...evidence from the Singapore approach (~6 km out) releases it
        _commitT(k.worker, 3, 2, 95, 200, _tel(1_300_000, 103_800_000, HUMIDITY, SHOCK));
        (, inside,) = controller.placeCheck(id, 3, 2);
        require(inside, "M4 evidence should be inside the place");
        _release(k.exporter, 3, 2);

        // Scene 7: humidity breach on M5 (92% against an 85% limit) -> monitor pauses HUMIDITY_LIMIT;
        // the reefer is inspected, the arbiter resumes, fresh in-limit evidence releases M5.
        _commitT(k.worker, 4, 1, 93, 200, _tel(SIN_LAT, SIN_LON, 9200, SHOCK));
        vm.broadcast(k.monitor);
        controller.pauseFinancing(id, keccak256("HUMIDITY_LIMIT"));
        _commitT(k.worker, 4, 2, 98, 100, _tel(SIN_LAT, SIN_LON, 7000, SHOCK));
        vm.broadcast(k.arbiter);
        controller.resumeByVerifier(id, keccak256("reefer-inspection-report"));
        _release(k.exporter, 4, 2);

        vm.broadcast(k.buyer);
        controller.markDelivered(id);

        // Scene 8: buyer pays 100,000 USDG
        vm.startBroadcast(k.buyer);
        usdg.approve(address(vault), INVOICE);
        controller.settle(id);
        vm.stopBroadcast();

        require(
            controller.getFacility(id).status == IFinancingController.Status.SETTLED, "not settled"
        );
        require(usdg.balanceOf(financier) == financierBefore + 1_200e6, "financier != +1,200 fee");
        require(usdg.balanceOf(exporter) == exporterBefore + 98_800e6, "exporter != 98,800");
    }

    // ------------------------------------------------------------------ CF-2026-SG02

    function _coveredDefault(Keys memory k) internal {
        address financier = vm.addr(k.financier);
        address insurer = vm.addr(k.insurer);
        uint256 financierBefore = usdg.balanceOf(financier);
        uint256 insurerBefore = usdg.balanceOf(insurer);

        id = _openFacility(k, "CF-2026-SG02-", _milestones());

        // the insurer escrows 20,000 USDG of default cover at 2.5%; the financier buys it
        vm.startBroadcast(k.insurer);
        usdg.approve(address(pool), COVER);
        pool.offerCover(id, COVER, PREMIUM_BPS);
        vm.stopBroadcast();
        vm.startBroadcast(k.financier);
        usdg.approve(address(pool), PREMIUM);
        pool.acceptCover(id, insurer);
        usdg.approve(address(vault), COMMITTED);
        controller.depositCapital(id);
        vm.stopBroadcast();
        vm.broadcast(k.exporter);
        controller.startTransit(id);

        _commit(k.worker, 0, 1, 94, 500);
        _release(k.exporter, 0, 1);
        _commit(k.worker, 1, 1, 95, 300);
        _release(k.exporter, 1, 1);

        // a 9 g drop against a 5 g limit: the cargo is condemned and the arbiter declares default
        _commitT(k.worker, 2, 1, 90, 300, _tel(JNPT_LAT, JNPT_LON, HUMIDITY, 900));
        vm.broadcast(k.monitor);
        controller.pauseFinancing(id, keccak256("SHOCK_LIMIT"));
        vm.broadcast(k.arbiter);
        controller.markDefaulted(id, keccak256("cargo-condemned-survey"));

        // anyone may trigger the claim; the financier is credited its 16,000 loss, the insurer 4,000
        vm.broadcast(k.exporter);
        pool.claim(id);
        ICoverPool.Cover memory c = pool.getCover(id);
        require(c.financierPayout == 2 * TRANCHE, "financier payout != 16,000");
        require(c.insurerReturn == COVER - 2 * TRANCHE, "insurer remainder != 4,000");
        vm.broadcast(k.financier);
        pool.withdraw();
        vm.broadcast(k.insurer);
        pool.withdraw();

        // financier: -40,000 deposit +24,000 undrawn refund +16,000 cover -500 premium = -500
        require(usdg.balanceOf(financier) + PREMIUM == financierBefore, "financier not made whole");
        // insurer: +500 premium -16,000 paid out
        require(usdg.balanceOf(insurer) + 2 * TRANCHE == insurerBefore + PREMIUM, "insurer balance");
        require(usdg.balanceOf(address(pool)) == 0, "pool not empty");
    }

    // ------------------------------------------------------------------ CF-2026-SG03 (v3)

    function _titleBoundShipment(Keys memory k) internal {
        address exporter = vm.addr(k.exporter);
        address buyer = vm.addr(k.buyer);
        address carrier = vm.addr(k.carrier);

        id = _openFacility(k, "CF-2026-SG03-", _milestones());
        bytes32 doc = keccak256(abi.encode("bill-of-lading", id));
        vm.broadcast(k.carrier);
        uint256 tokenId = ebl.issue(doc, exporter, buyer);
        vm.startBroadcast(k.exporter);
        ebl.approve(address(controller), tokenId);
        controller.bindTitle(id, tokenId);
        vm.stopBroadcast();
        require(ebl.ownerOf(tokenId) == address(controller), "title not escrowed");

        _fundAndStart(k);
        for (uint8 i; i < 5; ++i) {
            _commit(k.worker, i, 1, 95, 300);
            _release(k.exporter, i, 1);
        }
        vm.broadcast(k.buyer);
        controller.markDelivered(id);
        require(ebl.ownerOf(tokenId) == address(controller), "title left before payment");

        // documents against payment: the title moves to the buyer in the paying transaction
        vm.startBroadcast(k.buyer);
        usdg.approve(address(vault), INVOICE);
        controller.settle(id);
        vm.stopBroadcast();
        require(ebl.ownerOf(tokenId) == buyer, "buyer did not receive the title");

        // the buyer surrenders the bill to the carrier to take the goods
        vm.broadcast(k.buyer);
        ebl.surrender(tokenId);
        require(ebl.ownerOf(tokenId) == carrier, "bill not surrendered");
        require(
            ebl.getBill(tokenId).status == IEBLRegistry.TitleStatus.SURRENDERED, "not SURRENDERED"
        );
    }

    // ------------------------------------------------------------------ CF-2026-SG04 (v3)

    function _parametricPayout(Keys memory k) internal {
        address exporter = vm.addr(k.exporter);
        address financier = vm.addr(k.financier);
        address insurer = vm.addr(k.insurer);

        id = _openFacility(k, "CF-2026-SG04-", _milestones());
        vm.startBroadcast(k.insurer);
        usdg.approve(address(pool), COVER);
        pool.offerParametricCover(id, COVER, PREMIUM_BPS, 3, SALVAGE);
        vm.stopBroadcast();
        vm.startBroadcast(k.financier);
        usdg.approve(address(pool), PREMIUM);
        pool.acceptCover(id, insurer);
        vm.stopBroadcast();
        _fundAndStart(k);

        _commit(k.worker, 0, 1, 94, 500);
        _release(k.exporter, 0, 1);
        _commit(k.worker, 1, 1, 95, 300);
        _release(k.exporter, 1, 1);

        // the reefer fails: three consecutive non-compliant epochs, the monitor pauses
        bytes32[] memory failed = new bytes32[](3);
        for (uint32 s; s < 3; ++s) {
            failed[s] = evidence.epochIdFor(id, 2, s + 1);
            _commit(k.worker, 2, s + 1, 41, 6500);
        }
        vm.broadcast(k.monitor);
        controller.pauseFinancing(id, keccak256("THERMAL_EXCURSION"));

        // anyone proves the trigger from the stored epochs; nobody waits for a default
        uint256 exporterBefore = usdg.balanceOf(exporter);
        vm.broadcast(k.exporter);
        pool.triggerParametric(id, failed);
        ICoverPool.Cover memory c = pool.getCover(id);
        require(c.status == ICoverPool.CoverStatus.TRIGGERED, "not triggered");
        require(c.financierPayout == 2 * TRANCHE, "financier payout != 16,000");
        require(pool.getParametricCover(id).exporterSalvage == SALVAGE, "salvage != 2,000");
        require(c.insurerReturn == COVER - 2 * TRANCHE - SALVAGE, "insurer remainder != 2,000");
        vm.broadcast(k.financier);
        pool.withdraw();
        vm.broadcast(k.exporter);
        pool.withdraw();
        vm.broadcast(k.insurer);
        pool.withdraw();
        require(usdg.balanceOf(exporter) == exporterBefore + SALVAGE, "exporter salvage");

        // the arbiter closes the facility; the undrawn 24,000 returns to the financier
        uint256 financierBefore = usdg.balanceOf(financier);
        vm.broadcast(k.arbiter);
        controller.markDefaulted(id, keccak256("cargo-spoiled"));
        require(usdg.balanceOf(financier) == financierBefore + 3 * TRANCHE, "undrawn refund");
        require(usdg.balanceOf(address(pool)) == 0, "pool not empty");
    }

    // ------------------------------------------------------------------ CF-2026-SG05 (v3)

    function _cancelledFacility(Keys memory k) internal {
        address insurer = vm.addr(k.insurer);
        id = _openFacility(k, "CF-2026-SG05-", _milestones());
        vm.startBroadcast(k.insurer);
        usdg.approve(address(pool), SMALL_COVER);
        pool.offerCover(id, SMALL_COVER, PREMIUM_BPS);
        vm.stopBroadcast();
        vm.startBroadcast(k.financier);
        usdg.approve(address(pool), SMALL_PREMIUM);
        pool.acceptCover(id, insurer);
        vm.stopBroadcast();

        // the deal falls through before any deposit: the exporter cancels, the cover comes back
        vm.broadcast(k.exporter);
        controller.cancelFacility(id);
        require(
            controller.getFacility(id).status == IFinancingController.Status.CANCELLED,
            "not cancelled"
        );
        uint256 insurerBefore = usdg.balanceOf(insurer);
        vm.broadcast(k.exporter);
        pool.release(id);
        vm.broadcast(k.insurer);
        pool.withdraw();
        require(usdg.balanceOf(insurer) == insurerBefore + SMALL_COVER, "cover not returned");
    }

    function _fundAndStart(Keys memory k) internal {
        vm.startBroadcast(k.financier);
        usdg.approve(address(vault), COMMITTED);
        controller.depositCapital(id);
        vm.stopBroadcast();
        vm.broadcast(k.exporter);
        controller.startTransit(id);
    }

    // ------------------------------------------------------------------ helpers

    function _policy() internal pure returns (IPolicyEngine.Policy memory) {
        return IPolicyEngine.Policy({
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

    function _openFacility(
        Keys memory k,
        string memory refPrefix,
        IFinancingController.MilestoneSpec[] memory milestones
    ) internal returns (bytes32 shipmentId) {
        IPolicyEngine.Policy memory policy = _policy();
        bytes32 ref = keccak256(
            bytes(
                string.concat(
                    refPrefix, vm.envOr("SHIPMENT_REF_SUFFIX", vm.toString(block.timestamp))
                )
            )
        );
        bytes32 commitment = policies.hashPolicy(policy);
        vm.startBroadcast(k.exporter);
        shipmentId = registry.registerShipment(
            ref,
            vm.addr(k.buyer),
            keccak256(abi.encode("invoice", refPrefix)),
            keccak256("IN-SG-route"),
            commitment,
            INVOICE
        );
        policies.setPolicy(shipmentId, policy);
        controller.createFacility(shipmentId, vm.addr(k.financier), FEE_BPS, milestones);
        vm.stopBroadcast();
    }

    function _commit(
        uint256 workerKey,
        uint8 milestone,
        uint32 seq,
        uint32 score,
        uint32 conflictBps
    ) internal {
        _commitT(
            workerKey, milestone, seq, score, conflictBps, _tel(JNPT_LAT, JNPT_LON, HUMIDITY, SHOCK)
        );
    }

    function _commitT(
        uint256 workerKey,
        uint8 milestone,
        uint32 seq,
        uint32 score,
        uint32 conflictBps,
        IEvidenceRegistry.EpochTelemetry memory t
    ) internal {
        vm.broadcast(workerKey);
        evidence.commitEpoch(
            id,
            milestone,
            seq,
            keccak256(abi.encode("epoch-root", id, milestone, seq)),
            uint64(block.timestamp - 600),
            uint64(block.timestamp - 60),
            score,
            conflictBps,
            1200,
            score >= 75,
            t
        );
    }

    function _tel(int32 lat, int32 lon, uint16 humidity, uint16 shock)
        internal
        pure
        returns (IEvidenceRegistry.EpochTelemetry memory)
    {
        return IEvidenceRegistry.EpochTelemetry({
            latE6: lat, lonE6: lon, maxHumidityX100: humidity, maxShockX100: shock
        });
    }

    function _release(uint256 callerKey, uint8 milestone, uint32 seq) internal {
        vm.broadcast(callerKey);
        controller.evaluateAndReleaseMilestone(id, milestone, seq);
    }

    function _milestones() internal pure returns (IFinancingController.MilestoneSpec[] memory m) {
        m = new IFinancingController.MilestoneSpec[](5);
        for (uint8 i; i < 5; ++i) {
            m[i] = IFinancingController.MilestoneSpec({
                allocation: TRANCHE,
                evidenceThreshold: 75,
                checkpointCommitment: keccak256(abi.encode("checkpoint", i)),
                latE6: 0,
                lonE6: 0,
                radiusM: 0
            });
        }
    }

    function _milestonesWithSingaporeM4()
        internal
        pure
        returns (IFinancingController.MilestoneSpec[] memory m)
    {
        m = _milestones();
        m[3].latE6 = SIN_LAT;
        m[3].lonE6 = SIN_LON;
        m[3].radiusM = SIN_RADIUS_M;
    }

    function _ensureFunds(Keys memory k) internal {
        address financier = vm.addr(k.financier);
        address buyer = vm.addr(k.buyer);
        address insurer = vm.addr(k.insurer);
        if (_isLocal()) {
            // local MockUSDG is freely mintable
            vm.broadcast(k.financier);
            usdg.mint(financier, FINANCIER_FUNDS);
            vm.broadcast(k.buyer);
            usdg.mint(buyer, BUYER_FUNDS);
            vm.broadcast(k.insurer);
            usdg.mint(insurer, INSURER_FUNDS);
        }
        require(usdg.balanceOf(financier) >= FINANCIER_FUNDS, "financier needs 161,250 USDG");
        require(usdg.balanceOf(buyer) >= BUYER_FUNDS, "buyer needs 200,000 USDG");
        require(usdg.balanceOf(insurer) >= INSURER_FUNDS, "insurer needs 50,000 USDG");
    }

    function _load() internal {
        string memory json = vm.readFile(_manifestPath());
        controller =
            FinancingController(vm.parseJsonAddress(json, ".contracts.financingController"));
        evidence = EvidenceRegistry(vm.parseJsonAddress(json, ".contracts.evidenceRegistry"));
        registry = ShipmentRegistry(vm.parseJsonAddress(json, ".contracts.shipmentRegistry"));
        policies = PolicyEngine(vm.parseJsonAddress(json, ".contracts.policyEngine"));
        vault = ReceivableVault(vm.parseJsonAddress(json, ".contracts.receivableVault"));
        pool = CoverPool(vm.parseJsonAddress(json, ".contracts.coverPool"));
        ebl = EBLRegistry(vm.parseJsonAddress(json, ".contracts.eblRegistry"));
        usdg = MockUSDG(vm.parseJsonAddress(json, ".usdg"));
    }

    function _keys() internal view returns (Keys memory k) {
        k.exporter = _demoKey("DEMO_EXPORTER_KEY", ANVIL_KEY_1);
        k.financier = _demoKey("DEMO_FINANCIER_KEY", ANVIL_KEY_2);
        k.buyer = _demoKey("DEMO_BUYER_KEY", ANVIL_KEY_3);
        k.worker = _demoKey("DEMO_WORKER_KEY", ANVIL_KEY_4);
        k.monitor = _demoKey("DEMO_MONITOR_KEY", ANVIL_KEY_5);
        k.arbiter = _demoKey("DEMO_ARBITER_KEY", ANVIL_KEY_6);
        k.insurer = _demoKey("DEMO_INSURER_KEY", ANVIL_KEY_7);
        k.carrier = _demoKey("DEMO_CARRIER_KEY", ANVIL_KEY_8);
    }

    function _demoKey(string memory envName, string memory anvilKey)
        internal
        view
        returns (uint256)
    {
        string memory fromEnv = vm.envOr(envName, string(""));
        if (bytes(fromEnv).length != 0) return _parseKey(fromEnv);
        if (_isLocal()) return _parseKey(anvilKey);
        revert(string.concat("set ", envName));
    }
}
