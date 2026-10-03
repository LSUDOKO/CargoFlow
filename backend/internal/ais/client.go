// Package ais follows the vessels carrying CargoFlow shipments through aisstream.io's AIS feed, so the logger's own
// position can be cross-checked against the ship's transponder. AIS is advisory evidence: a disagreement is
// recorded for people to see, it never moves money.
package ais

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"math"
	"slices"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/coder/websocket"

	"github.com/LSUDOKO/CargoFlow/backend/internal/config"
)

// DefaultURL is aisstream.io's streaming endpoint.
const DefaultURL = "wss://stream.aisstream.io/v0/stream"

// maxMMSIs is how many vessels one aisstream subscription may filter on.
const maxMMSIs = 50

// Position is one AIS position report, in CargoFlow's fixed-point units.
type Position struct {
	MMSI        string
	Name        string
	LatE6       int32
	LonE6       int32
	Timestamp   int64 // unix seconds, from the report's UTC time
	SogKnotsX10 int32 // speed over ground, knots x 10
	CogDegX10   int32 // course over ground, degrees x 10
}

// Stream delivers positions for a changing set of vessels.
type Stream interface {
	Run(ctx context.Context, out chan<- Position) error
	Watch(mmsis []string)
}

// Client is the aisstream.io Stream. It connects only while there is at least one vessel to watch (an empty MMSI
// filter would stream every ship on earth), resubscribes on the open connection when the set changes, and
// reconnects with exponential backoff when the connection drops.
type Client struct {
	key config.Secret
	url string

	MinBackoff time.Duration // default 1s
	MaxBackoff time.Duration // default 60s
	Log        *slog.Logger

	mu      sync.Mutex
	mmsis   []string
	changed chan struct{}
}

// NewClient builds a client. An empty url selects aisstream.io.
func NewClient(key config.Secret, url string) *Client {
	if url == "" {
		url = DefaultURL
	}
	return &Client{key: key, url: url, Log: slog.Default(), changed: make(chan struct{}, 1)}
}

// Watch replaces the set of vessels to follow. Duplicates are dropped and at most 50 are followed.
func (c *Client) Watch(mmsis []string) {
	set := slices.Clone(mmsis)
	slices.Sort(set)
	set = slices.Compact(set)
	if len(set) > maxMMSIs {
		c.Log.Warn("aisstream filters at most 50 vessels; following the first 50", "requested", len(set))
		set = set[:maxMMSIs]
	}
	c.mu.Lock()
	same := slices.Equal(set, c.mmsis)
	c.mmsis = set
	c.mu.Unlock()
	if !same {
		select {
		case c.changed <- struct{}{}:
		default:
		}
	}
}

func (c *Client) current() []string {
	c.mu.Lock()
	defer c.mu.Unlock()
	return slices.Clone(c.mmsis)
}

var errNoVessels = errors.New("ais: no vessel left to watch")

// Run streams positions to out until ctx is cancelled.
func (c *Client) Run(ctx context.Context, out chan<- Position) error {
	minWait, maxWait := c.MinBackoff, c.MaxBackoff
	if minWait <= 0 {
		minWait = time.Second
	}
	if maxWait <= 0 {
		maxWait = time.Minute
	}
	wait := minWait
	for {
		if len(c.current()) == 0 {
			select {
			case <-ctx.Done():
				return ctx.Err()
			case <-c.changed:
				continue
			}
		}
		received, err := c.session(ctx, out)
		switch {
		case ctx.Err() != nil:
			return ctx.Err()
		case errors.Is(err, errNoVessels):
			continue
		}
		if received {
			wait = minWait
		}
		c.Log.Warn("aisstream connection ended; reconnecting", "err", c.redact(err), "retry_in", wait)
		select {
		case <-ctx.Done():
			return ctx.Err()
		case <-time.After(wait):
		}
		wait = min(wait*2, maxWait)
	}
}

func (c *Client) redact(err error) string {
	if err == nil {
		return ""
	}
	s := err.Error()
	if k := c.key.Reveal(); k != "" {
		s = strings.ReplaceAll(s, k, "[redacted]")
	}
	return s
}

// session runs one connection and reports whether any position arrived on it.
func (c *Client) session(ctx context.Context, out chan<- Position) (bool, error) {
	dctx, cancel := context.WithTimeout(ctx, 15*time.Second)
	conn, _, err := websocket.Dial(dctx, c.url, nil)
	cancel()
	if err != nil {
		return false, err
	}
	defer conn.CloseNow()
	conn.SetReadLimit(1 << 20)
	// aisstream drops a connection that has not subscribed within three seconds
	if err := c.subscribe(ctx, conn, c.current()); err != nil {
		return false, err
	}

	sctx, stop := context.WithCancel(ctx)
	defer stop()
	ended := make(chan error, 1)
	go func() {
		for {
			select {
			case <-sctx.Done():
				return
			case <-c.changed:
				set := c.current()
				if len(set) == 0 {
					ended <- errNoVessels
					_ = conn.Close(websocket.StatusNormalClosure, "")
					return
				}
				if err := c.subscribe(sctx, conn, set); err != nil {
					ended <- err
					_ = conn.CloseNow()
					return
				}
			}
		}
	}()

	received := false
	for {
		_, data, err := conn.Read(sctx)
		if err != nil {
			select {
			case why := <-ended:
				return received, why
			default:
				return received, err
			}
		}
		p, ok, problem := parse(data)
		if problem != "" {
			c.Log.Warn("aisstream reported an error", "error", problem)
		}
		if !ok {
			continue
		}
		received = true
		select {
		case out <- p:
		case <-ctx.Done():
			return received, ctx.Err()
		}
	}
}

func (c *Client) subscribe(ctx context.Context, conn *websocket.Conn, mmsis []string) error {
	msg, err := json.Marshal(map[string]any{
		"APIKey":             c.key.Reveal(),
		"BoundingBoxes":      [][][]float64{{{-90, -180}, {90, 180}}},
		"FiltersShipMMSI":    mmsis,
		"FilterMessageTypes": []string{"PositionReport"},
	})
	if err != nil {
		return err
	}
	wctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	return conn.Write(wctx, websocket.MessageText, msg)
}

// report is the part of an aisstream message CargoFlow reads.
type report struct {
	Error       string `json:"error"`
	MessageType string `json:"MessageType"`
	Message     struct {
		PositionReport *struct {
			Latitude  float64 `json:"Latitude"`
			Longitude float64 `json:"Longitude"`
			Sog       float64 `json:"Sog"`
			Cog       float64 `json:"Cog"`
			UserID    int64   `json:"UserID"`
		} `json:"PositionReport"`
	} `json:"Message"`
	MetaData struct {
		MMSI     int64  `json:"MMSI"`
		ShipName string `json:"ShipName"`
		TimeUTC  string `json:"time_utc"`
	} `json:"MetaData"`
}

// parse decodes a position report. It returns ok=false for anything else, and the feed's error text if it sent one.
func parse(data []byte) (Position, bool, string) {
	var r report
	if err := json.Unmarshal(data, &r); err != nil {
		return Position{}, false, ""
	}
	if r.Error != "" {
		return Position{}, false, r.Error
	}
	pr := r.Message.PositionReport
	if r.MessageType != "PositionReport" || pr == nil {
		return Position{}, false, ""
	}
	// AIS uses 91 and 181 for "not available"
	if math.Abs(pr.Latitude) > 90 || math.Abs(pr.Longitude) > 180 {
		return Position{}, false, ""
	}
	mmsi := r.MetaData.MMSI
	if mmsi == 0 {
		mmsi = pr.UserID
	}
	ts := time.Now().Unix()
	if t, err := time.Parse("2006-01-02 15:04:05.999999999 -0700 MST", r.MetaData.TimeUTC); err == nil {
		ts = t.Unix()
	}
	return Position{
		MMSI: strconv.FormatInt(mmsi, 10), Name: strings.TrimSpace(r.MetaData.ShipName),
		LatE6: int32(math.Round(pr.Latitude * 1e6)), LonE6: int32(math.Round(pr.Longitude * 1e6)), Timestamp: ts,
		SogKnotsX10: int32(math.Round(pr.Sog * 10)), CogDegX10: int32(math.Round(pr.Cog * 10)),
	}, true, ""
}
