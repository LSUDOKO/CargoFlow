import { BuiltOn } from "@/components/landing/BuiltOn";
import { ClosingBand } from "@/components/landing/ClosingBand";
import { Faq } from "@/components/landing/Faq";
import { UseWithClaudeCard } from "@/components/developers/UseWithClaude";
import { Hero } from "@/components/landing/Hero";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { StatsStrip } from "@/components/landing/StatsStrip";
import { Verified } from "@/components/landing/Verified";
import { Waterfall } from "@/components/landing/Waterfall";

export default function Home() {
  return (
    <>
      <Hero />
      <StatsStrip />
      <HowItWorks />
      <Waterfall />
      <Verified />
      <BuiltOn />
      <section className="container-page py-12 md:py-16" aria-label="Use CargoFlow in Claude">
        <UseWithClaudeCard />
      </section>
      <Faq />
      <ClosingBand />
    </>
  );
}
