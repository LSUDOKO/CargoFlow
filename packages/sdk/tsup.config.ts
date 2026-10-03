import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    index: "src/index.ts",
    "api/index": "src/api/index.ts",
    "contracts/index": "src/contracts/index.ts",
    gateway: "src/gateway.ts",
    messages: "src/messages.ts",
    csv: "src/csv.ts",
    evidence: "src/evidence.ts",
    documents: "src/documents.ts",
    merkle: "src/merkle.ts",
  },
  format: ["esm", "cjs"],
  dts: true,
  sourcemap: true,
  clean: true,
  target: "es2022",
  platform: "neutral",
  treeshake: true,
});
