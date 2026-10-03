package api

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"slices"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"github.com/ethereum/go-ethereum/common"

	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
)

// authorizationWindow is how far a signed authorization's issuedAt may be from the server clock.
const authorizationWindow = 10 * time.Minute

// replayMemory is the least time a used authorization is remembered. An authorization dated in the future stays
// valid for longer, so it is remembered until its window closes.
const replayMemory = 15 * time.Minute

// errReplayed answers a wallet-signed authorization that has already been used once.
var errReplayed = &Error{http.StatusConflict, "replayed", "this signed authorization was already used; sign a new one"}

// prunes counts consumed authorizations so expired records are deleted now and then, not on every request.
var prunes atomic.Uint64

func (s *Server) now() time.Time {
	if s.c.Now != nil {
		return s.c.Now()
	}
	return time.Now()
}

// walletSigner checks a wallet-signed (EIP-191 personal_sign) authorization and consumes it. It checks the time
// window, then the signature, then that the signer is one of allowed (lowercase 0x addresses), and finally that the
// authorization has not been used before: every authorization is single-use.
//
// A signature that does not recover to an allowed address is offered to each allowed address through EIP-1271
// isValidSignature, so contract wallets (multisigs, smart accounts) can sign too. With no allowed addresses any
// externally owned account may sign and the caller decides what the signer may do. deny is the message for a
// signature from anyone else. A refused authorization is not consumed, so a tampered copy cannot burn the original.
func (s *Server) walletSigner(ctx context.Context, message, signature string, issuedAt int64, deny string, allowed ...string) (string, error) {
	now := s.now()
	if d := now.Sub(time.Unix(issuedAt, 0)); d > authorizationWindow || d < -authorizationWindow {
		return "", ErrUnauthorized("the authorization has expired or is dated in the future; sign it again")
	}
	sig, err := hex.DecodeString(strings.TrimPrefix(signature, "0x"))
	if err != nil || len(sig) == 0 || len(sig) > 4096 {
		return "", ErrUnauthorized("the signature is not hex")
	}
	signer := ""
	if addr, err := auth.VerifyWalletSignature(message, sig); err == nil {
		signer = strings.ToLower(addr.Hex())
	}
	if signer == "" || (len(allowed) > 0 && !slices.Contains(allowed, signer)) {
		recovered := signer
		signer = s.contractSigner(ctx, message, sig, allowed)
		if signer == "" {
			if recovered == "" && len(allowed) == 0 {
				return "", ErrUnauthorized("the signature could not be verified")
			}
			return "", ErrUnauthorized(deny)
		}
	}
	if err := s.consume(ctx, signer, message, issuedAt, now); err != nil {
		return "", err
	}
	return signer, nil
}

// contractSigner returns the first allowed address whose contract accepts sig over message (EIP-1271), or "".
func (s *Server) contractSigner(ctx context.Context, message string, sig []byte, allowed []string) string {
	if s.c.Chain == nil {
		return ""
	}
	ctx, cancel := context.WithTimeout(ctx, 5*time.Second)
	defer cancel()
	for _, a := range allowed {
		if !common.IsHexAddress(a) || !s.hasCode(ctx, common.HexToAddress(a)) {
			continue
		}
		if ok, err := auth.VerifyContractSignature(ctx, s.c.Chain.Eth, common.HexToAddress(a), message, sig); err == nil && ok {
			return strings.ToLower(a)
		}
	}
	return ""
}

// codeTTL is how long an account's has-code answer is cached.
const codeTTL = 10 * time.Minute

// codeCache remembers which accounts hold code, so a stream of bad signatures costs one code lookup per party every
// few minutes instead of one contract call per party per request.
type codeCache struct {
	mu sync.Mutex
	m  map[common.Address]codeEntry
}

type codeEntry struct {
	has bool
	at  time.Time
}

// hasCode reports whether an account holds code (a contract wallet, or an EIP-7702 delegated account).
func (s *Server) hasCode(ctx context.Context, a common.Address) bool {
	now := time.Now()
	s.codes.mu.Lock()
	if e, ok := s.codes.m[a]; ok && now.Sub(e.at) < codeTTL {
		s.codes.mu.Unlock()
		return e.has
	}
	s.codes.mu.Unlock()
	code, err := s.c.Chain.Eth.CodeAt(ctx, a, nil)
	if err != nil {
		return false // not cached: try again next time
	}
	s.codes.mu.Lock()
	if s.codes.m == nil || len(s.codes.m) >= 4096 {
		s.codes.m = map[common.Address]codeEntry{}
	}
	s.codes.m[a] = codeEntry{len(code) > 0, now}
	s.codes.mu.Unlock()
	return len(code) > 0
}

// consume marks an authorization used. It is identified by its signer and message rather than the signature bytes,
// so a malleated copy of the same signature (ECDSA's s and n-s) is still recognised as the same authorization.
func (s *Server) consume(ctx context.Context, signer, message string, issuedAt int64, now time.Time) error {
	sum := sha256.Sum256([]byte(signer + "\n" + message))
	expires := now.Add(replayMemory)
	if until := time.Unix(issuedAt, 0).Add(authorizationWindow + time.Minute); until.After(expires) {
		expires = until
	}
	fresh, err := s.c.Store.UseAuthorization(ctx, hex.EncodeToString(sum[:]), now, expires)
	if err != nil {
		return err
	}
	if !fresh {
		return errReplayed
	}
	if prunes.Add(1)%256 == 0 {
		_ = s.c.Store.PruneAuthorizations(ctx, now) // best effort: stale rows are harmless
	}
	return nil
}
