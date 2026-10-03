import React from "react";
import { Composition, Folder } from "remotion";
import { ARCH, Architecture } from "./Architecture";
import { CLIPS, CLIP_H, CLIP_W, ReadmeClip } from "./Clip";
import { BANNER, Banner, CAST, CastSheet, GUIDE, GuideHeader, MEASURED, MeasuredPanel, SPONSORS, SponsorsBoard } from "./Stills";

/** README media kit (docs/assets/v3): stills and concept clips rendered from the film's library. */
export const ReadmeCompositions: React.FC = () => (
  <Folder name="Readme">
    <Composition id="Readme-Banner" component={Banner} durationInFrames={1} fps={30} width={BANNER.w} height={BANNER.h} />
    <Composition id="Readme-Cast" component={CastSheet} durationInFrames={1} fps={30} width={CAST.w} height={CAST.h} />
    <Composition id="Readme-Architecture" component={Architecture} durationInFrames={1} fps={30} width={ARCH.w} height={ARCH.h} />
    <Composition id="Readme-Sponsors" component={SponsorsBoard} durationInFrames={1} fps={30} width={SPONSORS.w} height={SPONSORS.h} />
    <Composition id="Readme-Measured" component={MeasuredPanel} durationInFrames={1} fps={30} width={MEASURED.w} height={MEASURED.h} />
    {(["meera", "daniel", "weilin", "carrier", "arbiter"] as const).map((who) => (
      <Composition key={who} id={`Readme-Guide-${who}`} component={GuideHeader} durationInFrames={1} fps={30} width={GUIDE.w} height={GUIDE.h} defaultProps={{ who }} />
    ))}
    {CLIPS.map((c) => (
      <Composition key={c.id} id={`Readme-Clip-${c.id}`} component={ReadmeClip} durationInFrames={c.frames} fps={30} width={CLIP_W} height={CLIP_H} defaultProps={{ id: c.id }} />
    ))}
  </Folder>
);
