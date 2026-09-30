package api

import (
	"testing"
	"time"
)

func TestLimiterAllowsUpToTheLimitThenBlocksUntilTheWindowResets(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	l := newLimiter(func() time.Time { return now })

	for i := 0; i < 3; i++ {
		if ok, _ := l.allow("a", 3); !ok {
			t.Fatalf("request %d was refused within the limit", i+1)
		}
	}
	ok, wait := l.allow("a", 3)
	if ok || wait <= 0 || wait > time.Minute {
		t.Fatalf("the 4th request must be refused with a retry hint, got ok=%v wait=%v", ok, wait)
	}

	now = now.Add(30 * time.Second)
	if ok, wait := l.allow("a", 3); ok || wait > 31*time.Second {
		t.Fatalf("still inside the window: ok=%v wait=%v", ok, wait)
	}
	now = now.Add(31 * time.Second)
	if ok, _ := l.allow("a", 3); !ok {
		t.Fatal("a new window must allow requests again")
	}
}

func TestLimiterKeysAreIndependentAndZeroMeansUnlimited(t *testing.T) {
	l := newLimiter(func() time.Time { return time.Unix(1, 0) })
	_, _ = l.allow("a", 1)
	if ok, _ := l.allow("a", 1); ok {
		t.Fatal("a should be limited")
	}
	if ok, _ := l.allow("b", 1); !ok {
		t.Fatal("one caller's traffic must not limit another")
	}
	for i := 0; i < 100; i++ {
		if ok, _ := l.allow("free", 0); !ok {
			t.Fatal("a zero limit means unlimited")
		}
	}
}

func TestLimiterForgetsExpiredWindows(t *testing.T) {
	now := time.Unix(1_800_000_000, 0)
	l := newLimiter(func() time.Time { return now })
	for i := 0; i < 2000; i++ {
		l.allow(string(rune(i))+"-k", 5)
	}
	now = now.Add(2 * time.Minute)
	l.allow("trigger", 5) // a new window triggers cleanup of the stale ones
	if n := len(l.windows); n > 1100 {
		t.Fatalf("expired windows are not collected: %d entries", n)
	}
}
