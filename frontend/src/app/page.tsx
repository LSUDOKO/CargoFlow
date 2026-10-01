import { BuiltOn } from "@/components/landing/BuiltOn";
import { ClosingBand } from "@/components/landing/ClosingBand";
import { Faq } from "@/components/landing/Faq";
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
      <Faq />
      <ClosingBand />
    </>
  );
}
