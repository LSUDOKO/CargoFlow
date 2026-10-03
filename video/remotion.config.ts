/**
 * Note: When using the Node.JS APIs, the config file
 * doesn't apply. Instead, pass options directly to the APIs.
 *
 * All configuration options: https://remotion.dev/docs/config
 */

import fs from "node:fs";
import path from "node:path";
import { Config } from "@remotion/cli/config";

Config.setRspack(true);
Config.setVideoImageFormat("jpeg");
Config.setOverwriteOutput(true);

// The caption track lives at video/captions.json (written by the script workflow).
// Remotion only serves public/, so mirror it there whenever the CLI starts.
try {
  const src = path.join(process.cwd(), "captions.json");
  const dst = path.join(process.cwd(), "public", "captions.json");
  if (fs.existsSync(src)) fs.copyFileSync(src, dst);
} catch {
  // captions are optional
}
