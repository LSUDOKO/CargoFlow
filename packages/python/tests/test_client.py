import httpx
import pandas as pd
import polars as pl
import pytest
import respx

from cargoflow import CargoFlow, CargoFlowError, NotFoundError
from conftest import API, sid


@pytest.fixture()
def cf():
    with CargoFlow(API, backoff=0, retries=2) as c:
        yield c


@respx.mock
def test_stats_health_and_errors(cf):
    respx.get(f"{API}/v1/stats").respond(json={"shipments": {"ACTIVE": 2, "PAUSED": 1}, "total": 3, "epochsCommitted": 9, "proofsVerified": 1})
    respx.get(f"{API}/v1/health").respond(json={"chainId": 46630, "database": "ok", "headBlock": 1, "status": "ok"})
    s = cf.stats()
    assert s.total == 3 and s.shipments["PAUSED"] == 1 and s.epochs_committed == 9
    assert cf.health().chain_id == 46630
    respx.get(f"{API}/v1/shipments/0xnope").respond(404, json={"error": {"code": "not_found", "message": "no shipment with this id"}})
    with pytest.raises(NotFoundError) as e:
        cf.shipment("0xnope")
    assert e.value.status == 404 and e.value.code == "not_found" and "no shipment" in str(e.value)
    respx.get(f"{API}/v1/shipments/0xbad/epochs").respond(400, json={"error": {"code": "bad_request", "message": "bad id"}})
    with pytest.raises(CargoFlowError, match="bad id"):
        cf.epochs("0xbad")


@respx.mock
def test_retries_server_errors_then_succeeds(cf):
    route = respx.get(f"{API}/v1/stats").mock(side_effect=[httpx.Response(503), httpx.ConnectError("down"), httpx.Response(200, json={"total": 1})])
    assert cf.stats().total == 1
    assert route.call_count == 3


@respx.mock
def test_retries_are_bounded(cf):
    respx.get(f"{API}/v1/stats").respond(502, text="bad gateway")
    with pytest.raises(CargoFlowError) as e:
        cf.stats()
    assert e.value.status == 502


@respx.mock
def test_shipment_view_and_lists_parse_typed(cf, payloads):
    v = payloads["views"][0]
    respx.get(f"{API}/v1/shipments/{sid(1)}").respond(json=v)
    respx.get(f"{API}/v1/shipments/{sid(1)}/epochs").respond(json={"epochs": payloads["epochs"][sid(1)]})
    respx.get(f"{API}/v1/shipments/{sid(1)}/track").respond(json={"points": payloads["tracks"][sid(1)]})
    view = cf.shipment(sid(1))
    assert view.shipment.invoice_value == 30_000_000 and isinstance(view.shipment.invoice_value, int)
    assert view.facility.drawn == 8_000_000 and view.cover.amount == 5_000_000
    assert view.milestones[0].released and view.milestones[0].released_at.year == 2026
    assert view.shipment.policy.band == "2 to 8°C" and view.shipment.route_key == "Mumbai -> Singapore"
    eps = cf.epochs(sid(1))
    assert eps[1].conflict_bps == 500 and eps[0].decision_action == "APPROVE_ADVANCE"
    trk = cf.track(sid(1))
    assert trk[1].pass_ is False and trk[1].max_temp_x100 == 950
    df = eps.to_frame()
    assert isinstance(df, pd.DataFrame) and {"conflict_bps", "decision_action", "penalties_conflict"} <= set(df.columns)
    pdf = trk.to_frame("polars")
    assert isinstance(pdf, pl.DataFrame) and pdf.height == 2


@respx.mock
def test_pagination_and_filters(cf, payloads):
    ships = [payloads["views"][0]["shipment"]] * 3
    route = respx.get(f"{API}/v1/shipments").mock(
        side_effect=lambda req: httpx.Response(200, json={"shipments": ships[: 2 if req.url.params["offset"] == "0" else 1], "limit": 2, "offset": int(req.url.params["offset"])})
    )
    got = cf.all_shipments(status=["PAUSED", "ACTIVE"], page_size=2)
    assert len(got) == 3
    assert route.calls[0].request.url.params["status"] == "PAUSED,ACTIVE"
    assert route.calls[1].request.url.params["offset"] == "2"
    assert cf.shipments(limit=2).to_frame()["policy_min_temp_x100"].iloc[0] == 200


@respx.mock
def test_party_market_audit_cover(cf):
    respx.get(f"{API}/v1/parties/0xabc").respond(json={"address": "0xabc", "exporter": {"shipments": 2, "volume": "32000000", "avgEvidenceScore": 91.3}, "financier": {"committed": "0", "drawn": "0", "inEscrow": "0", "feesEarned": "0"}, "buyer": {"paidVolume": "0"}, "since": "2026-10-02T12:06:32Z", "grade": "new"})
    p = cf.party("0xabc")
    assert p.exporter.volume == 32_000_000 and p.exporter.avg_evidence_score == 91.3 and p.grade == "new" and p.insurer.claimed == 0
    respx.get(f"{API}/v1/requests").respond(json={"requests": [{"id": "r1", "shipmentId": sid(1), "amount": "1000000", "maxFeeBps": 400, "milestoneCount": 5, "status": "open", "offers": [{"id": "o1", "financier": "0xf", "feeBps": 300, "accepted": False}], "createdAt": "2026-10-02T10:00:00Z"}]})
    reqs = cf.market_requests(status="open")
    assert reqs[0].amount == 1_000_000 and reqs[0].offers[0].fee_bps == 300
    respx.get(f"{API}/v1/shipments/{sid(1)}/audit").respond(json={"entries": [{"time": "2026-10-02T10:30:28Z", "kind": "chain_event", "title": "FinancingController.MilestoneAdvanceReleased", "txHash": "0x1", "detail": {"args": {"amount": "4000000"}}}]})
    a = cf.audit(sid(1), limit=5)
    assert a[0].kind == "chain_event" and a[0].detail["args"]["amount"] == "4000000"
    respx.get(f"{API}/v1/shipments/{sid(1)}/cover").respond(json={"offers": [{"insurer": "0xd", "amount": "5000000", "premiumBps": 200, "createdAt": "2026-10-02T10:00:00Z"}], "cover": None})
    c = cf.cover(sid(1))
    assert c.offers[0].premium_bps == 200 and c.cover is None
    respx.get(f"{API}/v1/shipments/{sid(2)}/cover").respond(404, text="404 page not found")
    with pytest.raises(NotFoundError):
        cf.cover(sid(2))


@respx.mock
def test_portfolio_fetches_everything_concurrently(cf, payloads):
    views = payloads["views"]
    respx.get(f"{API}/v1/shipments").respond(json={"shipments": [v["shipment"] for v in views], "limit": 200, "offset": 0})
    for v in views:
        i = v["shipment"]["id"]
        respx.get(f"{API}/v1/shipments/{i}").respond(json=v)
        respx.get(f"{API}/v1/shipments/{i}/epochs").respond(json={"epochs": payloads["epochs"][i]})
        respx.get(f"{API}/v1/shipments/{i}/track").respond(json={"points": payloads["tracks"][i]})
    pf = cf.portfolio()
    assert len(pf) == 4 and len(pf.epochs[sid(3)]) == 4 and len(pf.tracks[sid(4)]) == 2
    assert set(pf.shipments_frame()["status"]) == {"ACTIVE", "PAUSED", "SETTLED", "DEFAULTED"}
