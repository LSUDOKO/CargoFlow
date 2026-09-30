package auth_test

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"errors"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

var now = time.Unix(1_800_000_000, 0)

type fixture struct {
	pub     ed25519.PublicKey
	priv    ed25519.PrivateKey
	sources map[string]store.Source
	v       *auth.Verifier
}

func newFixture(t *testing.T) *fixture {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	f := &fixture{pub: pub, priv: priv, sources: map[string]store.Source{
		"carrier-1": {ID: "carrier-1", PublicKey: pub, SensorIDs: []string{"sensor-1", "sensor-2"}},
	}}
	f.v = &auth.Verifier{
		Lookup: func(_ context.Context, id string) (store.Source, error) {
			s, ok := f.sources[id]
			if !ok {
				return store.Source{}, store.ErrNotFound
			}
			return s, nil
		},
		Now:     func() time.Time { return now },
		MaxSkew: 5 * time.Minute,
	}
	return f
}

const path = "/v1/shipments/0xabc/telemetry"

func (f *fixture) request(body string, mutate func(*http.Request)) *http.Request {
	r := httptest.NewRequest(http.MethodPost, path, strings.NewReader(body))
	ts := now.Unix()
	r.Header.Set("X-Source-Id", "carrier-1")
	r.Header.Set("X-Timestamp", strconv.FormatInt(ts, 10))
	r.Header.Set("X-Signature", auth.Sign(f.priv, http.MethodPost, path, ts, []byte(body)))
	if mutate != nil {
		mutate(r)
	}
	return r
}

func TestValidSignatureIsAccepted(t *testing.T) {
	f := newFixture(t)
	body := `{"points":[]}`
	src, err := f.v.Verify(context.Background(), f.request(body, nil), []byte(body))
	if err != nil || src.ID != "carrier-1" {
		t.Fatalf("valid request rejected: %v", err)
	}
}

func TestEveryPartOfTheRequestIsCoveredByTheSignature(t *testing.T) {
	f := newFixture(t)
	body := `{"points":[]}`
	cases := map[string]struct {
		mutate func(*http.Request)
		body   string
	}{
		"different body":   {nil, `{"points":[{"tamper":1}]}`},
		"different path":   {func(r *http.Request) { r.URL.Path = "/v1/shipments/0xdef/telemetry" }, body},
		"different method": {func(r *http.Request) { r.Method = http.MethodPut }, body},
		"different timestamp": {func(r *http.Request) {
			r.Header.Set("X-Timestamp", strconv.FormatInt(now.Unix()+1, 10))
		}, body},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			_, err := f.v.Verify(context.Background(), f.request(body, tc.mutate), []byte(tc.body))
			if !errors.Is(err, auth.ErrBadSignature) {
				t.Fatalf("want ErrBadSignature, got %v", err)
			}
		})
	}
}

func TestSignatureFromAnotherKeyIsRejected(t *testing.T) {
	f := newFixture(t)
	_, other, _ := ed25519.GenerateKey(rand.Reader)
	body := "{}"
	r := f.request(body, func(r *http.Request) {
		r.Header.Set("X-Signature", auth.Sign(other, http.MethodPost, path, now.Unix(), []byte(body)))
	})
	if _, err := f.v.Verify(context.Background(), r, []byte(body)); !errors.Is(err, auth.ErrBadSignature) {
		t.Fatalf("got %v", err)
	}
}

func TestTimestampsOutsideTheWindowAreRejected(t *testing.T) {
	f := newFixture(t)
	body := "{}"
	at := func(ts int64) *http.Request {
		return f.request(body, func(r *http.Request) {
			r.Header.Set("X-Timestamp", strconv.FormatInt(ts, 10))
			r.Header.Set("X-Signature", auth.Sign(f.priv, http.MethodPost, path, ts, []byte(body)))
		})
	}
	for name, ts := range map[string]int64{
		"6 minutes old":   now.Unix() - 360,
		"6 minutes ahead": now.Unix() + 360,
		"ancient":         1,
	} {
		if _, err := f.v.Verify(context.Background(), at(ts), []byte(body)); !errors.Is(err, auth.ErrExpired) {
			t.Errorf("%s: got %v", name, err)
		}
	}
	for name, ts := range map[string]int64{"exactly at the edge (past)": now.Unix() - 300, "exactly at the edge (future)": now.Unix() + 300} {
		if _, err := f.v.Verify(context.Background(), at(ts), []byte(body)); err != nil {
			t.Errorf("%s rejected: %v", name, err)
		}
	}
}

func TestMissingOrMalformedHeaders(t *testing.T) {
	f := newFixture(t)
	body := "{}"
	for _, h := range []string{"X-Source-Id", "X-Timestamp", "X-Signature"} {
		r := f.request(body, func(r *http.Request) { r.Header.Del(h) })
		if _, err := f.v.Verify(context.Background(), r, []byte(body)); !errors.Is(err, auth.ErrMissingCredentials) {
			t.Errorf("without %s: got %v", h, err)
		}
	}
	for name, mut := range map[string]func(*http.Request){
		"timestamp not a number": func(r *http.Request) { r.Header.Set("X-Timestamp", "soon") },
		"signature not base64":   func(r *http.Request) { r.Header.Set("X-Signature", "%%%") },
		"signature wrong size":   func(r *http.Request) { r.Header.Set("X-Signature", "AAAA") },
	} {
		r := f.request(body, mut)
		if _, err := f.v.Verify(context.Background(), r, []byte(body)); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
}

func TestUnknownAndDisabledSources(t *testing.T) {
	f := newFixture(t)
	body := "{}"
	r := f.request(body, func(r *http.Request) { r.Header.Set("X-Source-Id", "ghost") })
	if _, err := f.v.Verify(context.Background(), r, []byte(body)); !errors.Is(err, auth.ErrUnknownSource) {
		t.Fatalf("unknown source: %v", err)
	}
	s := f.sources["carrier-1"]
	s.Disabled = true
	f.sources["carrier-1"] = s
	if _, err := f.v.Verify(context.Background(), f.request(body, nil), []byte(body)); !errors.Is(err, auth.ErrSourceDisabled) {
		t.Fatalf("disabled source: %v", err)
	}
}

func TestUnknownSourceAndBadSignatureAreIndistinguishableToTheCaller(t *testing.T) {
	// Both map to the same public error so the API cannot be used to enumerate source ids.
	if auth.PublicError(auth.ErrUnknownSource) != auth.PublicError(auth.ErrBadSignature) {
		t.Fatal("source existence leaks through differing error messages")
	}
	if auth.PublicError(auth.ErrExpired) == auth.PublicError(auth.ErrBadSignature) {
		t.Log("expiry is distinguishable, which is fine: it tells honest clients to fix their clock")
	}
}

func TestSensorAuthorization(t *testing.T) {
	src := store.Source{ID: "carrier-1", SensorIDs: []string{"sensor-1", "sensor-2"}}
	ok := []telemetry.Point{{SensorID: "sensor-1"}, {SensorID: "sensor-2"}}
	if err := auth.CheckSensors(src, ok); err != nil {
		t.Fatalf("authorised sensors rejected: %v", err)
	}
	bad := []telemetry.Point{{SensorID: "sensor-1"}, {SensorID: "sensor-99"}}
	err := auth.CheckSensors(src, bad)
	if !errors.Is(err, auth.ErrSensorNotAllowed) || !strings.Contains(err.Error(), "sensor-99") {
		t.Fatalf("a source may only report its own sensors: %v", err)
	}
}

func TestSigningStringIsUnambiguous(t *testing.T) {
	a := auth.SigningString("POST", "/a", 1, []byte("x"))
	b := auth.SigningString("POST", "/a", 1, []byte("y"))
	c := auth.SigningString("POST", "/b", 1, []byte("x"))
	if string(a) == string(b) || string(a) == string(c) {
		t.Fatal("distinct requests produce the same signing string")
	}
}
