package api

import (
	"net/http"
	"strings"

	"github.com/ethereum/go-ethereum/common"

	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
)

type recoveryRequest struct {
	SensorID  string `json:"sensorId"`
	Submitter string `json:"submitter"`
	IssuedAt  int64  `json:"issuedAt"`
	Signature string `json:"signature"`
}

// prepareRecovery lets a paused shipment's exporter request a zero-knowledge recovery proof bound to their own
// wallet. The backend commits the recovery evidence and proves it; the exporter submits resumeWithProof.
func (s *Server) prepareRecovery(w http.ResponseWriter, r *http.Request) error {
	var req recoveryRequest
	if err := decodeJSON(r, &req); err != nil {
		return err
	}
	if !sensorPattern.MatchString(req.SensorID) {
		return ErrBadRequest("sensorId names the probe whose fresh readings prove the recovery")
	}
	if !common.IsHexAddress(req.Submitter) {
		return ErrBadRequest("submitter must be a 0x address")
	}
	sh, err := s.shipmentFor(r)
	if err != nil {
		return err
	}
	submitter := strings.ToLower(req.Submitter)
	signer, err := s.walletSigner(r.Context(), auth.RecoveryAuthorization(sh.ID, req.SensorID, submitter, req.IssuedAt), req.Signature, req.IssuedAt,
		"only the shipment's exporter can request a recovery", strings.ToLower(sh.Exporter))
	if err != nil {
		return err
	}
	if signer != submitter {
		return ErrUnauthorized("the proof is bound to the wallet that submits it; sign with the submitter's wallet")
	}
	// after authorization, so nobody else can use up the exporter's allowance
	if err := s.rateLimit(w, "recovery:"+sh.ID, s.c.RecoveryPerMinute); err != nil {
		return err
	}
	p, err := s.c.Service.PrepareRecovery(r.Context(), sh.ID, req.SensorID, common.HexToAddress(submitter))
	if err != nil {
		return fromService(err)
	}
	writeJSON(w, http.StatusOK, p)
	return nil
}
