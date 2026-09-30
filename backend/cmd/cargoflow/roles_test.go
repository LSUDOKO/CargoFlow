package main

import (
	"context"
	"strings"
	"testing"

	"github.com/ethereum/go-ethereum/crypto"

	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/chain/chaintest"
)

func rolesEnv(t *testing.T) (*chain.Client, map[string]*chain.Signer) {
	t.Helper()
	ce := chaintest.Start(t)
	m, err := chain.LoadManifest(ce.ManifestPath)
	if err != nil {
		t.Fatal(err)
	}
	c, err := chain.Dial(context.Background(), ce.RPCURL, m)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(c.Close)
	s := map[string]*chain.Signer{}
	for name, k := range ce.Keys {
		s[name] = chain.NewSigner(k)
	}
	return c, s
}

func TestStartupRoleCheckAcceptsTheIntendedAssignment(t *testing.T) {
	c, s := rolesEnv(t)
	if err := verifyRoles(context.Background(), c, s["worker"], s["monitor"], s["deployer"]); err != nil {
		t.Fatalf("the intended assignment was rejected: %v", err)
	}
}

func TestStartupRoleCheckRefusesKeysThatLackTheirRole(t *testing.T) {
	c, s := rolesEnv(t)
	ctx := context.Background()
	// the exporter key holds no operational role at all
	for name, args := range map[string][3]*chain.Signer{
		"worker":  {s["exporter"], s["monitor"], s["deployer"]},
		"monitor": {s["worker"], s["exporter"], s["deployer"]},
		"manager": {s["worker"], s["monitor"], s["exporter"]},
	} {
		err := verifyRoles(ctx, c, args[0], args[1], args[2])
		if err == nil {
			t.Errorf("a %s key without its role was accepted", name)
		}
	}
}

// The monitor key is what an AI model acts through. If it ever holds more than the pause role, the service
// must refuse to start, because the whole safety argument is that the model can request a pause and nothing else.
func TestStartupRoleCheckRefusesAMonitorWithExtraAuthority(t *testing.T) {
	c, s := rolesEnv(t)
	ctx := context.Background()
	// misconfigure: the deployer key (admin + facility manager) is also given the monitor role and used as the monitor
	if _, err := c.Transact(ctx, s["deployer"], "access", "grantRole", [32]byte(crypto.Keccak256Hash([]byte("MONITOR_ROLE"))), s["deployer"].Address()); err != nil {
		t.Fatal(err)
	}
	err := verifyRoles(ctx, c, s["worker"], s["deployer"], s["deployer"])
	if err == nil {
		t.Fatal("a monitor key that is also the admin and facility manager was accepted")
	}
	if !strings.Contains(err.Error(), "MONITOR_KEY") || !strings.Contains(err.Error(), "nothing else") {
		t.Fatalf("the refusal should explain the problem, got: %v", err)
	}
}
