package chain

import (
	"encoding/hex"
	"errors"
	"fmt"
	"strings"

	"github.com/ethereum/go-ethereum/accounts/abi"
	"github.com/ethereum/go-ethereum/rpc"
)

// RevertError is a contract revert decoded into a named custom error (or a reason string), so callers
// and logs see "FacilityPaused" or "Unauthorized(role, account)" rather than hex.
type RevertError struct {
	Name   string // custom error name, "Error" for revert(string), "Panic" for a panic
	Args   []any  // decoded custom error arguments
	Reason string // revert(string) message
	Raw    []byte // the raw return data
	Cause  error
}

func (e *RevertError) Error() string {
	switch {
	case e.Reason != "":
		return fmt.Sprintf("execution reverted: %s", e.Reason)
	case len(e.Args) > 0:
		parts := make([]string, len(e.Args))
		for i, a := range e.Args {
			parts[i] = fmt.Sprint(a)
		}
		return fmt.Sprintf("execution reverted: %s(%s)", e.Name, strings.Join(parts, ", "))
	default:
		return fmt.Sprintf("execution reverted: %s()", e.Name)
	}
}

func (e *RevertError) Unwrap() error { return e.Cause }

// AsRevert extracts a decoded revert from err.
func AsRevert(err error) (*RevertError, bool) {
	var r *RevertError
	if errors.As(err, &r) {
		return r, true
	}
	return nil, false
}

// IsRevert reports whether err is a revert with the given custom error name.
func IsRevert(err error, name string) bool {
	r, ok := AsRevert(err)
	return ok && r.Name == name
}

// wrapRevert decodes revert data carried by an RPC error. Errors without revert data are returned as is.
func wrapRevert(err error) error {
	if err == nil {
		return nil
	}
	var de rpc.DataError
	if !errors.As(err, &de) {
		return err
	}
	data, ok := de.ErrorData().(string)
	if !ok {
		return err
	}
	raw, decodeErr := hex.DecodeString(strings.TrimPrefix(data, "0x"))
	if decodeErr != nil || len(raw) < 4 {
		return err
	}
	return decodeRevertData(raw, err)
}

func decodeRevertData(raw []byte, cause error) error {
	if reason, err := abi.UnpackRevert(raw); err == nil && reason != "" {
		name := "Error"
		if strings.HasPrefix(reason, "panic") {
			name = "Panic"
		}
		return &RevertError{Name: name, Reason: reason, Raw: raw, Cause: cause}
	}
	var sel [4]byte
	copy(sel[:], raw[:4])
	for _, parsed := range ABIs() {
		abiErr, err := parsed.ErrorByID(sel)
		if err != nil {
			continue
		}
		args, err := abiErr.Unpack(raw)
		if err != nil {
			continue
		}
		vals, _ := args.([]any)
		return &RevertError{Name: abiErr.Name, Args: vals, Raw: raw, Cause: cause}
	}
	return &RevertError{Name: "Unknown(0x" + hex.EncodeToString(sel[:]) + ")", Raw: raw, Cause: cause}
}
