// Package devicetrust verifies hardware-rooted evidence sources: P-256 ECDSA keys held in secure elements (vouched for
// by a manufacturer's X.509 chain) and WebAuthn passkeys (packed or none attestation, assertions per WebAuthn Level 2).
// It decides a device's class (software, passkey or secure_element), which the evidence engine uses to weight how much
// a source's readings are trusted.
package devicetrust

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"crypto/x509"
	"encoding/asn1"
	"encoding/base64"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"
	"math/big"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

// Device classes, from least to most trusted custody of the key.
const (
	ClassSoftware      = "software"
	ClassPasskey       = "passkey"
	ClassSecureElement = "secure_element"
)

// Key types.
const (
	KeyEd25519  = "ed25519"
	KeyP256     = "p256"
	KeyWebAuthn = "webauthn"
)

// ReliabilityBps is the trust the evidence engine places in a sensor reported by a device of the given class. A key
// that provably never leaves tamper-resistant hardware is trusted most; the values feed Shafer discounting of each
// sensor's evidence and the risk model's provider factor.
func ReliabilityBps(class string) int {
	switch class {
	case ClassSecureElement:
		return 9900
	case ClassPasskey:
		return 9700
	default:
		return 9500
	}
}

// ErrInvalid wraps every verification failure; its message is safe to show the registering client.
var ErrInvalid = errors.New("devicetrust")

func invalid(format string, a ...any) error {
	return fmt.Errorf("%w: %s", ErrInvalid, fmt.Sprintf(format, a...))
}

// ParseP256 accepts a P-256 public key as an uncompressed (65-byte) or compressed (33-byte) SEC1 point, or as a DER
// SubjectPublicKeyInfo, and returns the 65-byte uncompressed point.
func ParseP256(raw []byte) ([]byte, error) {
	switch {
	case len(raw) == 65 && raw[0] == 4:
		if _, err := p256Key(raw); err != nil {
			return nil, invalid("the public key is not a point on P-256")
		}
		return append([]byte(nil), raw...), nil
	case len(raw) == 33 && (raw[0] == 2 || raw[0] == 3):
		x, y := elliptic.UnmarshalCompressed(elliptic.P256(), raw)
		if x == nil {
			return nil, invalid("the public key is not a point on P-256")
		}
		return elliptic.Marshal(elliptic.P256(), x, y), nil //nolint:staticcheck // encoding only
	}
	pub, err := x509.ParsePKIXPublicKey(raw)
	if err != nil {
		return nil, invalid("a P-256 public key is a SEC1 point (33 or 65 bytes) or a DER SubjectPublicKeyInfo")
	}
	return p256Bytes(pub)
}

func p256Bytes(pub any) ([]byte, error) {
	ec, ok := pub.(*ecdsa.PublicKey)
	if !ok || ec.Curve != elliptic.P256() {
		return nil, invalid("the key is not a P-256 ECDSA key")
	}
	b, err := ec.Bytes()
	if err != nil {
		return nil, invalid("the key is not a valid P-256 point")
	}
	return b, nil
}

func p256Key(pub65 []byte) (*ecdsa.PublicKey, error) {
	key, err := ecdsa.ParseUncompressedPublicKey(elliptic.P256(), pub65)
	if err != nil {
		return nil, invalid("not an uncompressed point on P-256")
	}
	return key, nil
}

// VerifyP256 checks an ECDSA P-256 / SHA-256 signature over msg. sig is ASN.1 DER or the raw 64-byte r||s.
func VerifyP256(pub65, msg, sig []byte) bool {
	key, err := p256Key(pub65)
	if err != nil {
		return false
	}
	digest := sha256.Sum256(msg)
	if len(sig) == 64 {
		r, s := new(big.Int).SetBytes(sig[:32]), new(big.Int).SetBytes(sig[32:])
		return ecdsa.Verify(key, digest[:], r, s)
	}
	var parsed struct{ R, S *big.Int }
	if rest, err := asn1.Unmarshal(sig, &parsed); err != nil || len(rest) != 0 || parsed.R == nil || parsed.S == nil {
		return false
	}
	return ecdsa.VerifyASN1(key, digest[:], sig)
}

// Roots are the manufacturer root certificates device attestations must chain to.
type Roots struct {
	Pool  *x509.CertPool
	Names []string // subjects, for logs and the device record
}

// Empty reports whether no root is configured.
func (r *Roots) Empty() bool { return r == nil || len(r.Names) == 0 }

// LoadRoots reads every PEM certificate in dir (files ending in .pem or .crt). An empty dir gives no roots.
func LoadRoots(dir string) (*Roots, error) {
	r := &Roots{Pool: x509.NewCertPool()}
	if dir == "" {
		return r, nil
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("devicetrust: read DEVICE_ROOTS_DIR: %w", err)
	}
	for _, e := range entries {
		if e.IsDir() || !(strings.HasSuffix(e.Name(), ".pem") || strings.HasSuffix(e.Name(), ".crt")) {
			continue
		}
		raw, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			return nil, err
		}
		certs, err := parsePEMCerts(string(raw))
		if err != nil {
			return nil, fmt.Errorf("devicetrust: %s: %w", e.Name(), err)
		}
		for _, c := range certs {
			if !c.IsCA {
				return nil, fmt.Errorf("devicetrust: %s: %q is not a CA certificate", e.Name(), c.Subject.String())
			}
			r.Pool.AddCert(c)
			r.Names = append(r.Names, c.Subject.String())
		}
	}
	sort.Strings(r.Names)
	return r, nil
}

// AddPEM adds root certificates from PEM text (used by tests and embedders).
func (r *Roots) AddPEM(text string) error {
	certs, err := parsePEMCerts(text)
	if err != nil {
		return err
	}
	for _, c := range certs {
		r.Pool.AddCert(c)
		r.Names = append(r.Names, c.Subject.String())
	}
	return nil
}

func parsePEMCerts(text string) ([]*x509.Certificate, error) {
	var out []*x509.Certificate
	rest := []byte(text)
	for {
		var block *pem.Block
		block, rest = pem.Decode(rest)
		if block == nil {
			break
		}
		if block.Type != "CERTIFICATE" {
			continue
		}
		c, err := x509.ParseCertificate(block.Bytes)
		if err != nil {
			return nil, invalid("a certificate could not be parsed")
		}
		out = append(out, c)
	}
	if len(out) == 0 {
		return nil, invalid("no PEM certificate found")
	}
	return out, nil
}

// ChainResult is what a verified X.509 attestation says about the device.
type ChainResult struct {
	Leaf    string   `json:"leaf"`
	Chain   []string `json:"chain"` // leaf first, ending at the trusted root
	Serial  string   `json:"serial"`
	Expires string   `json:"expires"`
}

// VerifyChain checks an X.509 attestation for a P-256 device key: the certificates (PEM, leaf first; one string may hold
// several) must chain to one of roots, the leaf must be an end-entity certificate valid at now, and its public key must
// be exactly the device key.
func VerifyChain(pemChain []string, roots *Roots, devicePub65 []byte, now time.Time) (ChainResult, error) {
	if roots.Empty() {
		return ChainResult{}, invalid("this backend has no manufacturer roots configured (DEVICE_ROOTS_DIR), so it cannot verify an attestation chain")
	}
	var certs []*x509.Certificate
	for _, p := range pemChain {
		cs, err := parsePEMCerts(p)
		if err != nil {
			return ChainResult{}, err
		}
		certs = append(certs, cs...)
	}
	if len(certs) == 0 || len(certs) > 6 {
		return ChainResult{}, invalid("the attestation chain holds 1 to 6 certificates")
	}
	leaf := certs[0]
	if leaf.IsCA {
		return ChainResult{}, invalid("the first certificate must be the device's own (not a CA)")
	}
	leafKey, err := p256Bytes(leaf.PublicKey)
	if err != nil {
		return ChainResult{}, invalid("the device certificate does not hold a P-256 key")
	}
	if hex.EncodeToString(leafKey) != hex.EncodeToString(devicePub65) {
		return ChainResult{}, invalid("the device certificate is for a different key than the one being registered")
	}
	inter := x509.NewCertPool()
	for _, c := range certs[1:] {
		inter.AddCert(c)
	}
	chains, err := leaf.Verify(x509.VerifyOptions{Roots: roots.Pool, Intermediates: inter, CurrentTime: now, KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageAny}})
	if err != nil {
		return ChainResult{}, invalid("the attestation chain does not verify to a trusted manufacturer root: %s", oneLine(err.Error()))
	}
	out := ChainResult{Leaf: leaf.Subject.String(), Serial: leaf.SerialNumber.Text(16), Expires: leaf.NotAfter.UTC().Format(time.RFC3339)}
	for _, c := range chains[0] {
		out.Chain = append(out.Chain, c.Subject.String())
	}
	return out, nil
}

func oneLine(s string) string {
	s = strings.NewReplacer("\n", " ", "\r", " ").Replace(s)
	if len(s) > 200 {
		s = s[:200]
	}
	return s
}

func b64url(b []byte) string { return base64.RawURLEncoding.EncodeToString(b) }

// DecodeB64 accepts base64url (padded or not) and standard base64.
func DecodeB64(s string) ([]byte, error) {
	for _, enc := range []*base64.Encoding{base64.RawURLEncoding, base64.URLEncoding, base64.RawStdEncoding, base64.StdEncoding} {
		if b, err := enc.DecodeString(s); err == nil {
			return b, nil
		}
	}
	return nil, invalid("not base64url")
}

// ChainDER concatenates the DER bytes of a PEM certificate chain, in order: the "attestation bytes" whose keccak256
// is recorded on chain for a secure element.
func ChainDER(pemChain []string) ([]byte, error) {
	var out []byte
	for _, p := range pemChain {
		certs, err := parsePEMCerts(p)
		if err != nil {
			return nil, err
		}
		for _, c := range certs {
			out = append(out, c.Raw...)
		}
	}
	return out, nil
}
