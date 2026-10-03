import type { Metadata } from "next";
import Link from "next/link";
import { ApiReference } from "@/components/developers/ApiReference";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { DOCS_API_URL } from "@/lib/developer";

export const metadata: Metadata = {
  title: "API reference",
  description: "The CargoFlow REST API: public reads, wallet-signed writes and gateway-signed telemetry, with an interactive reference.",
};

const WALLET_RECIPE = `// 1. Take the operation's x-cargoflow-signed-message template, e.g. for POST /v1/notifications/read:
//    "CargoFlow notifications read\\naddress: <address>\\nids: <id,id | all>\\nissued: <t>"
const issuedAt = Math.floor(Date.now() / 1000);          // within 10 minutes of the server clock
const message = [
  "CargoFlow notifications read",
  \`address: \${address.toLowerCase()}\`,                   // ids and addresses lower case
  "ids: all",
  \`issued: \${issuedAt}\`,
].join("\\n");                                             // "\\n" between lines, no trailing newline

// 2. EIP-191 personal_sign with the party's wallet (EOA or EIP-1271 contract wallet)
const signature = await wallet.signMessage({ account: address, message });

// 3. Send the fields plus issuedAt and signature. Each signature works once (409 "replayed" after).
await fetch("${DOCS_API_URL}/v1/notifications/read", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ address, issuedAt, signature }),
});`;

const GATEWAY_RECIPE = `# Signing string (bytes the device signs), lines joined by "\\n":
CARGOFLOW-V1
POST
/v1/shipments/<id>/telemetry
<unix seconds>
<hex sha256(exact request body)>

# Headers
X-Source-Id:  src-…            # returned when the exporter registered the gateway
X-Timestamp:  <unix seconds>   # within 5 minutes
X-Signature:  base64url(signature)
#   ed25519   Ed25519 over the signing string
#   p256      ECDSA P-256 over sha256(signing string), DER or raw r||s
#   webauthn  passkey assertion with challenge = sha256(signing string), plus
#             X-WebAuthn-Authenticator-Data and X-WebAuthn-Client-Data (base64url)`;

const PACKAGES = [
  { name: "@cargoflow/sdk", what: "Typed TypeScript client, message builders, unsigned transactions", href: "/developers#sdk" },
  { name: "@cargoflow/mcp", what: "MCP server for Claude, Cursor and other assistants", href: "/developers#claude" },
  { name: "@cargoflow/gateway", what: "Edge agent that signs and delivers logger readings", href: "/developers#gateway" },
  { name: "cargoflow (Python)", what: "Analytics: data frames, exposure, Monte Carlo", href: "/developers#python" },
];

export default function DocsPage() {
  return (
    <div className="container-page py-10 md:py-14">
      <header className="grid gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:items-end">
        <div>
          <p className="text-sm font-semibold tracking-[0.12em] text-slate uppercase">Developers</p>
          <h1 className="mt-2 font-display text-[clamp(2rem,4.5vw,3.25rem)] leading-[1.05] font-bold tracking-tight">CargoFlow API reference</h1>
          <p className="mt-4 max-w-xl text-lg text-ink/75">
            Public reads need no credentials. Parties write by signing a fixed message with their own wallet; evidence gateways sign every request with their device key. The backend never holds a party key.
          </p>
        </div>
        <dl className="grid gap-3 rounded-[var(--radius-card)] border border-line bg-white p-5 text-sm sm:grid-cols-2">
          <div className="sm:col-span-2">
            <dt className="text-xs font-semibold tracking-wide text-slate uppercase">Base URL</dt>
            <dd className="mt-1 font-mono text-[0.9375rem] font-semibold break-all">{DOCS_API_URL}</dd>
          </div>
          <div>
            <dt className="text-xs font-semibold tracking-wide text-slate uppercase">Specification</dt>
            <dd className="mt-1"><a className="font-semibold underline decoration-ink/30 underline-offset-2 hover:decoration-ink" href={`${DOCS_API_URL}/v1/openapi.json`}>OpenAPI 3.1 JSON</a></dd>
          </div>
          <div>
            <dt className="text-xs font-semibold tracking-wide text-slate uppercase">Errors</dt>
            <dd className="mt-1 font-mono text-xs">{`{"error":{"code","message"}}`}</dd>
          </div>
        </dl>
      </header>

      <section className="mt-10 grid gap-5 lg:grid-cols-2" aria-labelledby="recipes">
        <h2 id="recipes" className="sr-only">Authentication recipes</h2>
        <div className="flex flex-col gap-3">
          <h3 className="font-display text-xl font-semibold">Wallet-signed requests</h3>
          <p className="text-sm text-slate">
            EIP-191 <code className="font-mono">personal_sign</code> over the exact text in each operation&apos;s <code className="font-mono">x-cargoflow-signed-message</code>. Contract wallets (passkey smart accounts) are checked through EIP-1271.
          </p>
          <CodeBlock label="TypeScript (viem)" code={WALLET_RECIPE} />
        </div>
        <div className="flex flex-col gap-3">
          <h3 className="font-display text-xl font-semibold">Gateway-signed telemetry</h3>
          <p className="text-sm text-slate">
            A gateway registered by the exporter (Ed25519, P-256 secure element or a WebAuthn passkey) signs each request. <Link href="/developers#gateway" className="font-semibold underline">@cargoflow/gateway</Link> does this for you.
          </p>
          <CodeBlock label="Signing string and headers" code={GATEWAY_RECIPE} />
        </div>
      </section>

      <nav aria-label="Client libraries" className="mt-8 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {PACKAGES.map((p) => (
          <Link key={p.name} href={p.href} className="group rounded-2xl border border-line bg-white px-4 py-3 transition-colors hover:border-ink/40">
            <span className="block font-mono text-sm font-semibold">{p.name}</span>
            <span className="mt-0.5 block text-sm text-slate">{p.what}</span>
          </Link>
        ))}
      </nav>

      <section className="mt-10" aria-labelledby="reference">
        <h2 id="reference" className="mb-4 font-display text-2xl font-semibold">Endpoints</h2>
        <ApiReference serverUrl={DOCS_API_URL} />
      </section>
    </div>
  );
}
