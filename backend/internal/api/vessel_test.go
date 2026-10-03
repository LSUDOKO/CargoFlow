package api_test

import (
	"context"
	"net/http"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/ais"
	"github.com/LSUDOKO/CargoFlow/backend/internal/api"
	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
)

// fakeStream stands in for aisstream.io and records which vessels it was asked to follow.
type fakeStream struct {
	mu      sync.Mutex
	watched []string
}

func (f *fakeStream) Run(ctx context.Context, _ chan<- ais.Position) error {
	<-ctx.Done()
	return ctx.Err()
}
func (f *fakeStream) Watch(m []string) {
	f.mu.Lock()
	f.watched = append([]string(nil), m...)
	f.mu.Unlock()
}

type vesselDTO struct {
	MMSI string `json:"mmsi"`
	Name string `json:"name"`
	Live bool   `json:"live"`
	Last *struct {
		LatE6       int32 `json:"latE6"`
		LonE6       int32 `json:"lonE6"`
		Timestamp   int64 `json:"timestamp"`
		SogKnotsX10 int32 `json:"sogKnotsX10"`
		CogDegX10   int32 `json:"cogDegX10"`
	} `json:"last"`
	Track []struct {
		LatE6     int32 `json:"latE6"`
		LonE6     int32 `json:"lonE6"`
		Timestamp int64 `json:"timestamp"`
	} `json:"track"`
	CrossCheck *struct {
		LoggerLatE6 int32 `json:"loggerLatE6"`
		LoggerLonE6 int32 `json:"loggerLonE6"`
		DistanceM   int64 `json:"distanceM"`
		AgeSec      int64 `json:"ageSec"`
		Agrees      bool  `json:"agrees"`
	} `json:"crossCheck"`
}

func vesselBody(t *testing.T, e *env, shipment, mmsi, name string, issued int64) map[string]any {
	return map[string]any{"mmsi": mmsi, "name": name, "issuedAt": issued,
		"signature": walletSign(t, e.keys["exporter"], auth.VesselAuthorization(shipment, mmsi, issued))}
}

func TestTheExporterNamesTheVesselAndAISIsCrossCheckedWithTheLogger(t *testing.T) {
	stream := &fakeStream{}
	var tracker *ais.Tracker
	e := newEnvWith(t, nil, func(e *env, c *api.Config) {
		tracker = &ais.Tracker{Store: e.store, Stream: stream}
		c.AIS = tracker
	})
	id := e.onChain(t, "api-vessel-1", true)
	e.registerShipment(t, id, "api-vessel-1")
	sh := idHex(id)
	path := "/v1/shipments/" + sh + "/vessel"
	now := time.Now().Unix()

	if resp := e.do(t, "GET", path, nil, nil, nil); resp.StatusCode != http.StatusNotFound {
		t.Fatalf("no vessel yet = %d, want 404", resp.StatusCode)
	}
	if resp := e.do(t, "POST", path, map[string]any{"mmsi": "563012345", "name": "x", "issuedAt": now,
		"signature": walletSign(t, e.keys["buyer"], auth.VesselAuthorization(sh, "563012345", now))}, nil, nil); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("the buyer naming the vessel = %d, want 401", resp.StatusCode)
	}
	if resp := e.do(t, "POST", path, vesselBody(t, e, sh, "12345", "x", now), nil, nil); resp.StatusCode != http.StatusBadRequest {
		t.Fatalf("a short MMSI = %d, want 400", resp.StatusCode)
	}
	var v vesselDTO
	if resp := e.do(t, "POST", path, vesselBody(t, e, sh, "563012345", "Maersk Test", now), nil, &v); resp.StatusCode != http.StatusCreated || v.MMSI != "563012345" || v.Name != "Maersk Test" {
		t.Fatalf("name the vessel = %d %+v", resp.StatusCode, v)
	}
	stream.mu.Lock()
	watched := strings.Join(stream.watched, ",")
	stream.mu.Unlock()
	if watched != "563012345" {
		t.Fatalf("the AIS stream follows %q", watched)
	}

	// the logger reports from Mumbai while the transponder puts the ship off Singapore, ten minutes apart
	t0 := now - 600
	if _, err := e.store.InsertPoint(ctxBG(), sh, reading(t0, "probe-a", 500, 18_950_000, 72_950_000), ""); err != nil {
		t.Fatal(err)
	}
	if err := tracker.Record(ctxBG(), ais.Position{MMSI: "563012345", LatE6: 1_264_000, LonE6: 103_820_000, Timestamp: t0 + 600, SogKnotsX10: 124, CogDegX10: 3084}); err != nil {
		t.Fatal(err)
	}
	if resp := e.do(t, "GET", path, nil, nil, &v); resp.StatusCode != http.StatusOK {
		t.Fatalf("vessel = %d", resp.StatusCode)
	}
	if !v.Live || v.Last == nil || v.Last.LatE6 != 1_264_000 || v.Last.SogKnotsX10 != 124 || len(v.Track) != 1 || v.CrossCheck == nil ||
		v.CrossCheck.Agrees || v.CrossCheck.DistanceM < 3_000_000 || v.CrossCheck.AgeSec != 600 || v.CrossCheck.LoggerLatE6 != 18_950_000 {
		t.Fatalf("vessel = %+v (cross-check %+v)", v, v.CrossCheck)
	}
	var audit struct {
		Entries []struct{ Kind, Title string } `json:"entries"`
	}
	e.do(t, "GET", "/v1/shipments/"+sh+"/audit", nil, nil, &audit)
	mismatches := 0
	for _, a := range audit.Entries {
		if strings.Contains(a.Title, "AIS_MISMATCH") {
			mismatches++
		}
	}
	if mismatches != 1 {
		t.Fatalf("audit has %d AIS_MISMATCH entries, want 1: %+v", mismatches, audit.Entries)
	}
	// a second disagreeing fix inside the window is not recorded again
	_ = tracker.Record(ctxBG(), ais.Position{MMSI: "563012345", LatE6: 1_300_000, LonE6: 103_900_000, Timestamp: t0 + 700})
	e.do(t, "GET", "/v1/shipments/"+sh+"/audit", nil, nil, &audit)
	mismatches = 0
	for _, a := range audit.Entries {
		if strings.Contains(a.Title, "AIS_MISMATCH") {
			mismatches++
		}
	}
	if mismatches != 1 {
		t.Fatalf("a long disagreement became %d audit lines", mismatches)
	}

	var renamed vesselDTO
	if resp := e.do(t, "POST", path, vesselBody(t, e, sh, "563099999", "Relay vessel", now+1), nil, &renamed); resp.StatusCode != http.StatusOK || renamed.MMSI != "563099999" {
		t.Fatalf("renaming the vessel = %d %+v", resp.StatusCode, renamed)
	}
}

func TestWithoutAnAISKeyTheVesselIsNotLive(t *testing.T) {
	e := newEnv(t, nil)
	id := e.onChain(t, "api-vessel-2", true)
	e.registerShipment(t, id, "api-vessel-2")
	sh := idHex(id)
	var v vesselDTO
	if resp := e.do(t, "POST", "/v1/shipments/"+sh+"/vessel", vesselBody(t, e, sh, "563012345", "", time.Now().Unix()), nil, &v); resp.StatusCode != http.StatusCreated {
		t.Fatalf("name the vessel = %d", resp.StatusCode)
	}
	if v.Live || v.Last != nil || v.CrossCheck != nil || v.Track == nil || len(v.Track) != 0 {
		t.Fatalf("vessel without AIS = %+v", v)
	}
}
