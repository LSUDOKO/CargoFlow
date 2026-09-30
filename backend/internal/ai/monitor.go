package ai

import (
	"context"
	"errors"
	"fmt"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/decision"
)

// Monitor consults a Provider about an epoch and reconciles its opinion with the deterministic
// decision. A nil Monitor, or one whose provider fails in any way, yields the deterministic decision.
type Monitor struct {
	provider      Provider
	minConfidence float64
	timeout       time.Duration
}

// MonitorOptions tunes a Monitor.
type MonitorOptions struct {
	MinConfidence float64       // confidence required to honour a stricter request; defaults to 0.9
	Timeout       time.Duration // per-consultation deadline; defaults to 10s
}

// Defaults for MonitorOptions.
const (
	DefaultMinConfidence = 0.9
	DefaultTimeout       = 10 * time.Second
)

// NewMonitor builds a Monitor around a provider.
func NewMonitor(p Provider, o MonitorOptions) *Monitor {
	if o.MinConfidence <= 0 || o.MinConfidence > 1 {
		o.MinConfidence = DefaultMinConfidence
	}
	if o.Timeout <= 0 {
		o.Timeout = DefaultTimeout
	}
	return &Monitor{provider: p, minConfidence: o.MinConfidence, timeout: o.Timeout}
}

// Enabled reports whether a model is configured.
func (m *Monitor) Enabled() bool { return m != nil && m.provider != nil }

// Review returns the final decision for an epoch. It never fails: any error, stall, panic or invalid
// reply from the model is reported on the Verdict and the deterministic decision stands.
func (m *Monitor) Review(ctx context.Context, b Brief, det decision.Decision) Verdict {
	if !m.Enabled() {
		return Reconcile(det, nil, 0)
	}
	a, err := m.consult(ctx, b)
	if err != nil {
		v := Reconcile(det, nil, m.minConfidence)
		v.Provider, v.Err = m.provider.Name(), err.Error()
		v.Note = NoteModelUnavailable
		if errors.Is(err, ErrInvalidAssessment) {
			v.Note = NoteModelReplyInvalid
		}
		return v
	}
	v := Reconcile(det, &a, m.minConfidence)
	v.Provider = m.provider.Name()
	return v
}

// consult calls the provider under a deadline it cannot outlast even if it ignores its context,
// contains panics, and validates the answer again.
func (m *Monitor) consult(ctx context.Context, b Brief) (Assessment, error) {
	ctx, cancel := context.WithTimeout(ctx, m.timeout)
	defer cancel()

	type result struct {
		a   Assessment
		err error
	}
	done := make(chan result, 1) // buffered: an abandoned provider goroutine never blocks on send
	go func() {
		defer func() {
			if r := recover(); r != nil {
				done <- result{err: fmt.Errorf("ai provider panicked: %v", r)}
			}
		}()
		a, err := m.provider.Assess(ctx, b)
		done <- result{a, err}
	}()

	select {
	case <-ctx.Done():
		return Assessment{}, fmt.Errorf("ai consultation abandoned: %w", ctx.Err())
	case r := <-done:
		if r.err != nil {
			return Assessment{}, r.err
		}
		if err := Validate(r.a, b); err != nil {
			return Assessment{}, err
		}
		return r.a, nil
	}
}
