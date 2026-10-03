package ais

import (
	"context"
	"errors"
	"log/slog"
	"sync"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/geo"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

// Cross-check thresholds: a logger and a transponder more than 50 km apart within 30 minutes of each other disagree.
const (
	MismatchMeters = 50_000
	MismatchWindow = 30 * 60 // seconds
)

// Storage tuning: one position per vessel per minute is plenty for a map, and two weeks of history is kept.
const (
	storeEvery = 60 // seconds
	keepFor    = 14 * 24 * time.Hour
)

// ReasonMismatch is the audit reason code of a logger/AIS disagreement.
const ReasonMismatch = "AIS_MISMATCH"

// Check compares the logger's latest position with the vessel's latest AIS position.
type Check struct {
	LoggerLatE6 int32 `json:"loggerLatE6"`
	LoggerLonE6 int32 `json:"loggerLonE6"`
	DistanceM   int64 `json:"distanceM"`
	AgeSec      int64 `json:"ageSec"` // time between the two fixes
	Agrees      bool  `json:"agrees"`
	Comparable  bool  `json:"comparable"` // false when the fixes are too far apart in time to say either way
}

// CrossCheck compares a logger reading with an AIS position. Fixes more than 30 minutes apart cannot contradict
// each other, so they agree by default.
func CrossCheck(logger telemetry.Point, p store.VesselPosition) Check {
	c := Check{
		LoggerLatE6: logger.LatitudeE6, LoggerLonE6: logger.LongitudeE6,
		DistanceM: geo.DistanceMeters(logger.LatitudeE6, logger.LongitudeE6, p.LatE6, p.LonE6),
		AgeSec:    max(logger.Timestamp-p.Timestamp, p.Timestamp-logger.Timestamp),
	}
	c.Comparable = c.AgeSec <= MismatchWindow
	c.Agrees = !(c.DistanceM > MismatchMeters && c.Comparable)
	return c
}

// Tracker keeps the AIS stream pointed at the vessels of live shipments, stores what it reports, and records an
// advisory AIS_MISMATCH audit event when a shipment's logger and its vessel disagree.
type Tracker struct {
	Store  *store.Store
	Stream Stream // nil when AIS is not configured
	Log    *slog.Logger

	mu       sync.Mutex
	lastSave map[string]int64     // per vessel: timestamp of the last stored position
	flagged  map[string]time.Time // per shipment: when a mismatch was last recorded
}

// Enabled reports whether a live AIS feed is configured.
func (t *Tracker) Enabled() bool { return t != nil && t.Stream != nil }

func (t *Tracker) log() *slog.Logger {
	if t.Log == nil {
		return slog.Default()
	}
	return t.Log
}

// Refresh points the stream at the vessels of every live shipment. Call it after a vessel is named.
func (t *Tracker) Refresh(ctx context.Context) error {
	if !t.Enabled() {
		return nil
	}
	mmsis, err := t.Store.WatchedMMSIs(ctx)
	if err != nil {
		return err
	}
	t.Stream.Watch(mmsis)
	return nil
}

// Run follows the stream until ctx is cancelled.
func (t *Tracker) Run(ctx context.Context) error {
	if !t.Enabled() {
		return nil
	}
	if err := t.Refresh(ctx); err != nil {
		t.log().Error("load watched vessels", "err", err)
	}
	positions := make(chan Position, 256)
	go func() { _ = t.Stream.Run(ctx, positions) }()
	refresh := time.NewTicker(5 * time.Minute) // shipments settle and new vessels are named
	defer refresh.Stop()
	prune := time.NewTicker(time.Hour)
	defer prune.Stop()
	for {
		select {
		case <-ctx.Done():
			return ctx.Err()
		case p := <-positions:
			if err := t.Record(ctx, p); err != nil {
				t.log().Warn("record AIS position", "mmsi", p.MMSI, "err", err)
			}
		case <-refresh.C:
			if err := t.Refresh(ctx); err != nil {
				t.log().Warn("refresh watched vessels", "err", err)
			}
		case <-prune.C:
			if err := t.Store.PruneVesselPositions(ctx, time.Now().Add(-keepFor).Unix()); err != nil {
				t.log().Warn("prune AIS positions", "err", err)
			}
		}
	}
}

// Record stores a position (at most one per vessel per minute) and cross-checks it against the logger of every
// shipment on that vessel.
func (t *Tracker) Record(ctx context.Context, p Position) error {
	t.mu.Lock()
	if t.lastSave == nil {
		t.lastSave, t.flagged = map[string]int64{}, map[string]time.Time{}
	}
	last, seen := t.lastSave[p.MMSI]
	skip := seen && p.Timestamp-last < storeEvery && p.Timestamp >= last
	if !skip {
		t.lastSave[p.MMSI] = p.Timestamp
	}
	t.mu.Unlock()
	if skip {
		return nil
	}
	vp := store.VesselPosition{MMSI: p.MMSI, Timestamp: p.Timestamp, LatE6: p.LatE6, LonE6: p.LonE6, SogKnotsX10: p.SogKnotsX10, CogDegX10: p.CogDegX10}
	if err := t.Store.AddVesselPosition(ctx, vp); err != nil {
		return err
	}
	shipments, err := t.Store.ShipmentsOnVessel(ctx, p.MMSI)
	if err != nil {
		return err
	}
	for _, id := range shipments {
		logger, err := t.Store.LatestReading(ctx, id)
		if errors.Is(err, store.ErrNotFound) {
			continue
		}
		if err != nil {
			return err
		}
		c := CrossCheck(logger, vp)
		if c.Agrees || !t.shouldFlag(id) {
			continue
		}
		if _, err := t.Store.InsertAIEvent(ctx, store.AIEvent{
			ShipmentID: id, Severity: "WARNING", ActionType: "ADVISORY", ReasonCode: ReasonMismatch,
			Data: map[string]any{"mmsi": p.MMSI, "distanceM": c.DistanceM, "ageSec": c.AgeSec, "aisLatE6": p.LatE6, "aisLonE6": p.LonE6,
				"loggerLatE6": c.LoggerLatE6, "loggerLonE6": c.LoggerLonE6, "note": "advisory only: AIS never moves money"},
		}); err != nil {
			return err
		}
	}
	return nil
}

// shouldFlag allows one mismatch record per shipment per window, so a long disagreement is one audit line, not
// thousands.
func (t *Tracker) shouldFlag(shipmentID string) bool {
	t.mu.Lock()
	defer t.mu.Unlock()
	if at, ok := t.flagged[shipmentID]; ok && time.Since(at) < MismatchWindow*time.Second {
		return false
	}
	t.flagged[shipmentID] = time.Now()
	return true
}
