package api_test

import (
	"bytes"
	"context"
	"encoding/json"
	"math/big"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"

	"github.com/LSUDOKO/CargoFlow/backend/internal/api"
	"github.com/LSUDOKO/CargoFlow/backend/internal/sponsor"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store/storetest"
)

const zdSecret = "zerodev-path-secret-0123456789"

var zdController = common.HexToAddress("0x00000000000000000000000000000000000000c1")

func zerodevServer(t *testing.T, perSender, global int) *httptest.Server {
	t.Helper()
	pool := storetest.Pool(t)
	if err := store.Migrate(context.Background(), pool, store.Migrations()); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(api.NewServer(api.Config{Store: store.New(pool), ZeroDev: &api.ZeroDevSponsor{
		Secret: zdSecret, ProjectID: "proj-1", ChainID: 46630, PerSender: perSender, Global: global,
		Policy: sponsor.Policy{Contracts: map[common.Address]bool{zdController: true}, MaxWei: big.NewInt(1e15)},
	}}).Handler())
	t.Cleanup(srv.Close)
	return srv
}

func kernelSingle(target common.Address) string {
	var mode [32]byte
	b32, _ := abi.NewType("bytes32", "", nil)
	by, _ := abi.NewType("bytes", "", nil)
	exec := append(append(target.Bytes(), make([]byte, 32)...), crypto.Keccak256([]byte("markDelivered(bytes32)"))[:4]...)
	exec = append(exec, make([]byte, 32)...)
	packed, _ := abi.Arguments{{Type: b32}, {Type: by}}.Pack(mode, exec)
	return "0x" + common.Bytes2Hex(append(crypto.Keccak256([]byte("execute(bytes32,bytes)"))[:4], packed...))
}

func zdPost(t *testing.T, srv *httptest.Server, secret string, body map[string]any) (int, map[string]any) {
	t.Helper()
	raw, _ := json.Marshal(body)
	resp, err := http.Post(srv.URL+"/v1/webhooks/zerodev/"+secret, "application/json", bytes.NewReader(raw))
	if err != nil {
		t.Fatal(err)
	}
	defer resp.Body.Close()
	var out map[string]any
	_ = json.NewDecoder(resp.Body).Decode(&out)
	return resp.StatusCode, out
}

func zdBody(project string, chain int, sender string, target common.Address) map[string]any {
	return map[string]any{"projectId": project, "chainId": chain, "userOp": map[string]any{
		"sender": sender, "nonce": "0x0", "callData": kernelSingle(target), "signature": "0x",
		"maxFeePerGas": "0x3b9aca00", "maxPriorityFeePerGas": "0x1", "callGasLimit": "0x186a0",
		"verificationGasLimit": "0x186a0", "preVerificationGas": "0xc350", "factory": "0xd703aaE79538628d27099B8c4f621bE4CCd142d5", "factoryData": "0x01"}}
}

func TestZeroDevGasPolicy(t *testing.T) {
	srv := zerodevServer(t, 2, 3)
	alice, bob := "0x00000000000000000000000000000000000a11ce", "0x0000000000000000000000000000000000000b0b"

	if code, _ := zdPost(t, srv, "wrong-secret-wrong-secret-000", zdBody("proj-1", 46630, alice, zdController)); code != 404 {
		t.Fatalf("a wrong secret looks like an unknown path, got %d", code)
	}
	if code, out := zdPost(t, srv, zdSecret, zdBody("proj-2", 46630, alice, zdController)); code != 200 || out["proceed"] != false {
		t.Fatalf("wrong project: %d %v", code, out)
	}
	if code, out := zdPost(t, srv, zdSecret, zdBody("proj-1", 1, alice, zdController)); code != 200 || out["proceed"] != false {
		t.Fatalf("wrong chain: %d %v", code, out)
	}
	if code, out := zdPost(t, srv, zdSecret, zdBody("proj-1", 46630, alice, common.HexToAddress("0xbeef"))); code != 200 || out["proceed"] != false {
		t.Fatalf("foreign target: %d %v", code, out)
	}
	for i := 0; i < 2; i++ {
		if code, out := zdPost(t, srv, zdSecret, zdBody("proj-1", 46630, alice, zdController)); code != 200 || out["proceed"] != true {
			t.Fatalf("allowed (with deployment) %d: %d %v", i, code, out)
		}
	}
	if _, out := zdPost(t, srv, zdSecret, zdBody("proj-1", 46630, alice, zdController)); out["proceed"] != false {
		t.Fatal("the per-sender limit stops the third")
	}
	if _, out := zdPost(t, srv, zdSecret, zdBody("proj-1", 46630, bob, zdController)); out["proceed"] != true {
		t.Fatal("another sender still proceeds (denials are not counted)")
	}
	if _, out := zdPost(t, srv, zdSecret, zdBody("proj-1", 46630, "0x0000000000000000000000000000000000000c0c", zdController)); out["proceed"] != false {
		t.Fatal("the global limit stops the fourth sponsorship")
	}
	if code, out := zdPost(t, srv, zdSecret, map[string]any{"projectId": 5}); code != 200 || out["proceed"] != false {
		t.Fatalf("a malformed body is a no, not an error: %d %v", code, out)
	}
}

func TestZeroDevGasPolicyOffIs404(t *testing.T) {
	pool := storetest.Pool(t)
	if err := store.Migrate(context.Background(), pool, store.Migrations()); err != nil {
		t.Fatal(err)
	}
	srv := httptest.NewServer(api.NewServer(api.Config{Store: store.New(pool)}).Handler())
	defer srv.Close()
	if code, _ := zdPost(t, srv, zdSecret, zdBody("proj-1", 46630, "0x00000000000000000000000000000000000a11ce", zdController)); code != 404 {
		t.Fatalf("unset: %d", code)
	}
}
