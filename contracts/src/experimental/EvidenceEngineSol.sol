// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @title EvidenceEngineSol
/// @notice Solidity reference for the Dempster-Shafer kernel that the Go backend runs and the Stylus (Rust)
///         engine in `stylus/` re-implements. It exists to be compared, not to be deployed in the core:
///         the three implementations are held to the same vectors in
///         `test/fixtures/evidence_engine_vectors.json`. Integer arithmetic in basis points throughout.
contract EvidenceEngineSol {
    error BadInput();

    /// @dev Static tuple (compliant, defective, uncertain, worst conflict); ABI-identical to four uint32 returns.
    struct Fused {
        uint32 compliant;
        uint32 defective;
        uint32 uncertain;
        uint32 worstConflictBps;
    }

    struct Acc {
        uint256 sumC;
        uint256 sumD;
        uint256 worst;
    }

    uint256 internal constant SCALE = 10_000;
    uint256 internal constant S2 = SCALE * SCALE;
    int256 internal constant MARGIN = 100; // a reading this far inside the band is fully trusted
    int256 internal constant FULL_DEFECT = 300; // this far outside the band is clearly defective

    /// @notice Dempster's rule over {Compliant, Defective} for two mass assignments (basis points).
    /// @return c fused compliant mass
    /// @return d fused defective mass
    /// @return u fused uncertain mass
    /// @return k conflict factor between the sources, in basis points
    function combine(uint32 ac, uint32 ad, uint32 au, uint32 bc, uint32 bd, uint32 bu)
        external
        pure
        returns (uint32 c, uint32 d, uint32 u, uint32 k)
    {
        (uint256 rc, uint256 rd, uint256 rk) = _combine(ac, ad, au, bc, bd, bu);
        return (uint32(rc), uint32(rd), uint32(SCALE - rc - rd), uint32(rk));
    }

    /// @notice Fuses an epoch: maps each aligned pair of readings (degrees C x 100) to masses, combines them,
    ///         then returns the mean fused mass and the worst per-step conflict.
    function fuseEpoch(
        int32 minTempX100,
        int32 maxTempX100,
        int32[] calldata tempsA,
        int32[] calldata tempsB
    ) external pure returns (Fused memory) {
        if (tempsA.length == 0 || tempsA.length != tempsB.length || minTempX100 >= maxTempX100) {
            revert BadInput();
        }

        Acc memory acc;
        for (uint256 i; i < tempsA.length; ++i) {
            _accumulate(acc, tempsA[i], tempsB[i], minTempX100, maxTempX100);
        }
        return _mean(acc, tempsA.length);
    }

    /// @dev Mean of the fused masses, rounding half up and repairing any rounding overshoot by trimming
    ///      compliance, never defect.
    function _mean(Acc memory acc, uint256 n) internal pure returns (Fused memory f) {
        uint256 mc = (acc.sumC + n / 2) / n;
        uint256 md = (acc.sumD + n / 2) / n;
        if (mc + md > SCALE) mc -= mc + md - SCALE;
        f = Fused(uint32(mc), uint32(md), uint32(SCALE - mc - md), uint32(acc.worst));
    }

    /// @dev One aligned pair of readings: map each to masses, combine them and fold into the accumulator.
    function _accumulate(Acc memory acc, int256 tempA, int256 tempB, int256 minT, int256 maxT)
        internal
        pure
    {
        (uint256 ac, uint256 ad) = _readingMass(tempA, minT, maxT);
        (uint256 bc, uint256 bd) = _readingMass(tempB, minT, maxT);
        (uint256 c, uint256 d, uint256 k) =
            _combine(ac, ad, SCALE - ac - ad, bc, bd, SCALE - bc - bd);
        acc.sumC += c;
        acc.sumD += d;
        if (k > acc.worst) acc.worst = k;
    }

    /// @dev Membership of one reading: fully compliant well inside the band, degrading linearly across the
    ///      edge, clearly defective by 3 C outside it. Returns the compliant and defective masses.
    function _readingMass(int256 temp, int256 minT, int256 maxT)
        internal
        pure
        returns (uint256 c, uint256 d)
    {
        int256 dist = temp - minT;
        int256 above = maxT - temp;
        if (above < dist) dist = above;

        if (dist >= MARGIN) return (9200, 100);
        if (dist >= 0) {
            return (uint256(5000 + 4200 * dist / MARGIN), uint256(1500 - 1400 * dist / MARGIN));
        }
        int256 a = -dist;
        if (a > FULL_DEFECT) a = FULL_DEFECT;
        return (uint256(5000 - 4800 * a / FULL_DEFECT), uint256(1500 + 7500 * a / FULL_DEFECT));
    }

    function _combine(uint256 ac, uint256 ad, uint256 au, uint256 bc, uint256 bd, uint256 bu)
        internal
        pure
        returns (uint256 c, uint256 d, uint256 conflictBps)
    {
        uint256 k = ac * bd + ad * bc;
        if (k >= S2) return (0, 0, SCALE); // total contradiction: vacuous result, never divide by zero
        conflictBps = (k + SCALE / 2) / SCALE;

        uint256 denom = S2 - k;
        uint256 rawC = ac * bc + ac * bu + au * bc;
        uint256 rawD = ad * bd + ad * bu + au * bd;
        c = (rawC * SCALE + denom / 2) / denom;
        d = (rawD * SCALE + denom / 2) / denom;
        if (c + d > SCALE) c -= c + d - SCALE;
    }
}
