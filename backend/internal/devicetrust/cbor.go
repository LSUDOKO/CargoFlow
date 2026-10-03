package devicetrust

import (
	"encoding/binary"
	"errors"
	"fmt"
	"math"
)

// A deliberately small CBOR (RFC 8949) decoder for WebAuthn attestation objects and COSE keys: definite-length
// unsigned and negative integers, byte and text strings, arrays, maps, booleans, null and floats. Indefinite lengths,
// tags and nesting deeper than 16 are refused; WebAuthn's canonical CBOR never uses them.

const cborMaxDepth = 16

var errCBOR = errors.New("devicetrust: malformed CBOR")

// cborDecode decodes one item from b and returns it with the number of bytes it used. Maps decode to map[any]any
// with int64 or string keys; integers to int64 (or uint64 above MaxInt64); byte strings to []byte.
func cborDecode(b []byte) (any, int, error) { return cborItem(b, 0) }

func cborHead(b []byte) (major byte, arg uint64, n int, err error) {
	if len(b) == 0 {
		return 0, 0, 0, errCBOR
	}
	major, info := b[0]>>5, b[0]&0x1f
	switch {
	case info < 24:
		return major, uint64(info), 1, nil
	case info == 24:
		if len(b) < 2 {
			return 0, 0, 0, errCBOR
		}
		return major, uint64(b[1]), 2, nil
	case info == 25:
		if len(b) < 3 {
			return 0, 0, 0, errCBOR
		}
		return major, uint64(binary.BigEndian.Uint16(b[1:])), 3, nil
	case info == 26:
		if len(b) < 5 {
			return 0, 0, 0, errCBOR
		}
		return major, uint64(binary.BigEndian.Uint32(b[1:])), 5, nil
	case info == 27:
		if len(b) < 9 {
			return 0, 0, 0, errCBOR
		}
		return major, binary.BigEndian.Uint64(b[1:]), 9, nil
	}
	return 0, 0, 0, fmt.Errorf("%w: indefinite or reserved length", errCBOR)
}

func cborItem(b []byte, depth int) (any, int, error) {
	if depth > cborMaxDepth {
		return nil, 0, fmt.Errorf("%w: nested too deeply", errCBOR)
	}
	major, arg, n, err := cborHead(b)
	if err != nil {
		return nil, 0, err
	}
	switch major {
	case 0:
		if arg > math.MaxInt64 {
			return arg, n, nil
		}
		return int64(arg), n, nil
	case 1:
		if arg > math.MaxInt64 {
			return nil, 0, fmt.Errorf("%w: negative integer out of range", errCBOR)
		}
		return -1 - int64(arg), n, nil
	case 2, 3:
		if arg > uint64(len(b)-n) {
			return nil, 0, fmt.Errorf("%w: string runs past the end", errCBOR)
		}
		raw := b[n : n+int(arg)]
		if major == 3 {
			return string(raw), n + int(arg), nil
		}
		out := make([]byte, len(raw))
		copy(out, raw)
		return out, n + int(arg), nil
	case 4:
		if arg > uint64(len(b)) {
			return nil, 0, errCBOR
		}
		out := make([]any, 0, arg)
		for range arg {
			v, used, err := cborItem(b[n:], depth+1)
			if err != nil {
				return nil, 0, err
			}
			out = append(out, v)
			n += used
		}
		return out, n, nil
	case 5:
		if arg > uint64(len(b)) {
			return nil, 0, errCBOR
		}
		out := make(map[any]any, arg)
		for range arg {
			k, used, err := cborItem(b[n:], depth+1)
			if err != nil {
				return nil, 0, err
			}
			n += used
			switch k.(type) {
			case int64, string:
			default:
				return nil, 0, fmt.Errorf("%w: map keys must be integers or text", errCBOR)
			}
			if _, dup := out[k]; dup {
				return nil, 0, fmt.Errorf("%w: duplicate map key", errCBOR)
			}
			v, used, err := cborItem(b[n:], depth+1)
			if err != nil {
				return nil, 0, err
			}
			out[k] = v
			n += used
		}
		return out, n, nil
	case 7:
		switch b[0] & 0x1f {
		case 20:
			return false, 1, nil
		case 21:
			return true, 1, nil
		case 22, 23:
			return nil, 1, nil
		case 26:
			return float64(math.Float32frombits(uint32(arg))), n, nil
		case 27:
			return math.Float64frombits(arg), n, nil
		}
	}
	return nil, 0, fmt.Errorf("%w: unsupported item (major type %d)", errCBOR, major)
}
