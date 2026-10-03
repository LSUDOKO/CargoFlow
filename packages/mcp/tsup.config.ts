import { defineConfig } from "tsup";

export default defineConfig({
  // hosted: the runtime-neutral fetch handler (no node:* imports); the Worker itself is bundled by wrangler from src/worker.ts.
  entry: { index: "src/index.ts", cli: "src/cli.ts", hosted: "src/hosted.ts" },
  format: ["esm"],
  dts: { entry: { index: "src/index.ts", hosted: "src/hosted.ts" } },
  sourcemap: true,
  clean: true,
  target: "node18",
  platform: "node",
});
