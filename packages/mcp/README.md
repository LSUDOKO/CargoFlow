# @cargoflow/mcp

A [Model Context Protocol](https://modelcontextprotocol.io) server for
[CargoFlow](https://cargoflow.adoranto737.workers.dev). With it, an assistant such as Claude or Cursor can read
shipments, evidence, cover and track records, verify a trade document on your computer, and prepare transactions for
**your own wallet** to sign.

- **No private keys, ever.** The server does not accept or store wallet keys and never signs or sends a transaction.
  The `prepare_*` tools return unsigned requests (`{to, data, value, chainId}`), a plain summary, and a CargoFlow link
  where you can sign the same action.
- Built on [`@cargoflow/sdk`](../sdk) and the official MCP TypeScript SDK. It speaks stdio by default and Streamable
  HTTP with `--http <port>`, and runs as a public remote server on Cloudflare Workers.

## Use the hosted server (no install)

A public, read-and-prepare instance runs at:

```
https://cargoflow-mcp.adoranto737.workers.dev/mcp
```

It needs no account or authentication, holds no keys, and cannot sign anything. It has every read and prepare tool.
It does not have the gateway tool, and `verify_document` takes a hash or base64 content instead of a local path. Open
the bare URL in a browser for a short page that describes it.

**claude.ai** (Pro, Max, Team and Enterprise plans; on Team and Enterprise an owner may have to add it first):

1. Open **Settings → Connectors**.
2. Click **Add custom connector**.
3. Name it `CargoFlow`, paste `https://cargoflow-mcp.adoranto737.workers.dev/mcp` as the URL, and leave the auth
   settings empty.
4. In a chat, turn CargoFlow on from the tools menu, then ask something like "Give me a CargoFlow fleet risk summary"
   or "Why is shipment CF-LIVE-1790936827464 paused?".

Claude connects from Anthropic's cloud over Streamable HTTP, so the same connector also works in Claude Desktop and
the mobile apps once it has been added.

**Claude Code**

```bash
claude mcp add --transport http cargoflow https://cargoflow-mcp.adoranto737.workers.dev/mcp
```

**Cursor**: add this to `~/.cursor/mcp.json` (or `.cursor/mcp.json` in a project):

```json
{
  "mcpServers": {
    "cargoflow": { "url": "https://cargoflow-mcp.adoranto737.workers.dev/mcp" }
  }
}
```

The hosted API runs on a free tier that sleeps when idle. The first call after a quiet spell can take up to a minute.
If it takes longer than 25 s, the tool answers "the CargoFlow API is waking up, try again in a moment".

## Run it locally (stdio)

Use the local server when you want `verify_document` to hash files on your computer or `submit_readings_csv` with a
gateway key file.

**Claude Code**

```bash
claude mcp add cargoflow -- npx -y @cargoflow/mcp
```

**Claude Desktop**: add this to `claude_desktop_config.json` (Settings → Developer → Edit Config):

```json
{
  "mcpServers": {
    "cargoflow": {
      "command": "npx",
      "args": ["-y", "@cargoflow/mcp"],
      "env": {
        "CARGOFLOW_API_URL": "https://cargoflow-api-75ul.onrender.com"
      }
    }
  }
}
```

**Cursor** (local):

```json
{
  "mcpServers": {
    "cargoflow": { "command": "npx", "args": ["-y", "@cargoflow/mcp"] }
  }
}
```

**Streamable HTTP** (stateless; it binds to 127.0.0.1 unless you pass `--host`):

```bash
npx -y @cargoflow/mcp --http 8787   # POST http://127.0.0.1:8787/mcp
```

## Configuration

| Variable | Flag | Default | Purpose |
|---|---|---|---|
| `CARGOFLOW_API_URL` | `--api-url` | `https://cargoflow-api-75ul.onrender.com` | The CargoFlow API |
| `CARGOFLOW_APP_URL` | `--app-url` | `https://cargoflow.adoranto737.workers.dev` | The web app that the "open to sign" links point to |
| `CARGOFLOW_GATEWAY_KEY_FILE` | `--gateway-key-file` | unset | Path to a gateway key file (downloaded from the web app); enables `submit_readings_csv` |
| `CARGOFLOW_RPC_URL` | `--rpc-url` | the chain's public RPC | On-chain reads (the invoice hash in `verify_document`) |

The gateway key file holds an Ed25519 key that can only submit sensor readings for the one shipment it was issued
for. The server reads it when the tool runs, and only signatures leave your machine. It is not a wallet key.

## Tools

**Read** (public data; nothing changes):

| Tool | What it answers |
|---|---|
| `list_shipments` | Shipments, filtered by status, party or reference |
| `get_shipment` | Parties, invoice, policy, facility, milestones (with places), latest evidence, cover, dashboard link |
| `explain_shipment` | Why it is where it is: causes with numbers, forecast, place hold, who can act next |
| `get_evidence` | Evidence epochs: score, conflict, risk, decision and reasons, commit tx, aggregates, per-sensor temperatures |
| `get_track` | One centroid per epoch with its temperature range |
| `get_audit` | The merged audit trail of chain events, decisions and transactions |
| `get_party` | A wallet's track record and grade |
| `list_market_requests` | Financing requests and financiers' offers |
| `get_cover` | Default-cover offers and the accepted cover (contracts v2) |
| `get_documents` | Attested documents and their hashes |
| `get_pricing` | Fee guidance: a low / mid / high band in bps with every factor behind it |
| `get_epcis` | The shipment as a GS1 EPCIS 2.0 JSON-LD document (summary, or `full: true`) |
| `get_ebl` | Electronic bills of lading (contracts v3): one bill with history and bound shipment, or a holder's bills |
| `verify_document` | Compares a document with the attestations and the on-chain invoice hash. Locally it hashes a file by path; on the hosted server it takes `sha256` / `keccak256` hex or `contentBase64` (up to 8 MB) |
| `fleet_risk_summary` | Daily review: paused, disputed and held shipments, weak evidence, temperature trends |

**Prepare** (unsigned transactions, a summary, and a signing link; each tool checks the shipment's state first):
`prepare_deposit`, `prepare_release`, `prepare_resume_with_proof`, `prepare_mark_delivered`, `prepare_settle`,
`prepare_open_dispute`, `prepare_offer_cover`, `prepare_accept_cover`, and on contracts v3 `prepare_cancel`
(cancel before transit) and `prepare_trigger_parametric` (picks the newest run of N consecutive failed committed epochs
and checks their commit order on chain when the RPC answers).

`prepare_resume_with_proof` needs the exporter's own signature. The first call returns the exact message to sign and
sends nothing. You sign it in your wallet and call again with the signature and its `issuedAt`. The backend then
commits the recovery evidence and returns the proof, and the tool returns the unsigned `resumeWithProof`.

**Gateway** (only with `CARGOFLOW_GATEWAY_KEY_FILE`): `submit_readings_csv` parses and checks a logger CSV, then
submits signed batches of at most 500 (Ed25519 or P-256 key files). Use `dryRun: true` to preview.

**Resources**: `cargoflow://shipment/{id}` (the shipment view as JSON) and `cargoflow://config` (chain, contract
addresses, contracts version).

**Prompts**: `daily-risk-review` and `explain-pause`.

## Example conversations

> **You:** Which of my shipments need attention today? My wallet is 0x8e68…102f.
>
> **Claude:** *(calls `fleet_risk_summary` with party 0x8e68…102f)* You have 2 shipments: 1 settled, 1 paused.
> CF-LIVE-1790936827464 is paused because its evidence did not meet the policy. The next step is the exporter's:
> upload fresh in-band readings from an independent probe and request a recovery proof. Shall I explain the pause?

> **You:** Is ~/Downloads/invoice-CF-2026-SG01.pdf the invoice that was financed for 0x5a90…9d61?
>
> **Claude:** *(calls `verify_document`)* No. The file's keccak256 is 0x25ef…19be, but the invoice hash registered on chain
> (read from the ShipmentRegistry contract) is 0x3792…8cdc, and the file is not among the attested documents.

> **You:** Fund the facility for CF-MEERA-0412.
>
> **Claude:** *(calls `prepare_deposit`)* Two transactions to send from the financier's wallet on Robinhood Chain
> Testnet: 1. approve the ReceivableVault for 20 USDG, 2. depositCapital. Nothing has been sent. Open
> https://cargoflow.adoranto737.workers.dev/track/0x… to sign them there, or send the JSON below from your wallet.

## Deploy your own (Cloudflare Workers)

`src/worker.ts` is the Workers entry. It wraps `src/hosted.ts`, a web-standard `fetch` handler that is also exported
as `@cargoflow/mcp/hosted` for Deno, Bun and other runtimes. Every `POST /mcp` gets a new server and a new
`WebStandardStreamableHTTPServerTransport`, with no session id and JSON responses. That means no Durable Objects and no
state between requests. `GET /mcp` answers 405 because this stateless server has no SSE stream; a browser asking
for HTML gets the landing page instead. `GET /` describes the server (JSON, or HTML for browsers). `GET /health`
returns `{ "ok": true }`. Every response allows any origin through CORS, and `OPTIONS` preflights are answered.

```bash
pnpm dev:worker         # wrangler dev -> http://127.0.0.1:8787/mcp
pnpm deploy:worker      # wrangler deploy -> https://cargoflow-mcp.<account>.workers.dev/mcp
```

Set the vars in `wrangler.toml` (`CARGOFLOW_API_URL`, `CARGOFLOW_APP_URL`, `CARGOFLOW_RPC_URL`). No secrets are needed,
and no `nodejs_compat` flag either, because the worker bundle imports nothing from `node:*`.

## Development

```bash
pnpm install            # @cargoflow/sdk comes from file:../sdk (build the SDK first; re-run with --force after SDK changes)
pnpm build
pnpm test               # in-memory MCP client and the Worker fetch handler, against a mocked API
pnpm exec tsc --noEmit
node dist/cli.js --help
```
