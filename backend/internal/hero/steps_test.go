package hero

import (
	"errors"
	"strings"
	"testing"
)

func TestScenesMustRunInOrderAndRepeatIsRecognised(t *testing.T) {
	s := &Session{done: map[string]StepResult{}}
	if err := s.checkOrder(SceneHealthy); !errors.Is(err, ErrOutOfOrder) || !strings.Contains(err.Error(), SceneSetup) {
		t.Fatalf("got %v", err)
	}
	if err := s.checkOrder("nonsense"); !errors.Is(err, ErrUnknownScene) {
		t.Fatalf("got %v", err)
	}
	s.done[SceneSetup] = StepResult{Scene: SceneSetup}
	s.next = 1
	if err := s.checkOrder(SceneSetup); !errors.Is(err, errAlreadyDone) {
		t.Fatalf("repeat should be recognised, got %v", err)
	}
	if err := s.checkOrder(SceneHealthy); err != nil {
		t.Fatalf("the next scene was refused: %v", err)
	}
	if got := s.Next(); got != SceneHealthy {
		t.Fatalf("next = %q", got)
	}
}

func TestSceneTimesContinueTheJourneyAndJumpForwardAfterALongPause(t *testing.T) {
	if got := sceneStart(9_500, 10_000, 8); got != 9_510 {
		t.Fatalf("a scene must continue after the last reading, got %d", got)
	}
	if got := sceneStart(1_000, 10_000, 8); got != 10_000-journeyHeadroom {
		t.Fatalf("after a long pause readings move up to the headroom before now, got %d", got)
	}
}

func TestBackToBackScenesNeverProduceFutureReadings(t *testing.T) {
	now := int64(10_000)
	last := journeyAnchor(now) // set by setup
	for _, n := range []int{16, 8, 16} { // healthy, excursion, finish sent within the same second
		start := sceneStart(last, now, n)
		end := start + int64(n-1)*stepSeconds
		if end > now {
			t.Fatalf("scene of %d steps ends at %d, after now (%d)", n, end, now)
		}
		last = end
	}
}
