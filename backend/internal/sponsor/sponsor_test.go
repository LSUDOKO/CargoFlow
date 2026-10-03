package sponsor_test

import (
	"encoding/json"
	"math/big"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"

	"github.com/LSUDOKO/CargoFlow/backend/internal/sponsor"
)

var (
	Controller = common.HexToAddress("0x00000000000000000000000000000000000000c1")
	Vault      = common.HexToAddress("0x00000000000000000000000000000000000000c2")
	USDG       = common.HexToAddress("0x7E955252E15c84f5768B83c41a71F9eba181802F")
	Foreign    = common.HexToAddress("0x000000000000000000000000000000000000beef")
)

func policy() sponsor.Policy {
	return sponsor.Policy{Contracts: map[common.Address]bool{Controller: true, Vault: true}, USDG: USDG, MaxWei: big.NewInt(200_000_000_000_000)}
}

func sel(sig string) []byte { return crypto.Keccak256([]byte(sig))[:4] }

func mustType(t string, comps []abi.ArgumentMarshaling) abi.Type {
	ty, err := abi.NewType(t, "", comps)
	if err != nil {
		panic(err)
	}
	return ty
}

func pack(args abi.Arguments, vals ...any) []byte {
	b, err := args.Pack(vals...)
	if err != nil {
		panic(err)
	}
	return b
}

type call struct {
	Target common.Address
	Value  *big.Int
	Data   []byte
}

// v3Single is Kernel v3 execute(mode single, abi.encodePacked(target, value, data)).
func v3Single(c call) []byte {
	exec := append(append(common.LeftPadBytes(c.Target.Bytes(), 20), common.LeftPadBytes(c.Value.Bytes(), 32)...), c.Data...)
	return v3(0x00, exec)
}

func v3(callType byte, exec []byte) []byte {
	var mode [32]byte
	mode[0] = callType
	args := abi.Arguments{{Type: mustType("bytes32", nil)}, {Type: mustType("bytes", nil)}}
	return append(sel("execute(bytes32,bytes)"), pack(args, mode, exec)...)
}

var callsType = mustType("tuple[]", []abi.ArgumentMarshaling{{Name: "target", Type: "address"}, {Name: "value", Type: "uint256"}, {Name: "data", Type: "bytes"}})

func v3Batch(calls ...call) []byte {
	return v3(0x01, pack(abi.Arguments{{Type: callsType}}, calls))
}

func approve(spender common.Address) []byte {
	return append(sel("approve(address,uint256)"), pack(abi.Arguments{{Type: mustType("address", nil)}, {Type: mustType("uint256", nil)}}, spender, big.NewInt(1e9))...)
}

func deposit() []byte { return append(sel("deposit(bytes32)"), make([]byte, 32)...) }

func op(callData []byte) sponsor.UserOp {
	raw, _ := json.Marshal(map[string]any{
		"sender": "0x1234567890123456789012345678901234567890", "nonce": "0x1", "callData": "0x" + common.Bytes2Hex(callData),
		"maxFeePerGas": "0x3b9aca00", "maxPriorityFeePerGas": "0x0", "callGasLimit": "100000", "verificationGasLimit": "0x186a0",
		"preVerificationGas": 50000, "signature": "0x",
	})
	var o sponsor.UserOp
	if err := json.Unmarshal(raw, &o); err != nil {
		panic(err)
	}
	return o
}

func TestSelectorsMatchTheirSignatures(t *testing.T) {
	for sig, want := range map[string]string{
		"execute(bytes32,bytes)": "e9ae5c53", "execute(address,uint256,bytes,uint8)": "51945447",
		"executeBatch((address,uint256,bytes)[])": "34fcd5be", "approve(address,uint256)": "095ea7b3",
	} {
		if got := common.Bytes2Hex(sel(sig)); got != want {
			t.Errorf("%s = %s, want %s", sig, got, want)
		}
	}
}

func TestPolicy(t *testing.T) {
	p := policy()
	p.MaxWei = big.NewInt(1e18)
	zero := big.NewInt(0)
	v2Args := abi.Arguments{{Type: mustType("address", nil)}, {Type: mustType("uint256", nil)}, {Type: mustType("bytes", nil)}, {Type: mustType("uint8", nil)}}
	cases := []struct {
		name     string
		callData []byte
		want     bool
		reason   string
	}{
		{"single call to the controller", v3Single(call{Controller, zero, deposit()}), true, ""},
		{"batch approve to the vault then deposit", v3Batch(call{USDG, zero, approve(Vault)}, call{Vault, zero, deposit()}), true, ""},
		{"foreign target", v3Single(call{Foreign, zero, deposit()}), false, "not a CargoFlow contract"},
		{"foreign target inside a batch", v3Batch(call{Controller, zero, deposit()}, call{Foreign, zero, nil}), false, "not a CargoFlow contract"},
		{"approve to a foreign spender", v3Batch(call{USDG, zero, approve(Foreign)}), false, "spender outside"},
		{"USDG transfer", v3Single(call{USDG, zero, append(sel("transfer(address,uint256)"), make([]byte, 64)...)}), false, "only approve"},
		{"value", v3Single(call{Controller, big.NewInt(1), deposit()}), false, "sends value"},
		{"delegatecall", v3(0xff, append(Controller.Bytes(), deposit()...)), false, "call type 0xff"},
		{"not a Kernel call", deposit(), false, "not a Kernel execute"},
		{"Kernel v2 execute", append(sel("execute(address,uint256,bytes,uint8)"), pack(v2Args, Controller, zero, deposit(), uint8(0))...), true, ""},
		{"Kernel v2 delegatecall", append(sel("execute(address,uint256,bytes,uint8)"), pack(v2Args, Controller, zero, deposit(), uint8(1))...), false, "operation 1"},
		{"Kernel v2 batch", append(sel("executeBatch((address,uint256,bytes)[])"), pack(abi.Arguments{{Type: callsType}}, []call{{USDG, zero, approve(Controller)}, {Controller, zero, deposit()}})...), true, ""},
	}
	for _, c := range cases {
		ok, reason := p.Check(op(c.callData))
		if ok != c.want || (c.reason != "" && !strings.Contains(reason, c.reason)) {
			t.Errorf("%s: %v %q", c.name, ok, reason)
		}
	}
}

func TestGasCap(t *testing.T) {
	p := policy()
	o := op(v3Single(call{Controller, big.NewInt(0), deposit()}))
	// (100000 + 100000 + 50000) * 1 gwei = 2.5e14 wei > 2e14
	if ok, reason := p.Check(o); ok || !strings.Contains(reason, "cap") {
		t.Fatalf("above the cap: %v %q", ok, reason)
	}
	p.MaxWei = big.NewInt(250_000_000_000_000)
	if ok, reason := p.Check(o); !ok {
		t.Fatalf("at the cap: %q", reason)
	}
}

func TestDeploysWithBothShapes(t *testing.T) {
	var v6, v7 sponsor.UserOp
	_ = json.Unmarshal([]byte(`{"initCode":"0xd703aae79538628d27099b8c4f621be4ccd142d5aa"}`), &v6)
	_ = json.Unmarshal([]byte(`{"factory":"0xd703aaE79538628d27099B8c4f621bE4CCd142d5","factoryData":"0xaa"}`), &v7)
	if !v6.Deploys() || !v7.Deploys() {
		t.Fatal("deployment is recognised in v0.6 and v0.7 shapes")
	}
}
