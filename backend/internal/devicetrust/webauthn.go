package devicetrust

import (
	"bytes"
	"crypto/sha256"
	"crypto/x509"
	"encoding/asn1"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"slices"
	"strings"
	"time"
)

// WebAuthn (Level 2) registration and assertion checks for passkey evidence sources.

// Authenticator data flags.
const (
	flagUP = 0x01 // user present
	flagUV = 0x04 // user verified
	flagAT = 0x40 // attested credential data included
	flagED = 0x80 // extension data included
)

// coseAlgES256 is COSE's ECDSA w/ SHA-256 (the only algorithm accepted: the key must be P-256).
const coseAlgES256 = -7

// oidFIDOAAGUID is id-fido-gen-ce-aaguid, which an attestation certificate may carry (must then match the AAGUID).
var oidFIDOAAGUID = asn1.ObjectIdentifier{1, 3, 6, 1, 4, 1, 45724, 1, 1, 4}

// RegistrationChallenge is the challenge a passkey registration for a shipment must use:
// sha256("CARGOFLOW-V1-REGISTER\n" + lowercase shipment id).
func RegistrationChallenge(shipmentID string) []byte {
	sum := sha256.Sum256([]byte("CARGOFLOW-V1-REGISTER\n" + strings.ToLower(shipmentID)))
	return sum[:]
}

// AssertionChallenge is the challenge a passkey signs for one telemetry request: sha256 of the CARGOFLOW-V1 signing
// string.
func AssertionChallenge(signingString []byte) []byte {
	sum := sha256.Sum256(signingString)
	return sum[:]
}

// Credential is a verified passkey registration.
type Credential struct {
	PublicKey  []byte // 65-byte uncompressed P-256 point
	ID         []byte
	RPIDHash   []byte
	SignCount  uint32
	AAGUID     string // hex
	Format     string // packed or none
	Attested   bool   // the packed statement carried an x5c chain that verified to a trusted root
	Chain      []string
	UV         bool
	OriginSeen string
}

// Origins is the set of origins passkey ceremonies may come from. Empty accepts any https origin and http://localhost
// (development); set WEBAUTHN_ORIGINS (or CORS_ORIGINS) in production.
type Origins []string

func (o Origins) allows(origin string) bool {
	if len(o) > 0 {
		return slices.Contains(o, origin)
	}
	u, err := url.Parse(origin)
	if err != nil || u.Host == "" {
		return false
	}
	return u.Scheme == "https" || (u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1"))
}

// rpIDCandidates lists the RP ids a credential created at origin may be scoped to: the origin's host and its parent
// domains (never a bare top-level label).
func rpIDCandidates(origin string) []string {
	u, err := url.Parse(origin)
	if err != nil {
		return nil
	}
	host := u.Hostname()
	out := []string{host}
	labels := strings.Split(host, ".")
	for i := 1; i < len(labels)-1; i++ {
		out = append(out, strings.Join(labels[i:], "."))
	}
	return out
}

type clientData struct {
	Type      string `json:"type"`
	Challenge string `json:"challenge"`
	Origin    string `json:"origin"`
}

func parseClientData(raw []byte, wantType string, challenge []byte, origins Origins) (clientData, error) {
	var cd clientData
	if err := json.Unmarshal(raw, &cd); err != nil {
		return cd, invalid("clientDataJSON is not JSON")
	}
	if cd.Type != wantType {
		return cd, invalid("clientDataJSON type is %q, want %q", cd.Type, wantType)
	}
	got, err := DecodeB64(cd.Challenge)
	if err != nil || !bytes.Equal(got, challenge) {
		return cd, invalid("the WebAuthn challenge does not match")
	}
	if !origins.allows(cd.Origin) {
		return cd, invalid("the WebAuthn origin %q is not allowed", oneLine(cd.Origin))
	}
	return cd, nil
}

type authData struct {
	RPIDHash  []byte
	Flags     byte
	SignCount uint32
	AAGUID    []byte
	CredID    []byte
	CredKey   map[any]any
}

func parseAuthData(b []byte) (authData, error) {
	if len(b) < 37 {
		return authData{}, invalid("authenticatorData is too short")
	}
	ad := authData{RPIDHash: b[:32], Flags: b[32], SignCount: binary.BigEndian.Uint32(b[33:37])}
	rest := b[37:]
	if ad.Flags&flagAT != 0 {
		if len(rest) < 18 {
			return ad, invalid("attested credential data is truncated")
		}
		ad.AAGUID = rest[:16]
		n := int(binary.BigEndian.Uint16(rest[16:18]))
		if n == 0 || n > 1023 || len(rest) < 18+n {
			return ad, invalid("the credential id is malformed")
		}
		ad.CredID = rest[18 : 18+n]
		key, used, err := cborDecode(rest[18+n:])
		if err != nil {
			return ad, invalid("the credential public key is not CBOR")
		}
		m, ok := key.(map[any]any)
		if !ok {
			return ad, invalid("the credential public key is not a COSE key")
		}
		ad.CredKey = m
		rest = rest[18+n+used:]
	}
	if ad.Flags&flagED != 0 {
		if _, used, err := cborDecode(rest); err != nil {
			return ad, invalid("extension data is not CBOR")
		} else {
			rest = rest[used:]
		}
	}
	if len(rest) != 0 {
		return ad, invalid("authenticatorData has trailing bytes")
	}
	return ad, nil
}

// coseP256 converts a COSE EC2 ES256 P-256 key to the uncompressed point.
func coseP256(k map[any]any) ([]byte, error) {
	kty, _ := k[int64(1)].(int64)
	alg, _ := k[int64(3)].(int64)
	crv, _ := k[int64(-1)].(int64)
	x, _ := k[int64(-2)].([]byte)
	y, _ := k[int64(-3)].([]byte)
	if kty != 2 || alg != coseAlgES256 || crv != 1 || len(x) != 32 || len(y) != 32 {
		return nil, invalid("the passkey must be an ES256 (P-256) credential")
	}
	pub := append([]byte{4}, append(append([]byte{}, x...), y...)...)
	if _, err := p256Key(pub); err != nil {
		return nil, err
	}
	return pub, nil
}

// VerifyRegistration checks a passkey's attestation object and clientDataJSON (WebAuthn L2 §7.1, steps 5-24 that apply
// to a relying party without a metadata service): type webauthn.create, the challenge, an allowed origin, an RP id hash
// matching the origin's host or a parent domain, the user-present flag, an ES256 credential key, and the attestation
// statement: "none", or "packed" with self attestation, or "packed" with an x5c chain whose certificate meets §8.2.1
// and verifies to one of roots.
func VerifyRegistration(attestationObject, clientDataJSON, challenge []byte, origins Origins, roots *Roots, now time.Time) (Credential, error) {
	cd, err := parseClientData(clientDataJSON, "webauthn.create", challenge, origins)
	if err != nil {
		return Credential{}, err
	}
	obj, _, err := cborDecode(attestationObject)
	if err != nil {
		return Credential{}, invalid("the attestation object is not CBOR")
	}
	m, ok := obj.(map[any]any)
	if !ok {
		return Credential{}, invalid("the attestation object is not a map")
	}
	fmtName, _ := m["fmt"].(string)
	rawAuth, _ := m["authData"].([]byte)
	stmt, _ := m["attStmt"].(map[any]any)
	if rawAuth == nil || stmt == nil {
		return Credential{}, invalid("the attestation object needs fmt, authData and attStmt")
	}
	ad, err := parseAuthData(rawAuth)
	if err != nil {
		return Credential{}, err
	}
	rpOK := false
	for _, id := range rpIDCandidates(cd.Origin) {
		sum := sha256.Sum256([]byte(id))
		if bytes.Equal(sum[:], ad.RPIDHash) {
			rpOK = true
			break
		}
	}
	if !rpOK {
		return Credential{}, invalid("the credential is scoped to a relying party that does not match the origin")
	}
	if ad.Flags&flagUP == 0 {
		return Credential{}, invalid("the user-present flag is not set")
	}
	if ad.Flags&flagAT == 0 || ad.CredKey == nil {
		return Credential{}, invalid("the registration carries no credential")
	}
	pub, err := coseP256(ad.CredKey)
	if err != nil {
		return Credential{}, err
	}
	cred := Credential{PublicKey: pub, ID: append([]byte(nil), ad.CredID...), RPIDHash: append([]byte(nil), ad.RPIDHash...), SignCount: ad.SignCount,
		AAGUID: hex.EncodeToString(ad.AAGUID), Format: fmtName, UV: ad.Flags&flagUV != 0, OriginSeen: cd.Origin}
	cdHash := sha256.Sum256(clientDataJSON)
	signed := append(append([]byte{}, rawAuth...), cdHash[:]...)

	switch fmtName {
	case "none":
		if len(stmt) != 0 {
			return Credential{}, invalid("a none attestation has an empty statement")
		}
	case "packed":
		alg, _ := stmt["alg"].(int64)
		sig, _ := stmt["sig"].([]byte)
		if alg != coseAlgES256 || len(sig) == 0 {
			return Credential{}, invalid("a packed statement needs alg -7 (ES256) and sig")
		}
		x5c, hasChain := stmt["x5c"].([]any)
		if !hasChain {
			if !VerifyP256(pub, signed, sig) {
				return Credential{}, invalid("the packed self-attestation signature does not verify")
			}
			break
		}
		certs := make([]*x509.Certificate, 0, len(x5c))
		for _, c := range x5c {
			der, _ := c.([]byte)
			cert, err := x509.ParseCertificate(der)
			if err != nil {
				return Credential{}, invalid("an x5c certificate could not be parsed")
			}
			certs = append(certs, cert)
		}
		if len(certs) == 0 || len(certs) > 6 {
			return Credential{}, invalid("x5c holds 1 to 6 certificates")
		}
		att := certs[0]
		attKey, err := p256Bytes(att.PublicKey)
		if err != nil || !VerifyP256(attKey, signed, sig) {
			return Credential{}, invalid("the packed attestation signature does not verify with the attestation certificate")
		}
		if err := checkPackedCert(att, ad.AAGUID); err != nil {
			return Credential{}, err
		}
		if roots.Empty() {
			return Credential{}, invalid("this backend has no manufacturer roots configured (DEVICE_ROOTS_DIR) to verify the passkey's attestation chain; register with attestation \"none\"")
		}
		inter := x509.NewCertPool()
		for _, c := range certs[1:] {
			inter.AddCert(c)
		}
		chains, err := att.Verify(x509.VerifyOptions{Roots: roots.Pool, Intermediates: inter, CurrentTime: now, KeyUsages: []x509.ExtKeyUsage{x509.ExtKeyUsageAny}})
		if err != nil {
			return Credential{}, invalid("the passkey's attestation chain does not verify to a trusted root: %s", oneLine(err.Error()))
		}
		cred.Attested = true
		for _, c := range chains[0] {
			cred.Chain = append(cred.Chain, c.Subject.String())
		}
	default:
		return Credential{}, invalid("attestation format %q is not supported (use packed or none)", oneLine(fmtName))
	}
	return cred, nil
}

// checkPackedCert applies the packed attestation certificate requirements (WebAuthn L2 §8.2.1).
func checkPackedCert(c *x509.Certificate, aaguid []byte) error {
	if c.Version != 3 {
		return invalid("the attestation certificate must be X.509 version 3")
	}
	s := c.Subject
	if len(s.Country) == 0 || len(s.Organization) == 0 || s.CommonName == "" || !slices.Contains(s.OrganizationalUnit, "Authenticator Attestation") {
		return invalid("the attestation certificate subject needs C, O, OU=\"Authenticator Attestation\" and CN")
	}
	if c.IsCA {
		return invalid("the attestation certificate must not be a CA")
	}
	for _, ext := range c.Extensions {
		if ext.Id.Equal(oidFIDOAAGUID) {
			if ext.Critical {
				return invalid("the AAGUID extension must not be critical")
			}
			var got []byte
			if _, err := asn1.Unmarshal(ext.Value, &got); err != nil || !bytes.Equal(got, aaguid) {
				return invalid("the attestation certificate's AAGUID does not match the authenticator's")
			}
		}
	}
	return nil
}

// Assertion is one passkey-signed telemetry request.
type Assertion struct {
	AuthenticatorData []byte
	ClientDataJSON    []byte
	Signature         []byte
}

// VerifyAssertion checks a passkey assertion over a telemetry request (WebAuthn L2 §7.2, steps 11-21): type
// webauthn.get, challenge = sha256(signing string), an allowed origin, the registered RP id hash, the user-present
// flag, and the signature over authenticatorData || sha256(clientDataJSON) with the registered key. It returns the
// authenticator's signature counter for the caller's clone check.
func VerifyAssertion(pub65, rpIDHash []byte, a Assertion, signingString []byte, origins Origins) (uint32, error) {
	if _, err := parseClientData(a.ClientDataJSON, "webauthn.get", AssertionChallenge(signingString), origins); err != nil {
		return 0, err
	}
	ad, err := parseAuthData(a.AuthenticatorData)
	if err != nil {
		return 0, err
	}
	if len(rpIDHash) == 32 && !bytes.Equal(ad.RPIDHash, rpIDHash) {
		return 0, invalid("the assertion is for another relying party")
	}
	if ad.Flags&flagUP == 0 {
		return 0, invalid("the user-present flag is not set")
	}
	cdHash := sha256.Sum256(a.ClientDataJSON)
	if !VerifyP256(pub65, append(append([]byte{}, a.AuthenticatorData...), cdHash[:]...), a.Signature) {
		return 0, invalid("the passkey signature does not verify")
	}
	return ad.SignCount, nil
}

// EncodeClientData builds a clientDataJSON (for clients and tests) in the order browsers use.
func EncodeClientData(typ string, challenge []byte, origin string) []byte {
	b, _ := json.Marshal(struct {
		Type        string `json:"type"`
		Challenge   string `json:"challenge"`
		Origin      string `json:"origin"`
		CrossOrigin bool   `json:"crossOrigin"`
	}{typ, b64url(challenge), origin, false})
	return b
}
