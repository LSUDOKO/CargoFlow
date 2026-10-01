// Package demo runs the CargoFlow story on demand for judge mode in the web frontend. It is only wired when
// DEMO_MODE is on: the backend then holds three demo wallets (exporter, financier, buyer) and plays the same
// scenes as `cargoflow demo` and the end-to-end test, one HTTP request per scene.
package demo

import (
	"context"
	"errors"
	"sync"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/hero"
)

// Errors callers can match.
var (
	ErrNotFound = errors.New("demo: no such run")
	ErrBusy     = errors.New("demo: a run was started moments ago; try again shortly")
)

// Config wires the registry.
type Config struct {
	APIURL   string // this backend's own base URL; the scenes call its public and admin API
	AdminKey string
	Chain    *chain.Client

	Exporter, Financier, Buyer *chain.Signer
	Divisor                    int64 // scales every USDG amount (see hero.Config.AmountDivisor)
	Mint                       bool  // mint test USDG (local mock token only)

	MaxSessions  int           // live runs kept in memory; the oldest is evicted (default 20)
	CreateEvery  time.Duration // minimum spacing between new runs (default 30s)
	SceneTimeout time.Duration // a scene finishes even if the caller disconnects (default 5m)
	Now          func() time.Time
}

type session interface {
	Run(ctx context.Context, scene string) (hero.StepResult, error)
	ShipmentID() string
	Done() []string
	Next() string
}

type entry struct {
	s       session
	created time.Time
}

// Registry holds the live demo runs.
type Registry struct {
	c Config

	mu         sync.Mutex
	runs       map[string]*entry
	order      []string // creation order, for eviction
	lastCreate time.Time

	work sync.Mutex // the demo wallets send one scene at a time, so their nonces never race

	newSession func() (session, error)
}

// New builds a registry.
func New(c Config) *Registry {
	if c.MaxSessions <= 0 {
		c.MaxSessions = 20
	}
	if c.CreateEvery <= 0 {
		c.CreateEvery = 30 * time.Second
	}
	if c.SceneTimeout <= 0 {
		c.SceneTimeout = 5 * time.Minute
	}
	if c.Now == nil {
		c.Now = time.Now
	}
	r := &Registry{c: c, runs: map[string]*entry{}}
	r.newSession = func() (session, error) {
		return hero.NewSession(hero.Config{
			APIURL: r.apiURL(), AdminKey: r.c.AdminKey, Chain: r.c.Chain,
			Exporter: r.c.Exporter, Financier: r.c.Financier, Buyer: r.c.Buyer,
			MintTestTokens: r.c.Mint, AmountDivisor: r.c.Divisor, RefPrefix: "CF-DEMO",
		})
	}
	return r
}

// SetAPIURL sets the backend's own base URL once its listener address is known.
func (r *Registry) SetAPIURL(u string) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.c.APIURL = u
}

func (r *Registry) apiURL() string {
	r.mu.Lock()
	defer r.mu.Unlock()
	return r.c.APIURL
}

// Divisor reports the amount scale the runs use.
func (r *Registry) Divisor() int64 { return max(r.c.Divisor, 1) }

// detached keeps a scene running to completion when the HTTP client goes away: a half-played scene would leave
// the facility between states.
func (r *Registry) detached(ctx context.Context) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.WithoutCancel(ctx), r.c.SceneTimeout)
}

// Create starts a run and plays its setup scene (register, fund, start transit).
func (r *Registry) Create(ctx context.Context) (string, hero.StepResult, error) {
	r.mu.Lock()
	now := r.c.Now()
	if !r.lastCreate.IsZero() && now.Sub(r.lastCreate) < r.c.CreateEvery {
		r.mu.Unlock()
		return "", hero.StepResult{}, ErrBusy
	}
	r.lastCreate = now
	r.mu.Unlock()

	s, err := r.newSession()
	if err != nil {
		return "", hero.StepResult{}, err
	}
	r.work.Lock()
	defer r.work.Unlock()
	ctx, cancel := r.detached(ctx)
	defer cancel()
	res, err := s.Run(ctx, hero.SceneSetup)
	id := s.ShipmentID()
	if id != "" {
		r.remember(id, s, now)
	}
	return id, res, err
}

func (r *Registry) remember(id string, s session, now time.Time) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.runs[id] = &entry{s: s, created: now}
	r.order = append(r.order, id)
	for len(r.order) > r.c.MaxSessions {
		delete(r.runs, r.order[0])
		r.order = r.order[1:]
	}
}

// Scene plays one scene of a run. A scene already played returns its recorded result.
func (r *Registry) Scene(ctx context.Context, id, scene string) (hero.StepResult, error) {
	r.mu.Lock()
	e, ok := r.runs[id]
	r.mu.Unlock()
	if !ok {
		return hero.StepResult{}, ErrNotFound
	}
	r.work.Lock()
	defer r.work.Unlock()
	ctx, cancel := r.detached(ctx)
	defer cancel()
	return e.s.Run(ctx, scene)
}

// Status reports a run's completed scenes and the next one ("" when finished).
func (r *Registry) Status(id string) (done []string, next string, ok bool) {
	r.mu.Lock()
	e, ok := r.runs[id]
	r.mu.Unlock()
	if !ok {
		return nil, "", false
	}
	return e.s.Done(), e.s.Next(), true
}
