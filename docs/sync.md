# Cross-repo sync

> **Status: implemented.** The sync engine lives in [`sync/`](../sync/) (see
> [`sync/README.md`](../sync/README.md)) and consumes the manifest
> [`studio.config.json`](../studio.config.json). This document is the design and rationale;
> the README is the operational reference.

## Why a sync tool

JRM Studio keeps shared DNA in this backbone repo (`jrmoulckers/.github`). Two classes of
assets propagate very differently:

| Class | Examples | How it reaches product repos |
| --- | --- | --- |
| **Native** | Community-health files, reusable workflows | GitHub inherits default health files from this `.github` repo automatically; reusable workflows are called directly with `uses: jrmoulckers/.github/.github/workflows/reusable-*.yml@main`. **No sync needed.** |
| **Canonical source** | `agents/`, `skills/`, `prompts/`, `instructions/`, `AGENTS.md`, `agency.toml` | Copilot does **not** auto-inherit these across repos. They must be **copied** into each product repo's `.github/…`. **This is what the sync tool does.** |
| **External vendored** | `@jrm/tokens` built outputs (CSS custom properties, Tailwind preset, typed JS) | Live in a *different* private backbone repo (`jrmoulckers/studio`), registry-free. The same engine copies studio's committed `dist/` tree into opted-in members under `vendor/@jrm/tokens/`. See [Vendored tokens](#vendored-tokens-jrmtokens). |

## Flow (scheduled PR)

```mermaid
flowchart LR
  A[studio.config.json] --> B[sync workflow<br/>scheduled + manual]
  B --> C{for each member repo}
  C --> D[resolve opted-in canon]
  D --> E[copy source → target paths]
  E --> F[open chore(sync) PR]
  F --> G[product repo CI runs]
```

1. **Trigger** — a scheduled workflow in this repo (e.g. weekly) plus manual `workflow_dispatch`.
2. **Read the manifest** — parse `studio.config.json`: the `canon` catalog, `sourcePaths`,
   `targetPaths`, and each `members[].optIn` selection.
3. **Resolve opt-ins** — for every member, expand `"*"` to the full canon list, honor explicit
   arrays, and skip anything set to `false`.
4. **Copy** — map each opted-in asset from its `sourcePaths` here to the member's `targetPaths`
   (agents → `.github/agents/`, skills → `.github/skills/`, etc.). `base` files (`AGENTS.md`,
   `agency.toml`) land at the member root; product repos keep their own extending `AGENTS.md`
   and the tool merges/append-marks rather than clobbering (see Drift below). `health` and
   `workflows` are **native** (see the table above): they are resolved and reported but never
   written — health files are inherited from this `.github` repo and reusable workflows are
   called via `uses: …@main`.
5. **Open a PR** — commit on a `studio-sync/<date>` branch and open a PR titled
   `chore(sync): update studio canon (<date>)` with a summary of changed assets. Never push to
   the member's default branch directly.
6. **Let product CI validate** — the member's own checks run on the sync PR; a human (or the
   member's agents) reviews and merges.

## CLI usage

The engine is a zero-dependency Node ESM CLI (Node ≥ 24). Full reference:
[`sync/README.md`](../sync/README.md).

```bash
node sync/index.mjs --dry-run                         # plan every member; no writes/git/network
node sync/index.mjs --members jrmoulckers/jrm-recipes # real sync of one member (opens a PR)
node sync/index.mjs --check                           # CI gate: non-zero if any member is stale
```

Flags: `--dry-run`, `--members <a,b>`, `--check`, `--force` (overwrite drift), `--work-dir
<path>` (apply against a local checkout; no clone/push/PR), `--studio-dir <path>` (local
`jrmoulckers/studio` checkout to vendor `@jrm/tokens` from, instead of cloning), `--date
<YYYY-MM-DD>`.

Every synced file gets a provenance header
(`synced from jrmoulckers/.github — canonical source; do not edit here`) — an HTML comment
after any YAML frontmatter (or atop plain Markdown), or a leading `#` line for `.toml`/`.yml`.

## Idempotency & drift

- The tool is **idempotent**: re-running with no upstream change writes nothing and opens no PR.
- State lives in a per-member lockfile **`.studio-sync.lock.json`** at the member root, mapping
  each target path to `{ sourceSha256, targetSha256, syncedAt }`:
  - `sourceSha256` detects **upstream** change (canon moved) → the target is rewritten.
  - `targetSha256` (hash of the exact bytes last written) detects **local** change — if the
    member's current file no longer matches, it was locally modified.
- **Drift detection**: a locally-modified target is flagged `⚠️ locally modified` in the PR body
  and **left untouched** (reviewer reconciles), unless `--force` is passed. Pre-existing,
  unrecorded files that differ from canon are treated the same way, so member-authored files are
  never clobbered. Hashes use LF-normalized content to avoid line-ending churn.

## Vendored tokens (`@jrm/tokens`)

The design-token package `@jrm/tokens` lives in the **other**, private backbone repo
`jrmoulckers/studio`, not here. Studio's token build (`packages/tokens/build/`) is gitignored,
and — by studio-owner decision — nothing is ever published to a package registry and there is no
GitHub org. So `@jrm/tokens` reaches product repos the **same way the AI layer does**: carried by
this sync engine and delivered as a `chore(sync)` PR. The `@jrm` name is kept purely as an
identifier; it is never resolved from a registry.

### How the engine obtains the built files — Option A (committed `dist/`)

`jrmoulckers/studio` commits a slim, purpose-built **distribution directory**
(`packages/tokens/dist/`, distinct from its gitignored `build/`) containing exactly what
consumers need: the CSS custom-property files, the Tailwind preset, and the typed JS. The sync
engine shallow-clones `jrmoulckers/studio` (read-only, using `STUDIO_SYNC_TOKEN`) and mirrors that
`dist/` tree verbatim into each opted-in member.

This was chosen over the alternative (the engine cloning studio and running
`pnpm --filter @jrm/tokens build` itself) because it:

- keeps the engine a **pure, deterministic, zero-dependency file-mover** — no pnpm/toolchain or
  build-failure surface injected into the sync runtime;
- keeps local `--studio-dir`/`--work-dir` testing trivial and **offline**;
- makes the vendored bytes **reproducible and auditable** — provenance, lock, and drift all
  operate on the exact committed `dist/` a reviewer approved in studio;
- **decouples reliability**: a broken token build fails in studio's own CI, not mid-sync across
  every member.

The cost — studio commits generated output — is contained to a dedicated `dist/` directory
treated as a distribution artifact. Producing/refreshing that `dist/` is studio's own concern.

### The `dist/` path contract (interface between the two repos)

This is the byte-for-byte interface the studio-side session must match. Under
`sourceBase` (`packages/tokens/dist/`), `jrmoulckers/studio` commits — and the engine reads and
mirrors — the whole tree, expected to contain at least:

| Path under `packages/tokens/dist/` | What | Consumers |
| --- | --- | --- |
| `css/default/tokens.css` | CSS custom properties (light/base) | all (finance `@import`s these) |
| `css/default/tokens-dark.css` | dark theme custom properties | all |
| `css/default/tokens-dark-oled.css` | dark-OLED theme | all |
| `css/default/tokens-high-contrast.css` | high-contrast theme | all |
| `css/default/index.css` | barrel that `@import`s the above | all |
| `tailwind/default.cjs` | Tailwind preset | future Tailwind consumers |
| `js/**` | typed JS/TS (`*.js`, `*.d.ts`, source maps) | future JS consumers |

The engine mirrors **whatever `dist/` actually contains** (whole-tree copy), so this table is the
_expected minimum layout_, not a hard allowlist — if studio adds files under `dist/`, they are
vendored too. Files that can't hold a comment (`.map`, `.json`) are copied verbatim and are still
tracked in the lockfile by sha256 (drift-detected) even though they carry no visible header. The
engine only reads this path; **it never runs studio's build** (Option A).

### Manifest, target path, and opt-in

Because tokens come from an external repo (not `.github` canon), they get their own top-level
`tokens` config and a **per-member `tokens` block**, kept separate from `optIn`:

```jsonc
// top-level
"tokens": {
  "sourceRepo": "jrmoulckers/studio",
  "package": "@jrm/tokens",
  "sourceBase": "packages/tokens/dist",   // whole tree mirrored (css + tailwind + js)
  "targetPath": "vendor/@jrm/tokens"       // default; per-member overridable
}

// per member
"tokens": { "enabled": true, "targetPath": "apps/web/vendor/@jrm/tokens" }  // finance (Vite app under apps/web/)
"tokens": { "enabled": false }             // score-king / jrm-recipes declared but off
```

The whole `sourceBase` tree is mirrored today. The schema leaves room for a future optional
per-member `include` (an array of sub-globs under `sourceBase`) to narrow what a member receives,
addable without a breaking change; it is intentionally **not** built yet.

Vendored files land under a **`vendor/@jrm/tokens/…`** convention (app assets, not `.github`
config; `vendor/` signals third-party/generated, and `@jrm/tokens` preserves the package
identity). The default is repo-root; each member may override — e.g. `finance` is a Vite app, so
its tokens go to `apps/web/vendor/@jrm/tokens` (co-located so Vite resolves the CSS `@import`
cleanly). Each file carries a source-aware provenance header —
`generated + synced from jrmoulckers/studio @jrm/tokens — do not edit here` — as a `/* … */`
comment for CSS/JS/TS; source maps and JSON are copied verbatim (a comment would corrupt them).
Token files reuse the same lockfile, drift detection, and PR-per-member flow as the AI layer.

For offline work, `--studio-dir <path>` supplies a local `jrmoulckers/studio` checkout instead of
cloning; `--dry-run` then lists the exact vendored files, and `--work-dir` applies them to a
scratch member checkout.

## Authentication (`STUDIO_SYNC_TOKEN`)

The scheduled workflow's default `GITHUB_TOKEN` is scoped to **this** repo only and **cannot**
push branches or open PRs in other repositories. Cross-repo sync therefore requires a Personal
Access Token stored as the **`STUDIO_SYNC_TOKEN`** secret, able to push and open PRs on every
member repo (and on `jrmoulckers/jrmoulckers` for the profile mirror), plus **read** access to
the private token source repo `jrmoulckers/studio` (for `@jrm/tokens` vendoring). Classic PAT:
`repo` scope; fine-grained: Contents + Pull requests read/write on the target repos, and
Contents: Read on `jrmoulckers/studio`. `--dry-run` needs no token (pass `--studio-dir` to list
vendored token files offline); the workflow fails fast on real runs when the secret is missing.

## Profile README (user-account caveat)

`profile/README.md` here is the canonical JRM Studio profile. Because `jrmoulckers` is a GitHub
**user** (not an org), a `.github` repo's `profile/README.md` does **not** render on the account
page — the profile README must live in the special `jrmoulckers/jrmoulckers` repo. The sync tool
therefore also **mirrors `profile/README.md` → `jrmoulckers/jrmoulckers/README.md`** so the
canonical copy stays here while the profile actually displays.

## Out of scope (for now)

- Two-way sync — flow is one-way: backbone → product repos.
- Pruning: assets a member later opts out of are not deleted from the member repo.
- Publishing `@jrm` packages to any registry — the studio is registry-free; `@jrm/tokens` is
  vendored (above), and the `@jrm` name is only ever an identifier, never resolved from a registry.
- Producing studio's committed `packages/tokens/dist/` — that build/commit is `jrmoulckers/studio`'s
  own concern; this engine only copies the result.
- The consumer-side wiring in members (e.g. finance repointing its CSS `@import` at the vendored
  path) — done in each product repo, not here.
