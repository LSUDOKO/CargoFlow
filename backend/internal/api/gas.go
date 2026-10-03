package api

import (
	"math/big"
	"net/http"
	"strings"
	"sync"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
)

// GasDrip sends a little native currency to a wallet that has almost none, so a new participant can pay for their
// own first transactions. Each address gets one drip per 24 hours and the drip as a whole has a daily cap.
type GasDrip struct {
	Chain     *chain.Client
	Signer    *chain.Signer // the drip's funded key; it holds no CargoFlow role
	AmountWei *big.Int      // sent per drip, and the balance below which a wallet qualifies
	Daily     int           // drips per 24 hours across all addresses

	mu sync.Mutex // one drip at a time, so the limits cannot be raced
}

var errGasUnavailable = &Error{http.StatusServiceUnavailable, "gas_unavailable", "the gas drip is not configured on this backend"}

type gasRequest struct {
	Address   string `json:"address"`
	IssuedAt  int64  `json:"issuedAt"`
	Signature string `json:"signature"`
}

func (s *Server) gas(w http.ResponseWriter, r *http.Request) error {
	var req gasRequest
	if err := decodeJSON(r, &req); err != nil {
		return err
	}
	if !addressPattern.MatchString(req.Address) {
		return ErrBadRequest("address must be a 0x address")
	}
	g := s.c.Gas
	if g == nil {
		return errGasUnavailable
	}
	// before verification: the address is the caller's choice, and checking a contract wallet costs chain calls
	if err := s.rateLimit(w, "gas:"+clientIP(r), s.c.GasPerMinute); err != nil {
		return err
	}
	who := strings.ToLower(req.Address)
	if _, err := s.walletSigner(r.Context(), auth.GasAuthorization(who, req.IssuedAt), req.Signature, req.IssuedAt,
		"sign with the wallet that receives the gas", who); err != nil {
		return err
	}
	g.mu.Lock()
	defer g.mu.Unlock()
	total, mine, err := s.c.Store.GasDripsSince(r.Context(), who, s.now().Add(-24*time.Hour))
	if err != nil {
		return err
	}
	if mine > 0 {
		return &Error{http.StatusTooManyRequests, "rate_limited", "this address already received gas in the last 24 hours"}
	}
	if total >= g.Daily {
		return &Error{http.StatusTooManyRequests, "rate_limited", "the gas drip has reached its daily limit; try again tomorrow"}
	}
	to := common.HexToAddress(who)
	have, err := g.Chain.Eth.BalanceAt(r.Context(), to, nil)
	if err != nil {
		return err
	}
	if have.Cmp(g.AmountWei) >= 0 {
		return ErrConflictMsg("this address already holds enough gas")
	}
	funds, err := g.Chain.Eth.BalanceAt(r.Context(), g.Signer.Address(), nil)
	if err != nil {
		return err
	}
	if funds.Cmp(new(big.Int).Mul(g.AmountWei, big.NewInt(2))) < 0 {
		s.c.Log.Error("the gas drip wallet is nearly empty", "address", g.Signer.Address().Hex(), "balance", funds.String())
		return &Error{http.StatusServiceUnavailable, "gas_unavailable", "the gas drip is empty; try again later"}
	}
	tx, err := g.Chain.SendValue(r.Context(), g.Signer, to, g.AmountWei)
	if err != nil {
		return err
	}
	hash := strings.ToLower(tx.Hash.Hex())
	if err := s.c.Store.RecordGasDrip(r.Context(), who, hash, g.AmountWei.String()); err != nil {
		s.c.Log.Error("record gas drip", "tx", hash, "err", err)
	}
	writeJSON(w, http.StatusOK, gasResponse{TxHash: hash, AmountWei: g.AmountWei.String(), Address: who})
	return nil
}
