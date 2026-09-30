// Package chain is the backend's window onto the CargoFlow contracts: typed reads, role-limited
// transaction sending, revert decoding and an idempotent log indexer.
package chain

import (
	"embed"
	"fmt"
	"strings"
	"sync"

	"github.com/ethereum/go-ethereum/accounts/abi"
)

//go:embed abi/*.json
var abiFS embed.FS

var (
	abisOnce sync.Once
	abis     map[string]abi.ABI
)

// ABIs returns the parsed contract ABIs keyed by contract name (plus "ERC20" for USDG).
// They are exported from the Foundry artifacts by `make abi`.
func ABIs() map[string]abi.ABI {
	abisOnce.Do(func() {
		entries, err := abiFS.ReadDir("abi")
		if err != nil {
			panic(err)
		}
		abis = make(map[string]abi.ABI, len(entries))
		for _, e := range entries {
			raw, err := abiFS.ReadFile("abi/" + e.Name())
			if err != nil {
				panic(err)
			}
			parsed, err := abi.JSON(strings.NewReader(string(raw)))
			if err != nil {
				panic(fmt.Sprintf("chain: bad ABI %s: %v", e.Name(), err))
			}
			abis[strings.TrimSuffix(e.Name(), ".json")] = parsed
		}
	})
	return abis
}
