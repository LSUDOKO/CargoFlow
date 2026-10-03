// Package devicetest builds test devices: a software WebAuthn authenticator that produces real attestation objects and
// assertions, and a throwaway certificate authority that issues device and attestation certificates. It is for tests
// and local tooling only.
package devicetest

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/binary"
	"encoding/pem"
	"math/big"
	"net/url"
	"sort"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/devicetrust"
)

// --- a minimal CBOR encoder (canonical enough for WebAuthn) ---

func head(major byte, n uint64) []byte {
	switch {
	case n < 24:
		return []byte{major<<5 | byte(n)}
	case n < 1<<8:
		return []byte{major<<5 | 24, byte(n)}
	case n < 1<<16:
		b := []byte{major<<5 | 25, 0, 0}
		binary.BigEndian.PutUint16(b[1:], uint16(n))
		return b
	default:
		b := []byte{major<<5 | 26, 0, 0, 0, 0}
		binary.BigEndian.PutUint32(b[1:], uint32(n))
		return b
	}
}

// CBOR encodes ints, []byte, string, []any and map[any]any (int or string keys, sorted canonically).
func CBOR(v any) []byte {
	switch x := v.(type) {
	case int:
		if x >= 0 {
			return head(0, uint64(x))
		}
		return head(1, uint64(-1-x))
	case int64:
		return CBOR(int(x))
	case []byte:
		return append(head(2, uint64(len(x))), x...)
	case string:
		return append(head(3, uint64(len(x))), x...)
	case []any:
		out := head(4, uint64(len(x)))
		for _, e := range x {
			out = append(out, CBOR(e)...)
		}
		return out
	case map[any]any:
		type kv struct{ k, v []byte }
		var items []kv
		for k, val := range x {
			items = append(items, kv{CBOR(k), CBOR(val)})
		}
		sort.Slice(items, func(i, j int) bool {
			if len(items[i].k) != len(items[j].k) {
				return len(items[i].k) < len(items[j].k)
			}
			return string(items[i].k) < string(items[j].k)
		})
		out := head(5, uint64(len(items)))
		for _, it := range items {
			out = append(out, it.k...)
			out = append(out, it.v...)
		}
		return out
	}
	panic("devicetest: cannot encode")
}

// --- a software passkey ---

// Passkey is a software WebAuthn authenticator holding one ES256 credential.
type Passkey struct {
	Key       *ecdsa.PrivateKey
	CredID    []byte
	AAGUID    []byte
	RPID      string
	SignCount uint32
}

// NewPasskey creates a credential scoped to rpID.
func NewPasskey(rpID string) *Passkey {
	k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	id := make([]byte, 16)
	_, _ = rand.Read(id)
	return &Passkey{Key: k, CredID: id, AAGUID: []byte("cargoflow-test-a"), RPID: rpID}
}

// PublicKey is the credential's uncompressed P-256 point.
func (p *Passkey) PublicKey() []byte {
	b, _ := p.Key.PublicKey.Bytes()
	return b
}

func (p *Passkey) authData(flags byte, withCred bool) []byte {
	rp := sha256.Sum256([]byte(p.RPID))
	out := append([]byte{}, rp[:]...)
	out = append(out, flags)
	cnt := make([]byte, 4)
	binary.BigEndian.PutUint32(cnt, p.SignCount)
	out = append(out, cnt...)
	if withCred {
		out = append(out, p.AAGUID...)
		l := make([]byte, 2)
		binary.BigEndian.PutUint16(l, uint16(len(p.CredID)))
		out = append(out, l...)
		out = append(out, p.CredID...)
		pub := p.PublicKey()
		out = append(out, CBOR(map[any]any{1: 2, 3: -7, -1: 1, -2: pub[1:33], -3: pub[33:]})...)
	}
	return out
}

func sign(k *ecdsa.PrivateKey, msg []byte) []byte {
	d := sha256.Sum256(msg)
	sig, _ := ecdsa.SignASN1(rand.Reader, k, d[:])
	return sig
}

// Attestation selects the registration statement.
type Attestation struct {
	Format   string            // "none" or "packed"
	CertDER  [][]byte          // packed with x5c: the attestation certificate first
	CertKey  *ecdsa.PrivateKey // packed with x5c: the attestation certificate's key
	SelfSign bool              // packed without x5c
}

// Register runs navigator.credentials.create at origin with challenge.
func (p *Passkey) Register(challenge []byte, origin string, att Attestation) (attestationObject, clientDataJSON []byte) {
	clientDataJSON = devicetrust.EncodeClientData("webauthn.create", challenge, origin)
	ad := p.authData(0x01|0x04|0x40, true)
	cdHash := sha256.Sum256(clientDataJSON)
	signed := append(append([]byte{}, ad...), cdHash[:]...)
	stmt := map[any]any{}
	format := att.Format
	if format == "" {
		format = "none"
	}
	if format == "packed" {
		if att.CertKey != nil {
			x5c := make([]any, len(att.CertDER))
			for i, c := range att.CertDER {
				x5c[i] = c
			}
			stmt = map[any]any{"alg": -7, "sig": sign(att.CertKey, signed), "x5c": x5c}
		} else {
			stmt = map[any]any{"alg": -7, "sig": sign(p.Key, signed)}
		}
	}
	return CBOR(map[any]any{"fmt": format, "authData": ad, "attStmt": stmt}), clientDataJSON
}

// Assert signs a telemetry request's signing string at origin, as navigator.credentials.get would.
func (p *Passkey) Assert(signingString []byte, origin string) devicetrust.Assertion {
	p.SignCount++
	clientDataJSON := devicetrust.EncodeClientData("webauthn.get", devicetrust.AssertionChallenge(signingString), origin)
	ad := p.authData(0x01|0x04, false)
	cdHash := sha256.Sum256(clientDataJSON)
	return devicetrust.Assertion{AuthenticatorData: ad, ClientDataJSON: clientDataJSON, Signature: sign(p.Key, append(append([]byte{}, ad...), cdHash[:]...))}
}

// Origin of an RP id.
func Origin(rpID string) string { return (&url.URL{Scheme: "https", Host: rpID}).String() }

// --- a throwaway certificate authority ---

// CA is a root and an intermediate that issue device and attestation certificates.
type CA struct {
	Root, Inter       *x509.Certificate
	RootKey, InterKey *ecdsa.PrivateKey
	RootPEM, InterPEM string
}

var serial int64 = 1000

func next() *big.Int { serial++; return big.NewInt(serial) }

func create(tmpl, parent *x509.Certificate, pub any, priv *ecdsa.PrivateKey) *x509.Certificate {
	der, err := x509.CreateCertificate(rand.Reader, tmpl, parent, pub, priv)
	if err != nil {
		panic(err)
	}
	c, _ := x509.ParseCertificate(der)
	return c
}

// PEM encodes a certificate.
func PEM(c *x509.Certificate) string {
	return string(pem.EncodeToMemory(&pem.Block{Type: "CERTIFICATE", Bytes: c.Raw}))
}

// NewCA creates a manufacturer root and an intermediate valid around now.
func NewCA(name string, now time.Time) *CA {
	rk, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	ik, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	root := &x509.Certificate{SerialNumber: next(), Subject: pkix.Name{CommonName: name + " Root CA", Organization: []string{name}},
		NotBefore: now.Add(-time.Hour), NotAfter: now.Add(20 * 365 * 24 * time.Hour), IsCA: true, BasicConstraintsValid: true,
		KeyUsage: x509.KeyUsageCertSign | x509.KeyUsageCRLSign}
	rc := create(root, root, &rk.PublicKey, rk)
	inter := &x509.Certificate{SerialNumber: next(), Subject: pkix.Name{CommonName: name + " Device CA", Organization: []string{name}},
		NotBefore: now.Add(-time.Hour), NotAfter: now.Add(10 * 365 * 24 * time.Hour), IsCA: true, BasicConstraintsValid: true,
		KeyUsage: x509.KeyUsageCertSign}
	ic := create(inter, rc, &ik.PublicKey, rk)
	return &CA{Root: rc, Inter: ic, RootKey: rk, InterKey: ik, RootPEM: PEM(rc), InterPEM: PEM(ic)}
}

// DeviceCert issues an end-entity certificate for a secure element's P-256 key.
func (ca *CA) DeviceCert(pub *ecdsa.PublicKey, serialName string, now time.Time) *x509.Certificate {
	t := &x509.Certificate{SerialNumber: next(), Subject: pkix.Name{CommonName: serialName, Organization: ca.Root.Subject.Organization},
		NotBefore: now.Add(-time.Hour), NotAfter: now.Add(5 * 365 * 24 * time.Hour), BasicConstraintsValid: true,
		KeyUsage: x509.KeyUsageDigitalSignature}
	return create(t, ca.Inter, pub, ca.InterKey)
}

// AttestationCert issues a packed-attestation certificate (WebAuthn §8.2.1) carrying aaguid.
func (ca *CA) AttestationCert(aaguid []byte, now time.Time) (*x509.Certificate, *ecdsa.PrivateKey) {
	k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	ext, _ := asn1.Marshal(aaguid)
	t := &x509.Certificate{SerialNumber: next(), Subject: pkix.Name{Country: []string{"SG"}, Organization: ca.Root.Subject.Organization,
		OrganizationalUnit: []string{"Authenticator Attestation"}, CommonName: "Test Authenticator"},
		NotBefore: now.Add(-time.Hour), NotAfter: now.Add(5 * 365 * 24 * time.Hour), BasicConstraintsValid: true,
		ExtraExtensions: []pkix.Extension{{Id: asn1.ObjectIdentifier{1, 3, 6, 1, 4, 1, 45724, 1, 1, 4}, Value: ext}}}
	return create(t, ca.Inter, &k.PublicKey, ca.InterKey), k
}
