"""Portfolio analytics over CargoFlow shipments.

Everything here works on a :class:`Portfolio` (fetched with ``CargoFlow().portfolio()``) and returns pandas
DataFrames (``backend="polars"`` for polars). Amounts are converted to USDG (floats) for analysis.

Functions
---------
- :func:`exposure` -- invoice value, committed, drawn, in escrow and covered amounts by shipment status.
- :func:`excursion_stats` -- temperature excursions per route and cargo band, from the per-epoch track.
- :func:`conflict_distribution` / :func:`conflict_histogram` -- the distribution of sensor conflict scores.
- :func:`release_latency` -- time from the approving evidence epoch to the milestone release on chain.
- :func:`recovery_rates` -- pauses and recoveries (resume with proof) per shipment.
- :func:`estimate_epoch_rates` and :func:`simulate_default_recovery` -- a seeded, vectorised Monte Carlo of
  default and recovery driven by historical epoch outcomes (model documented on the function).
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Any, Optional, Sequence

import numpy as np
import pandas as pd

from .frames import Backend, convert, models_to_frame
from .models import Epoch, ShipmentCover, ShipmentView, TrackPoint, usdg

PAUSE = "PAUSE_FACILITY"
ADVANCE = "APPROVE_ADVANCE"
CLOSED_STATUSES = {"SETTLED", "DEFAULTED"}
TOTAL = "TOTAL"


def _ts(seconds: int) -> Optional[pd.Timestamp]:
    return pd.Timestamp(seconds, unit="s", tz="UTC") if seconds else None


@dataclass
class Portfolio:
    """Shipment views with their epochs, tracks and (optionally) cover, keyed by shipment id."""

    views: list[ShipmentView]
    epochs: dict[str, list[Epoch]] = field(default_factory=dict)
    tracks: dict[str, list[TrackPoint]] = field(default_factory=dict)
    covers: dict[str, ShipmentCover] = field(default_factory=dict)

    def __post_init__(self) -> None:
        # keys are the canonical (lower-case) shipment ids the API returns in views
        norm = lambda d: {k.lower(): v for k, v in d.items()}  # noqa: E731
        self.epochs, self.tracks, self.covers = norm(self.epochs), norm(self.tracks), norm(self.covers)

    def __len__(self) -> int:
        return len(self.views)

    def view(self, shipment_id: str) -> ShipmentView:
        for v in self.views:
            if v.id.lower() == shipment_id.lower():
                return v
        raise KeyError(shipment_id)

    # -- frames

    def shipments_frame(self, backend: Backend | str = "pandas"):
        """One row per shipment: parties, route, cargo band, policy, facility amounts (USDG), cover, latest evidence."""
        rows = []
        for v in self.views:
            s, f = v.shipment, v.facility
            dec = v.usdg_decimals
            funded_open = bool(f and f.funded and not f.closed)
            cover = v.cover
            rows.append(
                {
                    "shipment_id": s.id,
                    "external_ref": s.external_ref,
                    "status": s.status,
                    "exporter": s.exporter,
                    "financier": s.financier or (f.financier if f else ""),
                    "buyer": s.buyer,
                    "route": s.route_key,
                    "cargo": s.policy.band,
                    "min_temp_c": s.policy.min_temp_c,
                    "max_temp_c": s.policy.max_temp_c,
                    "max_conflict_bps": s.policy.max_conflict_bps,
                    "min_evidence_score": s.policy.min_evidence_score,
                    "invoice_value": usdg(s.invoice_value, dec),
                    "milestones": len(v.milestones),
                    "milestones_released": sum(m.released for m in v.milestones),
                    "facility_status": f.status if f else None,
                    "committed": usdg(f.committed, dec) if f else 0.0,
                    "drawn": usdg(f.drawn, dec) if f else 0.0,
                    "remaining": usdg(f.remaining, dec) if f else 0.0,
                    "in_escrow": usdg(f.remaining, dec) if funded_open and f else 0.0,
                    "fee_bps": f.fee_bps if f else None,
                    "pause_count": f.pause_count if f else 0,
                    "funded": bool(f and f.funded),
                    "closed": bool(f and f.closed),
                    "cover_status": cover.status if cover else None,
                    "cover_amount": usdg(cover.amount, dec) if cover else 0.0,
                    "latest_score": v.latest_evidence.score if v.latest_evidence else None,
                    "quarantined_readings": v.quarantined_readings,
                    "created_at": s.created_at,
                }
            )
        return convert(pd.DataFrame(rows), backend)

    def epochs_frame(self, backend: Backend | str = "pandas"):
        """One row per evidence epoch, with the shipment's route, cargo band and policy limits."""
        rows = []
        for v in self.views:
            s = v.shipment
            for e in self.epochs.get(s.id.lower(), []):
                d = e.model_dump(mode="python")
                d.update(
                    shipment_id=s.id,
                    status=s.status,
                    route=s.route_key,
                    cargo=s.policy.band,
                    max_conflict_bps_policy=s.policy.max_conflict_bps,
                    evaluated=e.evaluated,
                    start=_ts(e.start_time),
                    end=_ts(e.end_time),
                    duration_s=max(0, e.end_time - e.start_time),
                )
                rows.append(d)
        return convert(pd.DataFrame(rows), backend)

    def track_frame(self, backend: Backend | str = "pandas"):
        """One row per track point with the policy band and how far outside it the epoch went (°C)."""
        rows = []
        for v in self.views:
            s, p = v.shipment, v.shipment.policy
            for t in self.tracks.get(s.id.lower(), []):
                below = max(0, p.min_temp_x100 - t.min_temp_x100) / 100
                above = max(0, t.max_temp_x100 - p.max_temp_x100) / 100
                rows.append(
                    {
                        "shipment_id": s.id,
                        "route": s.route_key,
                        "cargo": s.policy.band,
                        "epoch_id": t.epoch_id,
                        "milestone_index": t.milestone_index,
                        "sequence": t.sequence,
                        "start": _ts(t.start_time),
                        "end": _ts(t.end_time),
                        "duration_s": max(0, t.end_time - t.start_time),
                        "lat": t.lat_e6 / 1e6,
                        "lon": t.lon_e6 / 1e6,
                        "min_temp_c": t.min_temp_x100 / 100,
                        "max_temp_c": t.max_temp_x100 / 100,
                        "policy_min_c": p.min_temp_c,
                        "policy_max_c": p.max_temp_c,
                        "below_c": below,
                        "above_c": above,
                        "exceedance_c": max(below, above),
                        "excursion": below > 0 or above > 0,
                        "pass": t.pass_,
                        "committed": t.committed,
                    }
                )
        return convert(pd.DataFrame(rows), backend)

    def milestones_frame(self, backend: Backend | str = "pandas"):
        rows = []
        for v in self.views:
            for m in v.milestones:
                d = m.model_dump(mode="python")
                d["allocated"] = usdg(m.allocated_usdg, v.usdg_decimals)
                d["shipment_id"] = v.id
                rows.append(d)
        return convert(pd.DataFrame(rows), backend)


# --------------------------------------------------------------------------------------------- exposure


def exposure(portfolio: Portfolio, by: str = "status", backend: Backend | str = "pandas"):
    """Portfolio exposure by ``status`` (or any shipments_frame column, e.g. ``"financier"``, ``"route"``).

    Columns (USDG): ``invoice_value``; ``committed`` (facility size); ``drawn`` (advanced to the exporter);
    ``in_escrow`` (funded in the vault, not yet drawn, on open facilities); ``undrawn`` (committed - drawn);
    ``covered`` (accepted default cover still ACTIVE); ``uncovered_drawn`` (drawn not backed by active cover, the
    loss if every open facility defaulted with nothing recovered); ``share_of_drawn``. A ``TOTAL`` row is appended.
    """
    df = portfolio.shipments_frame()
    cols = ["shipments", "invoice_value", "committed", "drawn", "in_escrow", "undrawn", "covered", "uncovered_drawn", "share_of_drawn"]
    if df.empty:
        return convert(pd.DataFrame(columns=[by, *cols]).set_index(by), backend)
    df["undrawn"] = (df["committed"] - df["drawn"]).clip(lower=0)
    active_cover = np.where(df["cover_status"].eq("ACTIVE"), df["cover_amount"], 0.0)
    df["covered"] = active_cover
    open_drawn = np.where(df["status"].isin(CLOSED_STATUSES), 0.0, df["drawn"])
    df["uncovered_drawn"] = np.clip(open_drawn - active_cover, 0, None)
    g = df.groupby(by, dropna=False).agg(
        shipments=("shipment_id", "count"),
        invoice_value=("invoice_value", "sum"),
        committed=("committed", "sum"),
        drawn=("drawn", "sum"),
        in_escrow=("in_escrow", "sum"),
        undrawn=("undrawn", "sum"),
        covered=("covered", "sum"),
        uncovered_drawn=("uncovered_drawn", "sum"),
    )
    total = g.sum(numeric_only=True)
    g.loc[TOTAL] = total
    drawn_total = total["drawn"]
    g["share_of_drawn"] = g["drawn"] / drawn_total if drawn_total else 0.0
    g["shipments"] = g["shipments"].astype(int)
    return convert(g[cols], backend)


# --------------------------------------------------------------------------------------------- excursions


def excursion_stats(portfolio: Portfolio, by: Sequence[str] = ("route", "cargo"), backend: Backend | str = "pandas"):
    """Temperature excursions per group (default: route x cargo band), from each epoch's min/max temperature.

    An epoch is an excursion when its minimum is below the shipment's band or its maximum above it; the exceedance
    is how far outside, in °C. Columns: ``shipments``, ``epochs``, ``excursion_epochs``, ``excursion_rate`` (share
    of epochs), ``shipments_with_excursion``, ``shipment_excursion_rate``, ``mean_exceedance_c`` (over excursion
    epochs), ``max_exceedance_c``, ``excursion_minutes`` (duration of excursion epochs) and
    ``committed_excursions`` (excursion epochs committed on chain).
    """
    t = portfolio.track_frame()
    by = list(by)
    cols = ["shipments", "epochs", "excursion_epochs", "excursion_rate", "shipments_with_excursion", "shipment_excursion_rate", "mean_exceedance_c", "max_exceedance_c", "excursion_minutes", "committed_excursions"]
    if t.empty:
        return convert(pd.DataFrame(columns=by + cols).set_index(by), backend)
    t["exc_exceedance"] = t["exceedance_c"].where(t["excursion"])
    t["exc_minutes"] = np.where(t["excursion"], t["duration_s"] / 60, 0.0)
    t["committed_exc"] = t["excursion"] & t["committed"]
    per_ship = t.groupby(by + ["shipment_id"])["excursion"].any().reset_index()
    g = t.groupby(by).agg(
        shipments=("shipment_id", "nunique"),
        epochs=("epoch_id", "count"),
        excursion_epochs=("excursion", "sum"),
        mean_exceedance_c=("exc_exceedance", "mean"),
        max_exceedance_c=("exceedance_c", "max"),
        excursion_minutes=("exc_minutes", "sum"),
        committed_excursions=("committed_exc", "sum"),
    )
    g["shipments_with_excursion"] = per_ship.groupby(by)["excursion"].sum()
    g["excursion_rate"] = g["excursion_epochs"] / g["epochs"]
    g["shipment_excursion_rate"] = g["shipments_with_excursion"] / g["shipments"]
    for c in ("excursion_epochs", "shipments_with_excursion", "committed_excursions"):
        g[c] = g[c].astype(int)
    return convert(g[cols].sort_values("excursion_rate", ascending=False), backend)


# --------------------------------------------------------------------------------------------- conflicts


def conflict_distribution(
    portfolio: Portfolio,
    by: Optional[str | Sequence[str]] = None,
    quantiles: Sequence[float] = (0.5, 0.9, 0.95, 0.99),
    evaluated_only: bool = True,
    backend: Backend | str = "pandas",
):
    """Distribution of epoch conflict scores (basis points of disagreement between sensors).

    Per group (or overall): ``epochs``, ``mean_bps``, ``std_bps``, the requested quantiles (``p50`` ...), ``max_bps``
    and ``share_above_policy`` (epochs whose conflict exceeded the shipment's ``maxConflictBps``).
    """
    e = portfolio.epochs_frame()
    qcols = [f"p{round(q * 100):d}" for q in quantiles]
    cols = ["epochs", "mean_bps", "std_bps", *qcols, "max_bps", "share_above_policy"]
    if e.empty:
        return convert(pd.DataFrame(columns=cols), backend)
    if evaluated_only:
        e = e[e["evaluated"]]
    e = e.assign(above=e["conflict_bps"] > e["max_conflict_bps_policy"], _all="all")
    keys = [by] if isinstance(by, str) else list(by) if by else ["_all"]

    def summarize(x: pd.DataFrame) -> pd.Series:
        c = x["conflict_bps"].to_numpy(dtype=float)
        out = {"epochs": len(c), "mean_bps": c.mean(), "std_bps": c.std(ddof=1) if len(c) > 1 else 0.0}
        for q, name in zip(quantiles, qcols):
            out[name] = float(np.quantile(c, q))
        out["max_bps"] = c.max()
        out["share_above_policy"] = float(x["above"].mean())
        return pd.Series(out)

    g = e.groupby(keys)[["conflict_bps", "above"]].apply(summarize)
    g["epochs"] = g["epochs"].astype(int)
    if keys == ["_all"]:
        g.index = pd.Index(["all"], name="group")
    return convert(g[cols], backend)


def conflict_histogram(portfolio: Portfolio, bins: Sequence[int] = (0, 250, 500, 1000, 2000, 3000, 5000, 7500, 10001), backend: Backend | str = "pandas"):
    """Counts of evaluated epochs per conflict band (``[lo, hi)`` bps) and their share."""
    e = portfolio.epochs_frame()
    edges = np.asarray(bins)
    labels = [f"{lo}-{hi - 1}" for lo, hi in zip(edges[:-1], edges[1:])]
    if e.empty:
        return convert(pd.DataFrame({"band": labels, "epochs": 0, "share": 0.0}), backend)
    c = e.loc[e["evaluated"], "conflict_bps"].to_numpy()
    counts, _ = np.histogram(c, bins=edges)
    df = pd.DataFrame({"band": labels, "epochs": counts, "share": counts / max(1, counts.sum())})
    return convert(df, backend)


# --------------------------------------------------------------------------------------------- release latency


def release_latency(portfolio: Portfolio, backend: Backend | str = "pandas"):
    """Seconds from the approving evidence epoch to the milestone's release on chain.

    For each released milestone, the approving epoch is the latest ``APPROVE_ADVANCE`` epoch for that milestone
    created at or before the release. Columns: ``shipment_id``, ``milestone_index``, ``epoch_id``,
    ``evidence_at``, ``released_at``, ``latency_s``. Use ``.latency_s.describe()`` for the summary.
    """
    rows = []
    for v in portfolio.views:
        eps = portfolio.epochs.get(v.id.lower(), [])
        for m in v.milestones:
            if not m.released_at:
                continue
            cands = [e for e in eps if e.milestone_index == m.index and e.decision_action == ADVANCE and e.created_at and e.created_at <= m.released_at]
            if not cands:
                continue
            e = max(cands, key=lambda x: x.created_at)  # type: ignore[arg-type,return-value]
            rows.append(
                {
                    "shipment_id": v.id,
                    "route": v.shipment.route_key,
                    "milestone_index": m.index,
                    "epoch_id": e.epoch_id,
                    "evidence_at": e.created_at,
                    "released_at": m.released_at,
                    "latency_s": (m.released_at - e.created_at).total_seconds(),  # type: ignore[operator]
                }
            )
    cols = ["shipment_id", "route", "milestone_index", "epoch_id", "evidence_at", "released_at", "latency_s"]
    return convert(pd.DataFrame(rows, columns=cols), backend)


# --------------------------------------------------------------------------------------------- recoveries


@dataclass
class PauseEvent:
    shipment_id: str
    milestone_index: int
    paused_at: Optional[datetime]
    outcome: str  # "recovered", "defaulted" or "open"
    recovered_at: Optional[datetime] = None
    with_proof: bool = False


def pause_events(portfolio: Portfolio) -> list[PauseEvent]:
    """Every ``PAUSE_FACILITY`` epoch and what followed: recovered (a later passing ``APPROVE_ADVANCE`` epoch for
    the same milestone), defaulted (shipment DEFAULTED without such an epoch) or open (still paused / no outcome)."""
    out = []
    for v in portfolio.views:
        eps = sorted(portfolio.epochs.get(v.id.lower(), []), key=lambda e: (e.created_at or datetime.min.replace(tzinfo=timezone.utc), e.sequence))
        for i, e in enumerate(eps):
            if e.decision_action != PAUSE:
                continue
            nxt = next((x for x in eps[i + 1 :] if x.milestone_index == e.milestone_index and x.decision_action == ADVANCE and x.decision_pass), None)
            if nxt:
                out.append(PauseEvent(v.id, e.milestone_index, e.created_at, "recovered", nxt.created_at, nxt.proof_verified))
            elif v.shipment.status == "DEFAULTED":
                out.append(PauseEvent(v.id, e.milestone_index, e.created_at, "defaulted"))
            else:
                out.append(PauseEvent(v.id, e.milestone_index, e.created_at, "open"))
    return out


def recovery_rates(portfolio: Portfolio, by: Optional[str] = None, backend: Backend | str = "pandas"):
    """Pauses and their outcomes per shipment (or per ``route`` / ``cargo`` / ``exporter`` with ``by``).

    ``recovery_rate`` = recovered / (recovered + defaulted): open pauses are censored, not counted as failures.
    ``mean_time_to_recovery_s`` is measured from the pausing epoch to the recovering epoch. A ``TOTAL`` row is added.
    """
    ev = pause_events(portfolio)
    meta = {v.id: {"route": v.shipment.route_key, "cargo": v.shipment.policy.band, "exporter": v.shipment.exporter, "status": v.shipment.status} for v in portfolio.views}
    key = by or "shipment_id"
    cols = ["pauses", "recovered", "defaulted", "open", "recovery_rate", "with_proof", "mean_time_to_recovery_s"]
    if not ev:
        return convert(pd.DataFrame(columns=[key, *cols]).set_index(key), backend)
    df = pd.DataFrame(
        [
            {
                "shipment_id": x.shipment_id,
                **meta.get(x.shipment_id, {}),
                "outcome": x.outcome,
                "with_proof": x.with_proof,
                "ttr_s": (x.recovered_at - x.paused_at).total_seconds() if x.recovered_at and x.paused_at else np.nan,
            }
            for x in ev
        ]
    )

    def agg(x: pd.DataFrame) -> pd.Series:
        rec = int((x["outcome"] == "recovered").sum())
        dft = int((x["outcome"] == "defaulted").sum())
        return pd.Series(
            {
                "pauses": len(x),
                "recovered": rec,
                "defaulted": dft,
                "open": int((x["outcome"] == "open").sum()),
                "recovery_rate": rec / (rec + dft) if rec + dft else np.nan,
                "with_proof": int(x["with_proof"].sum()),
                "mean_time_to_recovery_s": x["ttr_s"].mean(),
            }
        )

    g = df.groupby(key)[["outcome", "with_proof", "ttr_s"]].apply(agg)
    g.loc[TOTAL] = agg(df)
    for c in ("pauses", "recovered", "defaulted", "open", "with_proof"):
        g[c] = g[c].astype(int)
    return convert(g[cols], backend)


# --------------------------------------------------------------------------------------------- Monte Carlo


@dataclass
class EpochRates:
    """Beta posteriors of the two probabilities that drive :func:`simulate_default_recovery`.

    ``pause``: probability that a milestone's evidence evaluation pauses the facility, from evaluated epochs
    (``APPROVE_ADVANCE`` vs ``PAUSE_FACILITY``). ``recover``: probability that a pause is recovered, from resolved
    pauses (recovered vs defaulted; open pauses are censored). Both start from a ``Beta(prior)`` prior.
    """

    pause_alpha: float
    pause_beta: float
    recover_alpha: float
    recover_beta: float
    evaluations: int
    pauses: int
    recovered: int
    defaulted: int

    @property
    def pause_mean(self) -> float:
        return self.pause_alpha / (self.pause_alpha + self.pause_beta)

    @property
    def recover_mean(self) -> float:
        return self.recover_alpha / (self.recover_alpha + self.recover_beta)


def estimate_epoch_rates(portfolio: Portfolio, prior: tuple[float, float] = (1.0, 1.0)) -> EpochRates:
    """Counts historical epoch outcomes and returns the Beta posteriors (conjugate update of ``prior``)."""
    n_eval = n_pause = 0
    for eps in portfolio.epochs.values():
        for e in eps:
            if not e.evaluated:
                continue
            if e.decision_action == PAUSE:
                n_eval += 1
                n_pause += 1
            elif e.decision_action == ADVANCE:
                n_eval += 1
    ev = pause_events(portfolio)
    rec = sum(x.outcome == "recovered" for x in ev)
    dft = sum(x.outcome == "defaulted" for x in ev)
    a, b = prior
    return EpochRates(a + n_pause, b + n_eval - n_pause, a + rec, b + dft, n_eval, n_pause, rec, dft)


@dataclass
class MonteCarloResult:
    shipment_ids: list[str]
    n_sims: int
    seed: Optional[int]
    rates: EpochRates
    defaults: np.ndarray  # (S, N) bool
    ead: np.ndarray  # (S, N) exposure at default, USDG (0 where no default)
    losses: np.ndarray  # (S, N) loss after cover and salvage, USDG
    exposure_now: np.ndarray  # (N,) drawn today, USDG
    params: dict[str, Any] = field(default_factory=dict)

    @property
    def portfolio_losses(self) -> np.ndarray:
        """(S,) total loss per simulated scenario."""
        return self.losses.sum(axis=1)

    def var(self, level: float = 0.99) -> float:
        """Value at risk: the ``level`` quantile of the portfolio loss."""
        return float(np.quantile(self.portfolio_losses, level)) if self.n_sims else 0.0

    def expected_shortfall(self, level: float = 0.99) -> float:
        """Mean portfolio loss in the worst ``1 - level`` of scenarios."""
        pl = self.portfolio_losses
        if not len(pl):
            return 0.0
        tail = pl[pl >= np.quantile(pl, level)]
        return float(tail.mean()) if len(tail) else 0.0

    def summary(self) -> dict[str, float]:
        pl = self.portfolio_losses
        return {
            "shipments": float(len(self.shipment_ids)),
            "simulations": float(self.n_sims),
            "exposure_now": float(self.exposure_now.sum()),
            "expected_defaults": float(self.defaults.sum(axis=1).mean()) if self.n_sims else 0.0,
            "prob_any_default": float(self.defaults.any(axis=1).mean()) if self.n_sims else 0.0,
            "expected_loss": float(pl.mean()) if self.n_sims else 0.0,
            "loss_std": float(pl.std(ddof=1)) if self.n_sims > 1 else 0.0,
            "var_95": self.var(0.95),
            "var_99": self.var(0.99),
            "es_95": self.expected_shortfall(0.95),
            "es_99": self.expected_shortfall(0.99),
            "pause_prob_mean": self.rates.pause_mean,
            "recover_prob_mean": self.rates.recover_mean,
        }

    def by_shipment(self, backend: Backend | str = "pandas"):
        """Per shipment: default probability, exposure today, expected exposure at default (given default),
        expected loss and its 99th percentile."""
        d = self.defaults
        n_def = d.sum(axis=0)
        with np.errstate(invalid="ignore", divide="ignore"):
            ead_given = np.where(n_def > 0, self.ead.sum(axis=0) / np.maximum(n_def, 1), np.nan)
        df = pd.DataFrame(
            {
                "shipment_id": self.shipment_ids,
                "exposure_now": self.exposure_now,
                "default_probability": d.mean(axis=0) if self.n_sims else 0.0,
                "ead_given_default": ead_given,
                "expected_loss": self.losses.mean(axis=0) if self.n_sims else 0.0,
                "loss_p99": np.quantile(self.losses, 0.99, axis=0) if self.n_sims else 0.0,
            }
        )
        return convert(df.sort_values("expected_loss", ascending=False).reset_index(drop=True), backend)

    def to_frame(self, backend: Backend | str = "pandas"):
        return self.by_shipment(backend)

    def loss_distribution(self, bins: int = 50, backend: Backend | str = "pandas"):
        """Histogram of portfolio losses (``loss_lo``, ``loss_hi``, ``probability``)."""
        pl = self.portfolio_losses
        hi = float(pl.max()) if len(pl) and pl.max() > 0 else 1.0
        counts, edges = np.histogram(pl, bins=bins, range=(0.0, hi))
        return convert(pd.DataFrame({"loss_lo": edges[:-1], "loss_hi": edges[1:], "probability": counts / max(1, len(pl))}), backend)


def simulate_default_recovery(
    portfolio: Portfolio,
    n_sims: int = 10_000,
    seed: Optional[int] = 7,
    rates: Optional[EpochRates] = None,
    prior: tuple[float, float] = (1.0, 1.0),
    salvage: tuple[float, float] | float = (2.0, 5.0),
    parameter_uncertainty: bool = True,
) -> MonteCarloResult:
    """Monte Carlo of default and recovery for the open facilities of a portfolio.

    Model
    -----
    Each open facility (shipment not SETTLED / DEFAULTED, with a facility) still has ``R`` milestones to pass,
    with tranche sizes ``A_1..A_R`` (their allocations) and ``D`` already drawn. Every remaining milestone is an
    evidence evaluation:

    1. with probability ``p_pause`` the evaluation pauses the facility;
    2. a pause is recovered (resume with proof, then the tranche is released) with probability ``p_recover``;
       otherwise the facility defaults at that milestone.

    A facility that is PAUSED today starts with that pending pause. Exposure at default is what was drawn before
    the failing milestone: ``EAD = D + A_1 + ... + A_(k-1)``. On default the accepted cover pays up to its amount
    (``min(cover, EAD)``, ACTIVE covers only) and a salvage fraction of the rest is recovered (cargo resale,
    collections), ``salvage ~ Beta(a, b)`` per default (default ``Beta(2, 5)``, mean 29%; a float fixes it).
    ``loss = EAD - cover payout - salvage x (EAD - cover payout)``.

    ``p_pause`` and ``p_recover`` come from the historical epochs (:func:`estimate_epoch_rates`): with
    ``parameter_uncertainty`` each simulation draws them from their Beta posteriors, so a thin history widens the
    loss distribution instead of hiding behind a point estimate; without it the posterior means are used.

    Simplifications (stated so they can be challenged): milestones are independent given the rates; one pause per
    milestone; settlement risk after delivery, disputes and fees are not modelled; amounts are USDG.

    Everything is vectorised over a ``(n_sims, shipments, milestones)`` array and seeded with
    ``numpy.random.default_rng(seed)``, so a run is reproducible.
    """
    rng = np.random.default_rng(seed)
    rates = rates or estimate_epoch_rates(portfolio, prior)

    open_views = [v for v in portfolio.views if v.facility is not None and v.shipment.status not in CLOSED_STATUSES and not v.facility.closed]
    ids = [v.id for v in open_views]
    n, s = len(open_views), int(n_sims)
    remaining = [[usdg(m.allocated_usdg, v.usdg_decimals) for m in sorted(v.milestones, key=lambda m: m.index) if m.index >= v.facility.next_milestone] for v in open_views]  # type: ignore[union-attr]
    k_max = max((len(r) for r in remaining), default=0)
    tranches = np.zeros((n, k_max))
    valid = np.zeros((n, k_max), dtype=bool)
    for i, r in enumerate(remaining):
        tranches[i, : len(r)] = r
        valid[i, : len(r)] = True
    drawn = np.array([usdg(v.facility.drawn, v.usdg_decimals) for v in open_views], dtype=float)  # type: ignore[union-attr]
    paused_now = np.array([v.shipment.status == "PAUSED" or v.facility.status == "PAUSED" for v in open_views], dtype=bool)  # type: ignore[union-attr]
    cover = np.array(
        [usdg(v.cover.amount, v.usdg_decimals) if v.cover and v.cover.status == "ACTIVE" else 0.0 for v in open_views],
        dtype=float,
    )

    if parameter_uncertainty:
        p_pause = rng.beta(rates.pause_alpha, rates.pause_beta, size=s)
        p_rec = rng.beta(rates.recover_alpha, rates.recover_beta, size=s)
    else:
        p_pause = np.full(s, rates.pause_mean)
        p_rec = np.full(s, rates.recover_mean)

    # column 0 is the pending pause of facilities paused today; columns 1.. are the remaining milestones
    pause = np.zeros((s, n, k_max + 1), dtype=bool)
    pause[:, :, 0] = paused_now[None, :]
    pause[:, :, 1:] = (rng.random((s, n, k_max)) < p_pause[:, None, None]) & valid[None, :, :]
    recovered = rng.random((s, n, k_max + 1)) < p_rec[:, None, None]
    failure = pause & ~recovered
    defaults = failure.any(axis=2)
    first = np.argmax(failure, axis=2)  # index of the first unrecovered pause (0 when none; masked below)
    # drawn before column j: D + sum of tranches before milestone j (column j >= 1 is milestone j-1)
    before = np.concatenate([np.zeros((n, 2)), np.cumsum(tranches, axis=1)[:, :-1]], axis=1) if k_max else np.zeros((n, 1))
    ead = drawn[None, :] + np.take_along_axis(np.broadcast_to(before, (s, n, before.shape[1])), first[:, :, None], axis=2)[:, :, 0]
    ead = np.where(defaults, ead, 0.0)

    covered = np.minimum(ead, cover[None, :])
    rest = ead - covered
    if isinstance(salvage, (int, float)):
        frac = np.full((s, n), float(salvage))
    else:
        frac = rng.beta(salvage[0], salvage[1], size=(s, n))
    losses = np.where(defaults, rest * (1.0 - frac), 0.0)

    return MonteCarloResult(
        shipment_ids=ids,
        n_sims=s,
        seed=seed,
        rates=rates,
        defaults=defaults,
        ead=ead,
        losses=losses,
        exposure_now=drawn,
        params={"salvage": salvage, "prior": prior, "parameter_uncertainty": parameter_uncertainty},
    )


__all__ = [
    "Portfolio",
    "exposure",
    "excursion_stats",
    "conflict_distribution",
    "conflict_histogram",
    "release_latency",
    "PauseEvent",
    "pause_events",
    "recovery_rates",
    "EpochRates",
    "estimate_epoch_rates",
    "MonteCarloResult",
    "simulate_default_recovery",
    "models_to_frame",
]
