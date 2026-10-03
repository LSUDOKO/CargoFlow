import React from "react";
import { Composition, Folder } from "remotion";
import { ASSET_SHEET, ASSET_SHEET_DATA, AssetSheet, AssetSheetData } from "./assets/AssetSheet";
import { MapDemo } from "./maps/MapDemo";
import { CharacterLineup, CharacterSheet, SHEET_H, SHEET_W } from "./characters/CharacterSheet";

/** Preview compositions for the v2 illustration library (characters, assets, maps). */
export const LibraryCompositions: React.FC = () => (
  <Folder name="Library">
    <Composition id="CharacterSheet" component={CharacterSheet} durationInFrames={150} fps={30} width={SHEET_W} height={SHEET_H} />
    <Composition id="CharacterLineup" component={CharacterLineup} durationInFrames={150} fps={30} width={1920} height={1080} />
    <Composition id="AssetSheet" component={AssetSheet} durationInFrames={150} fps={30} width={ASSET_SHEET.w} height={ASSET_SHEET.h} />
    <Composition id="AssetSheetData" component={AssetSheetData} durationInFrames={150} fps={30} width={ASSET_SHEET_DATA.w} height={ASSET_SHEET_DATA.h} />
    <Composition id="MapDemo" component={MapDemo} durationInFrames={300} fps={30} width={1920} height={1080} />
  </Folder>
);
