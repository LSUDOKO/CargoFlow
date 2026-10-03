// SPDX-License-Identifier: MIT
pragma solidity 0.8.25;

import {CofheTest} from "@cofhe/foundry-plugin/contracts/CofheTest.sol";
import {CofheClient} from "@cofhe/foundry-plugin/contracts/CofheClient.sol";
import {ACP} from "@cofhe/mock-contracts/contracts/Permissioned.sol";
import {euint64, externalEuint64} from "@fhenixprotocol/cofhe-contracts/FHE.sol";
import {ConfidentialInvoiceTerms} from "../src/ConfidentialInvoiceTerms.sol";

contract ConfidentialInvoiceTermsTest is CofheTest {
    ConfidentialInvoiceTerms internal terms;
    CofheClient internal exporter;
    CofheClient internal financier;
    CofheClient internal buyer;
    CofheClient internal outsider;
    address internal reporter = makeAddr("reporter");
    // cached so an argument like `financier.account()` never consumes a pending vm.prank
    address internal exp;
    address internal fin;
    address internal buy;
    address internal out;

    bytes32 internal constant SHIPMENT = keccak256("CF-2026-SG01");
    uint64 internal constant MARGIN_BPS = 1_850; // 18.5%
    uint64 internal constant RATE = 250e6; // 250 USDG per excursion hour
    uint64 internal constant CAP = 5_000e6; // 5,000 USDG

    function setUp() public {
        deployMocks();
        exporter = _client(0xE1);
        financier = _client(0xF1);
        buyer = _client(0xB1);
        outsider = _client(0x0D);
        terms = new ConfidentialInvoiceTerms(reporter);
        (exp, fin, buy, out) =
            (exporter.account(), financier.account(), buyer.account(), outsider.account());
    }

    function _client(uint256 pk) internal returns (CofheClient c) {
        c = createCofheClient();
        c.connect(pk);
    }

    function _setTerms(uint64 margin, uint64 rate, uint64 cap) internal {
        (externalEuint64 m, bytes memory mp) =
            exporter.createExternalEuint64(margin, address(terms));
        (externalEuint64 r, bytes memory rp) = exporter.createExternalEuint64(rate, address(terms));
        (externalEuint64 c, bytes memory cp) = exporter.createExternalEuint64(cap, address(terms));
        vm.prank(exp);
        terms.setTerms(SHIPMENT, fin, buy, m, mp, r, rp, c, cp);
    }

    function _allowed(euint64 v, address who) internal view returns (bool) {
        return mockTaskManager.isAllowed(uint256(euint64.unwrap(v)), who);
    }

    // ----------------------------------------------------------- setTerms

    function test_setTerms_storesCiphertextsAndCommitment() public {
        _setTerms(MARGIN_BPS, RATE, CAP);

        (euint64 margin, euint64 rate, euint64 cap, euint64 penalty) = terms.handles(SHIPMENT);
        expectPlaintext(margin, MARGIN_BPS);
        expectPlaintext(rate, RATE);
        expectPlaintext(cap, CAP);
        assertEq(euint64.unwrap(penalty), bytes32(0), "no penalty before computation");

        (address e, address f, address b) = terms.parties(SHIPMENT);
        assertEq(e, exp);
        assertEq(f, fin);
        assertEq(b, buy);

        bytes32 expected = keccak256(
            abi.encode(
                block.chainid,
                address(terms),
                SHIPMENT,
                e,
                f,
                b,
                euint64.unwrap(margin),
                euint64.unwrap(rate),
                euint64.unwrap(cap)
            )
        );
        assertEq(terms.termsCommitment(SHIPMENT), expected);
    }

    function test_setTerms_emitsEvent() public {
        (externalEuint64 m, bytes memory mp) = exporter.createExternalEuint64(1, address(terms));
        (externalEuint64 r, bytes memory rp) = exporter.createExternalEuint64(2, address(terms));
        (externalEuint64 c, bytes memory cp) = exporter.createExternalEuint64(3, address(terms));
        vm.expectEmit(true, true, true, false, address(terms));
        emit ConfidentialInvoiceTerms.TermsSet(SHIPMENT, exp, fin, buy, bytes32(0));
        vm.prank(exp);
        terms.setTerms(SHIPMENT, fin, buy, m, mp, r, rp, c, cp);
    }

    function test_acl_marginHiddenFromBuyer_scheduleSharedWithAllThree() public {
        _setTerms(MARGIN_BPS, RATE, CAP);
        (euint64 margin, euint64 rate, euint64 cap,) = terms.handles(SHIPMENT);

        assertTrue(_allowed(margin, exp));
        assertTrue(_allowed(margin, fin));
        assertFalse(_allowed(margin, buy), "buyer must not see the margin");
        assertFalse(_allowed(margin, out));

        address[3] memory three = [exp, fin, buy];
        for (uint256 i; i < 3; ++i) {
            assertTrue(_allowed(rate, three[i]));
            assertTrue(_allowed(cap, three[i]));
        }
        assertFalse(_allowed(rate, out));
        assertFalse(_allowed(cap, out));
        assertFalse(_allowed(rate, reporter), "the reporter never decrypts");
    }

    function test_buyerDecryptsScheduleWithAcp() public {
        _setTerms(MARGIN_BPS, RATE, CAP);
        (, euint64 rate,,) = terms.handles(SHIPMENT);
        ACP memory acp = buyer.ACP_createSelf();
        assertEq(buyer.decryptForView(euint64.unwrap(rate), acp), RATE);
    }

    function test_outsiderCannotDecrypt() public {
        _setTerms(MARGIN_BPS, RATE, CAP);
        (, euint64 rate,,) = terms.handles(SHIPMENT);
        ACP memory acp = outsider.ACP_createSelf();
        (bool allowed,,) =
            mockThresholdNetwork.querySealOutput(uint256(euint64.unwrap(rate)), block.chainid, acp);
        assertFalse(allowed);
    }

    function test_setTerms_onlyOnce() public {
        _setTerms(MARGIN_BPS, RATE, CAP);
        (externalEuint64 m, bytes memory mp) = exporter.createExternalEuint64(1, address(terms));
        (externalEuint64 r, bytes memory rp) = exporter.createExternalEuint64(1, address(terms));
        (externalEuint64 c, bytes memory cp) = exporter.createExternalEuint64(1, address(terms));
        vm.prank(exp);
        vm.expectRevert(ConfidentialInvoiceTerms.TermsAlreadySet.selector);
        terms.setTerms(SHIPMENT, fin, buy, m, mp, r, rp, c, cp);
    }

    function test_setTerms_rejectsBadParties() public {
        (externalEuint64 m, bytes memory mp) = exporter.createExternalEuint64(1, address(terms));
        (externalEuint64 r, bytes memory rp) = exporter.createExternalEuint64(1, address(terms));
        (externalEuint64 c, bytes memory cp) = exporter.createExternalEuint64(1, address(terms));
        vm.startPrank(exp);
        vm.expectRevert(ConfidentialInvoiceTerms.ZeroAddress.selector);
        terms.setTerms(SHIPMENT, address(0), buy, m, mp, r, rp, c, cp);
        vm.expectRevert(ConfidentialInvoiceTerms.DuplicateParty.selector);
        terms.setTerms(SHIPMENT, exp, buy, m, mp, r, rp, c, cp);
        vm.expectRevert(ConfidentialInvoiceTerms.DuplicateParty.selector);
        terms.setTerms(SHIPMENT, buy, buy, m, mp, r, rp, c, cp);
        vm.stopPrank();
    }

    function test_setTerms_rejectsInputEncryptedForAnotherSender() public {
        // the input was signed for the exporter; the outsider cannot replay it
        (externalEuint64 m, bytes memory mp) = exporter.createExternalEuint64(1, address(terms));
        (externalEuint64 r, bytes memory rp) = exporter.createExternalEuint64(1, address(terms));
        (externalEuint64 c, bytes memory cp) = exporter.createExternalEuint64(1, address(terms));
        vm.prank(out);
        vm.expectRevert();
        terms.setTerms(SHIPMENT, fin, buy, m, mp, r, rp, c, cp);
    }

    // ----------------------------------------------------- computePenalty

    function test_computePenalty_belowCap() public {
        _setTerms(MARGIN_BPS, RATE, CAP);
        vm.prank(fin);
        euint64 p = terms.computePenalty(SHIPMENT, 3);
        expectPlaintext(p, 750e6);
        (,,, euint64 stored) = terms.handles(SHIPMENT);
        assertEq(euint64.unwrap(stored), euint64.unwrap(p));
        (, uint64 computedAt, uint32 hrs,,) = terms.status(SHIPMENT);
        assertEq(hrs, 3);
        assertEq(computedAt, block.timestamp);
    }

    function test_computePenalty_capped() public {
        _setTerms(MARGIN_BPS, RATE, CAP);
        vm.prank(reporter);
        euint64 p = terms.computePenalty(SHIPMENT, 48); // 12,000 USDG uncapped
        expectPlaintext(p, CAP);
    }

    function test_computePenalty_zeroHours() public {
        _setTerms(MARGIN_BPS, RATE, CAP);
        vm.prank(buy);
        expectPlaintext(terms.computePenalty(SHIPMENT, 0), uint64(0));
    }

    function test_computePenalty_noWrapAtExtremes() public {
        // a rate near 2^64 times the maximum hours would wrap in 64-bit arithmetic
        _setTerms(0, type(uint64).max, type(uint64).max - 1);
        vm.prank(exp);
        expectPlaintext(terms.computePenalty(SHIPMENT, 8760), type(uint64).max - 1);
    }

    function test_computePenalty_readableByThreeParties() public {
        _setTerms(MARGIN_BPS, RATE, CAP);
        vm.prank(exp);
        euint64 p = terms.computePenalty(SHIPMENT, 5);
        assertTrue(_allowed(p, exp));
        assertTrue(_allowed(p, fin));
        assertTrue(_allowed(p, buy));
        assertFalse(_allowed(p, out));
        assertFalse(_allowed(p, reporter));
        ACP memory acp = financier.ACP_createSelf();
        assertEq(financier.decryptForView(euint64.unwrap(p), acp), 1_250e6);
    }

    function test_computePenalty_recomputeOverwrites() public {
        _setTerms(MARGIN_BPS, RATE, CAP);
        vm.startPrank(exp);
        terms.computePenalty(SHIPMENT, 1);
        euint64 p = terms.computePenalty(SHIPMENT, 2);
        vm.stopPrank();
        (,,, euint64 stored) = terms.handles(SHIPMENT);
        expectPlaintext(stored, 500e6);
        assertEq(euint64.unwrap(stored), euint64.unwrap(p));
    }

    function test_computePenalty_emitsEvent() public {
        _setTerms(MARGIN_BPS, RATE, CAP);
        vm.expectEmit(true, true, false, false, address(terms));
        emit ConfidentialInvoiceTerms.PenaltyComputed(SHIPMENT, buy, 4, bytes32(0));
        vm.prank(buy);
        terms.computePenalty(SHIPMENT, 4);
    }

    function test_computePenalty_access() public {
        vm.expectRevert(ConfidentialInvoiceTerms.TermsNotSet.selector);
        terms.computePenalty(SHIPMENT, 1);

        _setTerms(MARGIN_BPS, RATE, CAP);
        vm.prank(out);
        vm.expectRevert(ConfidentialInvoiceTerms.NotAuthorized.selector);
        terms.computePenalty(SHIPMENT, 1);

        vm.prank(exp);
        vm.expectRevert(ConfidentialInvoiceTerms.ExcursionHoursTooHigh.selector);
        terms.computePenalty(SHIPMENT, 8761);
    }

    function test_reporterDisabledWhenZero() public {
        ConfidentialInvoiceTerms noReporter = new ConfidentialInvoiceTerms(address(0));
        (externalEuint64 m, bytes memory mp) =
            exporter.createExternalEuint64(1, address(noReporter));
        (externalEuint64 r, bytes memory rp) =
            exporter.createExternalEuint64(1, address(noReporter));
        (externalEuint64 c, bytes memory cp) =
            exporter.createExternalEuint64(1, address(noReporter));
        vm.prank(exp);
        noReporter.setTerms(SHIPMENT, fin, buy, m, mp, r, rp, c, cp);
        vm.prank(address(0));
        vm.expectRevert(ConfidentialInvoiceTerms.NotAuthorized.selector);
        noReporter.computePenalty(SHIPMENT, 1);
    }

    // -------------------------------------------------------- acknowledge

    function test_acknowledge() public {
        vm.expectRevert(ConfidentialInvoiceTerms.TermsNotSet.selector);
        terms.acknowledge(SHIPMENT);

        _setTerms(MARGIN_BPS, RATE, CAP);
        vm.prank(fin);
        terms.acknowledge(SHIPMENT);
        vm.prank(buy);
        terms.acknowledge(SHIPMENT);
        (,,, bool f, bool b) = terms.status(SHIPMENT);
        assertTrue(f && b);

        vm.prank(out);
        vm.expectRevert(ConfidentialInvoiceTerms.NotParty.selector);
        terms.acknowledge(SHIPMENT);
    }

    // --------------------------------------------------------------- fuzz

    function testFuzz_penaltyIsMinOfProductAndCap(uint64 rate, uint64 cap, uint32 hrs) public {
        hrs = uint32(bound(hrs, 0, 8760));
        _setTerms(0, rate, cap);
        vm.prank(exp);
        euint64 p = terms.computePenalty(SHIPMENT, hrs);
        uint256 raw = uint256(rate) * hrs;
        expectPlaintext(p, uint64(raw < cap ? raw : cap));
    }
}
