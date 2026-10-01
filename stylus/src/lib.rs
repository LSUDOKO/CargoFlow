//! CargoFlow EvidenceEngine on Arbitrum Stylus.
//!
//! Exposes the same two functions, with the same ABI and the same results, as the Solidity reference
//! `EvidenceEngineSol`, so the two can be benchmarked on identical calldata. The arithmetic lives in the
//! dependency-free `cargoflow-engine` crate, which is tested against the Go engine's vectors.
#![cfg_attr(not(any(test, feature = "export-abi")), no_main)]
extern crate alloc;

use alloc::vec::Vec;
use cargoflow_engine::{self as engine, Error, Mass};
use alloy_sol_types::sol;
use stylus_sdk::prelude::*;

sol! {
    error BadInput();
}

#[derive(SolidityError)]
pub enum EngineError {
    BadInput(BadInput),
}

#[storage]
#[entrypoint]
pub struct EvidenceEngine;

#[public]
impl EvidenceEngine {
    /// Dempster's rule over {Compliant, Defective}; returns (compliant, defective, uncertain, conflictBps).
    pub fn combine(&self, ac: u32, ad: u32, au: u32, bc: u32, bd: u32, bu: u32) -> (u32, u32, u32, u32) {
        let m = |c: u32, d: u32, u: u32| Mass { compliant: c as i64, defective: d as i64, uncertain: u as i64 };
        let (f, k) = engine::combine(m(ac, ad, au), m(bc, bd, bu));
        (f.compliant as u32, f.defective as u32, f.uncertain as u32, k as u32)
    }

    /// Fuses an epoch of aligned readings (degrees C x 100) from two sensors; returns the mean fused
    /// (compliant, defective, uncertain) and the worst per-step conflict in basis points.
    pub fn fuse_epoch(
        &self,
        min_temp_x100: i32,
        max_temp_x100: i32,
        temps_a: Vec<i32>,
        temps_b: Vec<i32>,
    ) -> Result<(u32, u32, u32, u32), EngineError> {
        match engine::fuse_epoch(min_temp_x100, max_temp_x100, &temps_a, &temps_b) {
            Ok(f) => Ok((
                f.mass.compliant as u32,
                f.mass.defective as u32,
                f.mass.uncertain as u32,
                f.worst_conflict_bps as u32,
            )),
            Err(Error::BadInput) => Err(EngineError::BadInput(BadInput {})),
        }
    }
}
