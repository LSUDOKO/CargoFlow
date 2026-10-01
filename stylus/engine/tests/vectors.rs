//! The Rust engine must reproduce the Go engine bit for bit. Both are checked against the same file,
//! `contracts/test/fixtures/evidence_engine_vectors.json`, which the Go test suite generates and guards.

use cargoflow_engine::{combine, fuse_epoch, Error, Mass};
use serde::Deserialize;

#[derive(Deserialize)]
struct CombineVec {
    a: [i64; 3],
    b: [i64; 3],
    fused: [i64; 3],
    #[serde(rename = "conflictBps")]
    conflict_bps: i64,
}

#[derive(Deserialize)]
struct FuseVec {
    name: String,
    #[serde(rename = "minTempX100")]
    min: i32,
    #[serde(rename = "maxTempX100")]
    max: i32,
    #[serde(rename = "tempsA")]
    a: Vec<i32>,
    #[serde(rename = "tempsB")]
    b: Vec<i32>,
    compliant: i64,
    defective: i64,
    uncertain: i64,
    #[serde(rename = "worstConflictBps")]
    worst: i64,
}

#[derive(Deserialize)]
struct Vectors {
    combine: Vec<CombineVec>,
    fuse: Vec<FuseVec>,
}

fn load() -> Vectors {
    let path = concat!(
        env!("CARGO_MANIFEST_DIR"),
        "/../../contracts/test/fixtures/evidence_engine_vectors.json"
    );
    serde_json::from_str(&std::fs::read_to_string(path).expect("vectors file"))
        .expect("valid vectors")
}

fn mass(v: [i64; 3]) -> Mass {
    Mass {
        compliant: v[0],
        defective: v[1],
        uncertain: v[2],
    }
}

#[test]
fn combine_matches_go_on_every_vector() {
    let v = load();
    assert!(v.combine.len() > 100);
    for c in &v.combine {
        let (fused, k) = combine(mass(c.a), mass(c.b));
        assert_eq!(
            [fused.compliant, fused.defective, fused.uncertain],
            c.fused,
            "{:?} x {:?}",
            c.a,
            c.b
        );
        assert_eq!(k, c.conflict_bps, "{:?} x {:?}", c.a, c.b);
    }
}

#[test]
fn fuse_epoch_matches_go_on_every_vector() {
    let v = load();
    assert!(v.fuse.len() > 10);
    for f in &v.fuse {
        let got = fuse_epoch(f.min, f.max, &f.a, &f.b).expect(&f.name);
        assert_eq!(got.mass.compliant, f.compliant, "{}", f.name);
        assert_eq!(got.mass.defective, f.defective, "{}", f.name);
        assert_eq!(got.mass.uncertain, f.uncertain, "{}", f.name);
        assert_eq!(got.worst_conflict_bps, f.worst, "{}", f.name);
    }
}

#[test]
fn bad_input_is_rejected() {
    assert_eq!(fuse_epoch(200, 800, &[1, 2], &[1]), Err(Error::BadInput));
    assert_eq!(fuse_epoch(200, 800, &[], &[]), Err(Error::BadInput));
    assert_eq!(fuse_epoch(800, 200, &[1], &[1]), Err(Error::BadInput));
    assert_eq!(fuse_epoch(500, 500, &[1], &[1]), Err(Error::BadInput));
}

#[test]
fn total_contradiction_is_vacuous_not_a_division_by_zero() {
    let (fused, k) = combine(
        Mass {
            compliant: 10_000,
            defective: 0,
            uncertain: 0,
        },
        Mass {
            compliant: 0,
            defective: 10_000,
            uncertain: 0,
        },
    );
    assert_eq!(k, 10_000);
    assert_eq!(
        fused,
        Mass {
            compliant: 0,
            defective: 0,
            uncertain: 10_000
        }
    );
}
