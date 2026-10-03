// Resolve playwright and viem from the frontend's installed node_modules (no separate install needed).
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const RECORDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
export const REPO = path.resolve(RECORDER, "..", "..");
export const VIDEO = path.join(REPO, "video");
export const FOOTAGE = path.join(VIDEO, "public", "footage");

const req = createRequire(path.join(REPO, "frontend", "package.json"));
export const playwright = req("@playwright/test");
export const viem = req("viem");
export const viemAccounts = req("viem/accounts");
