# Publishing to GitHub Packages

CargoFlow's primary packages are `@cargoflow/sdk`, `@cargoflow/mcp` and `@cargoflow/gateway` on npmjs.com and
`cargoflow` on PyPI. So that the repository's **Packages** sidebar lists them too, the same npm packages are mirrored
to GitHub Packages and the two Docker images are pushed to the GitHub Container Registry:

| Source | GitHub Packages name | Registry |
|---|---|---|
| `packages/sdk` (`@cargoflow/sdk`) | `@lsudoko/cargoflow-sdk` | `https://npm.pkg.github.com` |
| `packages/mcp` (`@cargoflow/mcp`) | `@lsudoko/cargoflow-mcp` (depends on `@lsudoko/cargoflow-sdk`) | `https://npm.pkg.github.com` |
| `packages/gateway` (`@cargoflow/gateway`) | `@lsudoko/cargoflow-gateway` | `https://npm.pkg.github.com` |
| `infra/docker/backend.Dockerfile` (context `.`) | `ghcr.io/lsudoko/cargoflow-backend` (linux/amd64) | `ghcr.io` |
| `packages/gateway/Dockerfile` (context `packages/gateway`) | `ghcr.io/lsudoko/cargoflow-gateway` (linux/amd64, linux/arm64) | `ghcr.io` |

GitHub's npm registry only accepts a scope equal to the repository owner, so the names are `@lsudoko/cargoflow-*`.
[`scripts/publish-github-packages.mjs`](../../scripts/publish-github-packages.mjs) copies each built package to a temp
directory and rewrites only the copy: the name, `publishConfig.registry`, `repository` (this repo, which is what links
the package to the sidebar), and in the MCP server the SDK dependency becomes
`"@cargoflow/sdk": "npm:@lsudoko/cargoflow-sdk@^0.1.0"` (an alias, so the built code's `import "@cargoflow/sdk"` keeps
working). A version that is already on GitHub Packages is skipped, so re-running is safe.

## Automatically: on every release

[`.github/workflows/publish-packages.yml`](../../.github/workflows/publish-packages.yml) runs when a release is
published (and from **Actions → Publish packages (GitHub Packages) → Run workflow**, with an optional dry run). It
uses the workflow's own `GITHUB_TOKEN` with `packages: write`, so no secret has to be added. Jobs:

- **npm**: builds the three packages with their pinned pnpm (`corepack`) and runs the publish script.
- **images**: builds both Dockerfiles with Buildx and pushes them to GHCR, tagged `X.Y.Z`, `X.Y`, `sha-…` and `latest`,
  with `org.opencontainers.image.source` pointing at this repository.

To publish the current `0.1.0` now, run the workflow by hand from `main`, or publish a release.

## From this machine

The founder's `gh` token currently has `repo`, `workflow`, `gist` and `read:org`. Add the packages scopes once:

```bash
gh auth refresh -h github.com -s write:packages,read:packages
gh auth status            # Token scopes now include 'write:packages'
```

### npm packages

```bash
# log in to the GitHub npm registry: username LSUDOKO, password = the token printed by `gh auth token`
npm login --registry=https://npm.pkg.github.com --scope=@lsudoko --auth-type=legacy

# build, then publish the three renamed copies (sdk first, then mcp, then gateway)
for p in sdk mcp gateway; do (cd packages/$p && pnpm install --frozen-lockfile && pnpm build); done
node scripts/publish-github-packages.mjs --dry-run   # check names, files and sizes
node scripts/publish-github-packages.mjs
```

Without `npm login`, pass the token for one run instead: `NODE_AUTH_TOKEN=$(gh auth token) node scripts/publish-github-packages.mjs`.

### Container images

```bash
gh auth token | docker login ghcr.io -u LSUDOKO --password-stdin

docker build -f infra/docker/backend.Dockerfile -t ghcr.io/lsudoko/cargoflow-backend:0.1.0 \
  --label org.opencontainers.image.source=https://github.com/LSUDOKO/CargoFlow .
docker tag ghcr.io/lsudoko/cargoflow-backend:0.1.0 ghcr.io/lsudoko/cargoflow-backend:latest
docker push --all-tags ghcr.io/lsudoko/cargoflow-backend

docker buildx build --platform linux/amd64,linux/arm64 \
  --label org.opencontainers.image.source=https://github.com/LSUDOKO/CargoFlow \
  -t ghcr.io/lsudoko/cargoflow-gateway:0.1.0 -t ghcr.io/lsudoko/cargoflow-gateway:latest \
  --push packages/gateway
```

## After the first publish

1. Open [github.com/LSUDOKO?tab=packages](https://github.com/LSUDOKO?tab=packages). Each package should show
   **Linked to LSUDOKO/CargoFlow**; if one is not, open it → **Package settings** → **Connect repository**.
2. A package published for the first time can be private. For each of the five: **Package settings** →
   **Danger Zone** → **Change visibility** → **Public**, and under **Manage Actions access** give `LSUDOKO/CargoFlow`
   the **Write** role so later workflow runs can publish new versions.
3. The repository's front page now lists them under **Packages**.

## Installing from GitHub Packages

The GitHub npm registry asks for a token even for public packages (any classic token with `read:packages`):

```bash
echo "@lsudoko:registry=https://npm.pkg.github.com" >> .npmrc
echo "//npm.pkg.github.com/:_authToken=$(gh auth token)" >> ~/.npmrc
npm i @lsudoko/cargoflow-sdk
npx -y @lsudoko/cargoflow-mcp            # stdio MCP server, same 25 tools as @cargoflow/mcp
npm i -g @lsudoko/cargoflow-gateway      # cargoflow-gateway watch <folder>
```

Public container images pull without logging in:

```bash
docker pull ghcr.io/lsudoko/cargoflow-backend:latest
docker pull ghcr.io/lsudoko/cargoflow-gateway:latest
```

PyPI has no GitHub Packages registry; the Python SDK stays on [PyPI](https://pypi.org/project/cargoflow/)
(`pip install cargoflow`).
