// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {IFinancingController} from "../../src/interfaces/IFinancingController.sol";
import {GeoDistance} from "../../src/libraries/GeoDistance.sol";
import {ControllerBase} from "./ControllerBase.sol";

/// @notice Place-based milestones: a milestone with a radius releases only on evidence whose centroid
///         lies inside it. Outside evidence is neither a failure nor a pause; the milestone waits.
contract FinancingControllerPlaceTest is ControllerBase {
    // Singapore, Pasir Panjang terminal
    int32 internal constant SIN_LAT = 1_264_000;
    int32 internal constant SIN_LON = 103_840_000;
    uint32 internal constant RADIUS = 25_000;

    uint256[2] internal a;
    uint256[2][2] internal b;
    uint256[2] internal c;

    /// The hero schedule with M3 (index 2) bound to a 25 km circle around Singapore.
    function _placedMilestones()
        internal
        pure
        returns (IFinancingController.MilestoneSpec[] memory m)
    {
        m = _milestones();
        m[2].latE6 = SIN_LAT;
        m[2].lonE6 = SIN_LON;
        m[2].radiusM = RADIUS;
    }

    function _activateWith(IFinancingController.MilestoneSpec[] memory m) internal {
        _createFacilityWith(m);
        vm.prank(financier);
        controller.depositCapital(id);
        vm.prank(exporter);
        controller.startTransit(id);
    }

    function _releaseFirstTwo() internal {
        for (uint8 i; i < 2; ++i) {
            _commitEvidence(i, 1, 95, 300);
            vm.prank(exporter);
            controller.evaluateAndReleaseMilestone(id, i, 1);
        }
    }

    function _release(uint8 milestone, uint32 seq) internal {
        vm.prank(exporter);
        controller.evaluateAndReleaseMilestone(id, milestone, seq);
    }

    function _commitAt(uint8 milestone, uint32 seq, int32 lat, int32 lon)
        internal
        returns (bytes32)
    {
        return _commitTelemetry(milestone, seq, 92, 300, lat, lon, HUMIDITY, SHOCK);
    }

    // ---- creation --------------------------------------------------------------------------------

    function test_placeIsStoredWithTheMilestone() public {
        _createFacilityWith(_placedMilestones());
        IFinancingController.MilestoneSpec memory m = controller.getMilestone(id, 2);
        assertEq(m.latE6, SIN_LAT);
        assertEq(m.lonE6, SIN_LON);
        assertEq(m.radiusM, RADIUS);
        assertEq(controller.getMilestone(id, 0).radiusM, 0, "other milestones keep no place");
    }

    function test_radiusMustBeBetweenOneAndAThousandKilometres() public {
        _registerAndSetPolicy();
        uint32[4] memory bad = [uint32(1), 999, 1_000_001, type(uint32).max];
        for (uint256 i; i < bad.length; ++i) {
            IFinancingController.MilestoneSpec[] memory m = _placedMilestones();
            m[2].radiusM = bad[i];
            vm.prank(exporter);
            vm.expectRevert(IFinancingController.InvalidMilestonePlace.selector);
            controller.createFacility(id, financier, FEE_BPS, m);
        }
    }

    function test_radiusBoundsAreInclusive() public {
        IFinancingController.MilestoneSpec[] memory m = _placedMilestones();
        m[1].latE6 = SIN_LAT;
        m[1].lonE6 = SIN_LON;
        m[1].radiusM = 1000;
        m[2].radiusM = 1_000_000;
        _createFacilityWith(m);
        assertEq(controller.getMilestone(id, 1).radiusM, 1000);
        assertEq(controller.getMilestone(id, 2).radiusM, 1_000_000);
    }

    function test_coordinatesAreRangeChecked() public {
        _registerAndSetPolicy();
        int32[2][4] memory bad = [
            [int32(90_000_001), SIN_LON],
            [int32(-90_000_001), SIN_LON],
            [SIN_LAT, int32(180_000_001)],
            [SIN_LAT, int32(-180_000_001)]
        ];
        for (uint256 i; i < bad.length; ++i) {
            IFinancingController.MilestoneSpec[] memory m = _placedMilestones();
            m[2].latE6 = bad[i][0];
            m[2].lonE6 = bad[i][1];
            vm.prank(exporter);
            vm.expectRevert(IFinancingController.InvalidMilestonePlace.selector);
            controller.createFacility(id, financier, FEE_BPS, m);
        }
        // a place-less milestone must not carry out-of-range coordinates either
        IFinancingController.MilestoneSpec[] memory n = _milestones();
        n[0].latE6 = 90_000_001;
        vm.prank(exporter);
        vm.expectRevert(IFinancingController.InvalidMilestonePlace.selector);
        controller.createFacility(id, financier, FEE_BPS, n);
    }

    // ---- release ---------------------------------------------------------------------------------

    function test_evidenceOutsideThePlaceWaitsWithoutPausing() public {
        _activateWith(_placedMilestones());
        _releaseFirstTwo();

        // healthy evidence, but the cargo is still at Mumbai
        _commitAt(2, 1, JNPT_LAT, JNPT_LON);
        vm.prank(exporter);
        vm.expectRevert(IFinancingController.OutsideMilestonePlace.selector);
        controller.evaluateAndReleaseMilestone(id, 2, 1);

        assertEq(
            uint8(controller.getFacility(id).status), uint8(IFinancingController.Status.ACTIVE)
        );
        assertEq(controller.getFacility(id).nextMilestone, 2);
        assertEq(usdg.balanceOf(exporter), 16_000e6);

        // later evidence from the Singapore approach (about 6 km out) releases the tranche
        vm.warp(block.timestamp + 3 days);
        _commitAt(2, 2, 1_300_000, 103_800_000);
        _release(2, 2);
        assertEq(usdg.balanceOf(exporter), 24_000e6);
        assertEq(controller.getFacility(id).nextMilestone, 3);
    }

    function test_centroidExactlyOnTheRadiusReleases() public {
        IFinancingController.MilestoneSpec[] memory m = _placedMilestones();
        int32 lat = 1_480_000;
        uint256 d = GeoDistance.distanceM(lat, SIN_LON, SIN_LAT, SIN_LON);
        // forge-lint: disable-next-line(unsafe-typecast)
        m[2].radiusM = uint32(d); // ~24 km, inside the allowed range
        _activateWith(m);
        _releaseFirstTwo();
        _commitAt(2, 1, lat, SIN_LON);
        _release(2, 1);
        assertEq(controller.getFacility(id).nextMilestone, 3);
    }

    function test_centroidOneMetreBeyondTheRadiusWaits() public {
        IFinancingController.MilestoneSpec[] memory m = _placedMilestones();
        int32 lat = 1_480_000;
        uint256 d = GeoDistance.distanceM(lat, SIN_LON, SIN_LAT, SIN_LON);
        // forge-lint: disable-next-line(unsafe-typecast)
        m[2].radiusM = uint32(d - 1);
        _activateWith(m);
        _releaseFirstTwo();
        _commitAt(2, 1, lat, SIN_LON);
        vm.prank(exporter);
        vm.expectRevert(IFinancingController.OutsideMilestonePlace.selector);
        controller.evaluateAndReleaseMilestone(id, 2, 1);
    }

    function test_placeAcrossTheAntimeridian() public {
        IFinancingController.MilestoneSpec[] memory m = _milestones();
        m[0].latE6 = -17_000_000; // near Fiji, just west of 180
        m[0].lonE6 = 179_990_000;
        m[0].radiusM = 5_000;
        _activateWith(m);
        _commitAt(0, 1, -17_000_000, -179_990_000); // ~2.1 km east, across the line
        _release(0, 1);
        assertEq(usdg.balanceOf(exporter), TRANCHE);
    }

    function test_policyFailureTakesPrecedenceOverPlace() public {
        _activateWith(_placedMilestones());
        _releaseFirstTwo();
        // weak evidence that is also outside the place: the policy failure is what is reported
        _commitTelemetry(2, 1, 48, 7800, JNPT_LAT, JNPT_LON, HUMIDITY, SHOCK);
        vm.prank(exporter);
        vm.expectRevert(IFinancingController.EvidenceBelowThreshold.selector);
        controller.evaluateAndReleaseMilestone(id, 2, 1);
    }

    function test_placeLessMilestoneIgnoresTheCentroid() public {
        _activate();
        _commitAt(0, 1, -45_000_000, -120_000_000); // the far side of the world
        _release(0, 1);
        assertEq(usdg.balanceOf(exporter), TRANCHE);
    }

    function test_placeCheckView() public {
        _activateWith(_placedMilestones());
        _releaseFirstTwo();
        _commitAt(2, 1, JNPT_LAT, JNPT_LON);
        _commitAt(2, 2, 1_300_000, 103_800_000);

        (bool required, bool inside, uint256 d) = controller.placeCheck(id, 2, 1);
        assertTrue(required);
        assertFalse(inside);
        assertEq(d, GeoDistance.distanceM(JNPT_LAT, JNPT_LON, SIN_LAT, SIN_LON));

        (required, inside, d) = controller.placeCheck(id, 2, 2);
        assertTrue(required);
        assertTrue(inside);
        assertLt(d, RADIUS);

        (required, inside, d) = controller.placeCheck(id, 0, 1);
        assertFalse(required);
        assertTrue(inside);
        assertEq(d, 0);
    }

    // ---- zero-knowledge recovery -----------------------------------------------------------------

    function _pausedAtPlacedMilestone() internal {
        _activateWith(_placedMilestones());
        _releaseFirstTwo();
        _commitEvidence(2, 1, 48, 7800);
        vm.prank(monitor);
        controller.pauseFinancing(id, THERMAL);
        vm.warp(block.timestamp + 10);
    }

    function test_proofRecoveryRequiresTheRecoveryEpochAtThePlace() public {
        _pausedAtPlacedMilestone();
        _commitAt(2, 2, JNPT_LAT, JNPT_LON);
        vm.prank(exporter);
        vm.expectRevert(IFinancingController.OutsideMilestonePlace.selector);
        controller.resumeWithProof(id, 2, 2, a, b, c);
        assertEq(
            uint8(controller.getFacility(id).status), uint8(IFinancingController.Status.PAUSED)
        );

        _commitAt(2, 3, 1_300_000, 103_800_000);
        vm.prank(exporter);
        controller.resumeWithProof(id, 2, 3, a, b, c);
        assertEq(
            uint8(controller.getFacility(id).status), uint8(IFinancingController.Status.ACTIVE)
        );
    }

    // ---- fuzz ------------------------------------------------------------------------------------

    /// Release succeeds exactly when the on-chain distance is within the radius.
    function testFuzz_releaseIffInsideRadius(int256 lat, int256 lon, uint256 radius) public {
        // forge-lint: disable-next-line(unsafe-typecast)
        int32 la = int32(bound(lat, -2_000_000, 4_000_000));
        // forge-lint: disable-next-line(unsafe-typecast)
        int32 lo = int32(bound(lon, 101_000_000, 106_000_000));
        // forge-lint: disable-next-line(unsafe-typecast)
        uint32 r = uint32(bound(radius, 1000, 1_000_000));
        IFinancingController.MilestoneSpec[] memory m = _placedMilestones();
        m[0] = m[2];
        m[0].radiusM = r;
        _activateWith(m);
        _commitAt(0, 1, la, lo);
        bool inside = GeoDistance.distanceM(la, lo, SIN_LAT, SIN_LON) <= r;
        vm.prank(exporter);
        if (!inside) vm.expectRevert(IFinancingController.OutsideMilestonePlace.selector);
        controller.evaluateAndReleaseMilestone(id, 0, 1);
        assertEq(controller.getFacility(id).nextMilestone, inside ? 1 : 0);
    }
}
