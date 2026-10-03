package chain_test

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"

	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/chain/chaintest"
)

func writeManifest(t *testing.T, body string) string {
	t.Helper()
	p := filepath.Join(t.TempDir(), "m.json")
	if err := os.WriteFile(p, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
	return p
}

const goodManifest = `{
  "chainId": 31337,
  "usdg": "0x5FbDB2315678afecb367f032d93F642f64180aa3",
  "contracts": {
    "access": "0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512",
    "shipmentRegistry": "0x9fE46736679d2D9a65F0992F2272dE9f3c7fa6e0",
    "policyEngine": "0xCf7Ed3AccA5a467e9e704C703E8D87F634fB0Fc9",
    "evidenceRegistry": "0xDc64a140Aa3E981100a9becA4E685f962f0cF6C9",
    "receivableVault": "0x5FC8d32690cc91D4c39d9d3abcBD16989F875707",
    "groth16Verifier": "0x0165878A594ca255338adfa4d48449f69242Eb8F",
    "financingController": "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853"
  }
}`

func TestLoadManifestParsesEveryAddress(t *testing.T) {
	m, err := chain.LoadManifest(writeManifest(t, goodManifest))
	if err != nil {
		t.Fatal(err)
	}
	if m.ChainID != 31337 || m.Controller != common.HexToAddress("0xa513E6E4b8f2a923D98304ec87F64353C4D5C853") {
		t.Fatalf("manifest = %+v", m)
	}
	for name, a := range map[string]common.Address{
		"usdg": m.USDG, "access": m.Access, "registry": m.Registry, "policies": m.Policies,
		"evidence": m.Evidence, "vault": m.Vault, "verifier": m.Verifier, "controller": m.Controller,
	} {
		if a == (common.Address{}) {
			t.Errorf("%s address is zero", name)
		}
	}
}

func TestLoadManifestRejectsIncompleteOrMalformedFiles(t *testing.T) {
	if _, err := chain.LoadManifest(filepath.Join(t.TempDir(), "missing.json")); err == nil {
		t.Fatal("missing file accepted")
	}
	if _, err := chain.LoadManifest(writeManifest(t, `not json`)); err == nil {
		t.Fatal("garbage accepted")
	}
	missing := strings.Replace(goodManifest, `"financingController": "0xa513E6E4b8f2a923D98304ec87F64353C4D5C853"`, `"financingController": ""`, 1)
	if _, err := chain.LoadManifest(writeManifest(t, missing)); err == nil || !strings.Contains(err.Error(), "financingController") {
		t.Fatalf("a missing contract address must be named in the error, got %v", err)
	}
	bad := strings.Replace(goodManifest, `"0x5FbDB2315678afecb367f032d93F642f64180aa3"`, `"0xNOPE"`, 1)
	if _, err := chain.LoadManifest(writeManifest(t, bad)); err == nil || !strings.Contains(err.Error(), "usdg") {
		t.Fatalf("a malformed address must be named in the error, got %v", err)
	}
	noChain := strings.Replace(goodManifest, `"chainId": 31337,`, ``, 1)
	if _, err := chain.LoadManifest(writeManifest(t, noChain)); err == nil {
		t.Fatal("a manifest without a chain id was accepted")
	}
}

func TestLoadManifestReadsTheOptionalCoverPool(t *testing.T) {
	m, err := chain.LoadManifest(writeManifest(t, goodManifest))
	if err != nil || m.CoverPool != (common.Address{}) {
		t.Fatalf("a v1 manifest must load without a cover pool: %+v, %v", m, err)
	}
	v2 := strings.Replace(goodManifest, `"access":`, `"coverPool": "0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6", "access":`, 1)
	m, err = chain.LoadManifest(writeManifest(t, v2))
	if err != nil || m.CoverPool != common.HexToAddress("0x2279B7A0a67DB372996a5FaB50D91eAA73d2eBe6") {
		t.Fatalf("v2 manifest: %+v, %v", m, err)
	}
	bad := strings.Replace(goodManifest, `"access":`, `"coverPool": "0xNOPE", "access":`, 1)
	if _, err := chain.LoadManifest(writeManifest(t, bad)); err == nil || !strings.Contains(err.Error(), "coverPool") {
		t.Fatalf("a malformed cover pool must be named, got %v", err)
	}
}

func dial(t *testing.T) (*chain.Client, *chaintest.Env) {
	t.Helper()
	env := chaintest.Start(t)
	m, err := chain.LoadManifest(env.ManifestPath)
	if err != nil {
		t.Fatal(err)
	}
	c, err := chain.Dial(context.Background(), env.RPCURL, m)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(c.Close)
	return c, env
}

func TestDialVerifiesTheChainIdAndThatContractsExist(t *testing.T) {
	c, env := dial(t)
	if err := c.CheckDeployed(context.Background()); err != nil {
		t.Fatalf("deployed contracts not found: %v", err)
	}

	wrong := c.M
	wrong.ChainID = 1
	if _, err := chain.Dial(context.Background(), env.RPCURL, wrong); err == nil {
		t.Fatal("dialling the wrong chain id succeeded; a mis-pointed RPC could sign transactions for the wrong network")
	}

	missing := c.M
	missing.Controller = common.HexToAddress("0x000000000000000000000000000000000000dEaD")
	c2, err := chain.Dial(context.Background(), env.RPCURL, missing)
	if err != nil {
		t.Fatal(err)
	}
	defer c2.Close()
	if err := c2.CheckDeployed(context.Background()); err == nil || !strings.Contains(err.Error(), "controller") {
		t.Fatalf("an address with no code must be reported by name, got %v", err)
	}
}

func TestDeployedRolesMatchTheLeastPrivilegeDesign(t *testing.T) {
	c, env := dial(t)
	ctx := context.Background()
	addr := func(name string) common.Address { return crypto.PubkeyToAddress(env.Keys[name].PublicKey) }

	cases := []struct {
		role   string
		holder common.Address
		want   bool
		why    string
	}{
		{"CONTROLLER_ROLE", c.M.Controller, true, "the controller is the only contract the vault obeys"},
		{"PROOF_VERIFIER_ROLE", c.M.Controller, true, "the controller marks epochs proof-verified"},
		{"EVIDENCE_VERIFIER_ROLE", addr("worker"), true, "the evidence worker commits epochs"},
		{"MONITOR_ROLE", addr("monitor"), true, "the monitor may request pauses"},
		{"DISPUTE_ROLE", addr("arbiter"), true, "the arbiter resolves disputes"},
		{"FACILITY_MANAGER_ROLE", addr("deployer"), true, "the relayer releases milestones"},
		// what must NOT hold
		{"CONTROLLER_ROLE", addr("monitor"), false, "the AI monitor must have no route to vault custody"},
		{"CONTROLLER_ROLE", addr("worker"), false, "the evidence worker must not control the vault"},
		{"DISPUTE_ROLE", addr("monitor"), false, "the monitor must not be able to resume or resolve"},
		{"EVIDENCE_VERIFIER_ROLE", addr("monitor"), false, "the monitor must not commit evidence"},
		{"MONITOR_ROLE", addr("exporter"), false, "an exporter must not hold operator roles"},
	}
	for _, tc := range cases {
		got, err := c.HasRole(ctx, tc.role, tc.holder)
		if err != nil {
			t.Fatalf("%s: %v", tc.role, err)
		}
		if got != tc.want {
			t.Errorf("%s for %s = %v, want %v (%s)", tc.role, tc.holder.Hex(), got, tc.want, tc.why)
		}
	}
}

// OpenZeppelin's DEFAULT_ADMIN_ROLE is bytes32(0), not keccak256("DEFAULT_ADMIN_ROLE"). A startup check
// that hashed the name would compare against a role nobody holds and pass vacuously, so the name-based
// lookup must resolve the admin role to its real identifier.
func TestTheAdminRoleIsDetectableByNameAndByIdentifier(t *testing.T) {
	c, env := dial(t)
	ctx := context.Background()
	deployer := crypto.PubkeyToAddress(env.Keys["deployer"].PublicKey)
	monitor := crypto.PubkeyToAddress(env.Keys["monitor"].PublicKey)

	for name, who := range map[string]struct {
		addr common.Address
		want bool
	}{"deployer": {deployer, true}, "monitor": {monitor, false}} {
		byName, err := c.HasRole(ctx, "DEFAULT_ADMIN_ROLE", who.addr)
		if err != nil || byName != who.want {
			t.Errorf("%s: HasRole(DEFAULT_ADMIN_ROLE) = %v, %v; want %v", name, byName, err, who.want)
		}
		byID, err := c.HasRoleID(ctx, [32]byte{}, who.addr)
		if err != nil || byID != who.want {
			t.Errorf("%s: HasRoleID(0x00) = %v, %v; want %v", name, byID, err, who.want)
		}
	}
	// the trap, demonstrated: the hash of the name is a role nobody holds
	if ok, _ := c.HasRoleID(ctx, [32]byte(crypto.Keccak256Hash([]byte("DEFAULT_ADMIN_ROLE"))), deployer); ok {
		t.Fatal("the hash of the admin role's name identifies nothing; if this holds the assumption behind the fix is wrong")
	}
}
