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
| **Native** | Community-health files, reusable workflows | GitHub inherits default health files from this `.github` repo automatically; reusable workflows are called directly with `uses: jrmoulckers/.github/.github/workflows/reusable-*.yml@<reviewed-commit-sha>`. **No sync needed — and a member must not keep its own copy** (see below). |
| **Canonical source** | `agents/`, `skills/`, `prompts/`, `instructions/`, `AGENTS.md`, `agency.toml`, `copilot-instructions.md` | Copilot does **not** auto-inherit these across repos. The sync tool materializes them as `.github/agents/`, `.github/skills/`, `.github/prompts/`, `.github/instructions/`, `.github/copilot-instructions.md`, and selected root files. Consumer copies are generated and read-only. |
| **External vendored** | `@jrm/tokens` built outputs (CSS custom properties, Tailwind preset, typed JS) | Live in a *different* private backbone repo (`jrmoulckers/studio`), registry-free. The same engine copies studio's committed `dist/` tree into opted-in members under `vendor/@jrm/tokens/`. See [Vendored tokens](#vendored-tokens-jrmtokens). |

## Flow (scheduled PR)

```mermaid
flowchart LR
  A[studio.config.json] --> B[sync workflow<br/>scheduled + manual]
  B --> C{for each member repo}
  C --> D[resolve opted-in canon]
  D --> E[verify checkout facts]
  E --> F[copy source → target paths]
  F --> G[open chore(sync) PR]
  G --> H[product repo CI runs]
```

1. **Trigger** — a scheduled workflow in this repo (e.g. weekly) plus manual `workflow_dispatch`.
2. **Read the manifest** — parse `studio.config.json`: the `canon` catalog, `sourcePaths`,
   `targetPaths`, and each member's mode and `optIn` selection. Schema validation covers `repo`,
   `mode`, mode-specific facts, `optIn`, `localAgents`, and `tokens`; agent integrity checks each
   selected roster's handoff closure, instruction integrity checks scopes, ownership, member
   profiles, precedence, immutable workflow examples, and local-agent collisions, while prompt
   integrity checks schema, parameters, runtime dependencies, references, and
   selected-prompt/available-agent closure. Agency integrity rejects mutable packages, deprecated
   packages, wildcard tools, and unreviewed active server profiles. Checkout-owning operations
   separately verify recorded/descriptive member facts (see
   [Member entries](../sync/README.md#member-entries)).
3. **Resolve opt-ins** — for every member, expand `"*"` to the full canon list, honor explicit
   arrays, and skip anything set to `false`.
4. **Verify recorded facts** — from the member checkout already acquired by a real sync, `--check`,
   or `--work-dir`, enforce its mode-specific framework/root-package-manager contract and derive
   called backbone workflows. A mismatch fails that member before reading its sync lock or applying,
   branching, or pushing; other members continue. Manifest-only `--dry-run` performs no clone and
   cannot certify these claims.
5. **Copy** — map each opted-in asset from its `sourcePaths` here to the member's `targetPaths`
   (agents → `.github/agents/`, skills → `.github/skills/`, etc.). `base` (`AGENTS.md`) and
   `runtime` (`agency.toml`) land at the member root; `copilot` lands at
   `.github/copilot-instructions.md`. These are three **independent** booleans, so an
   infrastructure member that declines the studio operating guide still receives canonical MCP
   policy and Copilot-surface orientation (see
   [ADR-0006](architecture/0006-runtime-and-copilot-canon-kinds.md)). `AGENTS.md` and
   `.github/copilot-instructions.md` are **merged**: members keep their own content and the tool
   replaces only the marked region rather than clobbering (see Drift below). The
   `studio:base` markers only count at column 0 on a line of their own, outside a fenced code
   block, so a member file may safely *document* the convention (see
   [Managed-region merge](../sync/README.md#managed-region-merge-agentsmd-githubcopilot-instructionsmd)).
   `health` and
   `workflows` are **native** (see the table above): they are resolved and reported but never
   written — health files are inherited from this `.github` repo and reusable workflows are
   called via a reviewed full 40-character commit SHA. A member
   repo must therefore **not** contain its own copy of
   either (see [Native kinds have no transport](#native-kinds-have-no-transport)).
6. **Open a PR** — commit on a `studio-sync/<date>` branch and open a PR titled
   `chore(sync): update studio canon (<date>)` with a summary of changed assets. Never push to
   the member's default branch directly. On a same-day re-run, an existing branch is reused only
   when it belongs to an open PR; its reviewer commits are preserved and the push is a plain
   fast-forward. A retained branch from a merged or closed PR is left untouched and, when another
   write is needed, replaced by a clean `studio-sync/<date>-rerun-N` branch from current default.
   The engine never force-pushes. A member whose sync fails is reported and skipped; the remaining
   members and the profile mirror still run, and the process exits non-zero.
7. **Let product CI validate** — the member's own checks run on the sync PR; a human (or the
   member's agents) reviews and merges.

## Canonical agents and local overlays

The supported model separates reusable role behavior from product facts:

1. `agents/*.agent.md` in this backbone owns generic persona, capabilities, workflow, and role
   boundaries. The agent-integrity validator checks schema, roster parity, and declared references
   before the sync engine can plan or copy them.
2. The sync engine materializes opted-in roles as `.github/agents/*.agent.md`. Those files are
   generated artifacts with provenance and lockfile drift detection; do not edit them in a member.
3. Canonical `skills/` and `instructions/` materialize under `.github/skills/` and
   `.github/instructions/`. They remain upstream-owned, read-only files in consumers; reusable
   changes return to this backbone and product-specific facts stay in local overlays.
4. A product's root `AGENTS.md` content outside the managed block, plus its more-specific scoped
   instructions, owns concise stack, path, command, domain, schema-extension, and product-risk
   overlays. Those local authorities override shared defaults for their scope while mandatory human
   gates remain the floor.
5. Product-only roles may remain additional local agent files. Their names are declared through
   `members[].localAgents`, and they may use a locally documented schema instead of the canonical
   schema. A member may also declare a
   same-slug local replacement in `members[].localAgents` only when an explicit `optIn.agents` list
   omits that canonical role; selecting both is invalid because discovery would be ambiguous.

When guidance intersects, mandatory human gates remain the floor; then root/local `AGENTS.md` and
more-specific scoped instructions override shared defaults. Choose the more restrictive rule when
two applicable safety rules conflict. The sync engine merges the root `AGENTS.md` managed block, but
it does **not** merge individual agent, skill, prompt, or instruction files. Move reusable behavior
upstream and keep product facts in supported overlay surfaces.

**Current discovery limitation:** Copilot custom agents are discovered from repository-local
`.github/agents/*.agent.md` files. Owner-level custom-agent inheritance from this backbone has not
been verified as an official runtime capability. Therefore consumer materializations cannot safely
be removed. If a member currently carries authored copies of canonical roles, reduce/move their
product-specific content into overlays and let sync own the materialized files; do not delete the
generated copies until official inheritance is verified end to end. A declared local replacement
remains authored and is not a generated copy.

## Canonical prompt runtime

Canonical prompt files are executable workflow specifications, so manifest loading validates them
before planning or copying. The zero-dependency prompt-integrity pass enforces exact roster parity,
unique frontmatter names, typed parameter defaults and bounds, interpolation closure, known
canonical-agent references, declared Copilot App/CLI built-ins, supported GitHub CLI check fields,
and member dependency closure.

The `parameters` structure and `{{ parameter }}` interpolation are Copilot App/CLI contracts rather
than portable Markdown features. `task` and `code-review`, agent polling through `read_agent` /
`list_agents`, and SQL todos are also runtime built-ins, not custom-agent slugs. A runtime without a
required capability must fail before dispatch or mutation. Repository roles remain subject to the
consumer's root/scoped `AGENTS.md` and `.github/instructions/` overlay; a materialized agent file
proves discovery, not applicability or mutation authority.

Prompt copies remain materialized under current discovery. After a canonical prompt change merges,
preview affected selections with `node sync/index.mjs --dry-run --members <owner/repo>`, then use the
normal authenticated scheduled/manual sync to open consumer PRs. Never hand-edit the generated
consumer copies.

## The member registry

`members[]` in [`studio.config.json`](../studio.config.json) is the registry. Validation covers
`repo` (must match `owner/name`), `mode` (one of `application`, `infrastructure`, or
`pre-bootstrap`), mode-specific framework/package-manager facts, `optIn` (keys against `KINDS`,
names against the canon catalog), `localAgents` (local handoff targets that cannot overlap selected
canon), and `tokens` (shape).
The full per-field table is in
[`sync/README.md`](../sync/README.md#member-entries).

**Mode and facts verify repository shape but never decide a write.** `application` requires and
strictly matches both framework and root package-manager evidence. `infrastructure` permits either
fact to be absent only when checkout inspection also finds it absent; every detected or declared
fact must match. `pre-bootstrap` requires both facts to be absent and fails actionably as soon as
either supported signal appears, forcing a mode/fact upgrade before sync proceeds. Omitted legacy
modes default to `application`; canonical entries are explicit.

Real syncs, `--check`, and `--work-dir` derive root package managers from root lockfiles, derive
supported frameworks from repository signatures, and scan `.github/workflows/**/*.yml|yaml` for
calls to this backbone. Each actual use records workflow name, full commit SHA, file, and line.
Undeclared or non-SHA uses fail before any member write. Declared availability that is not currently
called is reported deterministically but remains valid for intentional future adoption. Repository
identity checks remain in force. This is a shape-aware contract, not an `allowUnverified` path or
fallback.

Manifest-only `--dry-run` remains network-free and prints claims without certifying them. The
offline test suite uses synthetic checkouts rather than hand-typed member expected values, avoiding
the failure mode where one initial mistake is copied into both registry and test. Two practices
follow:

- **Verify member facts against the repo's default branch**, never an onboarding PR. `cartridge`
  was registered as a pnpm Next.js app from its PR #1, which was closed without merging; `main` is
  an npm Svelte PWA.
- **Use a real sync, `--check`, or verified `--work-dir` to certify checkout-derived facts.**
  Manifest-only dry-run validates the manifest and plan only.

`optIn` **is** validated, but only for names — not for intent. `"*"` means "take all canon of this
kind, re-evaluated every run", so on a member that deliberately omits canon it re-adds the omitted
files as an `added:` block in the next PR. A considered omission is indistinguishable from drift.
**A curated member should use explicit arrays** — but the bar for "curated" is a decision someone
made and can defend, not a subset that happens to read as coherent. `cartridge` briefly carried
explicit lists on exactly that mistake: its 11-of-19 agent set turned out to be a hand-typed
first-pass guess in a scaffold script, reasoned from "client-side PWA" in the same commit that added
a Cloudflare Worker handling OAuth. Deliberate in mechanism, not in substance. `"*"` is the default
because adding canon is reversible and a frozen list is not.
See [`sync/README.md`](../sync/README.md#-vs-an-explicit-list).

### Curated instruction profiles

Instructions are curated by repository authority model rather than wildcarded:

| Members | Selected instructions |
| --- | --- |
| Six application members | `agents`, `docs`, `skills`, `tokens`, `workflow` |
| `jrmoulckers/studio` | `agents`, `docs`, `skills`, `tokens`, `workflow` |
| `jrmoulckers/homelab` | `agents`, `infrastructure-operations` |
| `jrmoulckers/windows` | `agents`, `docs`, `infrastructure-operations`, `skills` |

`infrastructure-operations` is a routing and safety contract, not host authority. It establishes
repo-first and host-first modes, explicit confirmation, last-known-good/rollback/second-access-path
requirements, live-to-repo reconciliation, drift checks, and operations logging. The member's
root/scoped policy and declared local operators decide tools and live authority; generic canonical
agents receive none.

Homelab intentionally excludes generic docs, skills, tokens, and product workflow instructions so
its exact infrastructure facts, confirmation protocol, and flat local skill/agent schemas remain
authoritative. Its `agents` instruction is retained only because that instruction explicitly exempts
declared `localAgents` from the canonical schema and preserves slug-collision guards. Windows keeps
agent/skill/docs ownership rules alongside infrastructure safety, but excludes token and product
fleet workflow policy. Studio remains a token author, not a live-Homelab operator.

See [ADR-0004](architecture/0004-curated-instruction-profiles.md).

## Native kinds have no transport

`health` and `workflows` are the two `NATIVE_KINDS` (`sync/lib/manifest.mjs`). The engine resolves
and reports them so the plan reflects what a member has opted into, but `assets.mjs` drops them
before the write list — **no file is ever written for a native kind, on any run, forever.**

The rule that follows is not obvious from the opt-in table, so state it plainly:

> **A member repo must not contain its own copy of a native asset.** Opting in to `health` records
> reliance. `optIn.workflows` records workflows available for current or planned use; checkout
> inspection separately records actual calls. Neither means *"the engine will install these"*.
> A local copy is worse than having nothing, because it wins over the inherited version and nothing
> will ever update it.

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

### Hand-seeded canon is verified byte for byte on the first sync

The mirror-image trap applies to the **managed** kinds. A member seeded by hand before onboarding
carries copies of `agents/`, `skills/`, `prompts/` and `instructions/` files that the engine *does*
write — and on the first run each one takes one of these paths:

| The member's copy | First run |
| --- | --- |
| byte-identical to what the engine would write | **adopted** — baselined in the lockfile, no diff, silent thereafter |
| byte-identical to **raw canon** (no provenance header) | **stamped** — rewritten with the header, then silent |
| byte-identical to committed historical canon or its engine rendering | **recovered** — safely updated and baselined |
| differs in any other way | **drift** — flagged, left untouched, and it stays that way |

The final row does not self-heal. With no lock entry and no exact repository-history match, the
engine cannot tell a stale hand-copy from a deliberate local edit, so it refuses to clobber.
Historical recovery never trusts a provenance-looking header or similarity: it hashes committed
source blobs and their deterministic renderings, and only exact equality authorizes an update.

The second row exists because it would otherwise be the worst instance of the final row. A file
hand-copied from canon *without* going through `inject()` has current content and a missing header,
so it never matches what the engine would write and every run flags it while no run fixes it —
and it is the hardest staleness to spot by eye, because the content is right.
`jrmoulckers/finance`'s root `agency.toml` was exactly this. Rewriting it is safe in a way ordinary
drift is not: bytes equal to canon are provably not member-authored, so the write discards no human
work and changes nothing but the header. The narrowness matters — it applies **only** to targets
with no lock entry. Once a file is recorded, bytes equal to raw canon mean someone deliberately
stripped the header, which is a local edit and keeps its drift signal.

The dangerous case is a copy of *older* canon that still carries its provenance stamp: it looks
synced, and only a byte comparison reveals it isn't. The engine now recovers this case only when
full backbone history proves the bytes are prior canon output. A one-byte member mutation remains
drift, as does any recorded target that diverges from its lock baseline.

**"Byte-identical to canon" is shorthand, and taking it literally will mislead an audit.** The
engine writes canon *plus* a provenance header, LF-normalized; the expected value is
`inject(targetPath, canon)`, not canon. Diffing a member file against raw canon reports that header
as a member-side addition on every correctly-synced file — a per-file false positive small enough to
pass for a real finding. The cartridge audit above produced "68 lines missing, 1 line added"; the 68
were real and the 1 was the engine's own stamp, and only the size difference kept the conclusion
sound. See [`sync/README.md`](../sync/README.md#auditing-a-member-by-hand-compare-against-inject-not-against-canon)
for the check that settles it.

**Reconcile unproven drift in the member repo:** refresh the file to match what the engine would
write or delete it (the engine will add it). **Do not reach for `--force`** — `--force` overwrites
every drifted file in **every member the run touches**, so using it to fix one stale copy would also
silently discard genuine member-authored edits in other repos. It is a deliberate reviewer action
for a known-good state, not a first-run tool. Drift warnings name each exact skipped path.

## CLI usage

The engine is a zero-dependency Node ESM CLI (Node ≥ 24). Full reference:
[`sync/README.md`](../sync/README.md).

```bash
node sync/index.mjs --dry-run                         # plan every member; no writes/git/network
node sync/index.mjs --members jrmoulckers/jrm-recipes # real sync of one member (opens a PR)
node sync/index.mjs --check                           # CI gate: non-zero if any member is stale
```

Flags: `--dry-run`, `--members <a,b>`, `--check`, `--force` (overwrite drift), `--work-dir
<path>` (apply against a local checkout; no clone/push/PR), `--allow-unverified-work-dir`,
`--studio-dir <path>` (local `jrmoulckers/studio` checkout to vendor `@jrm/tokens` from, instead
of cloning), `--date <YYYY-MM-DD>`.

Five flag behaviors that are easy to trip over:

- **`--work-dir` requires exactly one member.** The path is a single member's checkout, so the
  run must resolve to exactly one member — pair it with `--members <owner/name>`. Anything else
  (no filter, or a filter matching two members) fails with
  `--work-dir requires exactly one member (use --members <owner/name>).`
- **`--work-dir` must be the member checkout itself, not a directory containing it.** The path is
  now required to be a git checkout, and the run aborts if it is not. Before that check existed,
  pointing at a parent directory made every target look absent, so the run reported them all as
  `added` and exited 0 — indistinguishable from a legitimate first-sync plan. That is the failure
  worth guarding: drift is reported by the *absence* of a warning, so a run that sees no files at
  all emits the most reassuring output the tool can produce.
- **`--work-dir` must also be provably *that* member, and the run refuses when it is not.** The
  checkout's `origin` is compared to the member in the plan. Three outcomes: it matches and the run
  proceeds; it names a different repo; or there is no origin at all. **The last two both abort with
  exit 1** — including under `--dry-run` and `--check`.

  Warning and proceeding was the earlier behavior and it was not enough. An observed run against an
  unrelated local repo rewrote its `AGENTS.md` from 3 lines to 145 and left a lockfile behind, and
  the remote-less variant did it in total silence, because "no origin to compare" was treated as
  "compared, fine". *Could not verify* is not *verified*.

  The lockfile is why this aborts on `--check` too: once written into the wrong directory it makes
  the next `--check` there report `up to date`, so the mistake stops being visible. The bytes are
  recoverable with `git checkout`; the certification is what persists.

  `--allow-unverified-work-dir` is the escape hatch for a genuine fork, mirror or local-only clone.
  It is scoped to that one check and prints what it suppressed.
- **`--members` disables the profile mirror.** See [Profile README](#profile-readme-user-account-caveat).
- **An offline rehearsal is only as current as the checkouts it reads.** Canon is loaded from the
  directory holding `sync/` (`REPO_ROOT` is derived from the script's own path), and `--studio-dir`
  reads tokens from whatever that checkout contains. Neither is fetched, and neither is compared to
  its remote. A CI run is safe because the workflow checks the repo out fresh; a run from a local
  worktree reports on the tree you have, including uncommitted edits and commits you have not
  pulled.

  This matters because rehearsal output is cited as evidence — several claims in this document are
  backed by `--work-dir` runs. Re-running the command refreshes the traversal and nothing about the
  sources it names, so a stale rehearsal produces a genuinely derived, genuinely new, genuinely
  wrong result that looks nothing like a quote. Run `git fetch && git status` in both checkouts
  first, and state which revisions a reported figure came from — see the dated cartridge numbers
  under [The first run](#the-first-run).
- **`--date <YYYY-MM-DD>` starts a clean attempt.** The first sync branch is
  `studio-sync/<date>`, so a fresh date means a fresh branch and a fresh PR. That is the recovery
  path after a bad run: the previous attempt is left intact for inspection rather than amended.
  Re-running with the *same* date updates an open PR by fast-forward. If that PR is already closed
  or merged but its branch remains, the next write uses `studio-sync/<date>-rerun-N` from current
  default instead of stacking on stale history.

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

**Vendored tokens can be adoption rather than addition.** "The engine has never run" is not the
same claim as "the files are not there", and conflating them makes the first-run split predictable
in the wrong direction. `cartridge` hand-vendored all 16 `vendor/@jrm/tokens/` files in its own
`ceb394e` long before any sync, and they are byte-identical to what the engine would write — so
they are *baselined*, not *added*. Measured with `--work-dir --studio-dir` against
`cartridge@2536220`, and unchanged at `973c759` (2026-08-05):

```
added: 15   (canon 15 · tokens 0)
baselined:  53   (canon 37 · tokens 16)      Σ 68, drift 0
```

Predict a first run by *reading the member*, not by assuming an empty target: any hand-seeded file
that already matches canon lands in the baselined column whatever kind it belongs to.

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
  is expected: merge it, and subsequent runs go quiet. Confirmed on disk, not inferred — a
  `--work-dir` rehearsal against a real `cartridge` clone with the lockfile deleted reported
  `baselined: 68` with `git status --porcelain` showing exactly one modified file. Because that
  reads badly (68 paths listed above a one-file diff), the PR body now states outright that no
  file contents changed when a run is adoption-only.
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
| Contents | Read and write | all 9 member repos + `jrmoulckers/jrmoulckers` |
| Pull requests | Read and write | same set |

Contents write covers branch pushes; Pull requests write covers opening and reusing sync PRs.
`jrmoulckers/studio` is one of the nine members and the private token source, so its read needed for
vendoring is already included in the member Contents grant. Nothing else is exercised.

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
- Automatic pruning: assets a member later opts out of are not deleted from the member repo. Follow
  the hash-verified cleanup contract in the sync README; never infer that a deselected path is safe
  to delete.
- Publishing `@jrm` packages to any registry — the studio is registry-free; `@jrm/tokens` is
  vendored (above), and the `@jrm` name is only ever an identifier, never resolved from a registry.
- Producing studio's committed `packages/tokens/dist/` — that build/commit is `jrmoulckers/studio`'s
  own concern; this engine only copies the result.
- The consumer-side wiring in members (e.g. finance repointing its CSS `@import` at the vendored
  path) — done in each product repo, not here.
