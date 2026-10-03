import type { Metadata } from "next";
import Link from "next/link";
import { ApiReference } from "@/components/developers/ApiReference";
import { LinkButton } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";
import { CodeBlock } from "@/components/ui/CodeBlock";
import { CopyField } from "@/components/ui/CopyField";
import { PageHeader, SectionHeader } from "@/components/ui/Section";
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
    <div className="container-page py-(--space-page-y)">
      <PageHeader
        eyebrow="Developers"
        title="CargoFlow API reference"
        description="Public reads need no credentials. Parties write by signing a fixed message with their own wallet; evidence gateways sign every request with their device key. The backend never holds a party key."
        actions={
          <>
            <LinkButton href={`${DOCS_API_URL}/v1/openapi.json`} external variant="secondary">
              OpenAPI 3.1 JSON<span className="sr-only"> (opens in a new tab)</span>
            </LinkButton>
            <LinkButton href="/developers" variant="ghost">SDKs and tools</LinkButton>
          </>
        }
      />

      <Card padded="sm" className="grid gap-4 md:grid-cols-12 md:items-center md:gap-6">
        <div className="min-w-0 md:col-span-7">
          <p className="eyebrow mb-1.5">Base URL</p>
          <CopyField value={DOCS_API_URL} kind="text" display="full" className="w-full" />
        </div>
        <dl className="grid grid-cols-2 gap-4 md:col-span-5">
          <div>
            <dt className="eyebrow">Auth</dt>
            <dd className="mt-1.5 text-small">None for reads · EIP-191 or device signature for writes</dd>
          </div>
          <div>
            <dt className="eyebrow">Errors</dt>
            <dd className="mt-1.5"><code className="font-mono text-caption">{`{"error":{"code","message"}}`}</code></dd>
          </div>
        </dl>
      </Card>

      <section className="mt-12" aria-labelledby="recipes">
        <SectionHeader id="recipes" title="Signing recipes" description="The two ways to write. Reads need neither." className="mb-6" />
        <div className="grid items-start gap-6 lg:grid-cols-2">
          <div className="flex min-w-0 flex-col gap-3">
            <h3 className="font-display text-h3">Wallet-signed requests</h3>
            <p className="text-small text-text-muted">
              EIP-191 <code className="font-mono">personal_sign</code> over the exact text in each operation&apos;s <code className="font-mono">x-cargoflow-signed-message</code>. Contract wallets (passkey smart accounts) are checked through EIP-1271.
            </p>
            <CodeBlock label="TypeScript (viem)" code={WALLET_RECIPE} />
          </div>
          <div className="flex min-w-0 flex-col gap-3">
            <h3 className="font-display text-h3">Gateway-signed telemetry</h3>
            <p className="text-small text-text-muted">
              A gateway registered by the exporter (Ed25519, P-256 secure element or a WebAuthn passkey) signs each request. <Link href="/developers#gateway" className="font-semibold text-ink underline decoration-ink/30 underline-offset-4 hover:decoration-ink">@cargoflow/gateway</Link> does this for you.
            </p>
            <CodeBlock label="Signing string and headers" code={GATEWAY_RECIPE} />
          </div>
        </div>
      </section>

      <nav aria-label="Client libraries" className="mt-8 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {PACKAGES.map((p) => (
          <Link key={p.name} href={p.href} className="group flex items-start justify-between gap-3 rounded-tile border border-border bg-surface px-4 py-3 transition-[border-color,box-shadow] duration-(--duration-fast) hover:border-border-strong hover:shadow-1">
            <span className="min-w-0">
              <span className="block font-mono text-small font-semibold">{p.name}</span>
              <span className="mt-0.5 block text-small text-text-muted">{p.what}</span>
            </span>
            <span aria-hidden="true" className="mt-0.5 text-text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-ink">→</span>
          </Link>
        ))}
      </nav>

      <section className="mt-12" aria-labelledby="reference">
        <SectionHeader id="reference" title="Endpoints" description="Every operation has a Test Request button that calls the live API." className="mb-4" />
        <ApiReference serverUrl={DOCS_API_URL} />
      </section>
    </div>
  );
}
