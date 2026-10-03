#!/usr/bin/env python3
"""Exports contract ABIs from the Foundry artifacts into backend/internal/chain/abi.

Run after changing a contract:  make abi
The backend embeds these files; a Go test fails if they drift from contracts/out.
"""
import json
import pathlib

root = pathlib.Path(__file__).resolve().parent.parent
out_dir = root / "backend" / "internal" / "chain" / "abi"
out_dir.mkdir(parents=True, exist_ok=True)

for name in ["FinancingController", "EvidenceRegistry", "ShipmentRegistry", "PolicyEngine", "ReceivableVault", "CoverPool"]:
    artifact = root / "contracts" / "out" / f"{name}.sol" / f"{name}.json"
    if not artifact.exists():
        raise SystemExit(f"{artifact} not found; run `make contracts-build` first")
    abi = json.loads(artifact.read_text())["abi"]
    (out_dir / f"{name}.json").write_text(json.dumps(abi, indent=2) + "\n")
    print(f"wrote {name}.json ({len(abi)} entries)")
