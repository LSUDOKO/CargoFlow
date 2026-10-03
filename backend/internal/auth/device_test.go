package auth_test

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"

	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
	"github.com/LSUDOKO/CargoFlow/backend/internal/devicetrust/devicetest"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

func signedRequest(id, body string, sig func(msg []byte) (string, map[string]string)) *http.Request {
	r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	ts := now.Unix()
	s, extra := sig(auth.SigningString(http.MethodPost, path, ts, []byte(body)))
	r.Header.Set("X-Source-Id", id)
	r.Header.Set("X-Timestamp", strconv.FormatInt(ts, 10))
	r.Header.Set("X-Signature", s)
	for k, v := range extra {
		r.Header.Set(k, v)
	}
	return r
}

func TestP256SourcesSignWithECDSA(t *testing.T) {
	f := newFixture(t)
	k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	pub, _ := k.PublicKey.Bytes()
	f.sources["se-1"] = store.Source{ID: "se-1", PublicKey: pub, SensorIDs: []string{"s"}, KeyType: store.KeyP256}
	body := `{"points":[]}`
	sign := func(msg []byte) (string, map[string]string) {
		d := sha256.Sum256(msg)
		sig, _ := ecdsa.SignASN1(rand.Reader, k, d[:])
		return base64.RawURLEncoding.EncodeToString(sig), nil
	}
	if _, err := f.v.Verify(context.Background(), signedRequest("se-1", body, sign), []byte(body)); err != nil {
		t.Fatal(err)
	}
	if _, err := f.v.Verify(context.Background(), signedRequest("se-1", body, sign), []byte(body+" ")); !errors.Is(err, auth.ErrBadSignature) {
		t.Fatalf("a changed body must fail, got %v", err)
	}
	// an Ed25519 signature is not accepted for a P-256 source
	ed := func(msg []byte) (string, map[string]string) {
		return auth.Sign(f.priv, http.MethodPost, path, now.Unix(), []byte(body)), nil
	}
	if _, err := f.v.Verify(context.Background(), signedRequest("se-1", body, ed), []byte(body)); !errors.Is(err, auth.ErrBadSignature) {
		t.Fatalf("got %v", err)
	}
}

func TestWebAuthnSourcesSignAssertions(t *testing.T) {
	f := newFixture(t)
	const rp = "app.cargoflow.test"
	origin := devicetest.Origin(rp)
	pk := devicetest.NewPasskey(rp)
	rpHash := sha256.Sum256([]byte(rp))
	f.sources["pk-1"] = store.Source{ID: "pk-1", PublicKey: pk.PublicKey(), SensorIDs: []string{"s"}, KeyType: store.KeyWebAuthn, RPIDHash: rpHash[:]}
	f.v.Origins = []string{origin}
	var last uint32
	f.v.SignCount = func(_ context.Context, _ string, n uint32) (bool, error) {
		if n <= last {
			return false, nil
		}
		last = n
		return true, nil
	}
	body := `{"points":[]}`
	assert := func(p *devicetest.Passkey) func(msg []byte) (string, map[string]string) {
		return func(msg []byte) (string, map[string]string) {
			a := p.Assert(msg, origin)
			enc := base64.RawURLEncoding.EncodeToString
			return enc(a.Signature), map[string]string{"X-WebAuthn-Authenticator-Data": enc(a.AuthenticatorData), "X-WebAuthn-Client-Data": enc(a.ClientDataJSON)}
		}
	}
	if _, err := f.v.Verify(context.Background(), signedRequest("pk-1", body, assert(pk)), []byte(body)); err != nil {
		t.Fatal(err)
	}
	if _, err := f.v.Verify(context.Background(), signedRequest("pk-1", body, assert(devicetest.NewPasskey(rp))), []byte(body)); !errors.Is(err, auth.ErrBadSignature) {
		t.Fatalf("another passkey must fail, got %v", err)
	}
	pk.SignCount = 0 // a cloned authenticator replays an old counter
	if _, err := f.v.Verify(context.Background(), signedRequest("pk-1", body, assert(pk)), []byte(body)); !errors.Is(err, auth.ErrBadSignature) {
		t.Fatalf("a counter that does not advance must fail, got %v", err)
	}
	r := signedRequest("pk-1", body, assert(pk))
	r.Header.Del("X-WebAuthn-Client-Data")
	if _, err := f.v.Verify(context.Background(), r, []byte(body)); !errors.Is(err, auth.ErrBadSignature) {
		t.Fatalf("a missing clientDataJSON must fail, got %v", err)
	}
}

func TestDeviceAuthorizationKeepsTheEd25519Message(t *testing.T) {
	ed := auth.SourceAuthorization("0xAB", "key", []string{"a", "b"}, 7)
	if ed != "CargoFlow evidence source\nshipment: 0xab\npublic key: key\nsensors: a,b\nissued: 7" {
		t.Fatalf("the Ed25519 message must not change: %q", ed)
	}
	if got := auth.DeviceAuthorization("0xab", "key", "p256", []string{"a"}, 7); got != "CargoFlow evidence source\nshipment: 0xab\npublic key: key\nsensors: a\nkey type: p256\nissued: 7" {
		t.Fatalf("%q", got)
	}
}
