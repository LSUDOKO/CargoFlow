import { Accordion } from "@/components/ui/Accordion";

const items = [
  { id: "what", title: "What does CargoFlow actually do?", body: "It lets a financier advance working capital against a specific shipment and releases that money in milestones, each one gated by sensor evidence committed on-chain. If the evidence fails, the money stops; if it recovers with proof, the money moves again." },
  { id: "pause", title: "Could a pause be used to steal the escrowed funds?", body: "No. Pausing only stops releases. No role, including the monitor that pauses and the admin, can redirect USDG: the vault pays only the exporter (tranches) and the fixed waterfall at settlement." },
  { id: "zk", title: "What does the zero-knowledge proof prove?", body: "That eight readings from the unaffected probe, committed after the pause in a specific Merkle root, all sit inside the policy's temperature band. It is bound to this shipment, this pause and this submitter, so it cannot be replayed, and it reveals none of the readings." },
  { id: "ai", title: "What can the AI monitor do?", body: "Only make the outcome stricter: ask for more proof or request a pause, through a key that holds no other permission. It never sees free text from the telemetry, and when it is missing, slow or unsure the deterministic policy gate decides alone." },
  { id: "testnet", title: "Is this real money?", body: "Not yet. CargoFlow runs on Robinhood Chain Testnet with testnet USDG, which has no value. The contracts are unaudited and the zero-knowledge setup is single-party, which is fine for a testnet and must change before production." },
  { id: "try", title: "How do I try it without a wallet full of USDG?", body: "Open the live demo. It plays the whole story, funding, an anomaly, a proof-based recovery and settlement, with wallets held by the demo backend, while you watch every transaction land." },
];

export function Faq() {
  return (
    <section id="faq" aria-labelledby="faq-title" className="container-page mt-24 grid gap-10 md:mt-32 lg:grid-cols-[0.8fr_1.2fr]">
      <h2 id="faq-title" className="font-display text-[clamp(2.2rem,4.6vw,3.6rem)] leading-[1] font-bold tracking-[-0.04em]">Questions people ask first</h2>
      <Accordion items={items} />
    </section>
  );
}
