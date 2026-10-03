

# %% [markdown]
# # Portfolio risk review
#
# A financier's weekly review of a CargoFlow book, from the public read API only: what is committed, drawn and
# sitting in escrow, how the evidence pipeline has behaved (pauses, recoveries, release latency), and a Monte Carlo
# of default and recovery driven by the historical epoch outcomes.
#
# Run it as a notebook (`jupyter nbconvert --to notebook --execute portfolio_risk_review.ipynb`) or as a script
# (`python portfolio_risk_review.py`). Set `CARGOFLOW_API_URL` to point at another deployment.

# %%
import os

import pandas as pd

from cargoflow import CargoFlow
from cargoflow import analytics as cfa

try:  # rich tables in Jupyter, plain text when run as a script
    from IPython.display import display as show
except ImportError:
    show = print

pd.set_option("display.width", 160)
pd.set_option("display.max_columns", 20)
pd.set_option("display.float_format", lambda x: f"{x:,.2f}")

API = os.environ.get("CARGOFLOW_API_URL", "https://cargoflow-api-75ul.onrender.com")
cf = CargoFlow(API, timeout=90, retries=4, backoff=2)
print(cf.health())
print(cf.stats())

# %% [markdown]
# ## The book
# `portfolio()` fetches every shipment's view, epochs and per-epoch track concurrently.

# %%
pf = cf.portfolio()
ships = pf.shipments_frame()
show(ships[["external_ref", "status", "route", "cargo", "invoice_value", "committed", "drawn", "in_escrow", "milestones_released", "milestones", "latest_score"]])

# %% [markdown]
# ## Exposure
# USDG. `in_escrow` is funded in the vault but not yet drawn on open facilities; `uncovered_drawn` is what the
# financier would lose if every open facility defaulted and nothing were recovered beyond accepted cover.

# %%
show(cfa.exposure(pf))

# %%
show(cfa.exposure(pf, by="cargo"))

# %% [markdown]
# ## Counterparties
# Each exporter's track record across the platform (`GET /v1/parties/{address}`).

# %%
rows = []
for addr in sorted(set(ships["exporter"])):
    p = cf.party(addr)
    rows.append({"exporter": addr, "grade": p.grade, "shipments": p.exporter.shipments, "settled": p.exporter.settled, "paused": p.exporter.paused, "defaulted": p.exporter.defaulted, "recoveries": p.exporter.recoveries, "avg_evidence_score": p.exporter.avg_evidence_score, "volume_usdg": p.exporter.volume / 1e6})
show(pd.DataFrame(rows))

# %% [markdown]
# ## Evidence pipeline behaviour
# Pauses and their outcomes (open pauses are censored, not counted as failures) and the time from the approving
# evidence epoch to the milestone release on chain.

# %%
show(cfa.recovery_rates(pf))

# %%
lat = cfa.release_latency(pf)
show(lat["latency_s"].describe())

# %% [markdown]
# ## Monte Carlo of default and recovery
# The two driving probabilities come from history: a milestone evaluation pauses the facility with `p_pause`, a
# pause is recovered with `p_recover`. Each simulation draws both from their Beta posteriors (so a short history
# widens the distribution), walks every open facility through its remaining milestones, and books
# `EAD - cover - salvage` on default. See `cfa.simulate_default_recovery` for the full model.

# %%
rates = cfa.estimate_epoch_rates(pf)
print(f"evaluations={rates.evaluations} pauses={rates.pauses} recovered={rates.recovered} defaulted={rates.defaulted}")
print(f"p_pause ~ Beta({rates.pause_alpha:g}, {rates.pause_beta:g}), mean {rates.pause_mean:.1%}")
print(f"p_recover ~ Beta({rates.recover_alpha:g}, {rates.recover_beta:g}), mean {rates.recover_mean:.1%}")

mc = cfa.simulate_default_recovery(pf, n_sims=20_000, seed=2026)
show(pd.Series(mc.summary()))

# %%
show(mc.by_shipment().merge(ships[["shipment_id", "external_ref", "status"]], on="shipment_id"))

# %% [markdown]
# ### Sensitivity
# How the tail moves with the salvage assumption and with a more sceptical prior on recoveries.

# %%
scenarios = {
    "base (salvage Beta(2,5))": dict(),
    "no salvage": dict(salvage=0.0),
    "salvage 60%": dict(salvage=0.6),
    "sceptical prior Beta(1,3)": dict(prior=(1.0, 3.0)),
    "posterior means only": dict(parameter_uncertainty=False),
}
sens = pd.DataFrame({name: cfa.simulate_default_recovery(pf, n_sims=20_000, seed=2026, **kw).summary() for name, kw in scenarios.items()}).T
show(sens[["prob_any_default", "expected_loss", "var_95", "var_99", "es_99"]])

# %%
try:
    import matplotlib

    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(7, 3.2))
    ax.hist(mc.portfolio_losses, bins=40, color="#2f6db5")
    ax.axvline(mc.var(0.99), color="#c0392b", linestyle="--", label=f"VaR 99% = {mc.var(0.99):,.2f}")
    ax.set_xlabel("portfolio loss (USDG)")
    ax.set_ylabel("scenarios")
    ax.set_title("Simulated loss distribution")
    ax.legend()
    fig.tight_layout()
    os.makedirs("output", exist_ok=True)
    fig.savefig(os.path.join("output", "loss_distribution.png"), dpi=120)
    show(fig)
    plt.close(fig)
except ImportError:
    print("matplotlib not installed; skipping the chart")
