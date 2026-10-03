// Copies the backend's generated OpenAPI document into public/openapi.json, so the /docs page has a build-time copy
// to fall back on when the live API (NEXT_PUBLIC_API_URL/v1/openapi.json) is asleep or unreachable. Run by `pnpm abi`
// and before every build (prebuild). A missing source (a frontend-only checkout) keeps the existing copy.
//
// It also copies the public deployment manifests (contracts/deployments/robinhood-testnet*.json, arbitrum-sepolia.json)
// into src/data/deployments/ for the /deployments page: Turbopack's root is this folder, so the page cannot import
// files above it directly.
import { copyFileSync, existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = fileURLToPath(new URL("../../backend/openapi.json", import.meta.url));
const dest = fileURLToPath(new URL("../public/openapi.json", import.meta.url));
if (existsSync(src)) {
  mkdirSync(fileURLToPath(new URL("../public/", import.meta.url)), { recursive: true });
  copyFileSync(src, dest);
  console.log("copied backend/openapi.json to public/openapi.json");
} else {
  console.log(`backend/openapi.json not found; ${existsSync(dest) ? "keeping the existing public/openapi.json" : "the /docs page will use the live spec only"}`);
}

const deployments = fileURLToPath(new URL("../../contracts/deployments/", import.meta.url));
const dataDir = fileURLToPath(new URL("../src/data/deployments/", import.meta.url));
mkdirSync(dataDir, { recursive: true });
for (const name of ["robinhood-testnet.json", "robinhood-testnet-v1.json", "arbitrum-sepolia.json"]) {
  if (existsSync(deployments + name)) copyFileSync(deployments + name, dataDir + name);
  else if (!existsSync(dataDir + name)) writeFileSync(dataDir + name, "{}\n"); // optional manifest: an empty one means "not deployed yet"
}
console.log("synced deployment manifests to src/data/deployments/");
