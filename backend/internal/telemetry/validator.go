package telemetry

// DefaultHistory is how many recent readings per sensor are remembered for replay detection.
const DefaultHistory = 4096

// Validator is the stateful ingestion gate. It applies the stateless checks, then rejects replayed
// packets, conflicting duplicates (same sensor and timestamp, different values) and timestamps that
// run backwards by more than the allowed jitter. Only accepted points change its state.
//
// A Validator is not safe for concurrent use; the ingestion worker owns one per shipment.
type Validator struct {
	jitterSec  int64
	historyCap int
	sensors    map[string]*sensorState
}

type sensorState struct {
	last  int64
	seen  map[int64]Point
	order []int64 // insertion order, oldest first, for bounded history
}

// NewValidator returns a Validator with the default history size.
func NewValidator(jitterSec int64) *Validator {
	return NewValidatorWithHistory(jitterSec, DefaultHistory)
}

// NewValidatorWithHistory bounds replay memory to historyCap readings per sensor.
func NewValidatorWithHistory(jitterSec int64, historyCap int) *Validator {
	if historyCap < 1 {
		historyCap = 1
	}
	return &Validator{jitterSec: jitterSec, historyCap: historyCap, sensors: make(map[string]*sensorState)}
}

// Accept returns nil and records the point, or a *Rejection explaining why it was refused.
func (v *Validator) Accept(p Point) error {
	if err := ValidatePoint(p); err != nil {
		return err
	}

	st := v.sensors[p.SensorID]
	if st != nil {
		if prev, dup := st.seen[p.Timestamp]; dup {
			if prev == p {
				return &Rejection{Reason: ReasonReplay, Point: p}
			}
			return &Rejection{Reason: ReasonEquivocation, Point: p}
		}
		if p.Timestamp < st.last-v.jitterSec {
			return &Rejection{Reason: ReasonOutOfOrder, Point: p}
		}
	} else {
		st = &sensorState{seen: make(map[int64]Point)}
		v.sensors[p.SensorID] = st
	}

	st.seen[p.Timestamp] = p
	st.order = append(st.order, p.Timestamp)
	if len(st.order) > v.historyCap {
		delete(st.seen, st.order[0])
		st.order = st.order[1:]
	}
	if p.Timestamp > st.last {
		st.last = p.Timestamp
	}
	return nil
}
