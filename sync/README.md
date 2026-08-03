# Studio sync engine

Distributes the canonical AI layer from the backbone repo (`jrmoulckers/.github`) to the
member repos declared in [`studio.config.json`](../studio.config.json). One-way only:
backbone → members. See [`docs/sync.md`](../docs/sync.md) for the design and rationale.

Zero runtime dependencies — Node.js **≥ 24**, built-ins only (`node:fs`, `node:path`,
`node:crypto`, `node:child_process`, …).

## Usage

```bash
node sync/index.mjs [options]
```

| Flag | Effect |
| --- | --- |
| `--dry-run` | Plan only. Prints the resolved file set per member. **No writes, git, or network.** |
| `--members <a,b>` | Restrict to these member repos (`owner/name` or bare `name`). |
| `--check` | CI gate. Exit non-zero if any member is out of date or has drift. |
| `--force` | Overwrite locally-modified (drift) targets instead of skipping them. |
| `--work-dir <path>` | Apply/inspect against a local checkout; **requires exactly one matching `--members` value**. No clone/push/PR. |
| `--studio-dir <path>` | Local checkout of the token source repo (`jrmoulckers/studio`) to vendor `@jrm/tokens` from, instead of cloning it. Offline seam for tokens. |
| `--date <YYYY-MM-DD>` | Override the date used for branch/commit naming. |
| `--help` | Show help. |

Examples:

```bash
# See exactly what each member would receive.
node sync/index.mjs --dry-run

# Real sync of a single member (opens a PR).
STUDIO_SYNC_TOKEN=ghp_… node sync/index.mjs --members jrmoulckers/jrm-recipes

# CI freshness gate across all members.
STUDIO_SYNC_TOKEN=ghp_… node sync/index.mjs --check
```

## Member entries

Each entry in `studio.config.json`'s `members[]` array describes one product repo:

| Field | Validated? | Used for |
| --- | --- | --- |
| `repo` | ✅ must match `owner/name` | Clone target, `--members` filter, PR destination. |
| `optIn` | ✅ keys against `KINDS`, names against `canon.<kind>` | What canon the member receives. |
| `tokens` | ✅ shape (`enabled` boolean, optional string `targetPath`) | Vendored `@jrm/tokens` opt-in + destination. |
| `framework` | ❌ **free-form** | Display only. |
| `packageManager` | ❌ **free-form** | Display only. |
| `notes` | ❌ free-form | Human/agent context. |

`framework` and `packageManager` are **not** enums and are never checked: `validateManifest` does
not mention them, `resolve.mjs` passes them straight through, and their only consumer is the
dry-run label in `index.mjs` (`▶ jrmoulckers/libro  (svelte · pnpm)`). Any string is accepted —
`npm`, `pnpm`, `svelte`, `nextjs`, `kmp-web` all appear today.

**That makes accuracy a discipline problem, not a validation problem.** A wrong value never breaks
a sync; it silently misleads every human and agent that reads the registry to decide how to treat a
repo. Two rules follow:

- **Verify against the member's default branch**, not an onboarding PR — an unmerged PR is not the
  repo. `cartridge` was registered as a pnpm Next.js app from its onboarding PR #1, which was
  closed without merging; `main` is an npm Svelte PWA.
- **Pin any fact worth defending in [`test/manifest.test.mjs`](test/manifest.test.mjs).** Validation
  will not catch a descriptive error, but an assertion will.

## What gets synced

Resolution follows each member's `optIn` in the manifest:

- `"*"` → the full canon of that kind, an array → those names, `false`/omitted → opt out.
- `base` and `health` are booleans.
- The **only** valid `optIn` keys are `base`, `agents`, `skills`, `prompts`, `instructions`,
  `workflows`, `health` (`KINDS` in [`lib/manifest.mjs`](lib/manifest.mjs)). Anything else — notably
  `optIn.tokens` or `optIn.profile` — fails validation with *"is not a known kind"*. Tokens and the
  profile README are configured elsewhere; see the two rows below the table.

| Kind | Shape | Target | Notes |
| --- | --- | --- | --- |
| `base` | `AGENTS.md`, `agency.toml` | member root | `AGENTS.md` is **merged** (see below); `agency.toml` copied wholesale. |
| `agents` | `*.agent.md` files | `.github/agents/` | |
| `prompts` | `*.prompt.md` files | `.github/prompts/` | |
| `instructions` | `*.instructions.md` files | `.github/instructions/` | |
| `skills` | `<name>/` directories | `.github/skills/` | Whole folder: `SKILL.md` + any checklists. |
| `health` | community-health files | — | **Native** — GitHub inherits these from the backbone `.github` repo. Never written; the member must **not** keep its own copy. |
| `workflows` | reusable workflows | — | **Native** — called via `uses: jrmoulckers/.github/.github/workflows/*@main`. Never written; the member must **not** vendor a copy. |

> **Opting in to a native kind installs nothing.** `health` and `workflows` (`NATIVE_KINDS` in
> [`lib/manifest.mjs`](lib/manifest.mjs)) are resolved and reported so the plan is complete, then
> dropped before the write list. Opting in means *"this member relies on the backbone's"*. A local
> copy of either is **worse than having none**: a member's own health file overrides the one
> inherited from `jrmoulckers/.github` and freezes it, and a vendored `reusable-*.yml` is a silent
> fork with no update path. The engine cannot detect or fix either, because it never writes them.
> See [Native kinds have no transport](../docs/sync.md#native-kinds-have-no-transport).

Two more asset classes are synced but are **not** `optIn` kinds:

| Asset | Configured by | Target | Notes |
| --- | --- | --- | --- |
| Vendored `@jrm/tokens` | `members[].tokens` (`{ "enabled": true, "targetPath"?: … }`) plus the top-level `tokens` block | `vendor/@jrm/tokens/` (per-member overridable) | **External** — vendored from the private `jrmoulckers/studio` repo, not backbone canon. See below. |
| Profile README | not configurable per member — always `profile/README.md` in this repo | `jrmoulckers/jrmoulckers` `README.md` | Mirrored to the user profile repo once per run, and **only on unfiltered runs**: passing `--members` skips the mirror entirely. `--dry-run` reports the mirror as skipped under a filter, matching the run it previews. |

Every synced file carries a provenance header
(`synced from jrmoulckers/.github — canonical source; do not edit here`): an HTML comment
after the YAML frontmatter (or at the top of plain Markdown), or a leading `#` line for
`.toml`/`.yml`.

### Vendored design tokens (`@jrm/tokens`)

The design-token package lives in a **different, private** backbone repo — `jrmoulckers/studio`
(package `@jrm/tokens`) — and is **registry-free**. Its built CSS custom properties, Tailwind
preset, and typed JS are carried into members by this same engine, exactly like the AI layer.

**How the files are obtained (Option A):** `jrmoulckers/studio` commits a slim, purpose-built
distribution directory (`packages/tokens/dist/`, separate from its gitignored `build/`). The
engine shallow-clones `jrmoulckers/studio` (read-only, `STUDIO_SYNC_TOKEN`) and mirrors that
committed `dist/` tree verbatim — it stays a pure, deterministic file-mover with no build step.
For offline testing, `--studio-dir <path>` points at a local `jrmoulckers/studio` checkout
instead of cloning.

Configuration lives in `studio.config.json`:

```jsonc
"tokens": {
  "sourceRepo": "jrmoulckers/studio",
  "package": "@jrm/tokens",
  "sourceBase": "packages/tokens/dist",   // whole tree mirrored (css + tailwind + js)
  "targetPath": "vendor/@jrm/tokens"       // default; per-member overridable
}
```

Opt-in is **per member** and kept separate from `optIn` (the source is an external repo, not
`.github` canon):

```jsonc
"tokens": { "enabled": true, "targetPath": "apps/web/vendor/@jrm/tokens" }  // finance (Vite app under apps/web/)
"tokens": { "enabled": false }                             // declared but off
"tokens": { "enabled": true }                              // default repo-root vendor/@jrm/tokens
```

The whole `sourceBase` tree is mirrored today; the schema leaves room for a future optional
per-member `include` (sub-globs under `sourceBase`) without a breaking change — not built yet.

Each vendored file lands under the member's `targetPath` (default repo-root `vendor/@jrm/tokens/`,
mirroring studio's `dist/` layout: `css/default/*.css`, `tailwind/default.cjs`, `js/**`) and
carries a source-aware provenance header
(`generated + synced from jrmoulckers/studio @jrm/tokens — do not edit here`): a `/* … */`
comment for `.css`/`.js`/`.cjs`/`.ts`. Source maps and JSON (`.map`/`.json`) are copied verbatim
(no header — a comment would corrupt them) but are still tracked in the lockfile by sha256.
Token files flow through the same lockfile, drift detection, and `chore(sync)` PR machinery as
the rest of the canon. See [`docs/sync.md`](../docs/sync.md#the-dist-path-contract-interface-between-the-two-repos)
for the exact `dist/` path contract the studio repo must match.

### AGENTS.md base merge

Product repos keep their own extending `AGENTS.md`. The tool manages only a marked region:

```markdown
<!-- studio:base:start -->
…canonical base guide…
<!-- studio:base:end -->
```

Everything outside the markers is product-local and never touched. Editing inside the block
is treated as drift; editing outside it is ignored. If a member has no `AGENTS.md`, one is
created containing just the managed block.

**A marker only counts when it stands alone on its own line, outside any fenced code block.**
That strictness exists because the natural thing for a product `AGENTS.md` to do is *explain*
this convention — quoting `` `<!-- studio:base:start -->` `` inline, or showing both markers in a
```` ```markdown ```` example, exactly as the block above does. Under a looser match that prose
formed a **phantom managed block**: `extractBlock` returned the few characters between the two
mentions instead of `null`, the "no markers → append" path was never taken, the phantom content
hashed as unrecognized drift, and `AGENTS.md` was **skipped** — the member received every other
file, the run reported success, and the base guide silently never arrived. So documenting the
sync in your `AGENTS.md` is safe; write about it freely.

As a second line of defense, drift on a managed block that is a small fraction of canon's size is
reported with an explicit *"check AGENTS.md for stray `studio:base` markers"* note, and a skipped
`AGENTS.md` gets its own warning line rather than being one entry in a drift list.

## Idempotency & drift — `.studio-sync.lock.json`

Each member repo carries a lockfile at its root:

```json
{
  "version": 1,
  "backbone": "jrmoulckers/.github",
  "generatedAt": "…",
  "entries": {
    ".github/agents/architect.agent.md": {
      "sourceSha256": "…",
      "targetSha256": "…",
      "syncedAt": "…"
    }
  }
}
```

- `sourceSha256` detects **upstream** changes (canon moved) → the target is rewritten.
- `targetSha256` is the hash of the exact bytes last written; if the member's current file no
  longer matches it, the file was **locally modified** → flagged `⚠️ locally modified` in the
  PR body and **left untouched** (unless `--force`). A pre-existing, unrecorded file that
  differs from canon is treated the same way, so member-authored files are never clobbered.

Re-running with no upstream change writes nothing and opens no PR. Hashes are computed on
LF-normalized content, so line-ending differences don't cause spurious churn.

**Adoption caveat (first run against an existing repo).** A pre-existing target that already
matches canon but has no lock entry is *adopted*: its baseline is recorded in the lockfile. Adoption
counts as a change, so the **first** run against a repo that was seeded by hand (or onboarded before
the engine existed) can open a PR whose only diff is `.studio-sync.lock.json` — no file content
changes, listed under "Baselined in lockfile" in the PR body. Once that lockfile is merged, further
runs with no upstream change write nothing and open no PR.

## PR flow

For each member with changes the tool clones (shallow), checks out `studio-sync/<YYYY-MM-DD>`,
commits `chore(sync): update studio canon (<date>)`, pushes, and opens a PR against the
member's **default** branch. It never pushes to the default branch, and skips members with
no changes.

**Same-day re-runs never force-push.** If the dated branch already exists on the remote it is
fetched and **reused as the base**, so this run is stacked on top of whatever is already there and
pushed as a fast-forward. Commits a reviewer pushed to the sync branch are preserved (and logged),
and reviewer edits to synced files are evaluated as ordinary drift — flagged and left alone rather
than overwritten. If the push is rejected because the remote moved mid-run, the run fails loudly
instead of overwriting; re-run it.

## Authentication

Set `STUDIO_SYNC_TOKEN` to a PAT that can push and open PRs on the member repos (and on
`jrmoulckers/jrmoulckers` for the profile mirror), plus **read** access to the private token
source repo `jrmoulckers/studio` (needed when a member opts into `tokens`). The default
`GITHUB_TOKEN` is scoped to the backbone repo only and **cannot** operate cross-repo.
`--dry-run` needs no token (it won't clone `jrmoulckers/studio`; pass `--studio-dir` to list
vendored token files offline).

## Scheduled runs

[`.github/workflows/studio-sync.yml`](../.github/workflows/studio-sync.yml) runs weekly and on
`workflow_dispatch` (with `members` and `dry_run` inputs), using the `STUDIO_SYNC_TOKEN` secret.

## Tests

Zero-dependency `node:test` suite — no network, no `gh`, no token (the git tests use local
file-path remotes):

```bash
cd sync && npm test        # or: node --test "test/*.test.mjs"
```

| File | Covers |
| --- | --- |
| `test/branch-reuse.test.mjs` | Sync-branch reuse: reviewer commits survive a re-run; a diverged remote is rejected instead of force-pushed. |
| `test/copier.test.mjs` | add / unchanged / drift / `--force` / adoption and the lockfile write rule. |
| `test/manifest.test.mjs` | The real `studio.config.json` validates; every member is registered; `tokens`/`profile` are not `optIn` kinds. |

[`.github/workflows/ci.yml`](../.github/workflows/ci.yml) runs the suite plus an offline
`--dry-run` on every PR.

## Profile mirror caveat

`jrmoulckers` is a GitHub **user**, so a `.github` repo's `profile/README.md` does not render
on the account page — it must live in the special `jrmoulckers/jrmoulckers` repo. The tool
mirrors it there. If that repo doesn't exist yet, the run logs a **warning** and continues
(it never fails the whole sync).

The mirror only runs on **unfiltered** syncs. Any run that passes `--members` skips it and logs
`Profile mirror skipped (member filter active).` — so a member-filtered run (including the
`members` input of the scheduled workflow) never touches `jrmoulckers/jrmoulckers`.
