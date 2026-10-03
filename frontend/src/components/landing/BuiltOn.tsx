/** The chain, the money and the cryptography, each with the one fact that matters. */
const core = [
  { name: "Robinhood Chain", note: "Arbitrum Orbit L2, chain 46630" },
  { name: "Paxos USDG", note: "Global Dollar stablecoin, 6 decimals" },
  { name: "Groth16 · Circom", note: "13,494-constraint recovery circuit" },
  { name: "Arbitrum Stylus", note: "Rust evidence engine, 19x cheaper at scale" },
];

/** Partner integrations, as plain wordmarks (set in our type, never imitating their logos). */
const partners = [
  { name: "ZeroDev", what: "Passkey smart accounts and sponsored gas" },
  { name: "Alchemy", what: "RPC failover and indexer webhooks" },
  { name: "QuickNode", what: "Primary RPC" },
  { name: "OpenZeppelin", what: "Contract libraries v5.4" },
  { name: "Dune", what: "Volume, escrow and recovery analytics" },
  { name: "Fhenix", what: "Encrypted invoice terms (FHE)" },
  { name: "GMX", what: "Optional financier price hedge" },
];

export function BuiltOn() {
  return (
    <section aria-labelledby="built-title" className="container-page mt-16 md:mt-20">
      <h2 id="built-title" className="eyebrow">Built on</h2>
      <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-6 border-y border-border py-6 lg:grid-cols-4 lg:gap-x-10">
        {core.map((m) => (
          <li key={m.name} className="min-w-0">
            <p className="font-display text-h3 tracking-tight md:text-xl">{m.name}</p>
            <p className="mt-1 text-small text-text-muted">{m.note}</p>
          </li>
        ))}
      </ul>
      <div className="mt-5 flex flex-col gap-3 md:flex-row md:items-baseline md:gap-6">
        <h3 className="eyebrow shrink-0">Integrations</h3>
        <ul className="flex flex-wrap items-baseline gap-x-6 gap-y-2">
          {partners.map((p) => (
            <li key={p.name} title={p.what} className="font-display text-h4 font-semibold tracking-tight text-text-subtle">
              {p.name}
              <span className="sr-only">: {p.what}</span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
