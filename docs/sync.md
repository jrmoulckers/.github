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
<path>` (apply against a local checkout; no clone/push/PR), `--date <YYYY-MM-DD>`.

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

## Authentication (`STUDIO_SYNC_TOKEN`)

The scheduled workflow's default `GITHUB_TOKEN` is scoped to **this** repo only and **cannot**
push branches or open PRs in other repositories. Cross-repo sync therefore requires a Personal
Access Token stored as the **`STUDIO_SYNC_TOKEN`** secret, able to push and open PRs on every
member repo (and on `jrmoulckers/jrmoulckers` for the profile mirror). Classic PAT: `repo`
scope; fine-grained: Contents + Pull requests read/write on the target repos. `--dry-run` needs
no token; the workflow fails fast on real runs when the secret is missing.

## Profile README (user-account caveat)

`profile/README.md` here is the canonical JRM Studio profile. Because `jrmoulckers` is a GitHub
**user** (not an org), a `.github` repo's `profile/README.md` does **not** render on the account
page — the profile README must live in the special `jrmoulckers/jrmoulckers` repo. The sync tool
therefore also **mirrors `profile/README.md` → `jrmoulckers/jrmoulckers/README.md`** so the
canonical copy stays here while the profile actually displays.

## Out of scope (for now)

- Two-way sync — flow is one-way: backbone → product repos.
- Pruning: assets a member later opts out of are not deleted from the member repo.
- Publishing `@jrm` npm packages (handled by each package's own release flow).
