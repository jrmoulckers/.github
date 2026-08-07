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
| `--force` | Overwrite locally-modified (drift) targets instead of skipping them. Applies to **every member in the run**, not per file. |
| `--work-dir <path>` | Apply/inspect against a local checkout; **requires exactly one matching `--members` value**, the path must be the checkout itself (a parent directory is rejected), and its `origin` must be that member — a different origin, or none at all, aborts with exit 1 even under `--dry-run`/`--check`. No clone/push/PR. |
| `--allow-unverified-work-dir` | Proceed when `--work-dir`'s origin is not provably the named member (fork, mirror, local-only clone). Scoped to that one check; prints what it suppressed. |
| `--studio-dir <path>` | Local checkout of the token source repo (`jrmoulckers/studio`) to vendor `@jrm/tokens` from, instead of cloning it. Offline seam for tokens. |
| `--date <YYYY-MM-DD>` | Override the date used for branch/commit naming. |
| `--help` | Show help. |

Examples:

```bash
# See exactly what each member would receive.
node sync/index.mjs --dry-run

# Real sync of a single member (opens a PR).
STUDIO_SYNC_TOKEN=github_pat_… node sync/index.mjs --members jrmoulckers/jrm-recipes

# CI freshness gate across all members.
STUDIO_SYNC_TOKEN=github_pat_… node sync/index.mjs --check
```

## Member entries

Each entry in `studio.config.json`'s `members[]` array describes one product repo:

| Field | Validated? | Used for |
| --- | --- | --- |
| `repo` | ✅ must match `owner/name` | Clone target, `--members` filter, PR destination. |
| `optIn.base` / `.agents` / `.skills` / `.prompts` / `.instructions` | ✅ keys against `KINDS`, names against `canon.<kind>` | **Executed** — what canon the member receives. |
| `optIn.health` / `optIn.workflows` | ✅ same validation | **Recorded only** — native kinds, never copied (see below). |
| `tokens` | ✅ shape (`enabled` boolean, optional string `targetPath`) | Vendored `@jrm/tokens` opt-in + destination. |
| `framework` | ❌ **free-form** | Display only — `--dry-run` plan label. |
| `packageManager` | ❌ **free-form** | Display only — `--dry-run` plan label. |
| `notes` | ❌ free-form | Human/agent context. |

**Two keys inside `optIn` do not behave like the rest.** `health` and `workflows` are
`NATIVE_KINDS` ([`lib/manifest.mjs`](lib/manifest.mjs)): community-health files are inherited from
this backbone repo by GitHub itself, and reusable workflows are called via
`uses: jrmoulckers/.github/.github/workflows/*@main`. Both are resolved and reported, then skipped
before any write ([`lib/assets.mjs`](lib/assets.mjs)). So `"agents": "*"` and
`"workflows": [...]` sit in the same object with the same shape, and one decides which files exist
while the other is a label. Validation catches a *misspelled* name in either; nothing catches a
`workflows` list that simply disagrees with what the member's CI actually calls — which is why
that invariant is asserted in [`test/manifest.test.mjs`](test/manifest.test.mjs) instead.

`framework` and `packageManager` are **not** enums and are never checked: `validateManifest` does
not mention them, `resolve.mjs` passes them straight through, and their only consumer is the
dry-run label in `index.mjs` (`▶ jrmoulckers/libro  (svelte · pnpm)`). Any string is accepted —
`npm`, `pnpm`, `svelte`, `nextjs`, `kmp-web` all appear today.

Narrower still: that label is built in `printPlan`, which has exactly **one** call site — inside
`runDryRun`. `pr.mjs` never references either field, so they never reach a PR body, and a real sync
run never prints them at all. **These two fields are visible only in `--dry-run` output.**

**That makes accuracy a discipline problem, not a validation problem.** A wrong value never breaks
a sync; it silently misleads every human and agent that reads the registry to decide how to treat a
repo. Note the perverse incentive: if a wrong `framework` broke a run, the error would be
self-correcting — CI goes red, someone fixes it, the registry converges on truth. Because it only
labels a mode most runs never use, `studio.config.json` can be **quietly wrong forever**, and its
only consumers are agents with no independent source to check it against. An unvalidated field with
no failure mode needs *more* care than a load-bearing one, not less. Two rules follow:

- **Verify against the member's default branch**, not an onboarding PR — an unmerged PR is not the
  repo. `cartridge` was registered as a pnpm Next.js app from its onboarding PR #1, which was
  closed without merging; `main` is an npm Svelte PWA.
- **Pin any fact worth defending in [`test/manifest.test.mjs`](test/manifest.test.mjs).** Validation
  will not catch a descriptive error, but an assertion will. Every member's `framework` and
  `packageManager` is already pinned there, so changing a stack without updating the test fails CI.

### `"*"` vs. an explicit list

`optIn.<kind>` accepts `"*"` (all canon of that kind), an array of names, or `false`. `"*"` is not a
default — it is a standing instruction to take everything, re-evaluated on every run.

**`"*"` is nevertheless the right starting point.** Adding canon a member did not need is cheap and
reversible: it lands as a visible `added:` block in a reviewable PR, and deleting a file the member
does not want is one commit. A frozen list is neither. Nothing will ever prompt someone to re-read
it, so a list is a decision that keeps applying itself long after anyone remembers making it.

**A member that deliberately omits canon should list what it takes explicitly.** `resolveSelection`
expands `"*"` to `[...canonList]`, so on a curated repo it re-adds every omitted file as an `added:`
block in the next sync PR. Nothing distinguishes "this member never had these" from "this member
decided against these", so a considered omission looks exactly like drift and gets undone.

The bar for "deliberately" is the part worth stating, because we got it wrong once. `cartridge`
carries 11 of 19 agents, 11 of 15 skills and 5 of 7 prompts, and that subset reads as a coherent
fit decision: every business, backend, data and i18n role is absent from what looks like an offline
game catalogue. It was registered with explicit arrays on that reading, and the reading was wrong.

The author of that tree has since answered directly, and the answer is more instructive than the
guesswork: the file list came from a **hand-typed `OPT_IN` object at the top of a one-off scaffold
script**. So it was deliberate in *mechanism* — eleven names typed, nothing truncated or lost — and
not a decision in *substance*. It was a first-pass guess made in the same breath as the scaffold,
from the premise "cartridge is a client-side PWA", and by the end of that same commit the repo
contained a Cloudflare Worker doing an OAuth client-credentials exchange, KV caching, a CORS
allowlist and per-IP throttling.

The tell is sharper still: that same commit **did** opt into the `privacy-compliance` and
`security-review-methodology` skills. The concern was live; it simply never carried across to the
agent list. An omission sitting next to its own counter-example is the signature of an oversight,
not a judgement.

Three rules come out of that:

- **A partial canon set is not evidence of curation.** Ruling out one explanation for a subset —
  such as canon having grown after the member vendored — does not establish another. A small set is
  easy to narrate a rationale for after the fact, and that narration is not verification.
- **Deliberate in mechanism is not deliberate in substance.** Someone typing a list by hand proves
  only that nothing was truncated. Ask what the list was reasoned from and whether that premise held
  by the end of the same commit.
- **Freeze only what someone can vouch for**, and record why in `notes`.
  [`test/manifest.test.mjs`](test/manifest.test.mjs) requires a `notes` entry on any member that
  narrows `agents`/`skills`/`prompts`. That test is inert today by design; it arms itself the moment
  a member curates.

One rule about tests comes out of it too, because the first attempt pinned the wrong thing. The test
added alongside the explicit lists asserted that cartridge's three keys stay arrays and named the
omitted files — it made a contested inference into a guarded invariant, so the next reader to doubt
it would have had to argue with a red suite rather than with a config value. **Assert schema and
consistency, not which names someone picked.** The `notes` requirement above is the version that
survives: it constrains how a choice is recorded, not what the choice is.

Use `"*"` when the member wants whatever canon grows into — both `libro` and `cartridge` do, and get
new canon automatically. Use a list when the omissions are a decision someone made and can defend.
The cost of the list is that someone must add new canon by hand; that is the point.

Typos in a list are caught: `validateOptIn` rejects any name absent from `canon.<kind>` before the
run starts. `resolveSelection`'s own `filter` would drop an unknown name silently, so validation is
the guardrail that makes explicit lists safe — pinned by a test.

### `optIn.workflows` vs. what the member actually calls

`workflows` is a native kind: nothing is written, so the list is a *record of intent* that nothing
in the engine can check against the member's real `ci.yml`. Same failure shape as `framework` —
silently wrong forever.

The invariant worth holding is one-directional: **every reusable workflow a member calls must appear
in its `optIn.workflows`.** Listing one it does not call yet is fine and common — `jrm-recipes`,
`score-king` and `finance` all list workflows they have not adopted, which records the intended
direction. Calling one that is *not* listed is the error, because the registry then misdescribes
the member and no other signal exists.

`test/manifest.test.mjs` pins a sweep of each member's `.github/workflows/` — every
`uses: jrmoulckers/.github/.github/workflows/<name>.yml` reference, read from its default branch —
and asserts the invariant. The suite is offline, so the sweep is pinned data, not a live fetch:
**re-run it by hand when a member changes CI.** cartridge is the worked example in both directions.
It inlined its own semantic-PR-title job while `reusable-ci-lint` could not be called without lint
commands, so the entry was correctly absent; once the empty-command guard shipped it adopted the
workflow, and the manifest had to follow.

#### Name collisions: a member may define its own workflow with a canon filename

The sweep reads `uses: jrmoulckers/.github/.github/workflows/<name>.yml`, so a workflow the member
defines *itself* and calls via `uses: ./.github/workflows/<name>.yml` is invisible to it by
construction. If that local file happens to share a name with a canon workflow, the two are
indistinguishable from either side.

`jrmoulckers/finance` is the live instance. It calls **zero** backbone workflows, so its swept list
is correctly empty — while it carries its own `.github/workflows/reusable-smoke-test.yml` that is
substantially larger than canon's and **not a superset** of it, and its registry entry lists
`reusable-smoke-test`. (Measured 2026-08-05: 275 lines against canon's 154. The counts are a
property of a checkout at a moment; the claim that survives is *different file, same name*.)

Nothing is broken today, and nothing is being written either way, since `workflows` is a native
kind. The risk is latent and specific: **if finance ever switches that call to
`uses: jrmoulckers/.github/…@main`, its own definition is silently replaced by a shorter, different
one** —
no diff in either repo, no error, and CI stays green while the job changes underneath it.

Whether finance's file is a stale fork of canon or an independent file that collided is genuinely
unresolvable from outside, and that ambiguity *is* the finding. The rule that avoids it: **give a
genuinely local workflow a local name, or reference canon — never both.**

This is deliberately not asserted in the test suite. Detecting it needs the member's full workflow
directory, which the offline suite does not have, and pinning each member's local filenames would
be a fact-test of the kind that goes stale and then certifies the wrong value. It is recorded as a
caveat on `CALLED_WORKFLOWS` instead.

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

**A marker only counts when it starts at column 0 on a line of its own, outside any fenced code
block.** That strictness exists because the natural thing for a product `AGENTS.md` to do is
*explain* this convention — quoting `` `<!-- studio:base:start -->` `` inline, showing both markers
in a ```` ```markdown ```` example exactly as the block above does, or indenting them four spaces as
a code block. Under a looser match that prose formed a **phantom managed block**: `extractBlock`
returned the few characters between the two mentions instead of `null`, the "no markers → append"
path was never taken, the phantom content hashed as unrecognized drift, and `AGENTS.md` was
**skipped** — the member received every other file, the run reported success, and the base guide
silently never arrived. So documenting the sync in your `AGENTS.md` is safe; write about it freely.

Three matching rules do that work, and they cover different cases: fenced examples are masked
before matching (offsets preserved, so the real block's indices stay honest), inline mentions fail
because the marker is not alone on its line, and **indented** code blocks fail because the markers
must be at column 0 — masking only understands ``` / ~~~ fences, so the indent rule is what closes
that one. The engine always writes markers at column 0, so nothing legitimate is excluded.

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

**The other half of that caveat.** Adoption only applies when the pre-existing file is
byte-identical to what the engine *would write* — canon plus its provenance header, LF-normalized,
not raw canon (see [Auditing a member by hand](#auditing-a-member-by-hand-compare-against-inject-not-against-canon)).
A hand-seeded copy that differs is drift unless its exact bytes match a committed historical canon
blob or the engine rendering reconstructed from that blob. That repository-history proof lets the
engine safely update stale canon without trusting a provenance-looking header or content
similarity. A genuine member edit — even a one-byte mutation of historical output — is still
flagged and left untouched.

**One case self-heals: bytes equal to *raw canon*.** A file hand-copied from the backbone without
going through `inject()` has current content and no provenance header, so it can never match what
the engine would write. Left as drift it is a permanent skip — every run flags it, no run fixes it,
`--check` fails forever — and it is the hardest staleness to notice, because the content is right.
The engine therefore stamps it: rewrites it with the header and records the baseline, reported as
an ordinary `updated`. This is safe in a way clobbering ordinary drift is not, since bytes equal to
canon are provably not member-authored, so nothing a human wrote is discarded.

The narrowness is the point. It applies **only** to a target with no lock entry. Once a file is
recorded, bytes equal to raw canon mean someone deliberately stripped the header — a local edit,
which keeps its drift signal. `jrmoulckers/finance`'s root `agency.toml` is the worked example: it
hashes to `281f6b5cf11d`, raw canon, against `inject()`'s `c5dc520a8bd3`.

The same boundary applies to historical recovery: only an unrecorded target can use the evidence.
The backbone checkout must contain full Git history (`fetch-depth: 0` in Actions); the engine fails
closed on a shallow checkout rather than pretending an incomplete evidence set is authoritative.
Drift warnings name every skipped target so reconciliation does not require lockfile archaeology.

`--force` is not the tool for that. It is one flag for the whole invocation — `index.mjs` parses it
once and threads it into every member, and `apply()` then applies it to every spec in each — so it
rewrites **every** drifted file in **every member the run touches**. Using it to clear one stale
copy would also discard genuine member-authored edits in repos you were not looking at. It is a
deliberate reviewer action against a known state, not a first-run cleanup.

The drift note in the PR body says so at the point of use, because that is the only text a reviewer
reads before reaching for the flag, and it appears inside a single member's PR where a run-wide
remedy looks scoped to the list beneath it.

### Auditing a member by hand: compare against `inject()`, not against canon

"Byte-identical to canon" above is shorthand, and the shorthand will mislead you if you reach for
`diff` to check it. The engine never writes canon verbatim — [`lib/provenance.mjs`](lib/provenance.mjs)
prepends a header (`<!-- synced from jrmoulckers/.github … -->`, or `#`/`/* */` by file type) and
normalizes line endings to LF first. The stored `targetSha256` is the hash of *that* output.

So the expected value for a synced file is `inject(targetPath, canonContent)`, and diffing a member
file against raw canon reports the header as a member-side addition on **every correctly-synced file
in every member**. That is a false positive per file, and it is a dangerous one, because it is small
and consistent enough to look like a real finding rather than a broken method.

It nearly cost us a wrong call. A hand audit of cartridge's `workflow.instructions.md` against raw
canon reported "68 lines missing, 1 line added". The 68 were real — a stale copy of older canon. The
"1 line added" was the engine's own provenance stamp, and the only reason the conclusion survived is
that the real signal was 68× larger than the artefact. Against a file that was merely *stale by one
line*, the same method would have reported 1 missing and 1 added and been indistinguishable from
noise.

The check that actually settles it, run from a backbone checkout:

```js
import { readFileSync } from 'node:fs';
import { inject, toLF } from './sync/lib/provenance.mjs';

const rendered = inject('.github/instructions/workflow.instructions.md',
                        readFileSync('instructions/workflow.instructions.md', 'utf8'));
const member = toLF(readFileSync('<member>/.github/instructions/workflow.instructions.md', 'utf8'));
rendered === member;   // true → will adopt;  false → drift
```

Note `toLF` on the member side too: a CRLF checkout differs from the rendered output byte for byte
while being identical to the engine, which hashes LF-normalized content. Comparing raw byte lengths
across a Windows checkout will disagree with this check and the check is the one that is right.

Vendored tokens pass their own `note`, so audit those with the same `note` the copier uses or they
will all read as drift.

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

> The engine previously rebuilt the branch from the default branch each run and pushed with
> `--force-with-lease`. That never destroyed anything — without an explicit `=<ref>:<expect>` the
> lease needs a reflog entry proving the local side observed the remote value, and a fresh shallow
> clone has none, so Git refused with `stale info`. It failed *safe*, but it failed: the
> "update the open PR in place" path could never succeed, and the failure was fatal to the run.
> Reusing the remote branch fixes both — the push succeeds *and* nothing can be clobbered.

**One member's failure no longer aborts the run.** Each member is synced inside its own
try/catch ([`lib/runner.mjs`](lib/runner.mjs)): a git or network error is reported, that member is
skipped, and the remaining members — and the profile mirror — still run. The process exits non-zero
with a summary of every failed target. The engine touches up to six separate repos over the
network, so treating the first error as fatal turned one transient failure into a total outage.

**Recovering from a bad run:** pass a fresh `--date`. The branch is `studio-sync/<date>`, so a new
date means a new branch and a new PR, leaving the previous attempt untouched for inspection.

## Authentication

Set `STUDIO_SYNC_TOKEN` to a **fine-grained** PAT with Contents + Pull requests **Read and write**
on the member repos and `jrmoulckers/jrmoulckers`, plus Contents: **Read** on the private token
source repo `jrmoulckers/studio` (needed when a member opts into `tokens`). The default
`GITHUB_TOKEN` is scoped to the backbone repo only and **cannot** operate cross-repo.

**No `workflow` scope.** The engine never writes under `.github/workflows/` — `workflows` and
`health` are native, resolved and reported but dropped before the write list, and a test asserts it.
See [`docs/sync.md`](../docs/sync.md#authentication-studio_sync_token) for why that scope in
particular is worth refusing.

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
| `test/basemerge.test.mjs` | Managed-block detection: markers quoted in prose, shown in a fenced example, or indented as a code block do not form a block; real blocks are still replaced; a canon change after adoption updates in place without duplicating markers; genuine edits are still drift. |
| `test/runner.test.mjs` | Per-member failure isolation: one member's error does not stop the others, and is reported rather than thrown; drift warnings name every exact skipped path. |
| `test/copier.test.mjs` | add / unchanged / drift / `--force` / adoption and the lockfile write rule; raw-canon stamping; exact historical-output recovery; empty-evidence and one-byte-mutation refusal; recorded targets never use first-sync recovery. |
| `test/history.test.mjs` | Full-history enforcement and committed-blob enumeration; end-to-end target enumeration recovers a member holding a prior engine rendering. |
| `test/manifest.test.mjs` | The real `studio.config.json` validates; every member is registered; every member's `framework`/`packageManager` matches its default branch; every reusable workflow a member calls is listed in its `optIn.workflows`; a member that narrows its AI layer records the reason in `notes`; an unknown name in an explicit list fails validation; `canon` matches the files on disk both ways; `tokens`/`profile` are not `optIn` kinds; native kinds are never written. |
| `test/provenance.test.mjs` | Every real write equals `inject(targetPath, canon)` and never canon verbatim — so the documented hand-audit baseline stays correct; and that check is line-ending agnostic on the member side. |
| `test/prbody.test.mjs` | An adoption-only run's PR body says its entire diff is the lockfile, and does not claim that when the run also wrote files (including via `--force`). The drift note states that `--force` is run-wide, offers the by-hand remedy first, and neither appears when the run has no drift. |
| `test/workdir.test.mjs` | `--work-dir` guards: a parent directory, a missing path and a file are all rejected; a git worktree (whose `.git` is a file) is accepted; identity resolves to `match` / `mismatch` / `unverifiable` across URL spellings and case, both failing verdicts abort, the refusal names the self-certifying lockfile, and `--allow-unverified-work-dir` overrides them without ever marking a matching checkout as overridden. |
| `test/cli-workdir.test.mjs` | The same guards **through the CLI**: every mode — apply, `--check`, `--dry-run` — exits 1 on a wrong or absent origin, a refused run leaves no file and no lockfile, the override flag lets a run through while saying what it suppressed, and a matching checkout is unaffected. Unit tests cannot see a guard that is called but not obeyed, which is how the warn-and-proceed version survived its own fix. |

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
