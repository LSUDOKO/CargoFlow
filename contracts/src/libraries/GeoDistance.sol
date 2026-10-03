// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title GeoDistance
/// @notice Integer-only ground distance between two WGS84 points given in degrees x 1e6, used to decide
///         whether an evidence epoch's centroid lies inside a milestone's place.
/// @dev Equirectangular projection at the mid latitude on a sphere of the IUGG mean radius
///      (6,371,008.8 m): d = R * sqrt(dLat^2 + (cos(midLat) * dLon)^2), with dLon taken the short way
///      round the antimeridian. cos is a 1-degree table (x 1e9) with linear interpolation (error below
///      4e-5 relative). Intermediates are micrometres in uint256, so nothing in range can overflow.
///
///      Accuracy against a float64 haversine on the same sphere, both points inside the band:
///        |d - haversine| <= e * haversine + 1 m, where e is
///          separation <= 500 km:    0.1% (|lat| <= 60 deg), 0.2% (<= 70 deg), 0.8% (<= 80 deg)
///          separation <= 1,000 km:  0.3% (|lat| <= 60 deg), 0.75% (<= 70 deg), 3.2% (<= 80 deg)
///      The extra metre is the floor to whole metres. Beyond 80 deg or 1,000 km the projection degrades
///      and the result must not be relied on (milestone radii are capped at 1,000 km).
///      test/libraries/GeoDistance.t.sol checks exactly this bound against embedded reference values.
library GeoDistance {
    int256 internal constant MAX_LAT_E6 = 90_000_000;
    int256 internal constant MAX_LON_E6 = 180_000_000;

    /// @dev R * pi / 180 in micrometres per degree, R = 6,371,008.8 m.
    uint256 internal constant UM_PER_DEG = 111_195_080_234;
    uint256 internal constant E6 = 1_000_000;
    uint256 internal constant COS_SCALE = 1_000_000_000;
    uint256 private constant HALF_TURN_E6 = 180_000_000;
    uint256 private constant FULL_TURN_E6 = 360_000_000;
    uint256 private constant QUARTER_TURN_E6 = 90_000_000;

    /// @dev round(cos(d deg) * 1e9) for d = 0..90, 4 bytes big-endian each.
    bytes internal constant COS_TABLE =
        hex"3b9aca003b98770f3b917e6b3b85e09f3b759e923b60b98a3b4733273b290d683b064aa53adeed953ab2f9493a82712f3a4d59113a13b51139d589ae3992dbc2394bb08039000d7438aff884385b77f03802924d37a54e8a3743b3ef36ddca15367398f2360528cb3592823e351bae3c34a0b6093421a33b339e7fbc331755c5328c2fe031fd18e8316a1c0530d344ac30389ea22f9a35f62ef817022e524e692da8e91b2cfbf44c2c4b7d792b9792662ae041182a2597dd2967a54228a6781827e21f6e271aaa952650291a2582aac724b23fa323def7ef2308e424223014f421549b472076883b1f95ed201eb2db7b1dcd65001ce59b941bfb914b1b0f58641a21034b1930a496183e4f03174a157816540b01155c42ce1462d02f1367c69a126b39a2116d3cf9106de46c0f6d43e50e6b6f680d687b0e0c647b0b0b5f83a30a59a93209530021084b9ced0743941f063afa4f0531e41f0428663a031e955402148629010a4d7600000000";

    /// @notice True when latitude is within +-90 deg and longitude within +-180 deg (x 1e6).
    function isValidCoordinate(int32 latE6, int32 lonE6) internal pure returns (bool) {
        return
            latE6 >= -MAX_LAT_E6 && latE6 <= MAX_LAT_E6 && lonE6 >= -MAX_LON_E6
                && lonE6 <= MAX_LON_E6;
    }

    /// @notice Approximate ground distance in whole metres (rounded down). Inputs must be valid
    ///         coordinates (see isValidCoordinate); the callers in this protocol validate on entry.
    function distanceM(int32 aLatE6, int32 aLonE6, int32 bLatE6, int32 bLonE6)
        internal
        pure
        returns (uint256)
    {
        uint256 dLat = _absDiff(aLatE6, bLatE6);
        uint256 dLon = _absDiff(aLonE6, bLonE6);
        if (dLon > HALF_TURN_E6) dLon = FULL_TURN_E6 - dLon; // the short way round the antimeridian
        uint256 midLat = _abs(int256(aLatE6) + int256(bLatE6)) / 2;

        uint256 dyUm = (dLat * UM_PER_DEG) / E6;
        uint256 dxUm = (dLon * UM_PER_DEG * cosE9(midLat)) / (E6 * COS_SCALE);
        return Math.sqrt(dxUm * dxUm + dyUm * dyUm) / E6;
    }

    /// @notice True when the two points are at most `radiusM` metres apart (inclusive).
    function withinRadius(int32 aLatE6, int32 aLonE6, int32 bLatE6, int32 bLonE6, uint32 radiusM)
        internal
        pure
        returns (bool)
    {
        return distanceM(aLatE6, aLonE6, bLatE6, bLonE6) <= radiusM;
    }

    /// @notice cos(latitude) x 1e9 for an absolute latitude in degrees x 1e6; 0 at or beyond the pole.
    function cosE9(uint256 absLatE6) internal pure returns (uint256) {
        if (absLatE6 >= QUARTER_TURN_E6) return 0;
        uint256 i = absLatE6 / E6;
        uint256 lo = _entry(i);
        uint256 hi = _entry(i + 1); // cos decreases on [0, 90], so hi <= lo
        return lo - ((lo - hi) * (absLatE6 % E6)) / E6;
    }

    function _entry(uint256 i) private pure returns (uint256 v) {
        bytes memory t = COS_TABLE;
        uint256 o = i * 4;
        v = (uint256(uint8(t[o])) << 24) | (uint256(uint8(t[o + 1])) << 16)
            | (uint256(uint8(t[o + 2])) << 8) | uint256(uint8(t[o + 3]));
    }

    function _absDiff(int32 a, int32 b) private pure returns (uint256) {
        return _abs(int256(a) - int256(b));
    }

    function _abs(int256 x) private pure returns (uint256) {
        return uint256(x < 0 ? -x : x);
    }
}
