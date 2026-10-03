import React from "react";
import { CalculateMetadataFunction, Composition, Folder } from "remotion";
import { Full, calculateFullMetadata, fullSchema } from "./Full";
import { withAutoMedia } from "./lib/media";
import { S0ColdOpen } from "./scenes/S0ColdOpen";
import { S1Problem } from "./scenes/S1Problem";
import { S2Insight } from "./scenes/S2Insight";
import { S3HowItWorks } from "./scenes/S3HowItWorks";
import { DemoProps, S4DemoSlot, demoSchema } from "./scenes/S4DemoSlot";
import { S5WhyRobinhood } from "./scenes/S5WhyRobinhood";
import { S6Proof } from "./scenes/S6Proof";
import { S7Outro } from "./scenes/S7Outro";
import { LibraryCompositions } from "./Library";
import { ReadmeCompositions } from "./readme";
import { FULL_V2_FRAMES, FullV2, SceneV2, fullV2Schema } from "./FullV2";
import { SCENES } from "./scenes-v2/timing";

const demoMetadata: CalculateMetadataFunction<DemoProps> = ({ props }) => {
  const resolved = withAutoMedia(props);
  return { durationInFrames: resolved.demoDurationInFrames, props: resolved };
};

export const RemotionRoot: React.FC = () => (
  <>
    <Composition
      id="Full"
      component={Full}
      durationInFrames={6150}
      fps={30}
      width={1920}
      height={1080}
      schema={fullSchema}
      calculateMetadata={calculateFullMetadata}
      defaultProps={{
        // Empty demoSrc / audioSrc = automatic: public/demo/demo-75s.mp4 (scripts/fit-demo.mjs) and
        // public/audio/mix.wav (scripts/mix.mjs) are used when they exist; placeholder / silence otherwise.
        // Set autoMedia: false to force the placeholder, or a path to use something else.
        demoSrc: "",
        demoDurationInFrames: 2250,
        demoTrimBeforeFrames: 0,
        autoMedia: true,
        audioSrc: "",
        audioVolume: 0.25,
        showCaptions: true,
        labels: [
          {
            fromSec: 0.6,
            toSec: 5.6,
            title: "Live on Robinhood Chain Testnet",
            subtitle: "cargoflow.adoranto737.workers.dev",
          },
          {
            fromSec: 6.6,
            toSec: 12.5,
            title: "Meera registers the shipment",
            subtitle: "Real testnet transactions · her own wallet",
          },
          {
            fromSec: 17.4,
            toSec: 22.6,
            title: "Financier funds the escrow",
            subtitle: "Approve + deposit 20 USDG",
          },
          {
            fromSec: 23.4,
            toSec: 30.4,
            title: "Signed readings release tranches",
            subtitle: "Readings never go on chain. Only roots.",
          },
          {
            fromSec: 33.4,
            toSec: 40.8,
            title: "Excursion: 11.7 °C",
            subtitle: "The epoch fails and the facility pauses itself",
          },
          {
            fromSec: 42.3,
            toSec: 46.6,
            title: "Arbiter console",
            subtitle: "The paused facility is flagged",
          },
          {
            fromSec: 47.4,
            toSec: 58.2,
            title: "Zero-knowledge recovery",
            subtitle: "Readings stay private · Groth16 verified on chain",
          },
          { fromSec: 60.4, toSec: 65.4, title: "All five tranches released" },
          {
            fromSec: 66.4,
            toSec: 74.2,
            title: "Buyer pays · waterfall settles",
            subtitle: "30 USDG in → 20.6 financier · 9.4 Meera",
          },
        ],
      }}
    />
    <Folder name="Scenes">
      <Composition
        id="S0-ColdOpen"
        component={S0ColdOpen}
        durationInFrames={240}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="S1-Problem"
        component={S1Problem}
        durationInFrames={960}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="S2-Insight"
        component={S2Insight}
        durationInFrames={540}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="S3-HowItWorks"
        component={S3HowItWorks}
        durationInFrames={960}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="S4-DemoSlot"
        component={S4DemoSlot}
        durationInFrames={2250}
        fps={30}
        width={1920}
        height={1080}
        schema={demoSchema}
        calculateMetadata={demoMetadata}
        defaultProps={{
          demoSrc: "",
          demoDurationInFrames: 2250,
          demoTrimBeforeFrames: 0,
          labels: [
            {
              fromSec: 0.6,
              toSec: 5.6,
              title: "Live on Robinhood Chain Testnet",
              subtitle: "cargoflow.adoranto737.workers.dev",
            },
            {
              fromSec: 6.6,
              toSec: 12.5,
              title: "Meera registers the shipment",
              subtitle: "Real testnet transactions · her own wallet",
            },
            {
              fromSec: 17.4,
              toSec: 22.6,
              title: "Financier funds the escrow",
              subtitle: "Approve + deposit 20 USDG",
            },
            {
              fromSec: 23.4,
              toSec: 30.4,
              title: "Signed readings release tranches",
              subtitle: "Readings never go on chain. Only roots.",
            },
            {
              fromSec: 33.4,
              toSec: 40.8,
              title: "Excursion: 11.7 °C",
              subtitle: "The epoch fails and the facility pauses itself",
            },
            {
              fromSec: 42.3,
              toSec: 46.6,
              title: "Arbiter console",
              subtitle: "The paused facility is flagged",
            },
            {
              fromSec: 47.4,
              toSec: 58.2,
              title: "Zero-knowledge recovery",
              subtitle: "Readings stay private · Groth16 verified on chain",
            },
            { fromSec: 60.4, toSec: 65.4, title: "All five tranches released" },
            {
              fromSec: 66.4,
              toSec: 74.2,
              title: "Buyer pays · waterfall settles",
              subtitle: "30 USDG in → 20.6 financier · 9.4 Meera",
            },
          ],
        }}
      />
      <Composition
        id="S5-WhyRobinhood"
        component={S5WhyRobinhood}
        durationInFrames={600}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="S6-Proof"
        component={S6Proof}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
      />
      <Composition
        id="S7-Outro"
        component={S7Outro}
        durationInFrames={300}
        fps={30}
        width={1920}
        height={1080}
      />
    </Folder>
    <Composition
      id="FullV2"
      component={FullV2}
      durationInFrames={FULL_V2_FRAMES}
      fps={30}
      width={1920}
      height={1080}
      schema={fullV2Schema}
      defaultProps={{ showCaptions: true, audio: true, audioVolume: 1 }}
    />
    <Folder name="V2-Scenes">
      {SCENES.map((s) => (
        <Composition
          key={s.id}
          id={`V2-${s.id}`}
          component={SceneV2}
          durationInFrames={s.frames}
          fps={30}
          width={1920}
          height={1080}
          defaultProps={{ id: s.id, showCaptions: true, audio: true }}
        />
      ))}
    </Folder>
    <LibraryCompositions />
    <ReadmeCompositions />
  </>
);
