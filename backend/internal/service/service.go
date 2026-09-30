// Package service orchestrates CargoFlow: it mirrors shipments from the chain, runs authenticated
// telemetry through the evidence pipeline, commits evidence on-chain, and acts on the decision through
// role-limited keys. The chain stays the source of truth; every action is idempotent and recorded in an
// outbox so a crash or retry never sends a transaction twice.
package service

import (
	"encoding/hex"
	"errors"
	"fmt"
	"log/slog"
	"regexp"
	"strings"
	"sync"

	"github.com/ethereum/go-ethereum/common"

	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/evidence"
	"github.com/LSUDOKO/CargoFlow/backend/internal/proof"
	"github.com/LSUDOKO/CargoFlow/backend/internal/risk"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
	"github.com/LSUDOKO/CargoFlow/backend/internal/ws"
)

// Errors callers can match with errors.Is.
var (
	ErrNotFound          = errors.New("service: not found")
	ErrInvalid           = errors.New("service: invalid input")
	ErrConflict          = errors.New("service: conflict")
	ErrNotOnChain        = errors.New("service: shipment is not registered on chain")
	ErrPolicyNotRevealed = errors.New("service: the shipment's policy has not been revealed on chain")
	ErrNoFacility        = errors.New("service: no facility exists on chain for this shipment")
	ErrNotPaused         = errors.New("service: the facility is not paused")
	ErrNotRecoverable    = errors.New("service: recovery evidence is not sufficient")
)

// Options wires the service to its collaborators.
type Options struct {
	Store  *store.Store
	Chain  *chain.Client
	Hub    *ws.Hub
	Prover proof.Prover // nil disables ZK recovery

	Worker  *chain.Signer // commits evidence (EVIDENCE_VERIFIER_ROLE)
	Monitor *chain.Signer // requests pauses (MONITOR_ROLE); no other authority
	Manager *chain.Signer // releases milestones and submits recovery proofs (FACILITY_MANAGER_ROLE)

	SaltSecret  []byte
	RiskContext risk.Context // defaults to 10% counterparty and corridor risk
	Log         *slog.Logger
}

// Service is the orchestrator. It is safe for concurrent use; work on one shipment is serialised.
type Service struct {
	o Options

	mu    sync.Mutex
	locks map[string]*sync.Mutex
	state map[string]*shipmentState
}

// New builds a Service.
func New(o Options) *Service {
	if o.Log == nil {
		o.Log = slog.Default()
	}
	if o.RiskContext == (risk.Context{}) {
		o.RiskContext = risk.Context{CounterpartyBps: 1000, CorridorBps: 1000, MinReliabilityBps: evidence.DefaultReliabilityBps}
	}
	return &Service{o: o, locks: map[string]*sync.Mutex{}, state: map[string]*shipmentState{}}
}

// lock serialises work on one shipment and returns the unlock function.
func (s *Service) lock(id string) func() {
	s.mu.Lock()
	l, ok := s.locks[id]
	if !ok {
		l = &sync.Mutex{}
		s.locks[id] = l
	}
	s.mu.Unlock()
	l.Lock()
	return l.Unlock
}

func (s *Service) publish(e ws.Event) {
	if s.o.Hub != nil {
		s.o.Hub.Publish(e)
	}
}

var idPattern = regexp.MustCompile(`^0x[0-9a-f]{64}$`)

// parseID validates a shipment id and returns its bytes and canonical lowercase form.
func parseID(raw string) ([32]byte, string, error) {
	canon := strings.ToLower(strings.TrimSpace(raw))
	if !idPattern.MatchString(canon) {
		return [32]byte{}, "", fmt.Errorf("%w: shipment id must be 0x followed by 64 hex characters", ErrInvalid)
	}
	var id [32]byte
	b, _ := hex.DecodeString(canon[2:])
	copy(id[:], b)
	return id, canon, nil
}

func hex32(b [32]byte) string { return "0x" + hex.EncodeToString(b[:]) }

func addrHex(a common.Address) string { return "0x" + hex.EncodeToString(a[:]) }
