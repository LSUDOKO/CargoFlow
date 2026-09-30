// Package epoch turns a validated telemetry stream into closed evidence epochs: each a batch of
// readings with a salted Poseidon Merkle root, an evidence score and a risk figure. It is the only
// place the ingestion, evidence, risk and commitment layers meet.
package epoch

import (
	"errors"
	"fmt"
	"math/big"
	"sort"

	"github.com/LSUDOKO/CargoFlow/backend/internal/evidence"
	"github.com/LSUDOKO/CargoFlow/backend/internal/geo"
	"github.com/LSUDOKO/CargoFlow/backend/internal/merkle"
	"github.com/LSUDOKO/CargoFlow/backend/internal/risk"
	"github.com/LSUDOKO/CargoFlow/backend/internal/telemetry"
)

// DefaultReadingsPerSensor is the demo epoch size (docs/project/07-evidence-engine.md section 10).
const DefaultReadingsPerSensor = 8

const defaultJitterSec = 30

// Config fixes everything an epoch's content depends on.
type Config struct {
	ShipmentID        [32]byte
	Policy            evidence.Policy
	Route             []geo.Point
	SaltSecret        []byte         // operator secret; salts make committed readings unguessable
	Reliability       map[string]int // per-sensor reliability in bps (optional)
	RiskContext       risk.Context
	ReadingsPerSensor int   // defaults to 8
	JitterSec         int64 // tolerated out-of-order slack, defaults to 30s
}

// Epoch is a closed batch of readings and everything derived from it.
type Epoch struct {
	ShipmentID [32]byte
	Sequence   uint32
	Points     []telemetry.Point // sorted by (timestamp, sensor): the leaf order of the tree
	StartTime  int64
	EndTime    int64
	Root       *big.Int
	Result     evidence.Result
	RiskBps    int

	tree   *merkle.Tree
	leaves []*big.Int
}

// RootBytes32 is the root as the bytes32 committed to EvidenceRegistry.
func (e *Epoch) RootBytes32() []byte { return e.tree.RootBytes32() }

// Leaf returns the committed leaf hash of reading i.
func (e *Epoch) Leaf(i int) *big.Int { return new(big.Int).Set(e.leaves[i]) }

// Prove returns the inclusion proof for reading i.
func (e *Epoch) Prove(i int) ([]*big.Int, error) { return e.tree.Prove(i) }

// Processor ingests readings for one shipment. It is not safe for concurrent use.
type Processor struct {
	cfg        Config
	validator  *telemetry.Validator
	buffer     []telemetry.Point
	counts     map[string]int
	next       uint32
	rejections []telemetry.Rejection
}

// NewProcessor validates cfg and returns a ready Processor.
func NewProcessor(cfg Config) (*Processor, error) {
	if len(cfg.SaltSecret) == 0 {
		return nil, errors.New("epoch: SaltSecret is required; without it committed readings can be brute-forced")
	}
	if cfg.Policy.Band.MinTempX100 >= cfg.Policy.Band.MaxTempX100 {
		return nil, errors.New("epoch: temperature band is empty or inverted")
	}
	if cfg.ReadingsPerSensor < 1 {
		cfg.ReadingsPerSensor = DefaultReadingsPerSensor
	}
	if cfg.JitterSec < 1 {
		cfg.JitterSec = defaultJitterSec
	}
	return &Processor{cfg: cfg, validator: telemetry.NewValidator(cfg.JitterSec), counts: map[string]int{}}, nil
}

// Rejections returns the quarantine log: every point refused at ingestion, with its reason.
func (p *Processor) Rejections() []telemetry.Rejection {
	return append([]telemetry.Rejection(nil), p.rejections...)
}

// Ingest validates and buffers one reading. It returns a closed epoch when the reading completes
// one, or when it would push a sensor past the epoch size while another sensor has gone quiet (the
// epoch then closes without the new reading, which starts the next one). A refused reading returns
// a *telemetry.Rejection and changes nothing.
func (p *Processor) Ingest(pt telemetry.Point) (*Epoch, error) {
	if err := p.validator.Accept(pt); err != nil {
		var rej *telemetry.Rejection
		if errors.As(err, &rej) {
			p.rejections = append(p.rejections, *rej)
		}
		return nil, err
	}

	var closed *Epoch
	if p.counts[pt.SensorID] >= p.cfg.ReadingsPerSensor {
		// this sensor is already full and another is lagging or silent: close what we have
		e, err := p.closeEpoch()
		if err != nil {
			return nil, err
		}
		closed = e
	}
	p.buffer = append(p.buffer, pt)
	p.counts[pt.SensorID]++

	if closed != nil {
		return closed, nil
	}
	for _, c := range p.counts {
		if c < p.cfg.ReadingsPerSensor {
			return nil, nil
		}
	}
	return p.closeEpoch() // every sensor seen in this epoch has delivered its share
}

// Flush closes whatever is buffered as a final, possibly short, epoch.
func (p *Processor) Flush() (*Epoch, error) {
	if len(p.buffer) == 0 {
		return nil, nil
	}
	return p.closeEpoch()
}

func (p *Processor) closeEpoch() (*Epoch, error) {
	pts := p.buffer
	p.buffer = nil
	p.counts = map[string]int{}

	sort.SliceStable(pts, func(i, j int) bool {
		if pts[i].Timestamp != pts[j].Timestamp {
			return pts[i].Timestamp < pts[j].Timestamp
		}
		return pts[i].SensorID < pts[j].SensorID
	})
	leaves := make([]*big.Int, len(pts))
	for i, pt := range pts {
		salt := merkle.DeriveSalt(p.cfg.SaltSecret, p.cfg.ShipmentID, pt.SensorID, pt.Timestamp)
		leaf, err := merkle.LeafHash(pt, salt)
		if err != nil {
			return nil, fmt.Errorf("epoch: cannot commit reading %d: %w", i, err)
		}
		leaves[i] = leaf
	}
	tree, err := merkle.Build(leaves)
	if err != nil {
		return nil, err
	}

	res := evidence.Evaluate(evidence.EpochInput{
		Points: pts, Policy: p.cfg.Policy, Reliability: p.cfg.Reliability, Route: p.cfg.Route,
	})
	e := &Epoch{
		ShipmentID: p.cfg.ShipmentID,
		Sequence:   p.next,
		Points:     pts,
		StartTime:  pts[0].Timestamp,
		EndTime:    pts[len(pts)-1].Timestamp,
		Root:       tree.Root(),
		Result:     res,
		RiskBps:    risk.Score(risk.FromEvidence(res, p.cfg.RiskContext)),
		tree:       tree,
		leaves:     leaves,
	}
	p.next++
	return e, nil
}
