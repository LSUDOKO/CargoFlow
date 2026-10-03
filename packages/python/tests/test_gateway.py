import json

import pytest

from cargoflow.gateway import (
    b64url,
    load_key_file,
    public_key_for,
    sign_request,
    signed_headers,
    signing_string,
    source_id_for,
    verify_request,
)

# backend/internal/auth/auth_test.go TestSigningVectorMatchesTheBrowser
SEED = bytes(range(1, 33))
GO_PUBLIC_KEY = "ebVWLo_mVPlAeLES6KmLp5AfhTrmlb7X4OORC60ElmQ"
GO_SIGNATURE = "sj1mt5G8eKywRtIFawngVCppOosS5MoZI3CpxYikGQXlDlwkoz8fvjHEjDnSBm3HqXgtLcI17J1atefHLz0wDg"
PATH = "/v1/shipments/0xabc/telemetry"
BODY = '{"points":[]}'


def test_public_key_matches_go_vector():
    assert public_key_for(SEED) == GO_PUBLIC_KEY
    assert public_key_for(b64url(SEED)) == GO_PUBLIC_KEY


def test_signature_matches_go_vector():
    assert sign_request(SEED, "POST", PATH, 1700000000, BODY) == GO_SIGNATURE
    assert sign_request(SEED, "POST", PATH, 1700000000, BODY.encode()) == GO_SIGNATURE


def test_verify_and_signing_string():
    assert verify_request(GO_PUBLIC_KEY, GO_SIGNATURE, "POST", PATH, 1700000000, BODY)
    assert not verify_request(GO_PUBLIC_KEY, GO_SIGNATURE, "POST", PATH, 1700000001, BODY)
    assert signing_string("POST", "/p", 1, "") == "CARGOFLOW-V1\nPOST\n/p\n1\ne3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"


def key_file(**over):
    raw = {
        "kind": "cargoflow-gateway-key",
        "version": 1,
        "sourceId": source_id_for(GO_PUBLIC_KEY),
        "shipmentId": "0xABC",
        "label": "Reefer",
        "sensorIds": ["probe-1", "probe-2"],
        "publicKey": GO_PUBLIC_KEY,
        "privateKeySeed": b64url(SEED),
        "note": "Keep this file private.",
    }
    raw.update(over)
    return json.dumps(raw, indent=2)


def test_load_key_file_from_text_and_path(tmp_path):
    k = load_key_file(key_file())
    assert k.shipment_id == "0xabc" and k.sensor_ids == ("probe-1", "probe-2") and k.public_key == GO_PUBLIC_KEY
    assert k.source_id.startswith("src-") and len(k.source_id) == 20
    assert "privateKeySeed" not in repr(k) and b64url(SEED) not in repr(k)
    p = tmp_path / "key.json"
    p.write_text(key_file())
    assert load_key_file(p).source_id == k.source_id
    h = signed_headers(k, "POST", PATH, BODY, timestamp=1700000000)
    assert h == {"X-Source-Id": k.source_id, "X-Timestamp": "1700000000", "X-Signature": GO_SIGNATURE}


def test_load_key_file_rejects_edits_and_garbage():
    with pytest.raises(ValueError, match="edited"):
        load_key_file(key_file(publicKey="A" * 43))
    with pytest.raises(ValueError, match="not a CargoFlow"):
        load_key_file("{}")
    with pytest.raises(ValueError, match="damaged"):
        load_key_file(key_file(privateKeySeed="AAAA"))
