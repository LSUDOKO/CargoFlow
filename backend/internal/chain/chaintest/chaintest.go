// Package chaintest starts a real anvil chain and deploys the real CargoFlow contracts to it, once per
// test process, so integration tests exercise genuine on-chain behaviour instead of mocks.
// Tests are skipped, not failed, when Foundry is not installed.
package chaintest

import (
	"bytes"
	"crypto/ecdsa"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/ethereum/go-ethereum/crypto"
)

// Anvil's well-known development keys (public; worthless on any real network). Role assignment matches
// contracts/script/Deploy.s.sol and RunHero.s.sol on a local chain.
var anvilKeys = map[string]string{
	"deployer":  "ac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
	"exporter":  "59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
	"financier": "5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
	"buyer":     "7c852118294e51e653712a81e05800f419141751be58f605c371e15141b007a6",
	"worker":    "47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
	"monitor":   "8b3a350cf5c34c9194ca85829a2df0ec3153be0318b5e2d3348e872092edffba",
	"arbiter":   "92db14e403b83dfe3df233f83dfa3a0d7096f21ca9b0d6d6b8d88b2b4ec1564e",
}

// Env describes the running chain.
type Env struct {
	RPCURL       string
	ChainID      uint64
	ManifestPath string
	Keys         map[string]*ecdsa.PrivateKey // deployer, exporter, financier, buyer, worker, monitor, arbiter
	// the deployer also holds FACILITY_MANAGER_ROLE in the local deployment
}

var (
	once    sync.Once
	shared  *Env
	initErr error
	skipMsg string
)

// Start returns the shared chain, starting and deploying it on first use.
func Start(t testing.TB) *Env {
	t.Helper()
	once.Do(func() { shared, initErr = launch() })
	if skipMsg != "" {
		t.Skip(skipMsg)
	}
	if initErr != nil {
		t.Fatalf("chain test environment failed: %v", initErr)
	}
	return shared
}

// FindFoundry locates a real Foundry binary. `forge` on PATH is sometimes a different tool entirely,
// so a candidate must identify itself as Foundry.
func FindFoundry(name string) (string, bool) {
	home, _ := os.UserHomeDir()
	candidates := []string{}
	if dir := os.Getenv("FOUNDRY_BIN_DIR"); dir != "" {
		candidates = append(candidates, filepath.Join(dir, name))
	}
	if p, err := exec.LookPath(name); err == nil {
		candidates = append(candidates, p)
	}
	candidates = append(candidates,
		filepath.Join(home, ".foundry", "bin", name),
		filepath.Join(home, ".config", ".foundry", "bin", name))
	for _, c := range candidates {
		out, err := exec.Command(c, "--version").CombinedOutput()
		if err == nil && strings.Contains(string(out), "Version:") {
			return c, true
		}
	}
	return "", false
}

func launch() (*Env, error) {
	anvil, ok := FindFoundry("anvil")
	if !ok {
		skipMsg = "anvil not found (install Foundry or set FOUNDRY_BIN_DIR)"
		return nil, nil
	}
	forge, ok := FindFoundry("forge")
	if !ok {
		skipMsg = "forge not found (install Foundry or set FOUNDRY_BIN_DIR)"
		return nil, nil
	}
	root, err := repoRoot()
	if err != nil {
		return nil, err
	}

	port, err := freePort()
	if err != nil {
		return nil, err
	}
	url := fmt.Sprintf("http://127.0.0.1:%d", port)
	cmd := exec.Command(anvil, "--silent", "--port", fmt.Sprint(port))
	setPdeathsig(cmd) // anvil dies with the test process
	if err := cmd.Start(); err != nil {
		return nil, fmt.Errorf("start anvil: %w", err)
	}
	if err := waitForRPC(url, 15*time.Second); err != nil {
		_ = cmd.Process.Kill()
		return nil, err
	}

	tmp, err := os.MkdirTemp("", "cf-chaintest-")
	if err != nil {
		return nil, err
	}
	// Foundry only allows scripts to write under contracts/deployments, so deploy there (the file name is
	// gitignored), then move the manifest into a private temp directory.
	scriptOut := filepath.Join("deployments", fmt.Sprintf("test-chaintest-%d.json", os.Getpid()))
	deploy := exec.Command(forge, "script", "script/Deploy.s.sol", "--rpc-url", url, "--broadcast")
	deploy.Dir = filepath.Join(root, "contracts")
	deploy.Env = append(os.Environ(), "DEPLOYMENT_FILE="+scriptOut)
	var out bytes.Buffer
	deploy.Stdout, deploy.Stderr = &out, &out
	if err := deploy.Run(); err != nil {
		_ = cmd.Process.Kill()
		return nil, fmt.Errorf("deploy contracts: %w\n%s", err, tail(out.String(), 1500))
	}

	written := filepath.Join(root, "contracts", scriptOut)
	body, err := os.ReadFile(written)
	if err != nil {
		_ = cmd.Process.Kill()
		return nil, fmt.Errorf("read deployment manifest: %w", err)
	}
	_ = os.Remove(written)
	manifest := filepath.Join(tmp, "manifest.json")
	if err := os.WriteFile(manifest, body, 0o600); err != nil {
		return nil, err
	}

	env := &Env{RPCURL: url, ChainID: 31337, ManifestPath: manifest, Keys: map[string]*ecdsa.PrivateKey{}}
	for name, hexKey := range anvilKeys {
		k, err := crypto.HexToECDSA(hexKey)
		if err != nil {
			return nil, err
		}
		env.Keys[name] = k
	}
	return env, nil
}

func repoRoot() (string, error) {
	dir, err := os.Getwd()
	if err != nil {
		return "", err
	}
	for {
		if _, err := os.Stat(filepath.Join(dir, "contracts", "foundry.toml")); err == nil {
			return dir, nil
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			return "", fmt.Errorf("repository root (contracts/foundry.toml) not found above %s", dir)
		}
		dir = parent
	}
}

func freePort() (int, error) {
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return 0, err
	}
	defer l.Close()
	return l.Addr().(*net.TCPAddr).Port, nil
}

func waitForRPC(url string, timeout time.Duration) error {
	deadline := time.Now().Add(timeout)
	body := `{"jsonrpc":"2.0","id":1,"method":"eth_chainId","params":[]}`
	for time.Now().Before(deadline) {
		resp, err := http.Post(url, "application/json", strings.NewReader(body))
		if err == nil {
			var r struct{ Result string }
			_ = json.NewDecoder(resp.Body).Decode(&r)
			resp.Body.Close()
			if r.Result != "" {
				return nil
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("anvil did not become ready at %s", url)
}

func tail(s string, n int) string {
	if len(s) <= n {
		return s
	}
	return "..." + s[len(s)-n:]
}
