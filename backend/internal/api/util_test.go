package api_test

import (
	"context"
	"crypto/ecdsa"
	"strconv"
	"testing"

	"github.com/ethereum/go-ethereum/crypto"

	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
)

func ctxBG() context.Context { return context.Background() }
func itoa(n int64) string    { return strconv.FormatInt(n, 10) }
func signWith(e *env, path string, body []byte, ts int64) string {
	return authSign(e, path, body, ts)
}

func authSign(e *env, path string, body []byte, ts int64) string {
	return auth.Sign(e.sourcePriv, "POST", path, ts, body)
}

// newWallet is a fresh key that holds no role on any shipment.
func newWallet(t *testing.T) *ecdsa.PrivateKey {
	t.Helper()
	k, err := crypto.GenerateKey()
	if err != nil {
		t.Fatal(err)
	}
	return k
}
