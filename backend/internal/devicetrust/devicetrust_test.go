package devicetrust_test

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/pem"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/LSUDOKO/CargoFlow/backend/internal/devicetrust"
	"github.com/LSUDOKO/CargoFlow/backend/internal/devicetrust/devicetest"
)

var now = time.Now()

func pubBytes(k *ecdsa.PrivateKey) []byte { b, _ := k.PublicKey.Bytes(); return b }

func TestParseP256AcceptsSEC1AndSPKI(t *testing.T) {
	k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	want := pubBytes(k)
	spki, _ := x509.MarshalPKIXPublicKey(&k.PublicKey)
	compressed := elliptic.MarshalCompressed(elliptic.P256(), k.PublicKey.X, k.PublicKey.Y) //nolint:staticcheck
	for name, in := range map[string][]byte{"uncompressed": want, "compressed": compressed, "spki": spki} {
		got, err := devicetrust.ParseP256(in)
		if err != nil || string(got) != string(want) {
			t.Errorf("%s: %x, %v", name, got, err)
		}
	}
	bad := append([]byte{}, want...)
	bad[40] ^= 1
	if _, err := devicetrust.ParseP256(bad); err == nil {
		t.Error("a point off the curve must be refused")
	}
}

func TestVerifyP256AcceptsDERAndRaw(t *testing.T) {
	k, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	msg := []byte("CARGOFLOW-V1\nPOST\n/v1/shipments/0x01/telemetry\n1700000000\nabc")
	d := sha256.Sum256(msg)
	der, _ := ecdsa.SignASN1(rand.Reader, k, d[:])
	r, s, _ := ecdsa.Sign(rand.Reader, k, d[:])
	raw := append(r.FillBytes(make([]byte, 32)), s.FillBytes(make([]byte, 32))...)
	if !devicetrust.VerifyP256(pubBytes(k), msg, der) || !devicetrust.VerifyP256(pubBytes(k), msg, raw) {
		t.Fatal("valid DER and raw signatures must verify")
	}
	if devicetrust.VerifyP256(pubBytes(k), append(msg, '!'), der) {
		t.Fatal("a signature over another message must not verify")
	}
}

func TestSecureElementChainVerifiesToAManufacturerRoot(t *testing.T) {
	ca := devicetest.NewCA("Acme Silicon", now)
	roots := &devicetrust.Roots{Pool: x509.NewCertPool()}
	if err := roots.AddPEM(ca.RootPEM); err != nil {
		t.Fatal(err)
	}
	dev, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	leaf := ca.DeviceCert(&dev.PublicKey, "ATECC608A-0001", now)
	chain := []string{devicetest.PEM(leaf), ca.InterPEM}

	res, err := devicetrust.VerifyChain(chain, roots, pubBytes(dev), now)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(res.Leaf, "ATECC608A-0001") || len(res.Chain) != 3 {
		t.Fatalf("result = %+v", res)
	}

	other, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if _, err := devicetrust.VerifyChain(chain, roots, pubBytes(other), now); err == nil {
		t.Error("a certificate for another key must not vouch for this one")
	}
	stranger := devicetest.NewCA("Unknown Fab", now)
	if _, err := devicetrust.VerifyChain([]string{devicetest.PEM(stranger.DeviceCert(&dev.PublicKey, "x", now)), stranger.InterPEM}, roots, pubBytes(dev), now); err == nil {
		t.Error("a chain to an untrusted root must be refused")
	}
	if _, err := devicetrust.VerifyChain(chain, &devicetrust.Roots{}, pubBytes(dev), now); err == nil || !errors.Is(err, devicetrust.ErrInvalid) {
		t.Error("without configured roots nothing verifies")
	}
	if _, err := devicetrust.VerifyChain([]string{devicetest.PEM(leaf)}, roots, pubBytes(dev), now); err == nil {
		t.Error("a chain missing its intermediate must not verify")
	}
	if _, err := devicetrust.VerifyChain(chain, roots, pubBytes(dev), now.Add(30*365*24*time.Hour)); err == nil {
		t.Error("an expired certificate must not verify")
	}
}

// The shipped test root and chain (scripts/make-device-certs.sh) verify, and the shipped device key signs.
func TestShippedTestRootAndChain(t *testing.T) {
	roots, err := devicetrust.LoadRoots("testdata/roots")
	if err != nil {
		t.Fatal(err)
	}
	if roots.Empty() {
		t.Fatal("the test root must load")
	}
	chain, _ := os.ReadFile("testdata/chain.pem")
	pubB64, _ := os.ReadFile("testdata/device-public.b64url")
	pub, err := devicetrust.DecodeB64(strings.TrimSpace(string(pubB64)))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := devicetrust.VerifyChain([]string{string(chain)}, roots, pub, now); err != nil {
		t.Fatal(err)
	}
	keyPEM, _ := os.ReadFile("testdata/device-key.pem")
	block, _ := pem.Decode(keyPEM)
	k, err := x509.ParsePKCS8PrivateKey(block.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	if got := pubBytes(k.(*ecdsa.PrivateKey)); string(got) != string(pub) {
		t.Fatal("device-public.b64url must be the device key's point")
	}
}

func TestPasskeyRegistrationAndAssertion(t *testing.T) {
	const rp = "app.cargoflow.test"
	origin := devicetest.Origin(rp)
	origins := devicetrust.Origins{origin}
	challenge := devicetrust.RegistrationChallenge("0xABC")
	pk := devicetest.NewPasskey(rp)

	for _, att := range []devicetest.Attestation{{Format: "none"}, {Format: "packed", SelfSign: true}} {
		obj, cd := pk.Register(challenge, origin, att)
		cred, err := devicetrust.VerifyRegistration(obj, cd, challenge, origins, nil, now)
		if err != nil {
			t.Fatalf("%s: %v", att.Format, err)
		}
		if string(cred.PublicKey) != string(pk.PublicKey()) || string(cred.ID) != string(pk.CredID) || cred.Attested {
			t.Fatalf("%s: credential = %+v", att.Format, cred)
		}
	}

	signing := []byte("CARGOFLOW-V1\nPOST\n/v1/shipments/0xabc/telemetry\n1700000000\ndeadbeef")
	rpHash := sha256.Sum256([]byte(rp))
	a := pk.Assert(signing, origin)
	count, err := devicetrust.VerifyAssertion(pk.PublicKey(), rpHash[:], a, signing, origins)
	if err != nil || count != 1 {
		t.Fatalf("assertion: %d %v", count, err)
	}
	if _, err := devicetrust.VerifyAssertion(pk.PublicKey(), rpHash[:], a, append(signing, '0'), origins); err == nil {
		t.Error("an assertion over another request (challenge) must fail")
	}
	if _, err := devicetrust.VerifyAssertion(pk.PublicKey(), rpHash[:], pk.Assert(signing, "https://evil.example"), signing, origins); err == nil {
		t.Error("an assertion from another origin must fail")
	}
	otherRP := sha256.Sum256([]byte("other.example"))
	if _, err := devicetrust.VerifyAssertion(pk.PublicKey(), otherRP[:], pk.Assert(signing, origin), signing, origins); err == nil {
		t.Error("an assertion for another relying party must fail")
	}
	tampered := pk.Assert(signing, origin)
	tampered.AuthenticatorData[33] ^= 0xff // the counter is signed
	if _, err := devicetrust.VerifyAssertion(pk.PublicKey(), rpHash[:], tampered, signing, origins); err == nil {
		t.Error("tampered authenticator data must fail")
	}

	t.Run("refusals", func(t *testing.T) {
		obj, cd := pk.Register([]byte("wrong challenge"), origin, devicetest.Attestation{})
		if _, err := devicetrust.VerifyRegistration(obj, cd, challenge, origins, nil, now); err == nil {
			t.Error("a registration with another challenge must fail")
		}
		elsewhere := devicetest.NewPasskey("evil.example")
		obj, cd = elsewhere.Register(challenge, origin, devicetest.Attestation{})
		if _, err := devicetrust.VerifyRegistration(obj, cd, challenge, origins, nil, now); err == nil {
			t.Error("a credential scoped to another RP must fail")
		}
		obj, cd = pk.Register(challenge, origin, devicetest.Attestation{Format: "packed", SelfSign: true})
		obj[len(obj)-1] ^= 1 // corrupt the self-attestation signature
		if _, err := devicetrust.VerifyRegistration(obj, cd, challenge, origins, nil, now); err == nil {
			t.Error("a bad self-attestation must fail")
		}
	})
}

func TestPackedAttestationWithACertificateChain(t *testing.T) {
	const rp = "app.cargoflow.test"
	origin := devicetest.Origin(rp)
	ca := devicetest.NewCA("Passkey Vendor", now)
	roots := &devicetrust.Roots{Pool: x509.NewCertPool()}
	_ = roots.AddPEM(ca.RootPEM)
	pk := devicetest.NewPasskey(rp)
	cert, key := ca.AttestationCert(pk.AAGUID, now)
	challenge := devicetrust.RegistrationChallenge("0xabc")
	obj, cd := pk.Register(challenge, origin, devicetest.Attestation{Format: "packed", CertDER: [][]byte{cert.Raw, ca.Inter.Raw}, CertKey: key})

	cred, err := devicetrust.VerifyRegistration(obj, cd, challenge, devicetrust.Origins{origin}, roots, now)
	if err != nil {
		t.Fatal(err)
	}
	if !cred.Attested || len(cred.Chain) != 3 || cred.Format != "packed" {
		t.Fatalf("credential = %+v", cred)
	}
	if _, err := devicetrust.VerifyRegistration(obj, cd, challenge, devicetrust.Origins{origin}, &devicetrust.Roots{Pool: x509.NewCertPool()}, now); err == nil {
		t.Error("an attestation chain needs a configured root")
	}
	wrongAAGUID, wkey := ca.AttestationCert([]byte("another-aaguid-x"), now)
	obj, cd = pk.Register(challenge, origin, devicetest.Attestation{Format: "packed", CertDER: [][]byte{wrongAAGUID.Raw, ca.Inter.Raw}, CertKey: wkey})
	if _, err := devicetrust.VerifyRegistration(obj, cd, challenge, devicetrust.Origins{origin}, roots, now); err == nil {
		t.Error("an attestation certificate for another authenticator model must fail")
	}
}

func TestOriginsDefaultToHTTPSOrLocalhost(t *testing.T) {
	pk := devicetest.NewPasskey("localhost")
	ch := devicetrust.RegistrationChallenge("0x1")
	obj, cd := pk.Register(ch, "http://localhost:3000", devicetest.Attestation{})
	if _, err := devicetrust.VerifyRegistration(obj, cd, ch, nil, nil, now); err != nil {
		t.Fatalf("localhost is allowed in development: %v", err)
	}
	pk = devicetest.NewPasskey("example.com")
	obj, cd = pk.Register(ch, "http://example.com", devicetest.Attestation{})
	if _, err := devicetrust.VerifyRegistration(obj, cd, ch, nil, nil, now); err == nil {
		t.Fatal("plain http on a public host is refused")
	}
}

func TestReliabilityRanksSecureElementHighest(t *testing.T) {
	se, pk, sw := devicetrust.ReliabilityBps(devicetrust.ClassSecureElement), devicetrust.ReliabilityBps(devicetrust.ClassPasskey), devicetrust.ReliabilityBps(devicetrust.ClassSoftware)
	if !(se > pk && pk > sw && sw == 9500) {
		t.Fatalf("%d %d %d", se, pk, sw)
	}
}

func TestCBORRefusesMalformedInput(t *testing.T) {
	for _, in := range [][]byte{{}, {0x5f}, {0x9f}, {0x42, 0x01}, {0xa1, 0x01}, {0xa2, 0x01, 0x01, 0x01, 0x02}} {
		if _, err := devicetrust.ExportCBORDecode(in); err == nil {
			t.Errorf("% x must be refused", in)
		}
	}
	v, err := devicetrust.ExportCBORDecode(devicetest.CBOR(map[any]any{"a": []any{1, -7, []byte{1, 2}}}))
	if err != nil {
		t.Fatal(err)
	}
	if v.(map[any]any)["a"].([]any)[1].(int64) != -7 {
		t.Fatalf("%v", v)
	}
}
