// Package sponsor decides whether CargoFlow pays the gas of a smart-account user operation (ZeroDev's custom gas
// policy webhook). Only calls into CargoFlow's own contracts, and USDG approvals to them, are sponsored.
package sponsor

import (
	"bytes"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math/big"
	"strconv"
	"strings"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/common"
)

// Quantity is a uint256 given as a JSON number, a decimal string or a 0x hex string.
type Quantity struct{ *big.Int }

// UnmarshalJSON accepts every encoding bundlers use.
func (q *Quantity) UnmarshalJSON(b []byte) error {
	s := strings.Trim(strings.TrimSpace(string(b)), `"`)
	if s == "" || s == "null" {
		q.Int = nil
		return nil
	}
	n := new(big.Int)
	var ok bool
	if strings.HasPrefix(s, "0x") || strings.HasPrefix(s, "0X") {
		if s == "0x" || s == "0X" {
			n, ok = big.NewInt(0), true
		} else {
			n, ok = n.SetString(s[2:], 16)
		}
	} else {
		n, ok = n.SetString(s, 10)
	}
	if !ok || n.Sign() < 0 || n.BitLen() > 256 {
		return fmt.Errorf("sponsor: %q is not a uint256", s)
	}
	q.Int = n
	return nil
}

func (q Quantity) val() *big.Int {
	if q.Int == nil {
		return new(big.Int)
	}
	return q.Int
}

// Hex is a 0x hex byte string.
type Hex []byte

// UnmarshalJSON decodes a 0x hex string (empty or null gives nil).
func (h *Hex) UnmarshalJSON(b []byte) error {
	var s *string
	if err := json.Unmarshal(b, &s); err != nil {
		return err
	}
	if s == nil || *s == "" || *s == "0x" {
		*h = nil
		return nil
	}
	raw, err := hex.DecodeString(strings.TrimPrefix(strings.TrimPrefix(*s, "0x"), "0X"))
	if err != nil {
		return fmt.Errorf("sponsor: bad hex: %w", err)
	}
	*h = raw
	return nil
}

// UserOp is an ERC-4337 user operation in the v0.6 (initCode, paymasterAndData) or v0.7 (factory, factoryData,
// paymaster fields) shape. Only the fields the policy reads are typed.
type UserOp struct {
	Sender                        string   `json:"sender"`
	Nonce                         Quantity `json:"nonce"`
	InitCode                      Hex      `json:"initCode"`
	Factory                       string   `json:"factory"`
	FactoryData                   Hex      `json:"factoryData"`
	CallData                      Hex      `json:"callData"`
	MaxFeePerGas                  Quantity `json:"maxFeePerGas"`
	MaxPriorityFeePerGas          Quantity `json:"maxPriorityFeePerGas"`
	CallGasLimit                  Quantity `json:"callGasLimit"`
	VerificationGasLimit          Quantity `json:"verificationGasLimit"`
	PreVerificationGas            Quantity `json:"preVerificationGas"`
	PaymasterVerificationGasLimit Quantity `json:"paymasterVerificationGasLimit"`
	PaymasterPostOpGasLimit       Quantity `json:"paymasterPostOpGasLimit"`
}

// Deploys reports whether the operation also deploys the account.
func (op UserOp) Deploys() bool {
	return len(op.InitCode) > 0 || (op.Factory != "" && op.Factory != "0x")
}

// MaxCost is the most the operation can cost: every gas limit times maxFeePerGas.
func (op UserOp) MaxCost() *big.Int {
	gas := new(big.Int)
	for _, q := range []Quantity{op.CallGasLimit, op.VerificationGasLimit, op.PreVerificationGas, op.PaymasterVerificationGasLimit, op.PaymasterPostOpGasLimit} {
		gas.Add(gas, q.val())
	}
	return gas.Mul(gas, op.MaxFeePerGas.val())
}

// Call is one call the account would make.
type Call struct {
	Target common.Address
	Value  *big.Int
	Data   []byte
}

// Policy is what may be sponsored.
type Policy struct {
	Contracts map[common.Address]bool // CargoFlow's contracts: any call to them (with no value)
	USDG      common.Address          // the stablecoin: only approve(spender in Contracts, amount)
	MaxWei    *big.Int                // cap on MaxCost
}

// Selectors.
var (
	selKernelV3Execute      = [4]byte{0xe9, 0xae, 0x5c, 0x53} // execute(bytes32,bytes) (ERC-7579, Kernel v3)
	selKernelV2Execute      = [4]byte{0x51, 0x94, 0x54, 0x47} // execute(address,uint256,bytes,uint8)
	selKernelV2Batch        = [4]byte{0x34, 0xfc, 0xd5, 0xbe} // executeBatch((address,uint256,bytes)[])
	selApprove              = [4]byte{0x09, 0x5e, 0xa7, 0xb3} // approve(address,uint256)
	callTypeSingle     byte = 0x00
	callTypeBatch      byte = 0x01
)

var (
	tBytes32, _ = abi.NewType("bytes32", "", nil)
	tBytes, _   = abi.NewType("bytes", "", nil)
	tAddress, _ = abi.NewType("address", "", nil)
	tUint256, _ = abi.NewType("uint256", "", nil)
	tUint8, _   = abi.NewType("uint8", "", nil)
	tCalls, _   = abi.NewType("tuple[]", "", []abi.ArgumentMarshaling{
		{Name: "target", Type: "address"}, {Name: "value", Type: "uint256"}, {Name: "data", Type: "bytes"}})

	argsV3Execute = abi.Arguments{{Type: tBytes32}, {Type: tBytes}}
	argsV2Execute = abi.Arguments{{Type: tAddress}, {Type: tUint256}, {Type: tBytes}, {Type: tUint8}}
	argsCalls     = abi.Arguments{{Type: tCalls}}
	argsApprove   = abi.Arguments{{Type: tAddress}, {Type: tUint256}}
)

// Calls decodes the calls a Kernel account's callData would make: Kernel v3 execute(mode, executionCalldata) with
// call type single or batch (never delegatecall), or Kernel v2 execute (operation call) / executeBatch.
func Calls(callData []byte) ([]Call, error) {
	if len(callData) < 4 {
		return nil, fmt.Errorf("callData has no selector")
	}
	var sel [4]byte
	copy(sel[:], callData[:4])
	body := callData[4:]
	switch sel {
	case selKernelV3Execute:
		vals, err := argsV3Execute.Unpack(body)
		if err != nil {
			return nil, fmt.Errorf("execute(bytes32,bytes): %w", err)
		}
		mode := vals[0].([32]byte)
		exec := vals[1].([]byte)
		switch mode[0] {
		case callTypeSingle:
			if len(exec) < 52 {
				return nil, fmt.Errorf("single execution is too short")
			}
			return []Call{{Target: common.BytesToAddress(exec[:20]), Value: new(big.Int).SetBytes(exec[20:52]), Data: exec[52:]}}, nil
		case callTypeBatch:
			return decodeCalls(exec)
		default:
			return nil, fmt.Errorf("call type 0x%02x is not sponsored (only single and batch calls)", mode[0])
		}
	case selKernelV2Execute:
		vals, err := argsV2Execute.Unpack(body)
		if err != nil {
			return nil, fmt.Errorf("execute(address,uint256,bytes,uint8): %w", err)
		}
		if op := vals[3].(uint8); op != 0 {
			return nil, fmt.Errorf("operation %d is not sponsored (only call)", op)
		}
		return []Call{{Target: vals[0].(common.Address), Value: vals[1].(*big.Int), Data: vals[2].([]byte)}}, nil
	case selKernelV2Batch:
		return decodeCalls(body)
	}
	return nil, fmt.Errorf("selector 0x%x is not a Kernel execute", sel)
}

func decodeCalls(b []byte) ([]Call, error) {
	vals, err := argsCalls.Unpack(b)
	if err != nil {
		return nil, fmt.Errorf("batch: %w", err)
	}
	var out []Call
	var tmp []struct {
		Target common.Address
		Value  *big.Int
		Data   []byte
	}
	if err := argsCalls.Copy(&tmp, vals); err != nil {
		return nil, fmt.Errorf("batch: %w", err)
	}
	for _, c := range tmp {
		out = append(out, Call{Target: c.Target, Value: c.Value, Data: c.Data})
	}
	return out, nil
}

// Check decides whether to sponsor op, with a short reason when not.
func (p Policy) Check(op UserOp) (bool, string) {
	if !common.IsHexAddress(op.Sender) {
		return false, "sender is not an address"
	}
	if p.MaxWei != nil && op.MaxCost().Cmp(p.MaxWei) > 0 {
		return false, "gas cost above the sponsorship cap"
	}
	calls, err := Calls(op.CallData)
	if err != nil {
		return false, err.Error()
	}
	if len(calls) == 0 {
		return false, "no calls"
	}
	for i, c := range calls {
		if c.Value != nil && c.Value.Sign() != 0 {
			return false, fmt.Sprintf("call %d sends value", i)
		}
		switch {
		case p.Contracts[c.Target]:
		case c.Target == p.USDG && p.USDG != (common.Address{}):
			if len(c.Data) < 4 || !bytes.Equal(c.Data[:4], selApprove[:]) {
				return false, fmt.Sprintf("call %d: only approve is sponsored on USDG", i)
			}
			vals, err := argsApprove.Unpack(c.Data[4:])
			if err != nil {
				return false, fmt.Sprintf("call %d: bad approve", i)
			}
			if spender := vals[0].(common.Address); !p.Contracts[spender] {
				return false, fmt.Sprintf("call %d: approve to a spender outside CargoFlow", i)
			}
		default:
			return false, fmt.Sprintf("call %d targets %s, not a CargoFlow contract", i, strings.ToLower(c.Target.Hex()))
		}
	}
	return true, "allowed (" + strconv.Itoa(len(calls)) + " calls)"
}
