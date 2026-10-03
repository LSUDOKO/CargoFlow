#!/usr/bin/env bash
# Make a TEST manufacturer root, an intermediate and a secure-element device certificate for a fresh P-256 key, the
# shape of what an ATECC608A or nRF91 provisioning flow produces. For development and tests only: never put this root
# in a production DEVICE_ROOTS_DIR.
#
#   scripts/make-device-certs.sh [out-dir] [device-serial]
#
# Writes:
#   roots/cargoflow-test-root.pem   the root (point DEVICE_ROOTS_DIR at roots/)
#   intermediate.pem                the device CA
#   device-key.pem                  the device's private key (on real hardware it never leaves the chip)
#   device.pem                      the device certificate
#   chain.pem                       device.pem + intermediate.pem: what goes into attestation.chain at registration
#   device-public.b64url            the device's public key as an uncompressed SEC1 point, base64url (the publicKey)
set -euo pipefail
OUT="${1:-internal/devicetrust/testdata}"
SERIAL="${2:-CF-SE-0001}"
DAYS_ROOT=7300 DAYS_INT=3650 DAYS_DEV=1825
mkdir -p "$OUT/roots"
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT

openssl ecparam -name prime256v1 -genkey -noout -out "$tmp/root.key"
openssl req -x509 -new -key "$tmp/root.key" -sha256 -days "$DAYS_ROOT" -subj "/O=CargoFlow Test Manufacturer/CN=CargoFlow Test Root CA" \
  -addext "basicConstraints=critical,CA:TRUE" -addext "keyUsage=critical,keyCertSign,cRLSign" -out "$OUT/roots/cargoflow-test-root.pem"

openssl ecparam -name prime256v1 -genkey -noout -out "$tmp/int.key"
openssl req -new -key "$tmp/int.key" -subj "/O=CargoFlow Test Manufacturer/CN=CargoFlow Test Device CA" -out "$tmp/int.csr"
printf 'basicConstraints=critical,CA:TRUE,pathlen:0\nkeyUsage=critical,keyCertSign\n' > "$tmp/int.ext"
openssl x509 -req -in "$tmp/int.csr" -CA "$OUT/roots/cargoflow-test-root.pem" -CAkey "$tmp/root.key" -CAcreateserial \
  -days "$DAYS_INT" -sha256 -extfile "$tmp/int.ext" -out "$OUT/intermediate.pem"

openssl ecparam -name prime256v1 -genkey -noout -out "$tmp/dev.key"
openssl pkcs8 -topk8 -nocrypt -in "$tmp/dev.key" -out "$OUT/device-key.pem"
openssl req -new -key "$tmp/dev.key" -subj "/O=CargoFlow Test Manufacturer/CN=$SERIAL" -out "$tmp/dev.csr"
printf 'basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature\n' > "$tmp/dev.ext"
openssl x509 -req -in "$tmp/dev.csr" -CA "$OUT/intermediate.pem" -CAkey "$tmp/int.key" -CAcreateserial \
  -days "$DAYS_DEV" -sha256 -extfile "$tmp/dev.ext" -out "$OUT/device.pem"

cat "$OUT/device.pem" "$OUT/intermediate.pem" > "$OUT/chain.pem"
# the uncompressed point is the last 65 bytes of the DER SubjectPublicKeyInfo of a P-256 key
openssl ec -in "$tmp/dev.key" -pubout -outform DER 2>/dev/null | tail -c 65 | base64 -w0 | tr '+/' '-_' | tr -d '=' > "$OUT/device-public.b64url"
rm -f "$OUT"/*.srl "$OUT/roots"/*.srl
echo "wrote $OUT (root: $OUT/roots/cargoflow-test-root.pem, device public key: $(cat "$OUT/device-public.b64url"))"
