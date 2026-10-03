import { UseWithClaudeCard } from "@/components/developers/UseWithClaude";
import { BuiltOn } from "@/components/landing/BuiltOn";
import { ClosingBand } from "@/components/landing/ClosingBand";
import { Faq } from "@/components/landing/Faq";
import { Hero } from "@/components/landing/Hero";
import { MeetThePeople } from "@/components/landing/MeetThePeople";
import { Roles } from "@/components/landing/Roles";
import { StatsStrip } from "@/components/landing/StatsStrip";
import { Verified } from "@/components/landing/Verified";
import { Waterfall } from "@/components/landing/Waterfall";
import { Story } from "@/components/story/Story";

export default function Home() {
  return (
    <>
      <Hero />
      <StatsStrip />
      <BuiltOn />
      <MeetThePeople />
      <Story />
      <Waterfall />
      <Roles />
      <Verified />
      <section className="container-page mt-24 md:mt-32" aria-label="Use CargoFlow in Claude">
        <UseWithClaudeCard />
      </section>
      <Faq />
      <ClosingBand />
    </>
  );
}
