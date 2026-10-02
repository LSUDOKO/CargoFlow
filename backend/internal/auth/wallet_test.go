package auth_test

import (
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/accounts"
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
