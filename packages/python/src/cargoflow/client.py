"""HTTP client for the CargoFlow API's read endpoints. Read-only: the SDK never submits transactions."""

from __future__ import annotations

import time
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Iterable, Iterator, Optional, Sequence, TypeVar

import httpx
from pydantic import BaseModel, TypeAdapter

from .models import (
    AuditEntry,
    Epoch,
    GatewaySource,
    Health,
    MarketRequest,
    ModelList,
    Party,
    Shipment,
    ShipmentCover,
    ShipmentView,
    Stats,
    TelemetrySummary,
    TrackPoint,
)

DEFAULT_API_URL = "https://cargoflow-api-75ul.onrender.com"
MAX_PAGE = 200  # the API's list limit
USER_AGENT = "cargoflow-python/0.1.0"

T = TypeVar("T", bound=BaseModel)


class CargoFlowError(Exception):
    """An error answer from the API (``{"error": {"code", "message"}}``) or a transport failure."""

    def __init__(self, message: str, status: Optional[int] = None, code: Optional[str] = None):
        super().__init__(message)
        self.message = message
        self.status = status
        self.code = code

    def __str__(self) -> str:
        return f"{self.status} {self.code}: {self.message}" if self.status else self.message


class NotFoundError(CargoFlowError):
    """404: no such shipment / party, or an endpoint this API version does not serve."""


class CargoFlow:
    """Typed client for the CargoFlow API.

    >>> cf = CargoFlow()                      # the public API
    >>> cf.stats().total
    >>> cf.shipments(status="ACTIVE").to_frame()

    ``retries`` covers 429, 5xx and connection errors with exponential backoff (the hosted API may need a few
    seconds to wake up). Use as a context manager, or call ``close()``.
    """

    def __init__(
        self,
        api_url: str = DEFAULT_API_URL,
        *,
        timeout: float = 60.0,
        retries: int = 3,
        backoff: float = 1.0,
        client: Optional[httpx.Client] = None,
        headers: Optional[dict[str, str]] = None,
    ):
        self.api_url = api_url.rstrip("/")
        self.retries = retries
        self.backoff = backoff
        self._own_client = client is None
        self._http = client or httpx.Client(timeout=timeout, headers={"User-Agent": USER_AGENT, "Accept": "application/json", **(headers or {})})

    # -- plumbing

    def close(self) -> None:
        if self._own_client:
            self._http.close()

    def __enter__(self) -> "CargoFlow":
        return self

    def __exit__(self, *exc: Any) -> None:
        self.close()

    def get(self, path: str, params: Optional[dict[str, Any]] = None) -> Any:
        """GET ``path`` (e.g. ``/v1/stats``) and return the decoded JSON, raising :class:`CargoFlowError` on errors."""
        url = f"{self.api_url}{path}"
        clean = {k: v for k, v in (params or {}).items() if v is not None and v != ""}
        attempt = 0
        while True:
            try:
                res = self._http.get(url, params=clean)
            except httpx.TransportError as exc:
                if attempt >= self.retries:
                    raise CargoFlowError(f"could not reach {self.api_url}: {exc}") from exc
                self._sleep(attempt, None)
                attempt += 1
                continue
            if res.status_code == 429 or res.status_code >= 500:
                if attempt < self.retries:
                    self._sleep(attempt, res.headers.get("Retry-After"))
                    attempt += 1
                    continue
            if res.status_code >= 400:
                raise self._error(res)
            return res.json()

    def _sleep(self, attempt: int, retry_after: Optional[str]) -> None:
        delay = self.backoff * 2**attempt
        try:
            if retry_after:
                delay = max(delay, min(float(retry_after), 60.0))
        except ValueError:
            pass
        time.sleep(delay)

    @staticmethod
    def _error(res: httpx.Response) -> CargoFlowError:
        code, message = None, res.text.strip()[:300] or res.reason_phrase
        try:
            body = res.json()
            err = body.get("error") if isinstance(body, dict) else None
            if isinstance(err, dict):
                code, message = err.get("code"), err.get("message", message)
            elif isinstance(err, str):
                message = err
        except ValueError:
            pass
        cls = NotFoundError if res.status_code == 404 else CargoFlowError
        return cls(message, status=res.status_code, code=code)

    @staticmethod
    def _list(model: type[T], items: Iterable[Any]) -> ModelList[T]:
        adapter = TypeAdapter(list[model])  # type: ignore[valid-type]
        return ModelList(adapter.validate_python(list(items)))

    # -- platform

    def health(self) -> Health:
        return Health.model_validate(self.get("/v1/health"))

    def config(self) -> dict[str, Any]:
        """Chain id, contract addresses and enabled features."""
        return self.get("/v1/config")

    def stats(self) -> Stats:
        return Stats.model_validate(self.get("/v1/stats"))

    # -- shipments

    def shipments(
        self,
        *,
        status: Optional[str | Sequence[str]] = None,
        party: Optional[str] = None,
        ref: Optional[str] = None,
        limit: int = 50,
        offset: int = 0,
    ) -> ModelList[Shipment]:
        """One page of shipments, newest first. ``status`` is one status or a list (``["PAUSED", "DISPUTED"]``)."""
        st = ",".join(status) if isinstance(status, (list, tuple, set)) else status
        body = self.get("/v1/shipments", {"status": st, "party": party, "ref": ref, "limit": limit, "offset": offset})
        return self._list(Shipment, body.get("shipments", []))

    def iter_shipments(self, *, status: Optional[str | Sequence[str]] = None, party: Optional[str] = None, ref: Optional[str] = None, page_size: int = MAX_PAGE) -> Iterator[Shipment]:
        """Every matching shipment, fetching pages of ``page_size`` (at most 200) as needed."""
        offset = 0
        while True:
            page = self.shipments(status=status, party=party, ref=ref, limit=page_size, offset=offset)
            yield from page
            if len(page) < page_size:
                return
            offset += page_size

    def all_shipments(self, **filters: Any) -> ModelList[Shipment]:
        return ModelList(self.iter_shipments(**filters))

    def shipment(self, shipment_id: str) -> ShipmentView:
        """The combined view: record, milestones, live facility, latest evidence, cover."""
        return ShipmentView.model_validate(self.get(f"/v1/shipments/{shipment_id}"))

    def epochs(self, shipment_id: str) -> ModelList[Epoch]:
        return self._list(Epoch, self.get(f"/v1/shipments/{shipment_id}/epochs").get("epochs", []))

    def track(self, shipment_id: str) -> ModelList[TrackPoint]:
        """One centroid and temperature range per epoch, oldest first."""
        return self._list(TrackPoint, self.get(f"/v1/shipments/{shipment_id}/track").get("points", []))

    def audit(self, shipment_id: str, limit: int = 500) -> ModelList[AuditEntry]:
        """The merged audit trail: chain events, monitoring decisions, epochs and sent transactions."""
        return self._list(AuditEntry, self.get(f"/v1/shipments/{shipment_id}/audit", {"limit": limit}).get("entries", []))

    def telemetry(self, shipment_id: str) -> TelemetrySummary:
        """Per-epoch, per-sensor temperature aggregates and the latest position (no raw readings)."""
        return TelemetrySummary.model_validate(self.get(f"/v1/shipments/{shipment_id}/telemetry"))

    def sources(self, shipment_id: str) -> ModelList[GatewaySource]:
        """The shipment's registered evidence gateways."""
        return self._list(GatewaySource, self.get(f"/v1/shipments/{shipment_id}/sources").get("sources", []))

    def cover(self, shipment_id: str) -> ShipmentCover:
        """Open default-cover offers and the accepted cover. Raises :class:`NotFoundError` on API versions without cover."""
        return ShipmentCover.model_validate(self.get(f"/v1/shipments/{shipment_id}/cover"))

    # -- parties and market

    def party(self, address: str) -> Party:
        return Party.model_validate(self.get(f"/v1/parties/{address}"))

    def market_requests(self, *, status: Optional[str] = None, exporter: Optional[str] = None) -> ModelList[MarketRequest]:
        """Financing requests in the market (``open``, ``accepted``, ``funded`` or ``closed``), newest first."""
        return self._list(MarketRequest, self.get("/v1/requests", {"status": status, "exporter": exporter}).get("requests", []))

    # -- bulk

    def portfolio(
        self,
        shipment_ids: Optional[Sequence[str]] = None,
        *,
        status: Optional[str | Sequence[str]] = None,
        party: Optional[str] = None,
        include_track: bool = True,
        include_cover: bool = False,
        max_workers: int = 8,
    ):
        """Fetches views, epochs and tracks for many shipments concurrently, for :mod:`cargoflow.analytics`.

        With no ids, every shipment matching ``status`` / ``party`` is included.
        """
        from .analytics import Portfolio

        ids = list(shipment_ids) if shipment_ids is not None else [s.id for s in self.iter_shipments(status=status, party=party)]

        def fetch(sid: str):
            view = self.shipment(sid)
            eps = self.epochs(sid)
            trk = self.track(sid) if include_track else ModelList()
            cov = None
            if include_cover:
                try:
                    cov = self.cover(sid)
                except NotFoundError:
                    cov = None
            return sid, view, eps, trk, cov

        with ThreadPoolExecutor(max_workers=max(1, max_workers)) as pool:
            results = list(pool.map(fetch, ids))
        # keyed by the canonical id in each view (the API lower-cases ids)
        return Portfolio(
            views=[r[1] for r in results],
            epochs={r[1].id: list(r[2]) for r in results},
            tracks={r[1].id: list(r[3]) for r in results},
            covers={r[1].id: r[4] for r in results if r[4] is not None},
        )
