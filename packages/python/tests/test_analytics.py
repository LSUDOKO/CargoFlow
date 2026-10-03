import math

import numpy as np
import polars as pl
import pytest

from cargoflow import analytics as cfa
from conftest import sid


def test_exposure_by_status(portfolio):
    e = cfa.exposure(portfolio)
    assert list(e.index) == ["ACTIVE", "DEFAULTED", "PAUSED", "SETTLED", "TOTAL"]
    a = e.loc["ACTIVE"]
    assert (a.shipments, a.invoice_value, a.committed, a.drawn, a.in_escrow, a.undrawn, a.covered, a.uncovered_drawn) == (1, 30, 20, 8, 12, 12, 5, 3)
    t = e.loc["TOTAL"]
    assert (t.shipments, t.invoice_value, t.committed, t.drawn, t.in_escrow, t.undrawn, t.covered, t.uncovered_drawn) == (4, 130, 52, 28, 20, 24, 5, 7)
    assert e.loc["SETTLED", "in_escrow"] == 0 and e.loc["DEFAULTED", "uncovered_drawn"] == 0
    assert math.isclose(e.loc["ACTIVE", "share_of_drawn"], 8 / 28)
    assert isinstance(cfa.exposure(portfolio, backend="polars"), pl.DataFrame)


def test_excursions_per_route_and_cargo(portfolio):
    x = cfa.excursion_stats(portfolio)
    coords = portfolio.view(sid(2)).shipment.route_key
    a = x.loc[("Mumbai -> Singapore", "2 to 8°C")]
    assert (a.shipments, a.epochs, a.excursion_epochs, a.excursion_rate, a.max_exceedance_c, a.excursion_minutes) == (1, 2, 1, 0.5, 1.5, 10)
    b = x.loc[(coords, "2 to 8°C")]
    assert (b.shipments, b.epochs, b.excursion_epochs, b.shipments_with_excursion, b.shipment_excursion_rate) == (2, 5, 1, 1, 0.5)
    assert math.isclose(b.mean_exceedance_c, 0.5)
    c = x.loc[(coords, "-20 to -15°C")]
    assert c.max_exceedance_c == 5.0 and c.committed_excursions == 1
    assert list(x.excursion_rate) == sorted(x.excursion_rate, reverse=True)
    by_route = cfa.excursion_stats(portfolio, by=["route"])
    assert by_route.loc[coords, "epochs"] == 7


def test_conflict_distribution_and_histogram(portfolio):
    d = cfa.conflict_distribution(portfolio)
    row = d.loc["all"]
    assert row.epochs == 10 and math.isclose(row.mean_bps, 2380.5) and row.max_bps == 9000 and math.isclose(row.share_above_policy, 0.3)
    c = np.array([166, 500, 166, 7475, 166, 6000, 166, 0, 166, 9000], dtype=float)
    assert math.isclose(row.p90, float(np.quantile(c, 0.9)))
    per = cfa.conflict_distribution(portfolio, by="status")
    assert per.loc["DEFAULTED", "max_bps"] == 9000 and per.loc["ACTIVE", "share_above_policy"] == 0
    h = cfa.conflict_histogram(portfolio)
    assert h.epochs.sum() == 10 and h.loc[h.band == "0-249", "epochs"].item() == 6 and math.isclose(h.share.sum(), 1)


def test_release_latency(portfolio):
    r = cfa.release_latency(portfolio)
    assert sorted(r.latency_s.tolist()) == [2, 3, 5, 5, 5, 7, 10]
    recovered = r[(r.shipment_id == sid(3)) & (r.milestone_index == 1)]
    assert recovered.latency_s.item() == 10  # measured from the recovering epoch, not the pausing one


def test_recovery_rates(portfolio):
    r = cfa.recovery_rates(portfolio)
    t = r.loc["TOTAL"]
    assert (t.pauses, t.recovered, t.defaulted, t.open, t.with_proof) == (3, 1, 1, 1, 1)
    assert t.recovery_rate == 0.5 and t.mean_time_to_recovery_s == 40
    assert r.loc[sid(2), "open"] == 1 and np.isnan(r.loc[sid(2), "recovery_rate"])
    by_cargo = cfa.recovery_rates(portfolio, by="cargo")
    assert by_cargo.loc["2 to 8°C", "pauses"] == 2


def test_frames(portfolio):
    s = portfolio.shipments_frame()
    assert s.set_index("shipment_id").loc[sid(1), "in_escrow"] == 12
    e = portfolio.epochs_frame()
    assert len(e) == 11 and (~e.evaluated).sum() == 1
    t = portfolio.track_frame("polars")
    assert t.filter(pl.col("excursion")).height == 3
    m = portfolio.milestones_frame()
    assert m.allocated.sum() == 4 * 13


def test_empty_portfolio_is_harmless():
    empty = cfa.Portfolio(views=[])
    assert cfa.exposure(empty).empty and cfa.excursion_stats(empty).empty and cfa.release_latency(empty).empty
    assert cfa.recovery_rates(empty).empty
    r = cfa.simulate_default_recovery(empty, n_sims=100)
    assert r.summary()["expected_loss"] == 0 and r.by_shipment().empty


def test_polars_frames_with_timestamps(portfolio):
    s = portfolio.shipments_frame("polars")
    assert s.height == 4 and str(s.schema["created_at"]).startswith("Datetime")
    r = cfa.release_latency(portfolio, backend="polars")
    assert r["latency_s"].sum() == 37
