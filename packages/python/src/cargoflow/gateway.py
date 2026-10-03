"""Gateway request signing, byte-identical to ``backend/internal/auth`` and the website / ``@cargoflow/gateway``.

A gateway authenticates each telemetry request with three headers::

    X-Source-Id:  src-<first 16 hex digits of sha256(public key)>
    X-Timestamp:  unix seconds (the API accepts a few minutes of clock skew)
    X-Signature:  base64url (no padding) Ed25519 signature over
                  "CARGOFLOW-V1\\n" METHOD "\\n" PATH "\\n" TIMESTAMP "\\n" hex(sha256(body))

This module only signs; the SDK does not send telemetry (use ``@cargoflow/gateway`` or ``signed_headers`` with
your own HTTP client).
"""

from __future__ import annotations

import base64
import hashlib
import json
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Optional, Union

from cryptography.exceptions import InvalidSignature
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.hazmat.primitives.serialization import Encoding, PublicFormat

SIGNING_PREFIX = "CARGOFLOW-V1"
KEY_FILE_KIND = "cargoflow-gateway-key"

Body = Union[str, bytes]


def b64url(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode("ascii")


def b64url_decode(s: str) -> bytes:
    return base64.urlsafe_b64decode(s + "=" * (-len(s) % 4))


def _bytes(body: Body) -> bytes:
    return body.encode("utf-8") if isinstance(body, str) else body


def signing_string(method: str, path: str, timestamp: int, body: Body) -> str:
    """The exact string a source signs (``auth.SigningString``)."""
    return f"{SIGNING_PREFIX}\n{method}\n{path}\n{int(timestamp)}\n{hashlib.sha256(_bytes(body)).hexdigest()}"


def _private(seed: Union[bytes, str]) -> Ed25519PrivateKey:
    raw = b64url_decode(seed) if isinstance(seed, str) else seed
    if len(raw) != 32:
        raise ValueError("an Ed25519 seed is 32 bytes")
    return Ed25519PrivateKey.from_private_bytes(raw)


def public_key_for(seed: Union[bytes, str]) -> str:
    """The base64url public key of a 32-byte seed (raw bytes or base64url)."""
    return b64url(_private(seed).public_key().public_bytes(Encoding.Raw, PublicFormat.Raw))


def source_id_for(public_key: str) -> str:
    """The id the backend derives from a gateway's public key."""
    return "src-" + hashlib.sha256(b64url_decode(public_key)).hexdigest()[:16]


def sign_request(seed: Union[bytes, str], method: str, path: str, timestamp: int, body: Body) -> str:
    """The ``X-Signature`` value. ``body`` must be the exact bytes sent; ``path`` the URL path (no host, no query)."""
    return b64url(_private(seed).sign(signing_string(method, path, timestamp, body).encode("utf-8")))


def verify_request(public_key: str, signature: str, method: str, path: str, timestamp: int, body: Body) -> bool:
    try:
        Ed25519PublicKey.from_public_bytes(b64url_decode(public_key)).verify(b64url_decode(signature), signing_string(method, path, timestamp, body).encode("utf-8"))
        return True
    except (InvalidSignature, ValueError):
        return False


@dataclass(frozen=True)
class GatewayKey:
    """A gateway key file (the website's ``cargoflow-gateway-key`` JSON format)."""

    source_id: str
    shipment_id: str
    label: str
    sensor_ids: tuple[str, ...]
    public_key: str
    seed: bytes

    def __repr__(self) -> str:  # never print the private key
        return f"GatewayKey(source_id={self.source_id!r}, shipment_id={self.shipment_id!r}, sensors={list(self.sensor_ids)!r})"

    def sign(self, method: str, path: str, timestamp: int, body: Body) -> str:
        return sign_request(self.seed, method, path, timestamp, body)

    def headers(self, method: str, path: str, body: Body, timestamp: Optional[int] = None) -> dict[str, str]:
        return signed_headers(self, method, path, body, timestamp)


def load_key_file(path_or_text: Union[str, Path]) -> GatewayKey:
    """Reads and checks a key file (path, or the JSON text itself). Raises ``ValueError`` if it is not one or was edited."""
    text = str(path_or_text)
    if not text.lstrip().startswith("{"):
        text = Path(path_or_text).read_text(encoding="utf-8")
    try:
        raw = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ValueError("This is not a CargoFlow gateway key file.") from exc
    if not isinstance(raw, dict) or raw.get("kind") != KEY_FILE_KIND or not isinstance(raw.get("privateKeySeed"), str) or not isinstance(raw.get("shipmentId"), str):
        raise ValueError("This is not a CargoFlow gateway key file.")
    seed = b64url_decode(raw["privateKeySeed"])
    if len(seed) != 32:
        raise ValueError("The key file's private key is damaged.")
    pub = public_key_for(seed)
    if raw.get("publicKey") != pub:
        raise ValueError("The key file's public key does not match its private key; it was edited.")
    sensors = tuple(s for s in raw.get("sensorIds", []) if isinstance(s, str))
    return GatewayKey(source_id_for(pub), raw["shipmentId"].lower(), raw.get("label", "") if isinstance(raw.get("label"), str) else "", sensors, pub, seed)


def signed_headers(key: GatewayKey, method: str, path: str, body: Body, timestamp: Optional[int] = None) -> dict[str, str]:
    """``X-Source-Id``, ``X-Timestamp`` and ``X-Signature`` for a request signed now (or at ``timestamp``)."""
    ts = int(time.time()) if timestamp is None else int(timestamp)
    return {"X-Source-Id": key.source_id, "X-Timestamp": str(ts), "X-Signature": key.sign(method, path, ts, body)}


__all__ = [
    "signing_string",
    "sign_request",
    "verify_request",
    "public_key_for",
    "source_id_for",
    "signed_headers",
    "load_key_file",
    "GatewayKey",
]
