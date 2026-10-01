const marks = [
  { name: "Robinhood Chain", note: "Arbitrum Orbit L2, chain 46630" },
  { name: "USDG", note: "Global Dollar stablecoin, 6 decimals" },
  { name: "Groth16 · Circom", note: "13,494-constraint recovery circuit" },
  { name: "Arbitrum Stylus", note: "Rust evidence engine, 19x cheaper at scale" },
];

export function BuiltOn() {
  return (
    <section aria-labelledby="built-title" className="container-page mt-20">
      <h2 id="built-title" className="sr-only">Built on</h2>
      <ul className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl border border-line bg-line lg:grid-cols-4">
        {marks.map((m) => (
          <li key={m.name} className="bg-paper px-5 py-6">
            <p className="font-display text-xl font-bold tracking-tight">{m.name}</p>
            <p className="mt-1 text-sm text-slate">{m.note}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
