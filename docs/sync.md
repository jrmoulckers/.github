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
| **Native** | Community-health files, reusable workflows | GitHub inherits default health files from this `.github` repo automatically; reusable workflows are called directly with `uses: jrmoulckers/.github/.github/workflows/reusable-*.yml@main`. **No sync needed — and a member must not keep its own copy** (see below). |
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
   `targetPaths`, and each `members[].optIn` selection. Validation covers `repo`, `optIn` and
   `tokens` only — a member's `framework`, `packageManager` and `notes` are free-form, unvalidated
   labels, so their accuracy is a discipline matter (see
   [Member entries](../sync/README.md#member-entries)).
3. **Resolve opt-ins** — for every member, expand `"*"` to the full canon list, honor explicit
   arrays, and skip anything set to `false`.
4. **Copy** — map each opted-in asset from its `sourcePaths` here to the member's `targetPaths`
   (agents → `.github/agents/`, skills → `.github/skills/`, etc.). `base` files (`AGENTS.md`,
   `agency.toml`) land at the member root; product repos keep their own extending `AGENTS.md`
   and the tool merges/append-marks rather than clobbering (see Drift below). The
   `studio:base` markers only count at column 0 on a line of their own, outside a fenced code
   block, so a member `AGENTS.md` may safely *document* the convention (see
   [AGENTS.md base merge](../sync/README.md#agentsmd-base-merge)). `health` and
   `workflows` are **native** (see the table above): they are resolved and reported but never
   written — health files are inherited from this `.github` repo and reusable workflows are
   called via `uses: …@main`. A member repo must therefore **not** contain its own copy of
   either (see [Native kinds have no transport](#native-kinds-have-no-transport)).
5. **Open a PR** — commit on a `studio-sync/<date>` branch and open a PR titled
   `chore(sync): update studio canon (<date>)` with a summary of changed assets. Never push to
   the member's default branch directly. If that branch already exists on the remote (a same-day
   re-run), it is fetched and **reused as the base** and the push is a plain fast-forward — the
   engine never force-pushes, so reviewer commits on the sync branch are preserved. A member whose
   sync fails is reported and skipped; the remaining members and the profile mirror still run, and
   the process exits non-zero.
6. **Let product CI validate** — the member's own checks run on the sync PR; a human (or the
   member's agents) reviews and merges.

## The member registry

`members[]` in [`studio.config.json`](../studio.config.json) is the registry. Validation covers
only three fields — `repo` (must match `owner/name`), `optIn` (keys against `KINDS`, names against
the canon catalog) and `tokens` (shape). The full per-field table is in
[`sync/README.md`](../sync/README.md#member-entries).

**`framework`, `packageManager` and `notes` are descriptive, unvalidated and unenforced.**
`manifest.mjs` never reads them, `resolve.mjs` passes them through, and their only consumer is the
plan label built in `printPlan` — which is called from `runDryRun` and nowhere else. A wrong value
is one wrong word in `--dry-run` stdout. It never reaches a real run, a PR body, or a failure.

That is a reason for *more* care, not less. A load-bearing field that is wrong turns CI red and
self-corrects: someone fixes it and the registry converges on truth. These can be **quietly wrong
forever** — nothing validates them, no run fails, and their only readers are humans and future
agents deciding how to treat a member repo, with no independent source to check against. Accuracy
here is a discipline obligation the tooling does not protect.

Two practices follow, both of which have already caught a real error:

- **Verify member facts against the repo's default branch**, never an onboarding PR. `cartridge`
  was registered as a pnpm Next.js app from its PR #1, which was closed without merging; `main` is
  an npm Svelte PWA.
- **Pin anything worth defending in [`sync/test/manifest.test.mjs`](../sync/test/manifest.test.mjs).**
  Validation will not catch a descriptive error, but an assertion will. Every member's `framework`
  and `packageManager` is asserted there today, so changing one without updating the test fails CI —
  which is the closest the repo can get to enforcing a field the engine deliberately ignores.

`optIn` **is** validated, but only for names — not for intent. `"*"` means "take all canon of this
kind, re-evaluated every run", so on a member that deliberately omits canon it re-adds the omitted
files as an `added:` block in the next PR. A considered omission is indistinguishable from drift.
**A curated member should use explicit arrays** — but the bar for "curated" is a decision someone
made and can defend, not a subset that happens to read as coherent. `cartridge` briefly carried
explicit lists on exactly that mistake: its 11-of-19 agent set was inherited wholesale from an
unrelated session, and the "no backend roles needed" story was contradicted by its own `bridge/`
Cloudflare Worker. `"*"` is the default because adding canon is reversible and a frozen list is not.
See [`sync/README.md`](../sync/README.md#-vs-an-explicit-list).

## Native kinds have no transport

`health` and `workflows` are the two `NATIVE_KINDS` (`sync/lib/manifest.mjs`). The engine resolves
and reports them so the plan reflects what a member has opted into, but `assets.mjs` drops them
before the write list — **no file is ever written for a native kind, on any run, forever.**

The rule that follows is not obvious from the opt-in table, so state it plainly:

> **A member repo must not contain its own copy of a native asset.** Opting in to `health` or
> `workflows` means *"this member relies on the backbone's"*, not *"the engine will install
> these"*. A local copy is worse than having nothing, because it wins over the inherited version
> and nothing will ever update it.

Why each case is harmful:

| Native asset | What a local copy does |
| --- | --- |
| Community-health files (`CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `PULL_REQUEST_TEMPLATE.md`, `ISSUE_TEMPLATE/`, `DISCUSSION_TEMPLATE/`) | GitHub serves a repo's own health file in preference to the one inherited from `jrmoulckers/.github`. A verbatim copy therefore **overrides** the inherited file and freezes it at the moment it was copied. Backbone edits stop reaching that member, silently. |
| Reusable workflows (`.github/workflows/reusable-*.yml`, called as `uses: ./.github/workflows/…`) | A silent fork with no update path. Fixing `reusable-ci-lint` here leaves the member on its stale copy indefinitely, and the divergence is invisible from both sides. |

Neither is self-correcting: because the engine never writes native kinds, it cannot detect the
copy, report drift, or delete it. Removal is a one-time manual cleanup in the member repo.

This has happened: `jrmoulckers/cartridge` carried verbatim copies of both reusable workflows and
all 13 community-health files before a cleanup PR removed them. The trigger was reading the opt-in
table and reasonably concluding that a "synced kind" belongs in the member.

**Checklist when onboarding a member:** it should have *no* `.github/workflows/reusable-*.yml`, and
of the health files only ones it genuinely wants to override deliberately. Prefer none.

### Hand-seeded canon must match, byte for byte, before the first sync

The mirror-image trap applies to the **managed** kinds. A member seeded by hand before onboarding
carries copies of `agents/`, `skills/`, `prompts/` and `instructions/` files that the engine *does*
write — and on the first run each one takes one of two paths:

| The member's copy | First run |
| --- | --- |
| byte-identical to canon | **adopted** — baselined in the lockfile, no diff, silent thereafter |
| differs in any byte | **drift** — flagged, left untouched, and it stays that way |

The second row does not self-heal. With no lock entry and content that differs, the engine cannot
tell a stale hand-copy from a deliberate local edit, so it refuses to clobber — correctly, but
permanently. The member then keeps an outdated file forever while every run reports success.

The dangerous case is a copy of *older* canon that still carries its provenance stamp: it looks
synced, and only a byte comparison reveals it isn't. `jrmoulckers/cartridge` has exactly this — a
`workflow.instructions.md` at 4376 bytes against canon's 8372, with no product-specific content.

**Reconcile before the first sync, in the member repo:** for each pre-seeded file, either make it
byte-identical to canon or delete it (the engine will add it). **Do not reach for `--force`** —
`--force` overwrites every drifted file in the run, so using it to fix a stale copy would also
silently discard genuine member-authored edits elsewhere. It is a deliberate reviewer action for a
known-good state, not a first-run tool.

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

Three flag behaviors that are easy to trip over:

- **`--work-dir` requires exactly one member.** The path is a single member's checkout, so the
  run must resolve to exactly one member — pair it with `--members <owner/name>`. Anything else
  (no filter, or a filter matching two members) fails with
  `--work-dir requires exactly one member (use --members <owner/name>).`
- **`--members` disables the profile mirror.** See [Profile README](#profile-readme-user-account-caveat).
- **`--date <YYYY-MM-DD>` starts a clean attempt.** The sync branch is `studio-sync/<date>`, so a
  fresh date means a fresh branch and a fresh PR. That is the recovery path after a bad run: the
  previous attempt is left intact for inspection rather than amended. Re-running with the *same*
  date is also safe — the existing branch is reused and the push is a fast-forward — but a new date
  is the cleaner reset.

### The first run

The engine has never been run against a member. When it is, the sequence is:

```bash
# 1. Plan both new members, with tokens listed. --studio-dir is what makes tokens visible.
node sync/index.mjs --dry-run \
  --members jrmoulckers/libro,jrmoulckers/cartridge \
  --studio-dir ../studio

# 2. Same command without --dry-run, once STUDIO_SYNC_TOKEN exists.
node sync/index.mjs --members jrmoulckers/libro,jrmoulckers/cartridge
```

**`tokens (0 files)` in a dry run is not a bug.** Vendored `@jrm/tokens` come from the *other*
backbone repo, `jrmoulckers/studio`, and `--dry-run` deliberately performs no network I/O — so with
no `--studio-dir` the source is unresolved and the plan prints
`(source not resolved — pass --studio-dir <checkout> to list files)` above a `0`. Pass a local
`jrmoulckers/studio` checkout to see the real file list. A **real** run clones the studio repo
itself, so `--studio-dir` is only an offline convenience.

Note that a member-filtered run — which the first one is — skips the profile mirror. The dry run
says so explicitly rather than printing a mirror line it would not perform.

Every synced file gets a provenance header
(`synced from jrmoulckers/.github — canonical source; do not edit here`) — an HTML comment
after any YAML frontmatter (or atop plain Markdown), or a leading `#` line for `.toml`/`.yml`.

## Idempotency & drift

- The tool is **idempotent**: once a member carries a lockfile, re-running with no upstream change
  writes nothing and opens no PR.
- **First-run caveat (adoption).** A pre-existing target that already matches canon but has no lock
  entry is *adopted*: its baseline is recorded so a later upstream change updates it instead of
  looking like local drift. Adoption counts as a change, so the very first run against a repo that
  was seeded by hand — every member today, since no `.studio-sync.lock.json` exists yet — can open a
  PR whose **only** diff is `.studio-sync.lock.json` (reported under "Baselined in lockfile"). That
  is expected: merge it, and subsequent runs go quiet.
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
Access Token stored as the **`STUDIO_SYNC_TOKEN`** secret.

**Use a fine-grained token, with exactly these permissions:**

| Permission | Level | Repositories |
| --- | --- | --- |
| Contents | Read and write | the 5 member repos + `jrmoulckers/jrmoulckers` |
| Pull requests | Read and write | same set |
| Contents | Read | `jrmoulckers/studio` (private `@jrm/tokens` source) |

Contents write covers the branch push; Pull requests write covers opening and reusing the sync PR;
the `studio` read is the token vendoring. Nothing else is exercised.

**Do not grant the classic `workflow` scope.** Scopes should be derived from the paths a tool
provably writes, not from the category of tool it is — and the engine never writes under
`.github/workflows/`. `workflows` and `health` are the `NATIVE_KINDS`: resolved and reported so the
plan is honest, dropped before the write list (see [Native kinds have no transport](#native-kinds-have-no-transport)),
and asserted as never-written in `sync/test/manifest.test.mjs`.

The asymmetry matters. `workflow` on a classic PAT confers the ability to create and modify Actions
workflow files in every repo the token reaches, and a workflow edit is arbitrary code execution in
CI with access to that repo's secrets. A stored PAT does not expire with the run, so an unnecessary
scope persists until someone thinks to revoke it — which is to say, indefinitely. If a real run ever
fails with a 403 on a `.github/workflows/` path, that is a **bug in the native-kind handling** and
must be fixed there, not granted around.

A classic PAT with `repo` also works and covers the `studio` read, but it is far broader than the
engine needs and is not the recommendation.

`--dry-run` needs no token (pass `--studio-dir` to list vendored token files offline); the workflow
fails fast on real runs when the secret is missing.

## Profile README (user-account caveat)

`profile/README.md` here is the canonical JRM Studio profile. Because `jrmoulckers` is a GitHub
**user** (not an org), a `.github` repo's `profile/README.md` does **not** render on the account
page — the profile README must live in the special `jrmoulckers/jrmoulckers` repo. The sync tool
therefore also **mirrors `profile/README.md` → `jrmoulckers/jrmoulckers/README.md`** so the
canonical copy stays here while the profile actually displays.

**Only on unfiltered runs.** The mirror is skipped whenever `--members` is passed (the run logs
`Profile mirror skipped (member filter active).`), and `--dry-run` reports it as skipped under the
same filter so the preview matches the run it predicts. This matters for the first real syncs, which are
member-filtered: a run like `--members jrmoulckers/libro,jrmoulckers/cartridge` will not touch
`jrmoulckers/jrmoulckers`. To mirror the profile, run the engine with no `--members` filter (the
scheduled weekly run, or a `workflow_dispatch` with a blank `members` input).

`profile` is **not** an `optIn` kind — it is not listed in `KINDS` and `optIn.profile` fails
validation. The mirror is unconditional (subject to the filter rule above) and driven by
`manifest.owner`.

## Out of scope (for now)

- Two-way sync — flow is one-way: backbone → product repos.
- Pruning: assets a member later opts out of are not deleted from the member repo.
- Publishing `@jrm` packages to any registry — the studio is registry-free; `@jrm/tokens` is
  vendored (above), and the `@jrm` name is only ever an identifier, never resolved from a registry.
- Producing studio's committed `packages/tokens/dist/` — that build/commit is `jrmoulckers/studio`'s
  own concern; this engine only copies the result.
- The consumer-side wiring in members (e.g. finance repointing its CSS `@import` at the vendored
  path) — done in each product repo, not here.
