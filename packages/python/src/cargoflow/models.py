"""Typed models of the CargoFlow API's read endpoints.

Field names are snake_case in Python and camelCase on the wire (``external_ref`` <-> ``externalRef``). Amounts are
USDG base units (6 decimals) as ``int``; the API sends them as decimal strings so no precision is lost. Temperatures
are hundredths of a degree Celsius (``*_x100``), positions micro-degrees (``*_e6``), shares basis points
(``*_bps``). Unknown fields are kept (``model_extra``) so newer API versions never break older clients.
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Generic, Iterable, Optional, TypeVar

from pydantic import BaseModel, BeforeValidator, ConfigDict, Field
from pydantic.alias_generators import to_camel

USDG_DECIMALS = 6


def _to_int(v: Any) -> int:
    if v is None or v == "":
        return 0
    if isinstance(v, bool):
        raise ValueError("expected an amount, got a boolean")
    return int(v)


BaseUnits = Annotated[int, BeforeValidator(_to_int)]
"""USDG base units (1 USDG = 10**6)."""


def usdg(amount: int, decimals: int = USDG_DECIMALS) -> float:
    """Base units -> USDG as a float (for analysis; keep ints for accounting)."""
    return amount / 10**decimals


class Model(BaseModel):
    model_config = ConfigDict(alias_generator=to_camel, populate_by_name=True, extra="allow", frozen=False)


class Health(Model):
    status: str
    chain_id: int = 0
    database: str = ""
    head_block: int = 0


class Stats(Model):
    shipments: dict[str, int] = Field(default_factory=dict)
    """count of shipments by status"""
    total: int = 0
    epochs_committed: int = 0
    proofs_verified: int = 0


class Policy(Model):
    min_temp_x100: int
    max_temp_x100: int
    max_gap_sec: int = 0
    max_route_deviation_m: int = 0
    min_evidence_score: int = 0
    max_conflict_bps: int = 0
    max_risk_bps: int = 0
    requires_zk: bool = False
    min_sensors: int = 1

    @property
    def min_temp_c(self) -> float:
        return self.min_temp_x100 / 100

    @property
    def max_temp_c(self) -> float:
        return self.max_temp_x100 / 100

    @property
    def band(self) -> str:
        """The cargo's temperature band, e.g. ``"2 to 8°C"`` (used to group cargo types)."""
        return f"{self.min_temp_c:g} to {self.max_temp_c:g}°C"


class RoutePoint(Model):
    lat_e6: int
    lon_e6: int

    @property
    def lat(self) -> float:
        return self.lat_e6 / 1e6

    @property
    def lon(self) -> float:
        return self.lon_e6 / 1e6


class Shipment(Model):
    id: str
    external_ref: str = ""
    exporter: str = ""
    buyer: str = ""
    financier: str = ""
    invoice_hash: str = ""
    route_commitment: str = ""
    policy_commitment: str = ""
    invoice_value: BaseUnits = 0
    policy: Policy
    route: list[RoutePoint] = Field(default_factory=list)
    place_labels: Optional[list[str]] = None
    status: str = ""
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    @property
    def route_key(self) -> str:
        """Origin -> destination, by place label when known, else by coordinates rounded to 0.1°."""
        labels = [x for x in (self.place_labels or []) if x]
        if len(labels) >= 2:
            return f"{labels[0]} -> {labels[-1]}"
        if len(self.route) >= 2:
            a, b = self.route[0], self.route[-1]
            return f"{a.lat:.1f},{a.lon:.1f} -> {b.lat:.1f},{b.lon:.1f}"
        return "unknown"


class Milestone(Model):
    index: int
    description: str = ""
    allocated_usdg: BaseUnits = 0
    evidence_threshold: int = 0
    checkpoint_commitment: str = ""
    lat_e6: int = 0
    lon_e6: int = 0
    radius_m: int = 0
    place_label: str = ""
    released: bool = False
    release_tx_hash: Optional[str] = None
    released_at: Optional[datetime] = None


class Facility(Model):
    status: str
    exporter: str = ""
    financier: str = ""
    buyer: str = ""
    committed: BaseUnits = 0
    drawn: BaseUnits = 0
    remaining: BaseUnits = 0
    fee_bps: int = 0
    next_milestone: int = 0
    milestone_count: int = 0
    paused_at: int = 0
    pause_reason: Optional[str] = None
    pause_count: int = 0
    funded: bool = False
    vault_paused: bool = False
    closed: bool = False


class Epoch(Model):
    """One evidence epoch: the evaluated aggregate of a window of readings and the decision taken on it."""

    sequence: int
    milestone_index: int
    """255 means observed but not evaluated against a milestone (e.g. while the facility was paused)"""
    epoch_id: str
    root: str = ""
    reading_count: int = 0
    start_time: int = 0
    end_time: int = 0
    score: int = 0
    conflict_bps: int = 0
    risk_bps: int = 0
    compliant: bool = True
    penalties: dict[str, int] = Field(default_factory=dict)
    decision_pass: bool = True
    decision_action: str = ""
    reasons: list[str] = Field(default_factory=list)
    commit_tx: Optional[str] = None
    proof_verified: bool = False
    created_at: Optional[datetime] = None
    lat_e6: int = 0
    lon_e6: int = 0
    max_humidity_x100: int = 0
    max_shock_x100: int = 0
    held_distance_m: Optional[int] = None

    @property
    def evaluated(self) -> bool:
        return self.milestone_index != 255


class CoverOffer(Model):
    insurer: str
    amount: BaseUnits = 0
    premium_bps: int = 0
    created_at: Optional[datetime] = None


class Cover(Model):
    insurer: str
    financier: str = ""
    amount: BaseUnits = 0
    premium: BaseUnits = 0
    status: str = ""
    """ACTIVE, RELEASED (settled) or CLAIMED (defaulted)"""
    financier_payout: BaseUnits = 0
    insurer_return: BaseUnits = 0


class ShipmentCover(Model):
    offers: list[CoverOffer] = Field(default_factory=list)
    cover: Optional[Cover] = None


class ShipmentView(Model):
    """``GET /v1/shipments/{id}``: the store record plus live chain state."""

    shipment: Shipment
    milestones: list[Milestone] = Field(default_factory=list)
    facility: Optional[Facility] = None
    latest_evidence: Optional[Epoch] = None
    quarantined_readings: int = 0
    usdg_decimals: int = USDG_DECIMALS
    cover: Optional[Cover] = None
    open_cover_offers: int = 0

    @property
    def id(self) -> str:
        return self.shipment.id


class TrackPoint(Model):
    epoch_id: str
    milestone_index: int = 0
    sequence: int = 0
    start_time: int = 0
    end_time: int = 0
    lat_e6: int = 0
    lon_e6: int = 0
    min_temp_x100: int = 0
    max_temp_x100: int = 0
    max_humidity_x100: int = 0
    max_shock_x100: int = 0
    pass_: bool = Field(default=True, alias="pass")
    committed: bool = False


class AuditEntry(Model):
    time: datetime
    kind: str
    """chain_event, monitoring, epoch or action"""
    title: str
    tx_hash: Optional[str] = None
    detail: dict[str, Any] = Field(default_factory=dict)


class SensorAggregate(Model):
    sensor_id: str
    readings: int = 0
    min_temp_x100: int = 0
    max_temp_x100: int = 0
    mean_temp_x100: int = 0


class EpochTelemetry(Model):
    epoch_id: str
    milestone_index: int = 0
    start_time: int = 0
    end_time: int = 0
    sensors: list[SensorAggregate] = Field(default_factory=list)


class Position(Model):
    lat_e6: int = 0
    lon_e6: int = 0
    timestamp: int = 0


class TelemetrySummary(Model):
    epochs: list[EpochTelemetry] = Field(default_factory=list)
    position: Optional[Position] = None


class GatewaySource(Model):
    id: str
    shipment_id: str = ""
    label: str = ""
    public_key: str = ""
    sensor_ids: list[str] = Field(default_factory=list)
    created_at: Optional[datetime] = None


class ExporterStats(Model):
    shipments: int = 0
    settled: int = 0
    active: int = 0
    paused: int = 0
    disputed: int = 0
    defaulted: int = 0
    recoveries: int = 0
    avg_evidence_score: Optional[float] = None
    volume: BaseUnits = 0


class FinancierStats(Model):
    facilities: int = 0
    committed: BaseUnits = 0
    drawn: BaseUnits = 0
    in_escrow: BaseUnits = 0
    fees_earned: BaseUnits = 0
    settled: int = 0
    defaulted: int = 0


class BuyerStats(Model):
    shipments: int = 0
    settled: int = 0
    paid_volume: BaseUnits = 0


class InsurerStats(Model):
    offered: int = 0
    active: int = 0
    released: int = 0
    claimed: int = 0
    cover_written: BaseUnits = 0
    premiums_earned: BaseUnits = 0
    paid_out: BaseUnits = 0


class Party(Model):
    """``GET /v1/parties/{address}``: an address's track record in every role."""

    address: str
    exporter: ExporterStats = Field(default_factory=ExporterStats)
    financier: FinancierStats = Field(default_factory=FinancierStats)
    buyer: BuyerStats = Field(default_factory=BuyerStats)
    insurer: InsurerStats = Field(default_factory=InsurerStats)
    since: Optional[datetime] = None
    grade: str = ""


class Offer(Model):
    id: str
    financier: str = ""
    fee_bps: int = 0
    created_at: Optional[datetime] = None
    accepted: bool = False


class MarketRequest(Model):
    """An exporter's open request for financing in the market (``GET /v1/requests``)."""

    id: str
    shipment_id: str
    external_ref: str = ""
    exporter: str = ""
    buyer: str = ""
    invoice_value: BaseUnits = 0
    amount: BaseUnits = 0
    max_fee_bps: int = 0
    milestone_count: int = 0
    note: str = ""
    route: list[RoutePoint] = Field(default_factory=list)
    policy: Optional[Policy] = None
    status: str = ""
    offers: list[Offer] = Field(default_factory=list)
    created_at: Optional[datetime] = None


M = TypeVar("M", bound=BaseModel)


class ModelList(list, Generic[M]):  # type: ignore[type-arg]
    """A list of models with ``to_frame()``: one row per item, nested objects flattened with ``_`` (e.g. ``policy_min_temp_x100``)."""

    def __init__(self, items: Iterable[M] = ()):
        super().__init__(items)

    def to_frame(self, backend: str = "pandas"):  # noqa: ANN201 - pandas or polars DataFrame
        from .frames import models_to_frame

        return models_to_frame(list(self), backend=backend)
