"""Read-only smoke test against the live API. Deselected by default; run with ``pytest -m live``."""

import os

import pytest

from cargoflow import CargoFlow, NotFoundError
from cargoflow import analytics as cfa

API = os.environ.get("CARGOFLOW_API_URL", "https://cargoflow-api-75ul.onrender.com")


@pytest.mark.live
def test_live_read_endpoints_and_analytics():
    with CargoFlow(API, timeout=90, retries=4, backoff=2) as cf:
        assert cf.health().status == "ok"
        stats = cf.stats()
        assert stats.total >= 0
        ships = cf.shipments(limit=5)
        assert len(ships) <= 5
        cf.market_requests()
        if not ships:
            pytest.skip("the live API has no shipments")
        s = ships[0]
        view = cf.shipment(s.id)
        assert view.shipment.id == s.id
        cf.epochs(s.id), cf.track(s.id), cf.audit(s.id, limit=5), cf.telemetry(s.id), cf.sources(s.id)
        cf.party(s.exporter)
        try:
            cf.cover(s.id)
        except NotFoundError:
            pass  # API versions before contracts v2 serve no cover endpoint
        pf = cf.portfolio([x.id for x in ships])
        cfa.exposure(pf)
        cfa.excursion_stats(pf)
        cfa.conflict_distribution(pf)
        cfa.release_latency(pf)
        cfa.recovery_rates(pf)
        mc = cfa.simulate_default_recovery(pf, n_sims=1000, seed=1)
        assert 0 <= mc.summary()["prob_any_default"] <= 1
