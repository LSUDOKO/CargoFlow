package chain

import (
	"context"
	"encoding/json"
	"fmt"
	"os"

	"github.com/ethereum/go-ethereum/accounts/abi/bind"
	"github.com/ethereum/go-ethereum/common"
	"github.com/ethereum/go-ethereum/crypto"
	"github.com/ethereum/go-ethereum/ethclient"
)

// Manifest is the deployment manifest written by contracts/script/Deploy.s.sol.
type Manifest struct {
	ChainID    uint64
	USDG       common.Address
	Access     common.Address
	Registry   common.Address
	Policies   common.Address
	Evidence   common.Address
	Vault      common.Address
	Controller common.Address
	Verifier   common.Address
}

// LoadManifest reads and validates a deployment manifest, naming any missing or malformed field.
func LoadManifest(path string) (Manifest, error) {
	raw, err := os.ReadFile(path)
	if err != nil {
		return Manifest{}, fmt.Errorf("chain: read manifest: %w", err)
	}
	var f struct {
		ChainID   uint64 `json:"chainId"`
		USDG      string `json:"usdg"`
		Contracts struct {
			Access              string `json:"access"`
			ShipmentRegistry    string `json:"shipmentRegistry"`
			PolicyEngine        string `json:"policyEngine"`
			EvidenceRegistry    string `json:"evidenceRegistry"`
			ReceivableVault     string `json:"receivableVault"`
			Groth16Verifier     string `json:"groth16Verifier"`
			FinancingController string `json:"financingController"`
		} `json:"contracts"`
	}
	if err := json.Unmarshal(raw, &f); err != nil {
		return Manifest{}, fmt.Errorf("chain: parse manifest: %w", err)
	}
	if f.ChainID == 0 {
		return Manifest{}, fmt.Errorf("chain: manifest has no chainId")
	}
	m := Manifest{ChainID: f.ChainID}
	for _, field := range []struct {
		name string
		raw  string
		dst  *common.Address
	}{
		{"usdg", f.USDG, &m.USDG},
		{"access", f.Contracts.Access, &m.Access},
		{"shipmentRegistry", f.Contracts.ShipmentRegistry, &m.Registry},
		{"policyEngine", f.Contracts.PolicyEngine, &m.Policies},
		{"evidenceRegistry", f.Contracts.EvidenceRegistry, &m.Evidence},
		{"receivableVault", f.Contracts.ReceivableVault, &m.Vault},
		{"groth16Verifier", f.Contracts.Groth16Verifier, &m.Verifier},
		{"financingController", f.Contracts.FinancingController, &m.Controller},
	} {
		if field.raw == "" {
			return Manifest{}, fmt.Errorf("chain: manifest is missing %s", field.name)
		}
		if !common.IsHexAddress(field.raw) {
			return Manifest{}, fmt.Errorf("chain: manifest %s is not an address: %q", field.name, field.raw)
		}
		*field.dst = common.HexToAddress(field.raw)
	}
	return m, nil
}

// Client is a connection to the chain with the deployed contract addresses.
type Client struct {
	Eth *ethclient.Client
	M   Manifest
}

// Dial connects and refuses to continue if the RPC reports a different chain than the manifest, so a
// mis-pointed endpoint can never cause transactions to be signed for the wrong network.
func Dial(ctx context.Context, rpcURL string, m Manifest) (*Client, error) {
	eth, err := ethclient.DialContext(ctx, rpcURL)
	if err != nil {
		return nil, fmt.Errorf("chain: dial %s: %w", rpcURL, err)
	}
	id, err := eth.ChainID(ctx)
	if err != nil {
		eth.Close()
		return nil, fmt.Errorf("chain: read chain id: %w", err)
	}
	if id.Uint64() != m.ChainID {
		eth.Close()
		return nil, fmt.Errorf("chain: RPC is chain %d but the manifest is for chain %d", id.Uint64(), m.ChainID)
	}
	return &Client{Eth: eth, M: m}, nil
}

// Close releases the connection.
func (c *Client) Close() { c.Eth.Close() }

// CheckDeployed verifies that every contract address holds code, naming the first that does not.
func (c *Client) CheckDeployed(ctx context.Context) error {
	for _, a := range []struct {
		name string
		addr common.Address
	}{
		{"access", c.M.Access}, {"registry", c.M.Registry}, {"policies", c.M.Policies},
		{"evidence", c.M.Evidence}, {"vault", c.M.Vault}, {"controller", c.M.Controller},
		{"verifier", c.M.Verifier}, {"usdg", c.M.USDG},
	} {
		code, err := c.Eth.CodeAt(ctx, a.addr, nil)
		if err != nil {
			return fmt.Errorf("chain: read code of %s: %w", a.name, err)
		}
		if len(code) == 0 {
			return fmt.Errorf("chain: no contract code at %s address %s", a.name, a.addr.Hex())
		}
	}
	return nil
}

// HasRole reports whether `who` holds the named role (for example "MONITOR_ROLE").
func (c *Client) HasRole(ctx context.Context, role string, who common.Address) (bool, error) {
	bc := bind.NewBoundContract(c.M.Access, ABIs()["AccessControl"], c.Eth, c.Eth, c.Eth)
	var out []any
	if err := bc.Call(&bind.CallOpts{Context: ctx}, &out, "hasRole", [32]byte(crypto.Keccak256Hash([]byte(role))), who); err != nil {
		return false, err
	}
	return out[0].(bool), nil
}
