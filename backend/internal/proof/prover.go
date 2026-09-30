package proof

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"os/exec"
	"path/filepath"
	"strings"

	"github.com/LSUDOKO/CargoFlow/backend/internal/epoch"
)

// EpochReadings is the number of readings the circuit proves (its Merkle tree has 8 leaves).
const EpochReadings = 8

var (
	// ErrNotProvable means at least one reading lies outside the policy bounds, so no valid proof exists.
	// It is returned before any proving time is spent.
	ErrNotProvable = errors.New("proof: readings violate the policy bounds")
	// ErrWrongEpochSize means the epoch does not have exactly EpochReadings readings.
	ErrWrongEpochSize = errors.New("proof: epoch must contain exactly 8 readings")
)

// Request asks for a proof that Epoch's readings all lie within the bounds, bound to ContextHash.
// ContextHash is the value the contract derives (see ContextHash and FinancingController.proofContext).
type Request struct {
	Epoch       *epoch.Epoch
	ContextHash *big.Int
	MinTempX100 int32
	MaxTempX100 int32
}

// Validate checks everything that would otherwise make proving fail slowly or produce a proof the
// contract must reject.
func (r Request) Validate() error {
	if r.Epoch == nil {
		return errors.New("proof: nil epoch")
	}
	if len(r.Epoch.Points) != EpochReadings {
		return fmt.Errorf("%w (got %d)", ErrWrongEpochSize, len(r.Epoch.Points))
	}
	if r.ContextHash == nil || r.ContextHash.Sign() < 0 || r.ContextHash.Cmp(ScalarField) >= 0 {
		return errors.New("proof: context hash is not a BN254 field element")
	}
	if _, err := OffsetTemp(r.MinTempX100); err != nil {
		return fmt.Errorf("min bound: %w", err)
	}
	if _, err := OffsetTemp(r.MaxTempX100); err != nil {
		return fmt.Errorf("max bound: %w", err)
	}
	if r.MinTempX100 >= r.MaxTempX100 {
		return errors.New("proof: empty temperature range")
	}
	for i, p := range r.Epoch.Points {
		if p.TemperatureX100 < r.MinTempX100 || p.TemperatureX100 > r.MaxTempX100 {
			return fmt.Errorf("%w: reading %d is %d (allowed %d..%d)", ErrNotProvable, i, p.TemperatureX100, r.MinTempX100, r.MaxTempX100)
		}
	}
	return nil
}

// CircuitReading is one reading in the exact JSON form circuits/scripts/prove.js consumes.
type CircuitReading struct {
	Timestamp       int64  `json:"timestamp"`
	SensorID        string `json:"sensorId"`
	TemperatureX100 int32  `json:"temperatureX100"`
	HumidityX100    int32  `json:"humidityX100"`
	LatitudeE6      int32  `json:"latitudeE6"`
	LongitudeE6     int32  `json:"longitudeE6"`
	ShockX100       int32  `json:"shockX100"`
	Salt            string `json:"salt"`
}

// CircuitInput is the prover's request body. It contains private witness material (readings and
// salts): keep it in memory, never persist or log it.
type CircuitInput struct {
	Readings    []CircuitReading `json:"readings"`
	ContextHash string           `json:"contextHash"`
	MinTempX100 int32            `json:"minTempX100"`
	MaxTempX100 int32            `json:"maxTempX100"`
}

// CircuitInput builds the witness for the circuit, in the epoch's committed leaf order.
func (r Request) CircuitInput() (CircuitInput, error) {
	if err := r.Validate(); err != nil {
		return CircuitInput{}, err
	}
	in := CircuitInput{
		ContextHash: r.ContextHash.String(),
		MinTempX100: r.MinTempX100,
		MaxTempX100: r.MaxTempX100,
	}
	for i, p := range r.Epoch.Points {
		in.Readings = append(in.Readings, CircuitReading{
			Timestamp: p.Timestamp, SensorID: p.SensorID, TemperatureX100: p.TemperatureX100,
			HumidityX100: p.HumidityX100, LatitudeE6: p.LatitudeE6, LongitudeE6: p.LongitudeE6,
			ShockX100: p.ShockX100, Salt: r.Epoch.Salt(i).String(),
		})
	}
	return in, nil
}

// Result is a Groth16 proof in the argument shape of Groth16Verifier.verifyProof, as 0x-prefixed
// 32-byte hex words, plus the public signals in decimal.
type Result struct {
	A          [2]string
	B          [2][2]string
	C          [2]string
	PubSignals [4]string // contextHash, merkleRoot, minTemp, maxTemp (temperatures offset by 10000)
	Root       string
}

// Prover produces proofs. The interface lets the API and queue be tested without Node or minutes of CPU.
type Prover interface {
	Prove(ctx context.Context, req Request) (*Result, error)
}

// SnarkjsProver shells out to circuits/scripts/prove.js, so the Go service never embeds a Groth16
// implementation. Proving 13.5k constraints takes tens of seconds; callers should run it off the
// request path and honour ctx cancellation.
type SnarkjsProver struct {
	CircuitsDir string // path to the circuits/ directory (needs node_modules and keys/)
	NodeBin     string // defaults to "node"
}

// Prove validates the request, runs the prover and returns the proof.
func (p *SnarkjsProver) Prove(ctx context.Context, req Request) (*Result, error) {
	in, err := req.CircuitInput()
	if err != nil {
		return nil, err
	}
	body, err := json.Marshal(in)
	if err != nil {
		return nil, err
	}

	node := p.NodeBin
	if node == "" {
		node = "node"
	}
	cmd := exec.CommandContext(ctx, node, filepath.Join("scripts", "prove.js"))
	cmd.Dir = p.CircuitsDir
	cmd.Stdin = bytes.NewReader(body)
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		// stderr never contains witness data: the script only prints error messages
		return nil, fmt.Errorf("proof: prover failed: %w: %s", err, strings.TrimSpace(stderr.String()))
	}

	var out struct {
		Root          string   `json:"root"`
		PublicSignals []string `json:"publicSignals"`
		Calldata      struct {
			A [2]string    `json:"a"`
			B [2][2]string `json:"b"`
			C [2]string    `json:"c"`
		} `json:"calldata"`
	}
	if err := json.Unmarshal(stdout.Bytes(), &out); err != nil {
		return nil, fmt.Errorf("proof: unreadable prover output: %w", err)
	}
	if len(out.PublicSignals) != 4 {
		return nil, fmt.Errorf("proof: prover returned %d public signals, want 4", len(out.PublicSignals))
	}
	res := &Result{A: out.Calldata.A, B: out.Calldata.B, C: out.Calldata.C, Root: out.Root}
	copy(res.PubSignals[:], out.PublicSignals)
	return res, nil
}
