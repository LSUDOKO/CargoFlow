package demo

import (
	"context"
	"errors"
	"fmt"
	"testing"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/hero"
)

// fakeSession plays scenes instantly with the same ordering rules as hero.Session.
type fakeSession struct {
	id   string
	next int
	runs map[string]int
}

func (f *fakeSession) Run(_ context.Context, scene string) (hero.StepResult, error) {
	idx := -1
	for i, s := range hero.Scenes {
		if s == scene {
			idx = i
		}
	}
	switch {
	case idx < 0:
		return hero.StepResult{}, hero.ErrUnknownScene
	case idx < f.next:
		return hero.StepResult{Scene: scene}, nil
	case idx > f.next:
		return hero.StepResult{}, fmt.Errorf("%w: the next scene is %q", hero.ErrOutOfOrder, hero.Scenes[f.next])
	}
	f.runs[scene]++
	f.next++
	if scene == hero.SceneSetup {
		f.id = fmt.Sprintf("0x%064d", len(f.runs)+int(time.Now().UnixNano()%1000))
	}
	return hero.StepResult{Scene: scene, TxHashes: []string{"0xabc"}}, nil
}
func (f *fakeSession) ShipmentID() string { return f.id }
func (f *fakeSession) Done() []string     { return append([]string(nil), hero.Scenes[:f.next]...) }
func (f *fakeSession) Next() string {
	if f.next >= len(hero.Scenes) {
		return ""
	}
	return hero.Scenes[f.next]
}

func registry(t *testing.T, now *time.Time, max int) (*Registry, *[]*fakeSession) {
	t.Helper()
	var made []*fakeSession
	r := New(Config{MaxSessions: max, CreateEvery: 30 * time.Second, Now: func() time.Time { return *now }})
	r.newSession = func() (session, error) {
		f := &fakeSession{runs: map[string]int{}}
		made = append(made, f)
		return f, nil
	}
	return r, &made
}

func TestCreateRunsSetupAndScenesRunInOrderOnce(t *testing.T) {
	now := time.Unix(1_000, 0)
	r, made := registry(t, &now, 20)
	ctx := context.Background()
	id, res, err := r.Create(ctx)
	if err != nil || id == "" || res.Scene != hero.SceneSetup {
		t.Fatalf("%q %+v %v", id, res, err)
	}
	if _, err := r.Scene(ctx, id, hero.SceneExcursion); !errors.Is(err, hero.ErrOutOfOrder) {
		t.Fatalf("out of order: %v", err)
	}
	for i := 0; i < 2; i++ {
		if _, err := r.Scene(ctx, id, hero.SceneHealthy); err != nil {
			t.Fatal(err)
		}
	}
	if (*made)[0].runs[hero.SceneHealthy] != 1 {
		t.Fatalf("a repeated scene touched the chain again: %v", (*made)[0].runs)
	}
	done, next, ok := r.Status(id)
	if !ok || len(done) != 2 || next != hero.SceneExcursion {
		t.Fatalf("%v %q %v", done, next, ok)
	}
	if _, err := r.Scene(ctx, "0xnope", hero.SceneHealthy); !errors.Is(err, ErrNotFound) {
		t.Fatalf("unknown run: %v", err)
	}
}

func TestCreationIsRateLimitedAndOldRunsAreEvicted(t *testing.T) {
	now := time.Unix(1_000, 0)
	r, _ := registry(t, &now, 2)
	ctx := context.Background()
	first, _, err := r.Create(ctx)
	if err != nil {
		t.Fatal(err)
	}
	if _, _, err := r.Create(ctx); !errors.Is(err, ErrBusy) {
		t.Fatalf("a second run within 30s must be refused, got %v", err)
	}
	for i := 0; i < 2; i++ {
		now = now.Add(31 * time.Second)
		if _, _, err := r.Create(ctx); err != nil {
			t.Fatal(err)
		}
	}
	if _, _, ok := r.Status(first); ok {
		t.Fatal("the oldest run should have been evicted at the cap")
	}
}
