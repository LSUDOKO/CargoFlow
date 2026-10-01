package main

import (
	"context"
	"errors"
	"flag"
	"fmt"
	"io"
	"strconv"
	"strings"

	"github.com/ethereum/go-ethereum/crypto"

	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/hero"
)

// demo runs the hero scenario once against a running backend using the exporter, financier and buyer
// wallets from the environment. It is the scripted acceptance run for a deployment.
func demo(ctx context.Context, args []string, getenv func(string) string, out io.Writer) error {
	fs := flag.NewFlagSet("demo", flag.ContinueOnError)
	fs.SetOutput(out)
	mint := fs.Bool("mint", false, "mint test USDG to the financier and buyer (mock token on a local chain only)")
	divisor := fs.Int64("divisor", 1, "scale every USDG amount down by this factor, e.g. 2000 for a 20 USDG facility and 50 USDG invoice")
	pace := fs.Duration("pace", 0, "pause between scenes so the run can be followed live, e.g. 3s")
	if err := fs.Parse(args); err != nil {
		return err
	}

	var missing []string
	val := func(name, def string) string {
		if v := strings.TrimSpace(getenv(name)); v != "" {
			return v
		}
		if def == "" {
			missing = append(missing, name+" is required")
		}
		return def
	}
	rpc, deployment, admin := val("RPC_URL", ""), val("DEPLOYMENT_FILE", ""), val("ADMIN_API_KEY", "")
	chainRaw := val("CHAIN_ID", "")
	apiURL := val("API_URL", "http://127.0.0.1:8080")
	keys := map[string]*chain.Signer{}
	for _, name := range []string{"EXPORTER_KEY", "FINANCIER_KEY", "BUYER_KEY"} {
		raw := strings.TrimPrefix(strings.TrimPrefix(val(name, ""), "0x"), "0X")
		if raw == "" {
			continue
		}
		k, err := crypto.HexToECDSA(raw)
		if err != nil {
			missing = append(missing, name+" must be a 32-byte hex private key")
			continue
		}
		keys[name] = chain.NewSigner(k)
	}
	chainID, err := strconv.ParseUint(chainRaw, 10, 64)
	if chainRaw != "" && err != nil {
		missing = append(missing, "CHAIN_ID must be a non-negative integer")
	}
	if len(missing) > 0 {
		return errors.New(strings.Join(missing, "; "))
	}

	manifest, err := chain.LoadManifest(deployment)
	if err != nil {
		return err
	}
	if manifest.ChainID != chainID {
		return fmt.Errorf("CHAIN_ID is %d but the deployment manifest is for chain %d", chainID, manifest.ChainID)
	}
	client, err := chain.Dial(ctx, rpc, manifest)
	if err != nil {
		return err
	}
	defer client.Close()

	res, err := hero.Run(ctx, hero.Config{
		APIURL: apiURL, AdminKey: admin, Chain: client,
		Exporter: keys["EXPORTER_KEY"], Financier: keys["FINANCIER_KEY"], Buyer: keys["BUYER_KEY"],
		MintTestTokens: *mint, AmountDivisor: *divisor, Pace: *pace, Log: out,
	})
	if err != nil {
		return err
	}
	fmt.Fprintf(out, "\nshipment %s (%s): %d transactions, all verified.\n", res.ShipmentID, res.Ref, len(res.TransactionHashes))
	return nil
}
