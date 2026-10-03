import math

import numpy as np
import pytest

from cargoflow import analytics as cfa
from conftest import sid


def fixed(p_pause: float, p_rec: float) -> cfa.EpochRates:
    # a near-degenerate posterior with the wanted means (used with parameter_uncertainty=False)
    k = 1e6
    return cfa.EpochRates(p_pause * k, (1 - p_pause) * k, p_rec * k, (1 - p_rec) * k, 0, 0, 0, 0)


def test_rates_from_history(portfolio):
    r = cfa.estimate_epoch_rates(portfolio)
    assert (r.evaluations, r.pauses, r.recovered, r.defaulted) == (10, 3, 1, 1)
    assert (r.pause_alpha, r.pause_beta, r.recover_alpha, r.recover_beta) == (4, 8, 2, 2)
    assert math.isclose(r.pause_mean, 1 / 3) and r.recover_mean == 0.5


def test_seeded_runs_are_reproducible(portfolio):
    a = cfa.simulate_default_recovery(portfolio, n_sims=2000, seed=42)
    b = cfa.simulate_default_recovery(portfolio, n_sims=2000, seed=42)
    c = cfa.simulate_default_recovery(portfolio, n_sims=2000, seed=43)
    assert np.array_equal(a.losses, b.losses) and not np.array_equal(a.losses, c.losses)
    assert a.shipment_ids == [sid(1), sid(2)]  # settled and defaulted facilities carry no open exposure
    assert a.defaults.shape == (2000, 2) and a.losses.shape == (2000, 2)


def test_default_probability_matches_the_closed_form(portfolio):
    p, r = 0.3, 0.6
    q = p * (1 - r)  # a milestone ends in default
    res = cfa.simulate_default_recovery(portfolio, n_sims=200_000, seed=1, rates=fixed(p, r), parameter_uncertainty=False, salvage=0.0)
    by = res.by_shipment().set_index("shipment_id")
    # ACTIVE: 3 milestones left
    assert abs(by.loc[sid(1), "default_probability"] - (1 - (1 - q) ** 3)) < 0.005
    # PAUSED today: the pending pause must recover, then 2 milestones
    assert abs(by.loc[sid(2), "default_probability"] - (1 - r * (1 - q) ** 2)) < 0.005
    # ACTIVE expected loss: EAD 8 / 12 / 16 at the 1st / 2nd / 3rd remaining milestone, minus 5 of cover
    el = q * 3 + (1 - q) * q * 7 + (1 - q) ** 2 * q * 11
    assert abs(by.loc[sid(1), "expected_loss"] - el) < 0.03
    # PAUSED: EAD 4 (pending pause), 4 (milestone 1), 8 (milestone 2); no cover
    el2 = (1 - r) * 4 + r * (q * 4 + (1 - q) * q * 8)
    assert abs(by.loc[sid(2), "expected_loss"] - el2) < 0.03


def test_degenerate_cases(portfolio):
    never = cfa.simulate_default_recovery(portfolio, n_sims=500, seed=1, rates=fixed(0.0, 1.0), parameter_uncertainty=False)
    assert never.summary()["expected_loss"] == 0 and not never.defaults.any()
    always = cfa.simulate_default_recovery(portfolio, n_sims=500, seed=1, rates=fixed(1.0, 0.0), parameter_uncertainty=False, salvage=0.0)
    by = always.by_shipment().set_index("shipment_id")
    assert by.loc[sid(1), "default_probability"] == 1 and by.loc[sid(1), "ead_given_default"] == 8
    assert by.loc[sid(1), "expected_loss"] == 3  # 8 drawn - 5 cover
    assert by.loc[sid(2), "expected_loss"] == 4
    s = always.summary()
    assert s["prob_any_default"] == 1 and s["var_99"] == 7 and s["es_99"] == 7


def test_salvage_and_parameter_uncertainty_widen_or_shrink_losses(portfolio):
    base = cfa.simulate_default_recovery(portfolio, n_sims=20_000, seed=3, salvage=0.0)
    salv = cfa.simulate_default_recovery(portfolio, n_sims=20_000, seed=3, salvage=0.5)
    assert math.isclose(salv.summary()["expected_loss"], base.summary()["expected_loss"] * 0.5, rel_tol=1e-9)
    point = cfa.simulate_default_recovery(portfolio, n_sims=20_000, seed=3, parameter_uncertainty=False, salvage=0.0)
    assert base.summary()["loss_std"] > point.summary()["loss_std"] * 0.9
    hist = base.loss_distribution(bins=10)
    assert math.isclose(hist.probability.sum(), 1.0)
    s = base.summary()
    assert s["var_95"] <= s["var_99"] <= s["es_99"] + 1e-9
