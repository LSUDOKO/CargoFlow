// Command cargoflow is the CargoFlow backend: one binary that runs the API, the chain indexer and the
// evidence pipeline.
//
//	cargoflow serve     run the service (migrates the database first)
//	cargoflow migrate   apply database migrations and exit
//	cargoflow keygen    generate an Ed25519 key pair for an evidence source
//	cargoflow demo      run the hero scenario against a running backend
package main

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"strings"
	"syscall"
	"time"

	"github.com/ethereum/go-ethereum/crypto"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/LSUDOKO/CargoFlow/backend/internal/ai"
	"github.com/LSUDOKO/CargoFlow/backend/internal/api"
	"github.com/LSUDOKO/CargoFlow/backend/internal/auth"
	"github.com/LSUDOKO/CargoFlow/backend/internal/chain"
	"github.com/LSUDOKO/CargoFlow/backend/internal/config"
	"github.com/LSUDOKO/CargoFlow/backend/internal/proof"
	"github.com/LSUDOKO/CargoFlow/backend/internal/service"
	"github.com/LSUDOKO/CargoFlow/backend/internal/store"
	"github.com/LSUDOKO/CargoFlow/backend/internal/ws"
)

func main() {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()
	if err := run(ctx, os.Args[1:], os.Getenv, os.Stdout); err != nil {
		fmt.Fprintln(os.Stderr, "cargoflow:", err)
		os.Exit(1)
	}
}

const usage = `usage: cargoflow <command>

  serve     run the API, chain indexer and evidence pipeline
  migrate   apply database migrations and exit
  keygen    generate an Ed25519 key pair for an evidence source
  demo      run the hero scenario against a running backend (flags: -mint, -pace 3s)
`

func run(ctx context.Context, args []string, getenv func(string) string, out io.Writer) error {
	if len(args) == 0 {
		fmt.Fprint(out, usage)
		return errors.New("no command given")
	}
	switch args[0] {
	case "serve":
		return serve(ctx, getenv, out)
	case "migrate":
		return migrate(ctx, getenv, out)
	case "keygen":
		return keygen(out)
	case "demo":
		return demo(ctx, args[1:], getenv, out)
	default:
		fmt.Fprint(out, usage)
		return fmt.Errorf("unknown command %q", args[0])
	}
}

func keygen(out io.Writer) error {
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		return err
	}
	enc := json.NewEncoder(out)
	enc.SetIndent("", "  ")
	return enc.Encode(map[string]string{
		"publicKey":  base64.RawURLEncoding.EncodeToString(pub),
		"privateKey": base64.RawURLEncoding.EncodeToString(priv),
		"note":       "register publicKey via POST /v1/sources; keep privateKey with the sensor gateway and never share it",
	})
}

func migrate(ctx context.Context, getenv func(string) string, out io.Writer) error {
	url := strings.TrimSpace(getenv("DATABASE_URL"))
	if url == "" {
		return errors.New("DATABASE_URL: is required")
	}
	pool, err := pgxpool.New(ctx, url)
	if err != nil {
		return fmt.Errorf("connect to database: %w", err)
	}
	defer pool.Close()
	if err := store.Migrate(ctx, pool, store.Migrations()); err != nil {
		return err
	}
	fmt.Fprintln(out, "migrations applied")
	return nil
}

func logger(level string) *slog.Logger {
	var l slog.Level
	_ = l.UnmarshalText([]byte(level))
	return slog.New(slog.NewJSONHandler(os.Stderr, &slog.HandlerOptions{Level: l}))
}

func serve(ctx context.Context, getenv func(string) string, out io.Writer) error {
	cfg, err := config.Load(getenv)
	if err != nil {
		return fmt.Errorf("invalid configuration:\n%w", err)
	}
	log := logger(cfg.LogLevel)
	log.Info("starting", "config", cfg.String())

	pool, err := pgxpool.New(ctx, cfg.DatabaseURL.Reveal())
	if err != nil {
		return fmt.Errorf("connect to database: %w", err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		return fmt.Errorf("database is unreachable: %w", err)
	}
	if err := store.Migrate(ctx, pool, store.Migrations()); err != nil {
		return err
	}
	st := store.New(pool)

	manifest, err := chain.LoadManifest(cfg.DeploymentFile)
	if err != nil {
		return err
	}
	if manifest.ChainID != cfg.ChainID {
		return fmt.Errorf("CHAIN_ID is %d but the deployment manifest is for chain %d", cfg.ChainID, manifest.ChainID)
	}
	client, err := chain.Dial(ctx, cfg.RPCURL, manifest)
	if err != nil {
		return err
	}
	defer client.Close()
	client.Confirmations = cfg.Confirmations
	if err := client.CheckDeployed(ctx); err != nil {
		return err
	}

	worker, monitor, manager, err := signers(cfg)
	if err != nil {
		return err
	}
	if err := verifyRoles(ctx, client, worker, monitor, manager); err != nil {
		return err
	}

	hub := ws.NewHub(256)
	svc := service.New(service.Options{
		Store: st, Chain: client, Hub: hub, Prover: prover(cfg, log), AI: aiMonitor(cfg, log),
		Worker: worker, Monitor: monitor, Manager: manager, SaltSecret: []byte(cfg.SaltSecret.Reveal()), Log: log,
	})

	idx := &chain.Indexer{
		C: client, Store: st, Name: "main", StartBlock: cfg.StartBlock, Confirmations: cfg.Confirmations,
		Poll: cfg.IndexerPoll, Sink: svc.OnChainEvents, Log: log,
	}
	if cfg.ReconcileInterval > 0 {
		go svc.RunReconciler(ctx, cfg.ReconcileInterval)
	} else {
		log.Warn("reconciler disabled: failed chain actions will not be retried automatically")
	}
	indexerDone := make(chan error, 1)
	go func() { indexerDone <- idx.Run(ctx) }()

	server := api.NewServer(api.Config{
		Service: svc, Store: st, Chain: client, Hub: hub, AdminKey: cfg.AdminAPIKey.Reveal(), CORSOrigins: cfg.CORSOrigins, Log: log,
		Verifier: &auth.Verifier{Lookup: st.GetSource, Now: time.Now, MaxSkew: 5 * time.Minute},
	})
	ln, err := net.Listen("tcp", cfg.HTTPAddr)
	if err != nil {
		return err
	}
	httpServer := &http.Server{
		Handler: server.Handler(), ReadHeaderTimeout: 10 * time.Second, ReadTimeout: 30 * time.Second,
		WriteTimeout: 3 * time.Minute, // a ZK recovery request can take tens of seconds
		IdleTimeout:  2 * time.Minute, MaxHeaderBytes: 1 << 16,
	}
	fmt.Fprintf(out, "listening on %s\n", ln.Addr())
	log.Info("listening", "addr", ln.Addr().String())

	serveErr := make(chan error, 1)
	go func() { serveErr <- httpServer.Serve(ln) }()
	select {
	case <-ctx.Done():
	case err := <-serveErr:
		return err
	case err := <-indexerDone:
		if ctx.Err() == nil {
			return fmt.Errorf("indexer stopped: %w", err)
		}
	}
	shutdown, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	log.Info("shutting down")
	if err := httpServer.Shutdown(shutdown); err != nil {
		return err
	}
	<-indexerDone
	return nil
}

func signers(cfg config.Config) (worker, monitor, manager *chain.Signer, err error) {
	mk := func(name string, k config.Key) (*chain.Signer, error) {
		key, err := crypto.ToECDSA(k)
		if err != nil {
			return nil, fmt.Errorf("%s is not a valid secp256k1 private key", name)
		}
		return chain.NewSigner(key), nil
	}
	if worker, err = mk("WORKER_KEY", cfg.WorkerKey); err != nil {
		return
	}
	if monitor, err = mk("MONITOR_KEY", cfg.MonitorKey); err != nil {
		return
	}
	manager, err = mk("MANAGER_KEY", cfg.ManagerKey)
	return
}

// verifyRoles fails fast if a key holds the wrong authority. The monitor key is the one an AI model acts
// through, so besides holding MONITOR_ROLE it must hold nothing that could move money or resume a facility.
func verifyRoles(ctx context.Context, c *chain.Client, worker, monitor, manager *chain.Signer) error {
	must := []struct {
		role, label string
		who         *chain.Signer
	}{
		{"EVIDENCE_VERIFIER_ROLE", "WORKER_KEY", worker},
		{"MONITOR_ROLE", "MONITOR_KEY", monitor},
		{"FACILITY_MANAGER_ROLE", "MANAGER_KEY", manager},
	}
	for _, m := range must {
		ok, err := c.HasRole(ctx, m.role, m.who.Address())
		if err != nil {
			return fmt.Errorf("check %s: %w", m.role, err)
		}
		if !ok {
			return fmt.Errorf("%s (%s) does not hold %s on this deployment", m.label, m.who.Address().Hex(), m.role)
		}
	}
	for _, forbidden := range []string{"CONTROLLER_ROLE", "DISPUTE_ROLE", "EVIDENCE_VERIFIER_ROLE", "FACILITY_MANAGER_ROLE", "DEFAULT_ADMIN_ROLE"} {
		role := forbidden
		ok, err := c.HasRole(ctx, role, monitor.Address())
		if err != nil {
			return fmt.Errorf("check %s: %w", role, err)
		}
		if ok {
			return fmt.Errorf("MONITOR_KEY (%s) holds %s: the monitor must be able to request a pause and nothing else", monitor.Address().Hex(), role)
		}
	}
	return nil
}

// prover returns a snarkjs-backed prover when Node and the built circuit keys are available, and nil
// otherwise (recovery endpoints then answer 503 rather than the service failing to start).
func prover(cfg config.Config, log *slog.Logger) proof.Prover {
	dir, err := filepath.Abs(cfg.CircuitsDir)
	if err != nil {
		return nil
	}
	if _, err := exec.LookPath("node"); err != nil {
		log.Warn("ZK recovery disabled: node is not installed")
		return nil
	}
	for _, need := range []string{"keys/telemetry_epoch_final.zkey", "node_modules"} {
		if _, err := os.Stat(filepath.Join(dir, need)); err != nil {
			log.Warn("ZK recovery disabled: circuits are not ready", "missing", need, "dir", dir)
			return nil
		}
	}
	return &proof.SnarkjsProver{CircuitsDir: dir}
}

// aiMonitor returns the model-backed monitor when a Groq key is configured and nil otherwise, in which
// case the deterministic policy gate decides alone.
func aiMonitor(cfg config.Config, log *slog.Logger) *ai.Monitor {
	if !cfg.AIEnabled() {
		log.Info("AI monitor disabled: GROQ_API_KEY is not set; the deterministic policy gate decides alone")
		return nil
	}
	provider := ai.NewGroq(ai.GroqConfig{APIKey: cfg.GroqAPIKey, Model: cfg.GroqModel})
	log.Info("AI monitor enabled", "provider", provider.Name(), "timeout", cfg.AITimeout, "minConfidence", cfg.AIMinConfidence)
	return ai.NewMonitor(provider, ai.MonitorOptions{MinConfidence: cfg.AIMinConfidence, Timeout: cfg.AITimeout})
}
