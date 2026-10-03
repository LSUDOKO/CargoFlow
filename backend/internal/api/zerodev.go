package api

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/sponsor"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
)

// ZeroDevSponsor configures the ZeroDev custom gas policy webhook.
type ZeroDevSponsor struct {
	Secret    string // the path secret; the URL is the only credential ZeroDev sends
	ProjectID string
	ChainID   uint64
	Policy    sponsor.Policy
	PerSender int // per sender per rolling 24 hours
	Global    int // everyone per rolling 24 hours
}

type zerodevRequest struct {
	ProjectID string           `json:"projectId"`
	ChainID   sponsor.Quantity `json:"chainId"`
	UserOp    sponsor.UserOp   `json:"userOp"`
}

// zerodevRequestDoc documents the body (v0.6 initCode/paymasterAndData or v0.7 factory/factoryData/paymaster fields).
type zerodevRequestDoc struct {
	ProjectID string `json:"projectId" doc:"must equal ZERODEV_PROJECT_ID"`
	ChainID   int64  `json:"chainId" doc:"must equal CHAIN_ID"`
	UserOp    struct {
		Sender               string `json:"sender"`
		Nonce                string `json:"nonce"`
		InitCode             string `json:"initCode,omitempty" optional:"true" doc:"v0.6"`
		Factory              string `json:"factory,omitempty" optional:"true" doc:"v0.7"`
		FactoryData          string `json:"factoryData,omitempty" optional:"true" doc:"v0.7"`
		CallData             string `json:"callData" doc:"Kernel v3 execute(bytes32 mode, bytes executionCalldata) single or batch, or Kernel v2 execute/executeBatch"`
		PaymasterAndData     string `json:"paymasterAndData,omitempty" optional:"true" doc:"v0.6"`
		Signature            string `json:"signature"`
		MaxFeePerGas         string `json:"maxFeePerGas"`
		MaxPriorityFeePerGas string `json:"maxPriorityFeePerGas"`
		CallGasLimit         string `json:"callGasLimit"`
		VerificationGasLimit string `json:"verificationGasLimit"`
		PreVerificationGas   string `json:"preVerificationGas"`
	} `json:"userOp"`
}

type zerodevResponse struct {
	Proceed bool `json:"proceed" doc:"true: CargoFlow sponsors this user operation"`
}

func (s *Server) zerodevWebhook(w http.ResponseWriter, r *http.Request) error {
	z := s.c.ZeroDev
	if z == nil || z.Secret == "" || subtle.ConstantTimeCompare([]byte(r.PathValue("secret")), []byte(z.Secret)) != 1 {
		http.NotFound(w, r) // the same answer as an unknown path: the route's existence is not revealed
		return nil
	}
	ctx, cancel := context.WithTimeout(r.Context(), 800*time.Millisecond)
	defer cancel()
	decide := func(ok bool, sender, reason string) error {
		s.c.Log.Info("zerodev sponsorship", "proceed", ok, "sender", strings.ToLower(sender), "reason", reason)
		writeJSON(w, http.StatusOK, zerodevResponse{Proceed: ok})
		return nil
	}
	body, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 256<<10))
	if err != nil {
		return decide(false, "", "unreadable body")
	}
	var req zerodevRequest
	if err := json.Unmarshal(body, &req); err != nil {
		return decide(false, "", "malformed body")
	}
	op := req.UserOp
	if req.ProjectID != z.ProjectID {
		return decide(false, op.Sender, "wrong project")
	}
	if req.ChainID.Int == nil || !req.ChainID.IsUint64() || req.ChainID.Uint64() != z.ChainID {
		return decide(false, op.Sender, "wrong chain")
	}
	if ok, reason := z.Policy.Check(op); !ok {
		return decide(false, op.Sender, reason)
	}
	nonce := "0"
	if op.Nonce.Int != nil {
		nonce = op.Nonce.String()
	}
	verdict, err := s.c.Store.ReserveSponsorship(ctx, op.Sender, nonce, op.MaxCost().String(), z.PerSender, z.Global)
	switch {
	case err != nil:
		return decide(false, op.Sender, "rate limit unavailable")
	case verdict == store.SponsorSenderLimit:
		return decide(false, op.Sender, "sender daily limit")
	case verdict == store.SponsorGlobalLimit:
		return decide(false, op.Sender, "global daily limit")
	}
	return decide(true, op.Sender, "allowed")
}
