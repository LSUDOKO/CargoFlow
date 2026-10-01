//! Fixed-point Dempster-Shafer kernel for CargoFlow evidence fusion.
//!
//! This is a line-for-line port of `backend/internal/evidence` (`ReadingMass`, `Combine`, `Mean`) and of the
//! Solidity reference in `contracts/src/experimental/EvidenceEngineSol.sol`. All three are held to the same
//! vectors. Masses are integers in basis points (10_000 = 1.0); there is no floating point, so results are
//! exact and reproducible across implementations.
#![no_std]
extern crate alloc;

/// Fixed-point denominator: 10_000 basis points is probability 1.0.
pub const SCALE: i64 = 10_000;
const S2: i64 = SCALE * SCALE;
/// A reading this far (degrees C x 100) inside the band is fully trusted.
const MARGIN: i64 = 100;
/// A reading this far outside the band is treated as clearly defective.
const FULL_DEFECT: i64 = 300;

/// Basic probability assignment over {Compliant, Defective}; `uncertain` is the mass on the whole frame.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Mass {
    pub compliant: i64,
    pub defective: i64,
    pub uncertain: i64,
}

impl Mass {
    pub const VACUOUS: Mass = Mass {
        compliant: 0,
        defective: 0,
        uncertain: SCALE,
    };
}

/// Result of fusing an epoch.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Fused {
    /// Mean fused mass across the epoch.
    pub mass: Mass,
    /// Worst per-step conflict between the two sources, in basis points.
    pub worst_conflict_bps: i64,
}

/// Reasons an epoch is refused.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Error {
    /// Empty input, unequal series lengths, or an empty or inverted temperature band.
    BadInput,
}

/// Maps one temperature reading (degrees C x 100) to a mass: fully compliant well inside the band,
/// degrading linearly across the edge, clearly defective 3 C outside it.
pub fn reading_mass(temp: i64, min: i64, max: i64) -> Mass {
    let mut d = temp - min;
    let above = max - temp;
    if above < d {
        d = above;
    }
    let (c, def) = if d >= MARGIN {
        (9200, 100)
    } else if d >= 0 {
        (5000 + 4200 * d / MARGIN, 1500 - 1400 * d / MARGIN)
    } else {
        let a = core::cmp::min(-d, FULL_DEFECT);
        (5000 - 4800 * a / FULL_DEFECT, 1500 + 7500 * a / FULL_DEFECT)
    };
    Mass {
        compliant: c,
        defective: def,
        uncertain: SCALE - c - def,
    }
}

/// Dempster's rule for two assignments. Returns the fused mass and the conflict factor K in basis points.
/// Total contradiction (K = 1) yields the vacuous mass with K = 10_000 instead of dividing by zero.
pub fn combine(a: Mass, b: Mass) -> (Mass, i64) {
    let k = a.compliant * b.defective + a.defective * b.compliant;
    if k >= S2 {
        return (Mass::VACUOUS, SCALE);
    }
    let conflict_bps = (k + SCALE / 2) / SCALE;

    let denom = S2 - k;
    let raw_c = a.compliant * b.compliant + a.compliant * b.uncertain + a.uncertain * b.compliant;
    let raw_d = a.defective * b.defective + a.defective * b.uncertain + a.uncertain * b.defective;
    let mut c = (raw_c * SCALE + denom / 2) / denom;
    let d = (raw_d * SCALE + denom / 2) / denom;
    let over = c + d - SCALE;
    if over > 0 {
        c -= over; // rounding overshoot: trim compliance, never defect
    }
    (
        Mass {
            compliant: c,
            defective: d,
            uncertain: SCALE - c - d,
        },
        conflict_bps,
    )
}

/// Fuses an epoch: each aligned pair of readings becomes two masses that are combined; the result is the
/// mean fused mass (rounding half up) and the worst conflict.
pub fn fuse_epoch(min: i32, max: i32, temps_a: &[i32], temps_b: &[i32]) -> Result<Fused, Error> {
    let n = temps_a.len();
    if n == 0 || n != temps_b.len() || min >= max {
        return Err(Error::BadInput);
    }
    let (min, max) = (min as i64, max as i64);
    let (mut sum_c, mut sum_d, mut worst) = (0i64, 0i64, 0i64);
    for i in 0..n {
        let (m, k) = combine(
            reading_mass(temps_a[i] as i64, min, max),
            reading_mass(temps_b[i] as i64, min, max),
        );
        sum_c += m.compliant;
        sum_d += m.defective;
        if k > worst {
            worst = k;
        }
    }
    let n = n as i64;
    let mut c = (sum_c + n / 2) / n;
    let d = (sum_d + n / 2) / n;
    let over = c + d - SCALE;
    if over > 0 {
        c -= over;
    }
    Ok(Fused {
        mass: Mass {
            compliant: c,
            defective: d,
            uncertain: SCALE - c - d,
        },
        worst_conflict_bps: worst,
    })
}
