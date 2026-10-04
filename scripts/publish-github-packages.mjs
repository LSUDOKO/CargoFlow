#!/usr/bin/env node
// Publish the three npm packages to GitHub Packages (npm.pkg.github.com) under the repository owner's scope.
//
// The primary packages stay @cargoflow/* on npmjs.com. GitHub's npm registry only accepts a scope equal to the
// repository owner, so each built package is copied to a temp dir and renamed there (@cargoflow/sdk becomes
// @lsudoko/cargoflow-sdk, and so on); the source package.json files are never modified.
//
//   node scripts/publish-github-packages.mjs              build output must exist (pnpm build in each package)
//   node scripts/publish-github-packages.mjs --dry-run    pack and show what would be published
//   node scripts/publish-github-packages.mjs sdk mcp      only these packages
//
// Auth: NODE_AUTH_TOKEN (a GITHUB_TOKEN in Actions, or `gh auth token` with write:packages locally) is written to a
// temporary .npmrc next to each copy; without it npm uses your own login (`npm login --registry=https://npm.pkg.github.com`).
// Env: GH_PACKAGES_SCOPE (default "lsudoko"), GH_PACKAGES_REPO (default "https://github.com/LSUDOKO/CargoFlow").

import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const REGISTRY = "https://npm.pkg.github.com";
const SCOPE = (process.env.GH_PACKAGES_SCOPE ?? "lsudoko").toLowerCase();
const REPO = process.env.GH_PACKAGES_REPO ?? "https://github.com/LSUDOKO/CargoFlow";
const ALL = ["sdk", "mcp", "gateway"]; // sdk first: mcp depends on it

const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const only = args.filter((a) => !a.startsWith("--"));
const targets = only.length ? ALL.filter((p) => only.includes(p)) : ALL;

/** "@cargoflow/sdk" -> "@lsudoko/cargoflow-sdk" */
const ghName = (name) => `@${SCOPE}/cargoflow-${name.split("/")[1]}`;

function npm(argv, cwd, { quiet = false } = {}) {
  return execFileSync("npm", argv, { cwd, encoding: "utf8", stdio: quiet ? ["ignore", "pipe", "pipe"] : "inherit" });
}

function alreadyPublished(name, version, cwd) {
  try {
    const out = npm(["view", `${name}@${version}`, "version", "--registry", REGISTRY], cwd, { quiet: true });
    return out.trim() === version;
  } catch {
    return false; // 404 (never published) or no read access yet
  }
}

for (const dir of targets) {
  const src = join(ROOT, "packages", dir);
  const pkg = JSON.parse(readFileSync(join(src, "package.json"), "utf8"));
  if (!existsSync(join(src, "dist"))) {
    console.error(`packages/${dir}: no dist/ — run \`pnpm install && pnpm build\` there first`);
    process.exit(1);
  }

  const name = ghName(pkg.name);
  const tmp = mkdtempSync(join(tmpdir(), `ghpkg-${dir}-`));
  try {
    for (const f of [...(pkg.files ?? ["dist"]), "README.md"]) {
      if (existsSync(join(src, f))) cpSync(join(src, f), join(tmp, f), { recursive: true });
    }
    cpSync(join(ROOT, "LICENSE"), join(tmp, "LICENSE"));

    const out = { ...pkg, name };
    out.description = `${pkg.description} (GitHub Packages mirror of ${pkg.name}.)`;
    out.repository = { type: "git", url: `git+${REPO}.git`, directory: `packages/${dir}` };
    out.homepage = `${REPO}/tree/main/packages/${dir}#readme`;
    out.bugs = { url: `${REPO}/issues` };
    out.publishConfig = { registry: REGISTRY };
    // the copy is already built: no lifecycle scripts, no dev tooling
    delete out.scripts;
    delete out.devDependencies;
    delete out.packageManager;
    delete out.pnpm;
    if (out.bin) out.bin = Object.fromEntries(Object.entries(out.bin).map(([k, v]) => [k, v.replace(/^\.\//, "")]));
    // the mcp build imports "@cargoflow/sdk" at runtime; an npm alias keeps that import working while the
    // dependency itself resolves to the GitHub Packages SDK
    if (out.dependencies?.["@cargoflow/sdk"]) {
      out.dependencies["@cargoflow/sdk"] = `npm:${ghName("@cargoflow/sdk")}@${out.dependencies["@cargoflow/sdk"]}`;
    }
    writeFileSync(join(tmp, "package.json"), JSON.stringify(out, null, 2) + "\n");

    const npmrc = [`@${SCOPE}:registry=${REGISTRY}`];
    if (process.env.NODE_AUTH_TOKEN) npmrc.push(`//npm.pkg.github.com/:_authToken=${process.env.NODE_AUTH_TOKEN}`);
    writeFileSync(join(tmp, ".npmrc"), npmrc.join("\n") + "\n");

    if (!dryRun && alreadyPublished(name, pkg.version, tmp)) {
      console.log(`= ${name}@${pkg.version} already on GitHub Packages, skipped`);
      continue;
    }
    console.log(`${dryRun ? "~" : "+"} ${name}@${pkg.version} (from ${pkg.name})`);
    npm(["publish", "--registry", REGISTRY, ...(dryRun ? ["--dry-run"] : [])], tmp);
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}
