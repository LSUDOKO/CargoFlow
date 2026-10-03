

# %% [markdown]
# # Route excursion analysis
#
# Where and on which lanes cargo leaves its temperature band, how far, for how long, and how much the sensors
# disagree while it happens. Uses the per-epoch track (centroid position and min/max temperature per evidence
# epoch) and the epochs' conflict scores; no raw readings are needed (the API only publishes aggregates).

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
pf = cf.portfolio()
print(f"{len(pf)} shipments")

# %% [markdown]
# ## Excursions per lane and cargo band
# An epoch is an excursion when its minimum is below the band or its maximum above it.

# %%
show(cfa.excursion_stats(pf))

# %%
show(cfa.excursion_stats(pf, by=["cargo"]))

# %% [markdown]
# ## The worst epochs

# %%
track = pf.track_frame()
worst = track[track["excursion"]].sort_values("exceedance_c", ascending=False)
show(worst[["shipment_id", "route", "milestone_index", "sequence", "start", "min_temp_c", "max_temp_c", "policy_min_c", "policy_max_c", "exceedance_c", "lat", "lon", "committed"]].head(10))

# %% [markdown]
# ## Sensor conflict
# Conflict is the disagreement between a shipment's sensors in an epoch (basis points). A high conflict next to an
# excursion separates a real temperature event from one faulty probe.

# %%
show(cfa.conflict_distribution(pf, by="route"))

# %%
show(cfa.conflict_histogram(pf))

# %%
ep = pf.epochs_frame()
ep = ep[ep["evaluated"]]
joined = ep.merge(track[["epoch_id", "excursion", "exceedance_c"]], on="epoch_id", how="left")
show(joined.groupby(joined["excursion"].fillna(False))["conflict_bps"].describe())

# %% [markdown]
# ## Per-sensor view of the worst shipment
# `GET /v1/shipments/{id}/telemetry` gives min / mean / max per sensor and epoch.

# %%
if len(worst):
    sid = worst.iloc[0]["shipment_id"]
    tel = cf.telemetry(sid)
    rows = [{"epoch": e.epoch_id[:10], "milestone": e.milestone_index, "sensor": s.sensor_id, "readings": s.readings, "min_c": s.min_temp_x100 / 100, "mean_c": s.mean_temp_x100 / 100, "max_c": s.max_temp_x100 / 100} for e in tel.epochs for s in e.sensors]
    display_df = pd.DataFrame(rows)
else:
    display_df = pd.DataFrame()
show(display_df)

# %%
try:
    import matplotlib

    import matplotlib.pyplot as plt

    fig, ax = plt.subplots(figsize=(6, 4))
    ok = track[~track["excursion"]]
    ax.scatter(ok["lon"], ok["lat"], s=12, c="#7f8c8d", label="in band")
    sc = ax.scatter(worst["lon"], worst["lat"], s=30 + 40 * worst["exceedance_c"], c=worst["exceedance_c"], cmap="Reds", label="excursion")
    if len(worst):
        fig.colorbar(sc, ax=ax, label="exceedance (°C)")
    ax.set_xlabel("longitude")
    ax.set_ylabel("latitude")
    ax.set_title("Where excursions happened (epoch centroids)")
    ax.legend(loc="best")
    fig.tight_layout()
    os.makedirs("output", exist_ok=True)
    fig.savefig(os.path.join("output", "excursion_map.png"), dpi=120)
    show(fig)
    plt.close(fig)
except ImportError:
    print("matplotlib not installed; skipping the chart")
