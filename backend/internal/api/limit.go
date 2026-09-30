package api

import (
	"sync"
	"time"
)

// limiter is a fixed-window rate limiter keyed by caller (source id or "admin"). It is deliberately
// simple: it bounds a misbehaving or compromised credential, it is not a DDoS defence (put a reverse
// proxy in front for that).
type limiter struct {
	mu      sync.Mutex
	now     func() time.Time
	windows map[string]*window
}

type window struct {
	start time.Time
	count int
}

func newLimiter(now func() time.Time) *limiter {
	if now == nil {
		now = time.Now
	}
	return &limiter{now: now, windows: map[string]*window{}}
}

// allow reports whether key may make another request this minute, and if not, how long to wait.
func (l *limiter) allow(key string, perMinute int) (bool, time.Duration) {
	if perMinute <= 0 {
		return true, 0
	}
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	w := l.windows[key]
	if w == nil || now.Sub(w.start) >= time.Minute {
		l.windows[key] = &window{start: now, count: 1}
		l.gc(now)
		return true, 0
	}
	if w.count >= perMinute {
		return false, time.Minute - now.Sub(w.start)
	}
	w.count++
	return true, 0
}

// gc drops expired windows so the map cannot grow without bound.
func (l *limiter) gc(now time.Time) {
	if len(l.windows) < 1024 {
		return
	}
	for k, w := range l.windows {
		if now.Sub(w.start) >= time.Minute {
			delete(l.windows, k)
		}
	}
}
