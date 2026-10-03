package auth_test

import (
	"bytes"
	"context"
	"errors"
	"math/big"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum"
	"github.com/ethereum/go-ethereum/accounts"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"

	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
)

func TestWalletSignaturesRecoverTheSigner(t *testing.T) {
	key, _ := crypto.GenerateKey()
	want := crypto.PubkeyToAddress(key.PublicKey)
	msg := auth.SourceAuthorization("0x"+strings.Repeat("ab", 32), "pubkey", []string{"sensor-1", "sensor-2"}, 1_800_000_000)
	sig, err := crypto.Sign(accounts.TextHash([]byte(msg)), key)
	if err != nil {
		t.Fatal(err)
	}
	got, err := auth.VerifyWalletSignature(msg, sig)
	if err != nil || got != want {
		t.Fatalf("v=0/1 signature: %s %v", got.Hex(), err)
	}
	sig[64] += 27 // wallets return v as 27/28
	if got, err = auth.VerifyWalletSignature(msg, sig); err != nil || got != want {
		t.Fatalf("v=27/28 signature: %s %v", got.Hex(), err)
	}
	if got, _ = auth.VerifyWalletSignature(msg+" ", sig); got == want {
		t.Fatal("a different message recovered the same signer")
	}
	if _, err := auth.VerifyWalletSignature(msg, sig[:10]); err == nil {
		t.Fatal("a truncated signature was accepted")
	}
}

func TestAuthorizationMessagesAreExact(t *testing.T) {
	src := auth.SourceAuthorization("0xabc", "PUB", []string{"a", "b"}, 42)
	if src != "CargoFlow evidence source\nshipment: 0xabc\npublic key: PUB\nsensors: a,b\nissued: 42" {
		t.Fatalf("source message: %q", src)
	}
	rec := auth.RecoveryAuthorization("0xabc", "sensor-2", "0xDEF", 7)
	if rec != "CargoFlow recovery\nshipment: 0xabc\nsensor: sensor-2\nsubmitter: 0xdef\nissued: 7" {
		t.Fatalf("recovery message: %q", rec)
	}
}

func TestNewAuthorizationMessagesAreExact(t *testing.T) {
	sh := "0xABC"
	for got, want := range map[string]string{
		auth.DocumentAuthorization(sh, "invoice", "0xAA", 1):         "CargoFlow document\nshipment: 0xabc\nkind: invoice\nsha256: 0xaa\nissued: 1",
		auth.AlertsAuthorization(sh, "webhook", "https://X.io/h", 2): "CargoFlow alerts\nshipment: 0xabc\nchannel: webhook\ntarget: https://X.io/h\nissued: 2",
		auth.AlertsOffAuthorization("sub-1", 3):                      "CargoFlow alerts off\nsubscription: sub-1\nissued: 3",
		auth.VesselAuthorization(sh, "636012345", 4):                 "CargoFlow vessel\nshipment: 0xabc\nmmsi: 636012345\nissued: 4",
		auth.RequestAuthorization(sh, "40000000000", 250, 4, 5):      "CargoFlow financing request\nshipment: 0xabc\namount: 40000000000\nmax fee bps: 250\nmilestones: 4\nissued: 5",
		auth.OfferAuthorization("RID", 200, 6):                       "CargoFlow offer\nrequest: rid\nfee bps: 200\nissued: 6",
		auth.AcceptAuthorization("RID", "OID", 7):                    "CargoFlow accept\nrequest: rid\noffer: oid\nissued: 7",
		auth.CloseRequestAuthorization("RID", 8):                     "CargoFlow close request\nrequest: rid\nissued: 8",
		auth.GasAuthorization("0xDEF", 9):                            "CargoFlow gas\naddress: 0xdef\nissued: 9",
	} {
		if got != want {
			t.Errorf("message %q, want %q", got, want)
		}
	}
}

// fakeWallet answers isValidSignature like an EIP-1271 contract wallet that accepts exactly one (hash, signature).
type fakeWallet struct {
	addr  common.Address
	hash  [32]byte
	sig   []byte
	calls int
}

func (w *fakeWallet) CallContract(_ context.Context, msg ethereum.CallMsg, _ *big.Int) ([]byte, error) {
	w.calls++
	if msg.To == nil || *msg.To != w.addr {
		return nil, nil // an account without code answers nothing
	}
	data := msg.Data
	if len(data) < 4+32*3 || !bytes.Equal(data[:4], []byte{0x16, 0x26, 0xba, 0x7e}) {
		return nil, errors.New("execution reverted")
	}
	hash, n := data[4:36], new(big.Int).SetBytes(data[68:100]).Int64()
	sig := data[100 : 100+n]
	out := make([]byte, 32)
	if bytes.Equal(hash, w.hash[:]) && bytes.Equal(sig, w.sig) {
		copy(out, []byte{0x16, 0x26, 0xba, 0x7e})
	}
	return out, nil
}

func TestContractWalletSignaturesVerifyThroughEIP1271(t *testing.T) {
	msg := auth.GasAuthorization("0x"+strings.Repeat("1", 40), 1_800_000_000)
	w := &fakeWallet{addr: common.HexToAddress("0x" + strings.Repeat("1", 40)), hash: [32]byte(accounts.TextHash([]byte(msg))),
		sig: bytes.Repeat([]byte{7}, 97)} // contract wallets use signatures of any length
	ctx := context.Background()
	if ok, err := auth.VerifyContractSignature(ctx, w, w.addr, msg, w.sig); err != nil || !ok {
		t.Fatalf("the wallet's own signature = %v %v", ok, err)
	}
	if ok, _ := auth.VerifyContractSignature(ctx, w, w.addr, msg+"x", w.sig); ok {
		t.Fatal("a signature over another message verified")
	}
	if ok, _ := auth.VerifyContractSignature(ctx, w, common.HexToAddress("0x"+strings.Repeat("2", 40)), msg, w.sig); ok {
		t.Fatal("an account without code verified a signature")
	}
}
