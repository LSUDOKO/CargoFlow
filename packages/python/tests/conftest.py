"""Synthetic API payloads shaped exactly like the live API's (captured 2026-10-03), for respx mocks and analytics."""

from __future__ import annotations

from typing import Any

import pytest

from cargoflow.analytics import Portfolio
from cargoflow.models import Epoch, ShipmentView, TrackPoint

API = "https://api.test"
POLICY = {"minTempX100": 200, "maxTempX100": 800, "maxGapSec": 1800, "maxRouteDeviationM": 25000, "minEvidenceScore": 75, "maxConflictBps": 3000, "maxRiskBps": 3500, "requiresZk": False, "minSensors": 2}
ROUTE = [{"latE6": 18950000, "lonE6": 72950000}, {"latE6": 1264000, "lonE6": 103820000}]


def sid(n: int) -> str:
    return "0x" + f"{n:02x}" * 32


def shipment(n: int, status: str, invoice: int = 30_000_000, policy: dict | None = None, labels: list[str] | None = None) -> dict[str, Any]:
    return {
        "id": sid(n), "externalRef": f"CF-{n}", "exporter": "0x" + "a" * 40, "buyer": "0x" + "b" * 40, "financier": "0x" + "c" * 40,
        "invoiceHash": "0x" + "1" * 64, "routeCommitment": "0x" + "2" * 64, "policyCommitment": "0x" + "3" * 64,
        "invoiceValue": str(invoice), "policy": policy or POLICY, "route": ROUTE, "placeLabels": labels, "status": status,
        "createdAt": "2026-10-02T10:00:00Z", "updatedAt": "2026-10-02T11:00:00Z",
    }


def epoch(milestone: int, seq: int, t0: int, action: str = "APPROVE_ADVANCE", conflict: int = 166, created: str = "2026-10-02T10:00:00Z", proof: bool = False) -> dict[str, Any]:
    paused = action == "PAUSE_FACILITY"
    return {
        "sequence": seq, "milestoneIndex": milestone, "epochId": "0x" + f"{milestone:02x}{seq:02x}{t0 % 256:02x}" * 10 + "abcd",
        "root": "0x" + "0" * 64, "readingCount": 16, "startTime": t0, "endTime": t0 + 35, "score": 48 if paused else 100,
        "conflictBps": conflict, "riskBps": 433, "compliant": not paused, "penalties": {"conflict": 29 if paused else 0},
        "decisionPass": not paused, "decisionAction": action, "reasons": ["CONFLICT_TOO_HIGH"] if paused else [],
        "commitTx": "0x" + "9" * 64, "proofVerified": proof, "createdAt": created,
    }


def milestone(i: int, released_at: str | None = None, amount: int = 4_000_000) -> dict[str, Any]:
    m = {"index": i, "description": "", "allocatedUsdg": str(amount), "evidenceThreshold": 75, "checkpointCommitment": "0x" + "4" * 64, "released": released_at is not None}
    if released_at:
        m["releasedAt"] = released_at
        m["releaseTxHash"] = "0x" + "5" * 64
    return m


def facility(status: str, committed: int, drawn: int, next_m: int, count: int = 5, funded: bool = True, closed: bool = False) -> dict[str, Any]:
    return {
        "status": status, "exporter": "0x" + "a" * 40, "financier": "0x" + "c" * 40, "buyer": "0x" + "b" * 40,
        "committed": str(committed), "drawn": str(drawn), "remaining": str(committed - drawn), "feeBps": 300,
        "nextMilestone": next_m, "milestoneCount": count, "pausedAt": 0, "pauseCount": 0, "funded": funded, "vaultPaused": False, "closed": closed,
    }


def view(ship: dict, ms: list, fac: dict | None, cover: dict | None = None) -> dict[str, Any]:
    return {"shipment": ship, "milestones": ms, "facility": fac, "latestEvidence": None, "quarantinedReadings": 0, "usdgDecimals": 6, "cover": cover, "openCoverOffers": 0}


def track(milestone: int, seq: int, t0: int, tmin: int, tmax: int, committed: bool = True) -> dict[str, Any]:
    return {"epochId": f"e{milestone}-{seq}", "milestoneIndex": milestone, "sequence": seq, "startTime": t0, "endTime": t0 + 600, "latE6": 1, "lonE6": 2, "minTempX100": tmin, "maxTempX100": tmax, "maxHumidityX100": 0, "maxShockX100": 0, "pass": tmax <= 800, "committed": committed}


@pytest.fixture()
def payloads() -> dict[str, Any]:
    """Four shipments: ACTIVE (2 of 5 released, covered), PAUSED (pause on milestone 1), SETTLED (pause recovered), DEFAULTED."""
    T = 1_790_936_000
    active = view(
        shipment(1, "ACTIVE", labels=["Mumbai", "Singapore"]),
        [milestone(0, "2026-10-02T10:00:05Z"), milestone(1, "2026-10-02T10:01:07Z"), milestone(2), milestone(3), milestone(4)],
        facility("ACTIVE", 20_000_000, 8_000_000, 2),
        cover={"insurer": "0x" + "d" * 40, "financier": "0x" + "c" * 40, "amount": "5000000", "premium": "100000", "status": "ACTIVE", "financierPayout": "0", "insurerReturn": "0"},
    )
    paused = view(shipment(2, "PAUSED"), [milestone(0, "2026-10-02T10:00:10Z"), milestone(1), milestone(2)], facility("PAUSED", 12_000_000, 4_000_000, 1, count=3))
    settled = view(shipment(3, "SETTLED", invoice=40_000_000), [milestone(i, f"2026-10-02T10:0{i}:30Z") for i in range(3)], facility("SETTLED", 12_000_000, 12_000_000, 3, count=3, closed=True))
    defaulted = view(shipment(4, "DEFAULTED", policy={**POLICY, "minTempX100": -2000, "maxTempX100": -1500}), [milestone(0, "2026-10-02T10:00:20Z"), milestone(1)], facility("DEFAULTED", 8_000_000, 4_000_000, 1, count=2, closed=True))
    epochs = {
        sid(1): [epoch(0, 1, T, created="2026-10-02T10:00:02Z"), epoch(1, 1, T + 40, created="2026-10-02T10:01:00Z", conflict=500)],
        sid(2): [epoch(0, 1, T, created="2026-10-02T10:00:05Z"), epoch(1, 1, T + 40, "PAUSE_FACILITY", conflict=7475, created="2026-10-02T10:01:00Z"), epoch(255, 1, T + 80, "SKIPPED_FACILITY_PAUSED", created="2026-10-02T10:02:00Z")],
        sid(3): [
            epoch(0, 1, T, created="2026-10-02T10:00:28Z"),
            epoch(1, 1, T + 40, "PAUSE_FACILITY", conflict=6000, created="2026-10-02T10:00:40Z"),
            epoch(1, 2, T + 80, created="2026-10-02T10:01:20Z", proof=True),
            epoch(2, 1, T + 120, created="2026-10-02T10:02:25Z", conflict=0),
        ],
        sid(4): [epoch(0, 1, T, created="2026-10-02T10:00:15Z"), epoch(1, 1, T + 40, "PAUSE_FACILITY", conflict=9000, created="2026-10-02T10:01:00Z")],
    }
    tracks = {
        sid(1): [track(0, 1, T, 450, 520), track(1, 1, T + 600, 480, 950)],  # 1.5 °C above
        sid(2): [track(0, 1, T, 150, 500), track(1, 1, T + 600, 400, 500)],  # 0.5 °C below
        sid(3): [track(0, 1, T, 300, 700), track(1, 1, T + 600, 300, 700), track(2, 1, T + 1200, 300, 700)],
        sid(4): [track(0, 1, T, -1800, -1600), track(1, 1, T + 600, -1800, -1000)],  # frozen route: 5 °C above
    }
    return {"views": [active, paused, settled, defaulted], "epochs": epochs, "tracks": tracks}


@pytest.fixture()
def portfolio(payloads) -> Portfolio:
    return Portfolio(
        views=[ShipmentView.model_validate(v) for v in payloads["views"]],
        epochs={k: [Epoch.model_validate(e) for e in v] for k, v in payloads["epochs"].items()},
        tracks={k: [TrackPoint.model_validate(t) for t in v] for k, v in payloads["tracks"].items()},
    )
