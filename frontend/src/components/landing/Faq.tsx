import Link from "next/link";
import { Accordion } from "@/components/ui/Accordion";
import { GITHUB_URL } from "@/lib/developer";

const items = [
  { id: "what", title: "What does CargoFlow actually do?", body: "It lets a financier advance working capital against a specific shipment and releases that money in milestones, each one gated by sensor evidence committed on-chain. If the evidence fails, the money stops; if it recovers with proof, the money moves again." },
  { id: "pause", title: "Could a pause be used to steal the escrowed funds?", body: "No. Pausing only stops releases. No role, including the monitor that pauses and the admin, can redirect USDG: the vault pays only the exporter (tranches) and the fixed waterfall at settlement." },
  { id: "zk", title: "What does the zero-knowledge proof prove?", body: "That eight readings from the unaffected probe, committed after the pause in a specific Merkle root, all sit inside the policy's temperature band. It is bound to this shipment, this pause and this submitter, so it cannot be replayed, and it reveals none of the readings." },
  { id: "ai", title: "What can the AI monitor do?", body: "Only make the outcome stricter: ask for more proof or request a pause, through a key that holds no other permission. It never sees free text from the telemetry, and when it is missing, slow or unsure the deterministic policy gate decides alone." },
  { id: "testnet", title: "Is this ready to use?", body: "Yes. CargoFlow is a production build running live on Robinhood Chain Testnet with Paxos USDG, and you can run a full facility today. The mainnet release is next, with real USDG, the public zero-knowledge ceremony and the first outside financier." },
  { id: "evidence", title: "How does sensor data get in?", body: "On the shipment's page the exporter adds the data logger travelling with the goods as a gateway, authorized with a signature from their wallet. Its readings arrive as the logger's CSV export, signed in the browser, or straight from the device through the signed API. A gateway can only ever report for the shipment it was added to." },
  { id: "try", title: "How do I start?", body: "Connect a wallet on Robinhood Chain Testnet. The exporter registers the shipment and opens a facility in the exporter portal, the financier funds it from the financier portal with testnet USDG from the Paxos faucet, and the buyer pays from the buyer portal. Small amounts work exactly like large ones." },
];

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="container-page mt-24 scroll-mt-24 md:mt-32">
      <div className="grid gap-8 lg:grid-cols-12 lg:gap-12">
        <div className="lg:col-span-4">
          <div className="lg:sticky lg:top-28">
            <p className="eyebrow">FAQ</p>
            <h2 id="faq-title" className="h-section mt-3 max-w-md">Questions people ask first</h2>
            <p className="mt-5 max-w-sm text-text-muted">
              Anything else is in the{" "}
              <Link href="/docs" className="font-semibold text-ink underline decoration-ink/30 underline-offset-4 hover:decoration-ink">API reference</Link> or the{" "}
              <a href={`${GITHUB_URL}#readme`} target="_blank" rel="noreferrer" className="font-semibold text-ink underline decoration-ink/30 underline-offset-4 hover:decoration-ink">
                README<span className="sr-only"> (opens in a new tab)</span>
              </a>.
            </p>
          </div>
        </div>
        <div className="lg:col-span-8">
          <Accordion items={items} />
        </div>
      </div>
    </section>
  );
}
