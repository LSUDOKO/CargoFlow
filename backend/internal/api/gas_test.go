package api_test

import (
	"context"
	"math/big"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/accounts"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/common/hexutil"
	"github.com/ethereum/go-ethereum/crypto"

	"github.com/LSUDOKO/CargoFlow/backend/internal/api"
	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
)

var dripWei = big.NewInt(50_000_000_000_000)

func gasBody(t *testing.T, address string, signature string, issued int64) map[string]any {
	return map[string]any{"address": address, "issuedAt": issued, "signature": signature}
}

// contractWallet is EVM code that accepts plain transfers and answers isValidSignature(hash, ·) with the EIP-1271
// magic value for exactly one hash, as a smart account that signed that message would.
func contractWallet(hash [32]byte) []byte {
	code := []byte{0x36, 0x15, 0x60, 0x54, 0x57, // no calldata: jump to accept
		0x60, 0x00, 0x35, 0x60, 0xe0, 0x1c, 0x63, 0x16, 0x26, 0xba, 0x7e, 0x14, 0x15, 0x60, 0x4e, 0x57, // selector must be isValidSignature
		0x60, 0x04, 0x35, 0x7f}
	code = append(code, hash[:]...)
	code = append(code, 0x14, 0x15, 0x60, 0x4e, 0x57, // the hash must match
		0x63, 0x16, 0x26, 0xba, 0x7e, 0x60, 0xe0, 0x1b, 0x60, 0x00, 0x52, 0x60, 0x20, 0x60, 0x00, 0xf3, // return the magic value
		0x5b, 0x60, 0x00, 0x60, 0x00, 0xfd, // revert
		0x5b, 0x00) // accept
	return code
}

func TestTheGasDripFundsEmptyWalletsOnceADay(t *testing.T) {
	e := newEnvWith(t, nil, func(e *env, c *api.Config) {
		c.Gas = &api.GasDrip{Chain: e.chain, Signer: chain.NewSigner(e.keys["arbiter"]), AmountWei: dripWei, Daily: 3}
	})
	ctx := context.Background()
	now := time.Now().Unix()
	fresh := newWallet(t)
	who := addr(fresh)

	var out struct {
		TxHash    string `json:"txHash"`
		AmountWei string `json:"amountWei"`
		Address   string `json:"address"`
	}
	if resp := e.do(t, "POST", "/v1/gas", gasBody(t, who, walletSign(t, fresh, auth.GasAuthorization(who, now)), now), nil, &out); resp.StatusCode != http.StatusOK {
		t.Fatalf("drip = %d", resp.StatusCode)
	}
	bal, _ := e.chain.Eth.BalanceAt(ctx, common.HexToAddress(who), nil)
	if bal.Cmp(dripWei) != 0 || !strings.HasPrefix(out.TxHash, "0x") || out.AmountWei != dripWei.String() || out.Address != who {
		t.Fatalf("drip %+v, balance %s", out, bal)
	}
	var apiErr errResp
	if resp := e.do(t, "POST", "/v1/gas", gasBody(t, who, walletSign(t, fresh, auth.GasAuthorization(who, now+1)), now+1), nil, &apiErr); resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("a second drip the same day = %d, want 429", resp.StatusCode)
	}
	rich := addr(e.keys["exporter"])
	if resp := e.do(t, "POST", "/v1/gas", gasBody(t, rich, walletSign(t, e.keys["exporter"], auth.GasAuthorization(rich, now)), now), nil, &apiErr); resp.StatusCode != http.StatusConflict {
		t.Fatalf("a wallet that has gas = %d, want 409", resp.StatusCode)
	}
	other := newWallet(t)
	if resp := e.do(t, "POST", "/v1/gas", gasBody(t, who, walletSign(t, other, auth.GasAuthorization(who, now)), now), nil, &apiErr); resp.StatusCode != http.StatusUnauthorized {
		t.Fatalf("asking for someone else = %d, want 401", resp.StatusCode)
	}

	// a contract wallet signs through EIP-1271
	wallet := common.BytesToAddress(crypto.Keccak256([]byte("api gas contract wallet"))[:20])
	msg := auth.GasAuthorization(wallet.Hex(), now)
	if err := e.chain.Eth.Client().CallContext(ctx, nil, "anvil_setCode", wallet, hexutil.Encode(contractWallet([32]byte(accounts.TextHash([]byte(msg)))))); err != nil {
		t.Fatal(err)
	}
	if resp := e.do(t, "POST", "/v1/gas", gasBody(t, wallet.Hex(), "0x"+strings.Repeat("ab", 70), now), nil, &out); resp.StatusCode != http.StatusOK {
		t.Fatalf("a contract wallet's drip = %d", resp.StatusCode)
	}
	if bal, _ := e.chain.Eth.BalanceAt(ctx, wallet, nil); bal.Cmp(dripWei) != 0 {
		t.Fatalf("contract wallet balance %s", bal)
	}

	// the daily cap is global
	last := newWallet(t)
	e.do(t, "POST", "/v1/gas", gasBody(t, addr(last), walletSign(t, last, auth.GasAuthorization(addr(last), now)), now), nil, nil)
	capped := newWallet(t)
	if resp := e.do(t, "POST", "/v1/gas", gasBody(t, addr(capped), walletSign(t, capped, auth.GasAuthorization(addr(capped), now)), now), nil, &apiErr); resp.StatusCode != http.StatusTooManyRequests {
		t.Fatalf("over the daily cap = %d, want 429", resp.StatusCode)
	}
}

func TestTheGasDripIsUnavailableWithoutAKey(t *testing.T) {
	e := newEnv(t, nil)
	k := newWallet(t)
	now := time.Now().Unix()
	var apiErr errResp
	if resp := e.do(t, "POST", "/v1/gas", gasBody(t, addr(k), walletSign(t, k, auth.GasAuthorization(addr(k), now)), now), nil, &apiErr); resp.StatusCode != http.StatusServiceUnavailable || apiErr.Error.Code != "gas_unavailable" {
		t.Fatalf("unconfigured drip = %d %q", resp.StatusCode, apiErr.Error.Code)
	}
}
