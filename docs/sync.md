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
| **Canonical source** | `agents/`, `skills/`, `prompts/`, `instructions/`, `AGENTS.md`, `agency.toml`, `copilot-instructions.md`, `.gitattributes` | Copilot does **not** auto-inherit these across repos. The sync tool materializes them as `.github/agents/`, `.github/skills/`, `.github/prompts/`, `.github/instructions/`, `.github/copilot-instructions.md`, and selected root files. Consumer copies are generated and read-only — **except the managed-region files (`AGENTS.md`, `.github/copilot-instructions.md` and `.gitattributes`; `sync/lib/copier.mjs` is authoritative), which are read-only *between* the `studio:base` markers and member-owned outside them.** |
| **External vendored** | `@jrm/tokens` built outputs (CSS custom properties, Tailwind preset, typed JS) | Live in a *different* backbone repo (`jrmoulckers/studio`), registry-free. The same engine copies studio's committed `dist/` tree into opted-in members under `vendor/@jrm/tokens/`. See [Vendored tokens](#vendored-tokens-jrmtokens). |

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
   (agents → `.github/agents/`, skills → `.github/skills/`, etc.). `base` (`AGENTS.md`),
   `runtime` (`agency.toml`) and `attributes` (`.gitattributes`) land at the member root; `copilot`
   lands at `.github/copilot-instructions.md`. These are four **independent** booleans, so an
   infrastructure member that declines the studio operating guide still receives canonical MCP
   policy, Copilot-surface orientation, and LF normalization (see
   [ADR-0006](architecture/0006-runtime-and-copilot-canon-kinds.md) and
   [ADR-0009](architecture/0009-canonical-line-ending-normalization.md)). `AGENTS.md`,
   `.github/copilot-instructions.md` and `.gitattributes` are **merged**: members keep their own
   content and the tool
   replaces only the marked region rather than clobbering (see Drift below). The
   `studio:base` markers only count at column 0 on a line of their own, outside a fenced code
   block, so a member file may safely *document* the convention. Marker and provenance comment
   syntax follows the target file — HTML comments in Markdown, `#` lines in `.gitattributes`, where
   an HTML comment would be read as a pattern rule — and so does **placement**: canon is appended in
   Markdown but *prepended* in `.gitattributes`, because git resolves attributes by the last
   matching pattern and canon's `*` matches everything, so an appended region would silently
   outrank every member rule (see
   [ADR-0011](architecture/0011-managed-region-placement.md) and
   [Managed-region merge](../sync/README.md#managed-region-merge-agentsmd-githubcopilot-instructionsmd-gitattributes)).
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

**Absence from `members[]` has two meanings, and the manifest distinguishes them.** A repository the
owner has deliberately decided not to govern is recorded in the top-level `excluded` array with a
mandatory `reason`, so an org sweep that finds it ungoverned reads a closed decision instead of
drift. The engine never reads that list — it skips nothing and suppresses no report, because a
repository is synced for being in `members` and untouched for not being there. Validation requires
the reason and rejects any repository listed in both. `jrmoulckers/game-library` is the current
entry. See [ADR-0012](architecture/0012-recorded-exclusions.md).

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

> **A *deliberate* health-file override is a different case, and is allowed.** The harm above is
> specific to a **verbatim** copy: it inherits nothing new while adding nothing of its own, so it is
> pure loss. A member that genuinely needs product-specific security content may keep its own file
> — `workflow.instructions.md` permits this explicitly. `jrmoulckers/jrm-recipes` and
> `jrmoulckers/finance` both do, carrying threat models, data-processing detail, and disclosure
> terms that could not live in canon.
>
> The cost is unchanged and must be accepted knowingly: **that file is now a fork with no update
> path**, and canon edits will never reach it. Such a member owns re-reading canon when it changes.
> Before deleting a local health file as cleanup, check whether it is a verbatim copy (delete it) or
> a deliberate superset (leave it). See
> [ADR-0010](architecture/0010-selectable-support-postures.md), where a canon change left two
> deliberate overrides quoting a policy that no longer said what they claimed.

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
every drifted file in **every member the run names**, so using it to fix one stale copy would also
silently discard genuine member-authored edits elsewhere in those repos. It requires `--members` for
that reason, which bounds the damage without making it safe. It is a deliberate reviewer action
for a known-good state, not a first-run tool. Drift warnings name each exact skipped path.

## CLI usage

The engine is a zero-dependency Node ESM CLI (Node ≥ 24). Full reference:
[`sync/README.md`](../sync/README.md).

```bash
node sync/index.mjs --dry-run                         # plan every member; no writes/git/network
node sync/index.mjs --members jrmoulckers/jrm-recipes # real sync of one member (opens a PR)
node sync/index.mjs --check                           # CI gate: non-zero if any member is stale
```

Flags: `--dry-run`, `--members <a,b>`, `--check`, `--force` (overwrite drift; requires
`--members`), `--work-dir <path>` (apply against a local checkout; no clone/push/PR),
`--allow-unverified-work-dir`, `--studio-dir <path>` (local `jrmoulckers/studio` checkout to
vendor `@jrm/tokens` from, instead of cloning), `--date <YYYY-MM-DD>`.

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
(`synced from jrmoulckers/.github — canonical source; do not edit here`), rendered in whatever
comment syntax the target's own parser accepts: an HTML comment after any YAML frontmatter (or atop
plain Markdown), a leading `#` line for `.toml`/`.yml`/`.gitattributes`, a `/* … */` block for
`.css`/`.js`/`.ts`/`.kt`/`.swift`, and nothing at all for `.json`/`.map`, where any comment would
corrupt the file.

**That sentence is illustrative, not exhaustive — `sync/lib/provenance.mjs` is the authority.** It
carries cases the prose elides, including basename matches for extensionless dotfiles and the full
set of script and native extensions. Anyone writing a member-side check must mirror that file by
reading it, never by transcribing this paragraph.

**Do not scan a fixed window of leading lines for the stamp.** The paragraph above places it *after*
any YAML frontmatter, so on agent and skill files it sits well down the file, and a check that reads
the first N lines silently classifies every one of them as member-owned. `studio` shipped exactly
this — an eight-line window that saw 24 of 59 locked paths and none of the 22 under
`.github/agents/`, while reporting OK. Widening the window is the wrong repair: it swaps one
arbitrary boundary for another and leaves the real error, which is that **recognising the stamp
proves a file is canon while failing to recognise it proves nothing**. Enumerate from
`.studio-sync.lock.json` and keep the stamp as a signal that can only add.

The reason is the failure direction. An incomplete marker table fails **silently in the safe
direction**: an unlisted target simply never matches, so a correctly stamped file reports as
missing its marker — indistinguishable from real drift. An abbreviated table therefore cannot
announce that it is abbreviated; it surfaces later as an unexplained red check. `.gitignore` is the
sharp case, because there the wrong syntax *changes behaviour* rather than failing. Assert the
absent cases too — `.json` and `.map` are the ones people skip, and "no marker" stops looking like
behaviour right up until a fifth branch quietly gives JSON a leading comment.

This generalizes past this one table. When guidance restates backbone logic, **name the
authoritative file by path** so the reader can check rather than infer. A summary that reads as
complete is exactly the summary whose completeness the recipient cannot verify. Note that the
duplication is the deeper problem: prose restating a machine-readable table has no mechanism to
notice when the source grows an entry, so it is the wrong-unit pattern one level up — the table
varies over "whatever `provenance.mjs` currently defines," and prose cannot be keyed to that.
Marking the restatement illustrative and pointing at the source is the only stable fix.

**The rule has a boundary: it holds while reading the authority is cheap.** It works here because
the engine is small, local, and readable, so checking costs a minute. Where an authority is large,
remote, or itself derived, "go read it" stops being cheap and an abbreviated summary becomes the
rational choice — at which point the obligation shifts to marking the summary as lossy and pinning
what it was derived from (a version, a commit, a date), so a reader knows what they are trusting and
when it went stale. Apply the rule where the check is affordable; do not apply it where the cost of
checking exceeds the silent-failure risk it prevents.

The fallback is HTML, which makes an unclassified *source* extension a silent hazard: the file is
still written, still hashed, and still drift-free, but it carries `<!-- … -->` and no longer
compiles — a failure that surfaces only in the member's build. Classify new source extensions in
`sync/lib/provenance.mjs` when a distribution grows them.

### Members must exclude canon from their formatters

The normative rule now lives in `instructions/canon-formatting.instructions.md`, which is
distributed to every member through the `instructions` kind, so a member can read it in its own
tree rather than following a citation into this document. This document is not a canon kind and is
synced to nobody; the heading is kept here because existing citations resolve by its name.

### `git add --renormalize` cannot repair a file with doubled CRs

The section above covers a **stale worktree** whose index is already correct. This is the opposite
case: the committed blob itself is wrong, and renormalization still will not fix it.

Git's binary detection is not only about NUL bytes, and the threshold is far lower than it sounds:
a file is classified `-text` when its CR count **differs at all** from its CRLF count — `cr != crlf`
in git's own `convert.c`. A **single** carriage return outside a CRLF pair is enough. Doubled
`\r\r\n` terminators, which is what a CRLF-writing tool produces against content that already ended
in CRLF, trip it immediately. A `-text` file is exempt from `eol=lf`,
and `git add --renormalize` skips it. **The corruption blocks its own repair**, so it survives the
remedy, reports success, and stays invisible in a rendered diff.

There is no margin here and no recoverable middle state: the file does not accumulate stray CRs and
degrade gradually, it flips on the first one. Pinned by measurement in
[`sync/test/gitattributes.test.mjs`](../sync/test/gitattributes.test.mjs), because an earlier
version of this paragraph said "CR count exceeds its CRLF pairs", which wrongly implies a few stray
CRs are survivable.

All thirteen of this repo's community-health files were in exactly that state: canon's own LF rule
was inert for the files GitHub serves org-wide.

```bash
# `i/-text` alone is NOT the signal — every tracked image, font and icon is legitimately
# classified binary. The discriminator is the conjunction: classified binary AND no NUL byte.
git ls-files --eol | grep 'i/-text' | awk '{print $4}' | while read -r f; do
  git show ":$f" | grep -qU $'\0' || echo "CORRUPT: $f"
done

# repair: strip the stray CRs and commit. renormalize alone will not do it.
```

Running the bare `grep 'i/-text'` against `jrmoulckers/jrm-recipes` returns **60 rows and not one
real defect** — 34 `.png`, 21 `.webp`, 4 `.woff2`, 1 `.ico`, every one with `nul > 0`. A genuine
asset is `-text` *because* it contains NUL; this corruption is `-text` despite containing none.
Canon's own case measured `CR=299, LF=171, NUL=0`.

`git check-attr` cannot substitute for the NUL test, and it is worth knowing why, because it looks
like the more principled choice. Under canon's `* text=auto`, an undeclared asset resolves to
`text: auto` — **the same answer a doubled-CR text file gets.** Only an explicit member `binary`
rule yields `unset`. `check-attr` reports policy; only the bytes report what the file is.

Telling the two apart: if `git diff` is clean and the formatter fails, it is the stale worktree
above. If a tracked file is `i/-text` **with no NUL byte**, it is this — and the fix must be
committed.

`sync/test/gitattributes.test.mjs` asserts no tracked file here is classified `-text` and pins the
doubled-CR mechanism behind that assertion. Run the check above **before** concluding that
renormalization finished the job: a clean `format:check` on Linux CI can coexist with files that
were never normalized at all.

That guard protects *this* repository only — it inherits its population from the repo it runs in,
which is the limitation recorded above for coverage claims generally. A member that receives canon's
`.gitattributes` gains the rule but not the check, and the rule is precisely what goes inert if the
member's own blobs are already corrupt. `studio` built its own after canon's thirteen files were
repaired, keyed to its generated `packages/tokens/dist/**`.

**There is no correct two-line form, and the one this section used to recommend was refuted by the
three paragraphs above it.** It read `git ls-files --eol | grep 'i/-text'`, commented "must be
empty, or every hit is exempt via `check-attr`". Every clause of that is wrong here: `i/-text` alone
is not the signal (L625), the bare grep returns 60 rows and no defect on `jrm-recipes` (L634), and
`check-attr` cannot substitute for the NUL test (L639). Measured across all three attribute states
on a fixture holding one real PNG and one doubled-CR Markdown file:

| member's `.gitattributes` | `check-attr text` PNG / corrupt | what `ls-files --eol` shows |
| --- | --- | --- |
| none | `unspecified` / `unspecified` | both `i/-text attr/` |
| `*.png binary` | `unset` / `unspecified` | PNG gains `attr/-text`; corrupt does not |
| canon's `* text=auto eol=lf` | `auto` / `auto` | both `attr/text=auto eol=lf` |

So an exemption keyed to `unset` exempts nothing until the member has *declared* its binaries, which
is exactly what an incompletely-attributed member has not done; and under canon's own rule the two
files are **indistinguishable in every column the grep can see**. Where a declaration does exist,
the discrimination has moved to the `attr/` column, which a filter on `i/` cannot reach. The
discriminator is a conjunction of a classification and a content test, and no single filter
expression can express it.

The portable core is therefore a script, and its shape matters more than its filter: **enumerate,
exempt explicitly, fail closed.** A grep fails *open* — a newly added binary produces noise, and
noise is skimmed rather than acted on, so the check quietly trains dismissal while continuing to
pass. An allowlist fails *closed* — a newly added binary breaks the build until a human puts it on
the list.

**This section previously held up `studio`'s allowlist as the exemplar, and `studio` has since
deleted it.** The recommended line was `const ALLOWED_BINARY = new Set()`, annotated *"deliberately
empty. An entry here is a decision, not a default."* Confirmed absent at
`jrmoulckers/studio@37e1271`, blob `6478b157` of `scripts/validate-text-classification.mjs`: the set
is gone and the classification is computed from the bytes. Two lessons, and the second is the one
worth carrying.

**An exemption list that stays empty is evidence the question was empirical all along.** The set was
not disciplined, it was unused — nothing was ever exempted because no case ever required a human
decision, and a decision point that never has to decide is a computation waiting to be written. So
the earlier rule *allowlist by explicit declaration, never by inference* is not repealed; it is
bounded. It governs which **kind** of list to keep once you need one, and this governs whether you
need one: **compute the question the bytes can answer, and reserve the declared list for the
question they cannot.** Here that split is exact — *is this file binary* is answerable from the
presence of a NUL byte, whereas *does canon's provenance comment survive in this format* is a
property of the format's conventions and must be declared.

**And a guard inherits its population from the repository it runs in, so it can be green for
free.** That allowlist's pass was vacuous: the conjunction can only fire on a file classified
binary, and `studio` tracks none, so no input could reach the exemption branch and the guard scored
perfectly against an empty set. This is the *control that cannot fire* defect relocated from the
control to the **subject** population, which is harder to see because nothing about the guard looks
untested — it runs, it passes, it is wired into CI. Have such a check report how many files it
classified, so a green with a population of zero is distinguishable from a green with something in
it, and pair it with a fixture supplying the inputs the repository does not.

**Report the population at the narrowest branch the check discriminates on, not the corpus it
walked** — the count remedy above is satisfiable by the wrong number, and was. Run against the guard
it was derived from, that guard prints `208 tracked file(s)` and passes; the population that actually
reaches the discriminating branch is **0**, because the repository declares no `-text` path at all.
A member obeying the rule to the letter therefore prints a large, entirely true number that carries
no information about the vacuity. The size is actively anti-diagnostic: `208` reads as thorough
coverage at exactly the moment nothing was covered. An uncounted population at least invites *how
many?*; a counted one answers it with the wrong denominator and closes the question.

**And a total is not a distribution.** The failure above reports the wrong population; this one
reports the right population as a sum, which can be consistent with a claim whose shape it refutes.
A member argued that a sync lock's git history already supplies the append-only record of past
renderings that recovery would need, and offered `59 paths, 74 distinct target hashes` across four
revisions. All three figures replicate exactly. The distribution does not survive them: **47 of the
59 paths have exactly one recorded rendering**, the depth is carried entirely by 12 paths, and the
mean of 1.25 describes no path in the repository. For 47 paths that history holds precisely the
single datum the lock's tip already held.

The aggravation is that the flatness concentrates where the argument needed depth. The two
managed-region files — where canon text and local text share a file, and so where *were these bytes
ever ours?* is hardest — have one recorded rendering each, and no entry at all in the three earlier
revisions. They were introduced at the tip and **failed to correspond on the revision that recorded
them**, so there is no revision at which they ever matched. A structural explanation was offered for
that mismatch, and a structural cause would have shown across the series; a one-revision population
cannot distinguish *must mismatch* from *did mismatch, once*.

So report the distribution at the level the argument depends on, not the total above it. The general
form: an aggregate is evidence for a claim about aggregates. A claim about *what is available per
path* is answered only by the per-path counts, and a sum is comfortable precisely because it cannot
report a hole.

**And where the population cannot occur at all, the remedy is not to measure it.** Across the fleet
every `-text` file is NUL-bearing, so no member's real corpus can reach the detection branch — no
count taken anywhere would ever have been non-zero. What closed this was constructing the population
rather than reporting on it: a temp repository with fixtures reaching all three buckets, each
asserting its own capability first. That pairs with the rendered-output pin as the same instrument
facing opposite directions — **a pin proves the code still does what it did; a constructed fixture
proves it does anything at all.**

Use the conjunction above as the body, an explicit allowlist as the only exemption **for the
declarative half**, and a non-zero exit on anything unlisted. The bare grep survives as a
**candidate list** — a useful first look, and not a check, because it cannot be green.

Members with generated or vendored output should run that in CI rather than re-deriving a bespoke
classifier; the mechanism is git's, not the repository's, so the check does not need to be.

### While a sync PR is blocked, check its position rather than its contents

**A green check on one repository is not evidence that a billing block has lifted on another.**
Billing is enforced at the *account*, and canon previously explained this by saying public repos get
free Actions minutes and are never subject to the block — so their greens were an artifact of
immunity. **That rationale is false and was falsified by measurement:** `jrmoulckers/studio` is
public and was refused outright on `2026-08-10T22:14:21Z`, nine of nine jobs, standard runners only.

The conclusion survives on a different and stronger mechanism: **the refusal does not lift uniformly
across the account.** Studio was green again by 23:47Z while `jrmoulckers/homelab` was still being
refused at 06:15Z the next morning. So a sibling's green says nothing about a repo that has not
itself been re-run — not because the sibling was immune, but because it left the condition on its own
schedule. Reading one repo's green as an account-wide all-clear still picks a unit that contains the
real one, and it still fails in the reassuring direction; only the reason has changed.

This matters for what you do next. Under the old rationale the remedy was to check visibility and
discount public repos. Under the correct one, visibility discounts nothing — **only the repository's
own most recent run is evidence about that repository**:

```sh
gh api "repos/jrmoulckers/<name>/actions/runs?per_page=1" --jq '.workflow_runs[].conclusion'
```

Visibility is not a property to memorize here, and the enumeration this section used to carry was
wrong in both directions at once. It labelled the public repos **`(immune, useless as evidence)`** —
preserving, in the shorthand, the very rationale the paragraphs above falsify, and attaching it to
`studio`, the repository whose refusal did the falsifying. The two claims are not equivalent:
*useless as evidence* is true of every repository other than the one you are asking about, and that
is the point; *immune* is the discarded mechanism. It also listed 8 of 12, omitting `jrm-recipes`
and `engineering` as public and `cartridge` and `product` as private — both of the missing private
repos being blocked at the time the list was read, so the omission dropped live instances of the
condition this section teaches you to find.

The list is not corrected here, because correcting it re-arms the same decay with a fresh timer.
Visibility is one call, so derive it:

```sh
gh repo view "jrmoulckers/<name>" --json visibility --jq .visibility
```

Note that **canon itself is public**, so this repository's own unbroken green CI carries no
information about the account either — the party most likely to declare the all-clear is the one
with the least evidence for it. Confirm against a *private* member: a live run, not a sibling's
history. The block's signature is unmistakable when you look at the right repo — jobs with
`steps: 0`, downstream jobs `skipped`, and an annotation naming payments or the spending limit.

**Generalizing the shape, because it will recur wherever this document corrects itself:** prose and
the summaries of that prose are two surfaces, and a correction reaches the one it is written in. A
summary is derived from its source, which is precisely why it reads as incapable of disagreeing with
it — and why nobody re-checks it. Once written it is an independent artifact that does not update
when the source does, which is the duplicated-predicate problem transposed into prose, with the same
remedy: point the shorthand at the argument instead of restating its reason.

The stranded part is characteristically the **reason**, not the verdict. A correction usually
replaces a mechanism while the conclusion stands — *useless as evidence* survived, *immune* did not
— so the old and new readings keep agreeing wherever only the conclusion appears, and diverge solely
where the reason was compressed in. That is why the failure is quiet, and it is worse than quiet:
the summary is the skimmed surface, so the discarded rationale is the version most readers actually
take away.

### A failed lookup must not be spelled like an empty result

`foreignCommits` reported reviewer commits preserved on a reused sync branch. Its `--unshallow` fetch
is a network call, so failure is ordinary rather than exceptional, and it returned `[]` on failure.
`pr.mjs` warns only `if (base.foreign.length)`. So a failed lookup asserted **no reviewer work is
present**, on the one path whose entire purpose is preserving reviewer work.

`[]`, `null`, `{}` and `0` are all legitimate *answers*. None of them can also serve as "I could not
find out," because every consumer already has a branch for the answer and none has one for the
absence. Return an explicit third state — `{ status: 'unavailable' }` — and let the consumer decide;
the compiler cannot help here, but a caller that ignores the discriminator is at least visible.

Two audits missed this before a test caught it, and neither was careless. The first inspected all
seven `catch` blocks in the engine and reported clean. The second was written by the author of one of
the defects, in the same change that reported the class, with a warning about this exact shape in its
own description. **The defect is not visible where it lives** — `catch { return []; }` is ordinary
defensiveness at the site, and only the caller's use of the value makes it wrong. That is an argument
for a structural test rather than for closer reading, and the test is the one now in place: parse each
function body, assert its `catch` yields an explicit `unavailable`, with a matching `doesNotMatch`
for the bare-empty shape.

Not every such return is a defect, and the discriminator is whether the caller degrades **noisily**.
`findOpenPr` also returns `null` on failure, but the engine then attempts `gh pr create`, which fails
against an existing PR. The erasure is corrected by the next step rather than absorbed, so it stays.

**The evidence for this class was already in hand and was read as something else.** A GraphQL
node-budget rejection during an earlier rollout (`--limit 50` → 505,050 nodes, over the 500,000 cap)
was diagnosed as a query-cost bug and fixed as one. It was equally a demonstration of the erasure:
under the old shape that malformed query was indistinguishable from *a fleet with no older waves*,
permanently and with no symptom. The measurement was correct and the local explanation was
sufficient, and sufficiency is what removed the reason to ask the second question — *what would this
output look like if a failure were being swallowed?* A symptom that admits a mundane local
explanation will get one.

### A fleet-wide outage makes genuine regressions unreadable while it holds


The block does not merely stop work; it destroys the signal that would tell you whether anything
else is wrong. Every private member was refused and every public one was green — 10 of 10 readable,
`windows` unreadable behind an unrelated PAT 403. Re-measured `2026-08-12`, splitting by
`conclusion` rather than by step count:

```
libro      8 jobs    5 blocked   3 skipped
cartridge 12 jobs    7 blocked   5 skipped
docket    10 jobs    7 blocked   3 skipped
product    1 job     1 blocked   0 skipped
homelab    5 jobs    2 blocked   3 skipped
```

36 jobs, of which **22 blocked and 14 skipped**. A real regression landing in any of those repos
during the outage is **indistinguishable from the outage** at the level anyone actually reads — a red
check on a private member — and will be scrolled past for the same reason the outage is.

**This table previously read `steps=[0 × N]` per repo and totalled "35 failed jobs and not one
executed step", and that was wrong in a way worth preserving rather than quietly fixing.** A job
skipped by workflow conditions has zero steps too, so the step-count predicate swept the skipped jobs
in with the blocked ones and inflated the blocked population by more than half. The step counts were
individually accurate; the label on their sum was not. **`conclusion` is the discriminator, and
`steps` is only ever corroboration** — which is the rule already stated in
`instructions/workflow.instructions.md` under *Read `steps: 0` as a relation, not a count*, applied
here a table too late.

The trap is in how it ends. **The window does not close when the block lifts; it closes when someone
re-reads the checks afterwards, and nothing prompts that**, because the repos go green on their own
and a green check invites no investigation. So the all-clear is self-serving in the same direction as
everything else in this section: the recovery erases the evidence that a regression was ever
concealed. After an account-wide refusal lifts, re-read the members' checks deliberately rather than
treating the return to green as the answer.

That signature needs its predicate stated, because part of it is satisfied unconditionally. studio's
refused run censused as `total=9, steps0=9, failure=8, skipped=1, annotated=8`, and the two counts
were reconciled as two valid denominators — evidence versus relation. Verifying that instead of
accepting it: the ninth job is `security / Dependency review`, `skipped` at `steps: 0` on **every
green run of the same workflow**. It completes the relation while carrying nothing about the refusal.
`steps == 0 && conclusion == 'failure'` is **8**, equal to the annotated count, so the right predicate
**collapsed** the disagreement rather than splitting it.

Generalizing past the run: **a member that satisfies a relation unconditionally is indistinguishable
from one that satisfies it because the hypothesis is true**, and it inflates the population that looks
like corroboration. Report the discriminating predicate, not the relation, whenever the population is
mixed. The reconciliation is also the more attractive answer — *we measured different things and both
hold* preserves both parties' work, where *your predicate was loose* does not — so a tidy reconciliation
between two measurements deserves the suspicion normally reserved for a disagreement.

The same check produced a near-miss on the control. A green run showed **11** jobs to the refused
run's 9, `native-kotlin` and `native-swift` absent, which reads as jobs the account was never allowed
to create. They were added to `ci.yml` by `1a9d78e` at `23:49:29Z`; the run was created at `22:14:21Z`.
**A job-set delta across dates measures the workflow before it measures the run** — the control must be
pinned to the workflow **revision**, not merely the same event. Two independent confounds were present
(a `push` run compared against a `pull_request` one, and a later workflow revision), and correcting
only the first yielded a comparison that still could not support the claim. **One confound corrected is
not a controlled comparison**, and noticing the first is precisely what retires the search for the
second.

**The predicate's blind spot is `startup_failure`, and it is fleet-wide.** Every `startup_failure`
run in this fleet — twelve, across `.github`, `docket`, and `finance` — reports `jobs=0`, because the
conclusion names a run that failed before any job was created. `steps == 0 && conclusion == 'failure'`
iterates jobs, so on those runs it iterates nothing and returns no hits. That is not a judgement
about the run; it is the predicate having nothing to read, reported in the same shape as a clean
answer. When auditing refusals, treat run-level conclusions as a separate pass over
`workflow_runs[].conclusion`, and never cite a `startup_failure` run as a control that the job-level
predicate survived.

The corollary for controls: the ordinary-failure census cited here cannot falsify the predicate,
since an ordinary failing job has steps and the two populations do not overlap. It is still worth
keeping, re-scoped — across the last hundred runs of both public members, 143 jobs had zero steps,
135 `skipped` and 8 `failure`, which is what shows each conjunct excludes a population the other
admits. A control retired for being unfalsifiable should be re-aimed before it is deleted.

### An unreproducible finding resolves to a timestamp before it resolves to an author

A reported defect that is not there when you look has two explanations, and only one of them gets
reached for. **The second is that it was true when reported and repaired in between.** That has now
happened three times: docket's `.gitattributes` placement (real at `63482c42`, closed by docket PR
#92), finance's regressed lock entry (real, hand-fixed in finance #4085 roughly half an hour before
it was re-measured), and canon's own `SECURITY.md` mojibake (real, repaired by `b61db35`).

Preferring the author explanation is the expensive error, because it is **silently self-sealing**. A
finding retracted as phantom sends its whole class back to looking hypothetical, and nothing
afterwards prompts a recheck — which is very nearly what happened to the managed-region placement
bug. So resolve the discrepancy on the time axis first:

```sh
gh api "repos/OWNER/REPO/commits?path=FILE" --jq '.[] | "\(.sha[0:8]) \(.commit.author.date)"'
```

Then measure the file at each revision. Thirty seconds, and it converts *who claimed this* into
*when was it true*.

Two refinements, both from doing exactly that on the `SECURITY.md` case.

**A two-point trace establishes the repair, not the origin.** That file was traced across the commit
that touched it and the commit that fixed it, which reads as the damage entering at the former.
Measuring every revision instead:

```
973a5b9  2026-07-07  bytes=6032  0x3F=9  CR=272  emdash=0   <- scaffold; already damaged
6eb3d72  2026-08-10  bytes=7645  0x3F=9  CR=299  emdash=3
b61db35  2026-08-10  bytes=7364  0x3F=0  CR=0    emdash=12
```

The nine corrupted sites are byte-identical at the **scaffold commit**, a month earlier — the damage
shipped in the repository's first commit. `6eb3d72` is the maximally plausible culprit: a
`docs(security)` change that touched the file, grew it by 1,613 bytes, and introduced em-dashes. It
is innocent; it added three correct em-dashes beside nine it never touched. Note that the repair's
arithmetic is exact — `3 + 9 = 12` — and an exact reconciliation across two points still says nothing
about where the nine came from. **Walk to the first revision that carries the property, not to the
first revision that plausibly explains it.**

**A repair is not a cure, and a hand-repair is the dangerous case.** finance's lock regression was
fixed by hand, so the symptom vanished while the engine race that produced it stayed live — which is
why the recovery and the race are filed separately. Resolving to a timestamp therefore does more than
vindicate the reporter: it separates *repaired* from *cured*. **"I measured and it's fine" is the most
misleading form of unreproducible**, because a hand-repair erases the evidence while leaving the
defect able to recur, and the erasure is what makes the next occurrence look like a first one.

A PR that cannot merge — billing, a missing secret, an unavailable reviewer — invites repeated
re-verification, and that is nearly the wrong activity. **Validity** (do the contents still hold)
is settled at the first pass and cannot change while nothing is being pushed to the branch.
**Liveness** (is this still the change worth landing) changes continuously, is not a property of
the branch at all, and is therefore invisible to every check run from inside it.

```sh
git fetch && git log HEAD..origin/main   # the only question that moves while you wait
```

`jrmoulckers/studio` held a blocked sync PR for hours and re-verified it throughout — suites, region
hash, marker count, member content outside the markers — correctly and green every time. When the
block lifted, `main` had moved three commits, the branch was `CONFLICTING`, and per hunk it was
almost entirely superseded: canon re-emits every synced hunk, and its `.prettierignore` fix had
landed upstream more thoroughly in the interim. It merged at roughly a twentieth of its original
size, carrying only a member-authored trim, because nothing regenerates that.

The reason the checks could not help is that *behind* is a relation between the branch and a remote
nobody was refetching. Frequent verification of the artifact is what made its staleness feel
impossible, so on a blocked PR the re-verification habit is actively misleading: it raises
confidence in *this is ready to land* on evidence that only supports *this is internally consistent*.

When the block clears, judge the branch per hunk before merging it — see the merge-order and
diff-versus-tree rules below. A branch that has aged is rarely all-good or all-stale.

### Resolving conflicts in a sync PR

"Take canon's side wholesale" is right for whole-file canon and **wrong for managed-region files**,
where it silently reverts merged member work. A sync PR carries the canonical block *plus the
member's local content as of the commit the run cloned*. If member work lands on the default branch
after the PR is opened — a trim of the local region, say — taking theirs restores the pre-trim text
while looking like the safe, canon-respecting choice. Resolve per tier:

| Tier | Resolution |
| --- | --- |
| Whole-file canon | Take canon's side wholesale; never hand-merge |
| Managed-region file | Per region: canon inside the `studio:base` markers, the default branch's content outside them. Prefer rebasing — the two sides usually touch different parts of the file and auto-merge correctly |
| Member-owned file | Ordinary review; canon has no opinion |

**A clean rebase is the case that needs checking, not the case that excuses it.** The revert this
section warns about produces **no conflict marker** — the sides touch different regions, git merges
them without complaint, and the member's trimmed content is restored to its pre-trim state silently.
So "it rebased cleanly, no conflicts" is not evidence that member work survived; it is a description
of the exact circumstance in which the loss goes unnoticed. Rebasing is still the right default. It
just cannot be the last step.

**The loud case is not the safe complement of it.** The table's "usually touch different parts" is a
frequency claim, not a guarantee, and when it fails the conflict hunks land *inside* the `studio:base`
markers. Git then presents backbone-owned lines in a conflict block and asks for a resolution — so the
ordinary, correct-looking action at that prompt is to hand-edit canon. The drift constraint is
therefore reachable through routine git, not only through deliberate editing of a managed region:
nothing about the prompt distinguishes the lines you may resolve freely from the lines you may only
copy. `homelab` reached it on an everyday `git merge` of two sync PRs.

Treat a conflict whose hunks fall inside the markers as a **region-wise copy, not a merge**: take the
incoming side verbatim inside the markers, keep the default branch outside them, and take the newer
lockfile whole. Never resolve line-by-line inside a managed region, however small the hunk looks — a
hand-resolved region is drift by construction, and it will be reported against the member rather than
against the resolution that produced it.

**`actor.login` names the account, not the actor.** Every agent working this fleet authenticates as
the repository owner, so a timeline event, a comment author, and a merge are all attributed to the
same login whoever or whatever performed them. The field cannot answer "did a human do this" and does
not fail when asked — it returns a confident, correct name that supports whichever inference the
reader brought. During the rollout this produced a false claim that a member session's own PR closure
had been performed by the user, from a timeline entry that was entirely accurate.

Where the distinction matters operationally — deciding whether to redo work, whether an instruction
was already carried out, whether a close was authorized — take it from content rather than identity:
the comment body, a trailer, or the action's own description. A useful habit is that an agent closing
or merging anything states what it did and why in a comment first, which is what made the misread
recoverable here: the close was one second after a comment no drive-by would have written.

**The field is constant, not missing, and that is why it keeps being used.** Measured across one
issue's eight comments: one distinct `user.login`, one distinct `user.type`, one distinct
`author_association`. Three identity fields, zero discriminating power, none of them empty. A field
that returned nothing would prompt a search for another source; a field that returns `OWNER` on
every row answers the question asked of it and closes it.

**And the rule governs recall as much as reading.** Reading the body is only half the discipline, because
the attribution has to survive being written down. This repo read a member's cross-posted correction
correctly, recorded the fact without its origin, reasoned later from its own record, and told that
member their warning had been superseded — by the comment they themselves had written. Returning a
correspondent's own work to them as evidence that their contribution was redundant is the
characteristic harm here, and it is self-concealing: the identity field agrees with whoever is
claiming the work. So **carry the origin into the note, not just into the read.** An attribution
dropped at record time cannot be recovered at reuse time, and in a fleet on one account nothing
downstream will flag its absence.

**A second session confirming your number is not a second measurement.** Several sessions work these
repositories at once and cross-check each other constantly, which is valuable for judgement and
nearly worthless as verification when both run the same command. A line count taken by splitting on
newlines is wrong by one on every newline-terminated file and wrong identically for everyone who
takes it that way. Before treating agreement as evidence, ask what result would have made the two
disagree — if there isn't one, the second run confirmed the convention, not the fact. Where it
matters, use instruments that fail differently: a byte-level count against a parsed one, a local
working copy against the API, the engine's own output against a hand-built expectation.

Assert the invariant instead, on the merge result, after **every** rebase rather than only the final
one:

```sh
# 1. exactly one marker pair — a duplicated region is a merge artifact, not canon.
#    Match the DELIMITER at column 0, never the bare name. A file that must describe its own
#    markers necessarily contains strings that satisfy a bare-name matcher.
#    `.gitattributes` uses the `#` form; the HTML form is not valid there.
grep -c '^<!-- studio:base:start -->$' <file>      # AGENTS.md, copilot-instructions.md
grep -c '^# studio:base:start$'        .gitattributes

# 2. the managed region is byte-identical to ONE of the two input regions, verbatim
# 3. member content OUTSIDE the markers is byte-identical to the default branch
```

Hard-fail if the region extracts empty rather than hashing it: *found the markers* and *found the
region* are different successes, and the SHA-256 of the empty string is a plausible-looking value
rather than an obvious error.

**The prescription above is right; the justification this document used to give for it was false,
and the correction is worth more than the rule.** It read *"canon's own prose quotes
`studio:base:start`, so a name count returns 2 on every member in the fleet."* Backbone's own
`AGENTS.md` contains the literal **zero** times. Counted across all eleven members:

| name occurrences in `AGENTS.md` | members |
| --- | --- |
| 0 (no managed region at all) | studio, engineering, homelab, product, windows |
| 1 (delimiter only) | score-king, jrm-recipes, finance, docket |
| 2 (delimiter + a prose mention) | libro, cartridge |

*Every member* was two of twelve. The prose mention that made the number 2 sits **outside** the
managed region — in libro at line 6, with the region at 419–567 — so it is **member-authored**, and
canon claimed it as its own and then generalised a fleet invariant from it. The rule survived
because it was right for a reason nobody checked; a reader auditing the fleet against the stated
count would have found ten discrepancies and no defect.

**And the harm from matching the bare name is worse than a miscount: it relocates the region.** A
member's detector took the line-6 mention as the opening delimiter, which put the region's start
above the whole document and reported conflict hunks at 208–289 as falling *inside* it. That
converts an ordinary `AGENTS.md` resolution into an apparently human-gated one — a false escalation,
produced by the very sentence warning against writing the literals in prose. **A document that must
discuss its own delimiters contains strings satisfying any matcher for them; this is forced, not
incidental**, so the parser must require a delimiter to *be* the whole line rather than to appear in
it. Note the direction that made it survivable: the error announced itself by contradicting a prior
finding. Had it mislocated the region the other way — reporting hunks as safely outside — it would
have been read as corroboration and shipped.

**Assertion 2 asserts provenance, not equality with any reference, and that is what makes it
durable.** Both candidate references are wrong on a legitimate outcome, in opposite directions:

| Reference | Fails on |
| --- | --- |
| Live canon HEAD | A branch generated from older canon — correct, merely stale, and canon advances daily |
| The branch's own pre-rebase region | A rebase that legitimately updates canon: per the conflict rule above, a region-wise resolution takes the incoming region **verbatim**, so the region is supposed to change |

Asserting instead that the result equals *one of the two inputs, byte for byte* needs no external
reference, cannot go stale, and does not care which direction canon moved. Both inputs are already
in hand — `git show :2:<file>` and `:3:<file>` during a conflict, or the two merge parents after the
fact. It also catches the failure that motivates the check in the first place: a **blend** — a
half-applied hunk or a hand-reconciled region — equals neither input, which no equality-to-a-reference
test detects directly. Empty extraction is then the degenerate case of matching neither, so this
composes with the hard-fail above rather than duplicating it.

`finance` is the worked example in both directions: its region measured 4033 chars at two correct
merges and 5346 at a third, so an equality-to-canon assertion fails on the first two and an
equality-to-pre-rebase assertion fails on the third. The provenance form passes all three.

Two of the three are about content the merge should not have touched at all, which is the point: the
failure is invisible in the region under review and only shows in the parts nobody is looking at.
`jrmoulckers/finance` ran this after both of its rebases and reported a clean result — zero
conflicts *and* a verified-intact trim, which are two independent facts rather than one.

**Capture the pre-rebase hashes before rebasing — as one of the two inputs, not as the reference.**
The still-useful part of the older advice is that canon HEAD answers a different question: *is this
branch stale?*, whose answer on any older sync branch is a harmless yes. A rebase-integrity check
pointed at canon flags every slightly-stale branch as corrupt, and the obvious remedy is hand-porting
canon into the region — which is drift, and is discarded on the next sync. Both questions are
legitimate and they are not the same question; only one of them is about staleness.

What changed is the conclusion drawn from that. The pre-rebase region is not the *reference*, because
"the rebase changed nothing" is false whenever the rebase legitimately adopts newer canon. It is one
of the two admissible answers, and canon HEAD's region is usually the other. Capture it beforehand
because after a rebase it is expensive to recover, not because equality with it is the property.

**Extract the region defensively, because a broken extraction produces a plausible hash.** Canon
stores these bodies **unwrapped** — the source files carry no markers, and the engine injects them
along with the `synced from` line on emission. So "extract between the markers from canon" returns
nothing, and hashing nothing yields `e3b0c442…`, the SHA-256 of the empty string. That value compares
unequal to everything and looks like a genuine mismatch rather than a broken reader. Fail hard on an
empty extraction rather than hashing it.

**Name the exact path when claiming an asset survived.** A near-miss during the first rollout turned
on `high-contrast` versus `high-contrast-dark`: the filenames differ by one suffix, sort adjacently,
and a substring search for the shorter one matches the longer. Reading a directory listing is where
that goes wrong. Ask the tree for the exact token:

```sh
git ls-tree -r --name-only <ref> | grep '<exact-token>'
```

One call, no listing to misread, and it pairs with the file-level diff above rather than replacing
it.

The red flag is a canon PR showing changes to member-owned content **outside** the markers. Canon
never authors outside them, so such a diff is stale base content, not an upstream change — and
accepting it reverts whatever landed in the meantime. This is ordinary git staleness, not an engine
fault: each run clones the then-current default branch, so a PR only goes stale when a different
overlapping PR merges after it was opened.

**Establish supersession from content, never from chronology.** When two sync PRs are open, "the
later one merged, so the earlier is redundant" is a claim about *ordering*; redundancy is a fact
about *content*. Diff the branch against the post-merge default branch before closing anything.
Take the base ref from the API rather than assuming it — `gh api repos/<owner>/<repo> --jq
.default_branch`; the fleet is not uniformly `main`, and `jrmoulckers/homelab` uses `master`. Two
duplicate
waves are rarely a superset of each other in either direction: each carries whatever canon existed
when it was generated plus whatever member-side fixes were pushed to it. A closed PR whose branch
was force-pushed **cannot be reopened**, so the recovery is a fresh PR from the same branch — which
is only possible because the branch still exists. Preserve the branch and escalate rather than
discarding work you believe is redundant.

**`compare/A...B` is a merge-base diff, so it overstates what a branch uniquely carries.** Three
dots describe B relative to the *merge base*, not relative to A's current tip: anything that reached
A after the branch was cut still shows as added on B. Comparing two sync branches this way reports
assets the other already has. For "what does this branch carry that the other does not", compare the
tips — `git diff <A-tip> <B-tip>` — or, for generated assets, compare the lockfile entry sets, which
answers it exactly and without ambiguity:

```sh
gh api repos/<owner>/<repo>/contents/.studio-sync.lock.json?ref=<branch> \
  -H 'Accept: application/vnd.github.raw' | jq -r '.entries | keys[]'
```

Set-difference the two, then compare `targetSha256` on the shared keys. That distinguishes "a kind
this branch alone carries" from "the same kind at a different revision", which the file list cannot.

**`ahead_by` counts commits, not content, so the compare is asymmetric evidence.** `ahead: 0` is a
sound close signal. Non-zero is a signal to *look*, not proof that unique content exists: a branch
cut from an older base is ahead by its own commits even when everything they contain has since
reached the default branch by another route, so `ahead: N` with an empty effective diff is an
ordinary outcome rather than an edge case. Both halves of that asymmetry were hit during the first
fleet rollout — one PR sat at `ahead: 1` while its content had already landed under a different ADR
number, and a session on the other side read a non-zero count as confirmation that content was at
risk. Read the `files` list and diff the paths that matter; the count only tells you whether you are
allowed to skip that step.

**The two ways of misreading that count do not cost the same, and "keep it open" is not the safe
default it looks like.** Treating a non-zero count as proof of risk is the conservative error: it
costs one diff and preserves something that turns out to be disposable. Treating it as grounds to
keep a branch alive fails in the other direction — toward *retaining* stale content — and that is
only safe if retained branches are never merged. They are. A branch left open because nobody could
prove it was empty accumulates a plausible case for merging simply by continuing to exist, and by
then it is old enough to re-apply engine behaviour that has since been fixed. That is the shelf-life
hazard reached by a different road, and it is how one member came to lose every carve-out in its
`.gitattributes`. So the bias belongs on the work, not on the outcome: a non-zero count **obliges**
a diff, while `ahead: 0` **permits** skipping one. Neither licenses leaving the question unanswered.

**A diff answers "what does this branch change", never "what does the base contain".** The compare
above is the right call for supersession, but its output invites a specific misreading, because a
three-dot diff describes only the delta. `.gitattributes | 7 +` is consistent with creating a
seven-line file *and* with appending seven lines to an existing one, and a filename's presence in
the `files` array says nothing about whether the base already has that path. Both readings were made
during the first fleet rollout, in opposite directions and within an hour of each other: one session
reported a file as newly created when the branch only appended a managed region to a member-authored
file that already existed, and the other read the same entry as evidence the file was absent from
the default branch when it had been present all along.

When the question is about the **base** — does this file exist, does it already carry this rule —
fetch it and look:

```sh
gh api repos/<owner>/<repo>/contents/<path> -H 'Accept: application/vnd.github.raw'
```

One call, and the answer cannot be misread. Use the compare for *what changes*, the fetch for *what
is*. The failure mode is quiet in both directions: it manufactures absent files that are present,
and reports present files as missing, and in each case the conclusion looks fully supported by real
API output.

The same distinction applies to the PR set itself. Looking up a known list of PR numbers answers
"what is the state of these", not "what is open" — a PR opened outside the set is invisible to it,
and every individual fact returned is still correct, which is what makes the resulting conclusion
convincing. `gh pr list --state open` is the query that answers the second question.

**Compare a generated file against canon HEAD, never against a sibling branch.** The supersession
rule above says "from content", but it does not name the reference, and for generated assets the
intuitive reference is the wrong one. Two open sync branches are two *renderings of canon at
different moments*; diffing them tells you which snapshot is newer, not whether anything is at risk.
The trap is that the finding looks conclusive — the extra sections are real, they really are absent
from the other branch, and the comparison is a correct answer to a question nobody needed answered.

During the first fleet rollout a session compared its open sync PR against a sibling sync PR, found
~87 lines in two sections present in neither the sibling nor the default branch, and concluded the
branch had to be preserved. Canon already carried both sections, and canon's copy of that file was
488 lines against the branch's 311: the branch was *behind* canon, not ahead of it. For anything the
engine generates, the only reference that answers "is this at risk" is the canonical source, because
the next sync re-emits from there regardless of what any branch holds.

The reference therefore depends on who owns the content, and the two cases invert:

- **Generated content** — compare against **canon HEAD**. If canon still has it, nothing is at risk
  and the branch is discardable.
- **Member-authored content**, including anything inside a member's own region — compare against the
  **member's default branch**. Canon never had it and never will re-emit it, so the branch may be the
  only copy.

**Recoverability has a second premise: the destination must still be able to receive it.** "Canon
still has it, so the next sync re-emits it" is only half the argument. `buildFile` chooses a
placement only when the target file has no markers yet; where a region already exists it is replaced
where it sits and never relocated. So for a member whose file already carries a mis-placed region, no
future sync repairs it, and closing a branch on regeneration grounds discards the only correctly
placed copy. Before closing, check the destination as well as the source — `marker lines in the
member's file on its default branch` is the whole test, and zero is the answer that makes the
regeneration argument sound.

That check is cheap enough to run across the fleet, and worth re-running after any change to a
managed target's merge behaviour:

```sh
gh api repos/<owner>/<repo>/contents/.gitattributes --jq .content | base64 -d |
  grep -n '^# studio:base:start$'
```

A region that is not first, in a file that has member rules above it, is permanently mis-placed:
those rules are overridden by canon's `*` and nothing in the pipeline will move the region out of
their way. It requires a human edit.

**Apply that per hunk, not per branch.** A sync PR is routinely *mixed*: generated files the next sync
will re-emit, sitting beside member-authored edits — a `.prettierignore` entry, a local trim — that
nothing will ever regenerate. Judging such a branch as a unit gives the wrong answer whichever way you
round it. "It's behind canon, discard it" loses the member's work; "it has unique content, preserve it
whole" carries stale generated files forward and re-applies whatever the engine did that day. The
useful question is never *is this branch superseded* but *which parts of it are*, and the answer is
usually "the generated ones, entirely, and the authored ones, not at all". This is the managed-region
split one level up: the same mixture of owners that makes a single file need markers makes a whole
branch need per-hunk judgement.

**Judge a branch by its diff, not by its tree.** Every branch contains the whole repository, so
reading files *on* a branch tells you what its base contained and nothing about what the branch does.
A sync branch cut two days ago carries stale copies of every generated file, and it will keep
carrying them whether or not it changes any of them — those files simply come along with the
checkout. Classifying such a branch as "mixed" because stale generated content is visible in it is
the tree-for-diff substitution, and it turns a one-file member-authored change into an apparently
delicate salvage operation. `gh api repos/<o>/<r>/pulls/<n>/files` and the commit list answer the
question the tree cannot: `jrmoulckers/studio` #34 reads as mixed and stale by tree, and is one
authored commit touching one file by diff.

This matters most where the two disagree in the safe-looking direction. A branch whose tree looks
stale invites either discarding member work or hand-porting canon into it, both of which are worse
than the merge it was avoiding.

**A stale sync commit merged after a newer one reverts canon, and rebasing does not save you.** When
a member has two open sync PRs from different waves, merge order decides the outcome. Landing the
newer wave first is right, but it leaves the older branch carrying a generated commit that describes
canon as it stood days earlier; rebasing that branch onto the new default replays those files over
the newer ones. Where the two waves touched the same paths this conflicts loudly, which is the good
case. Where they did not, it applies clean and silently rolls canon back on exactly the files the
older wave happened to cover.

So an older mixed branch should not be rebased and merged — it should be **reduced to its
member-authored commits**, which is the only part of it the reference rule says is irreplaceable. In
practice: merge the current wave's PR, then cherry-pick the authored commits onto the default branch
and drop the stale sync commit entirely. The next scheduled run re-emits everything it removed.
`homelab` is the worked example — its `2026-08-09` PR carries one sync commit plus several
member-authored ones, while its `2026-08-11` PR is pure canon. **That sentence deliberately does not
state how many.** It said "two" when written and the branch has since accumulated a third, because an
undrained wave keeps taking commits for as long as it stays open: any count of them written into
prose has a shelf life equal to the drainage delay, and the example decayed by the exact mechanism it
exists to describe. The number is worth knowing at the moment someone is about to merge such a
branch, which is why the engine reports it per run rather than a paragraph carrying it.

**This is a queue-drainage property, not a property of any member.** Any repository that accumulates
two open sync PRs has it, and the precondition is ordinary rather than exotic: a fleet sweep found
six waves sitting open across members for a day. So the hazard should be read as a standing
consequence of an undrained queue, and the mitigation is drainage — a wave that is merged or closed
promptly cannot become the stale half of a pair.

**The engine reports the condition; it does not refuse to open the second wave.** Refusing would
convert a merge-time correctness hazard into an open-time availability failure, and it would land on
exactly the members already behind — canon would stop reaching a repository *because* that repository
was slow to drain, which is the wrong direction. The hazard also does not exist at open time: it
exists at merge, and only for an older branch that is **mixed**. A pure-canon older branch is simply
closed and re-emitted, at no cost. So this follows the same posture as ambiguous relocation
candidates, which are reported rather than guessed at: surface the older open wave, say whether it
carries commits the engine did not author, and leave the disposition to the merger, who is the only
party with the standing to choose.

**Re-derive a list at the point of use; never quote one forward.** The enumeration above decays the
moment it is written down, and the failure is not that the list is wrong when assembled — it is that
prose preserves it perfectly while the repository moves underneath it. A cherry-pick list assembled
from a branch's log and then restated in a later message dropped a commit that had been pushed in
between, and the omission was invisible because the list read as authoritative and internally
consistent. The same shape produced the stale tips, counts, and expected hashes elsewhere in this
document; a list is simply the plural case. Re-run `git log`, `gh pr list`, or the query itself at
the moment you act on it, and treat any list carried across a message boundary as a description of a
repository that no longer exists.

**The trigger is not only elapsed time — a change of question defeats this rule with no time at
all.** Every control above is keyed to decay, which implies a fact that was true when collected and
stopped being true. The other case is a fact that never stopped being true and was simply not
consulted, because it was gathered while answering something else. `homelab` asserted that
`.github/copilot-instructions.md` did not exist on `master`; it had existed since `64485f3` and
still did, and the disconfirming evidence was already in their own output — a merge simulation they
had run minutes earlier printed exactly two `create mode` lines, and that path was not one of them.
Re-running the query later would have returned what it would have returned earlier, so no freshness
discipline would have helped. **Re-derive a claim in the frame of the claim, not merely at the
moment of it:** evidence collected to answer *does this merge cleanly* has not been read for *does
this file exist*, even though it contains the answer.

Its tell is worth carrying because it is invisible from inside: **the confidence of a claim tracks
how recently you looked at anything, not whether you looked at this.** The same message was strong
on a simulation just run and equally strong on a cherry-pick never checked, and nothing in the tone
separated them.

**Enumerate the member's other PRs before deciding the reduction, not before merging it.** The
enumeration is usually filed as a pre-merge safety check, which puts it one step too late: what the
older branch should be reduced *to* depends on what the newer wave already covers, so running the
check at merge time can only confirm a decision that was made on incomplete information. `studio`
merged `2026-08-09` ten minutes after `2026-08-11` and was unharmed, but only because the branch had
already been reduced to a single member-authored hunk for the unrelated reason that it looked stale.
Had the supersession analysis left one sync hunk in place, that hunk would have reverted the newer
wave — clean, green, and with no conflict to raise the alarm. A safeguard that holds by coincidence
of another decision is not a safeguard, and the near miss is the evidence, not the outcome.

**`mergeStateStatus` is a reading, not a state — poll and merge in one loop.** Check-then-merge has
a window between the two calls, and on an active default branch that window is where the branch goes
`BEHIND` again. It is the stale-tip rule applied to the one query everybody treats as authoritative:
a `CLEAN` from thirty seconds ago describes a repository that no longer exists. Four consecutive
rebase/green/`BEHIND` cycles cost one session roughly 25 minutes. Merge immediately on reading
`CLEAN` and retry the whole cycle on failure, rather than reading, deciding, and then acting.

**Make the correct reference the cheap one.** The reason the sibling-branch comparison keeps getting
made is not that anyone believes it is right — it is that both branches are local refs, so it needs no
external lookup, while canon HEAD needs an API call against another repository. The wrong reference is
simply the reachable one. That is a bad property for a check that gates data loss, because it means the
operator most likely to get it wrong is the one working fastest, and speed is exactly the condition
under which these branches get triaged. Where a rule's correct form costs more than its incorrect
form, expect the incorrect form under load, and treat closing that gap as part of the fix rather than
as convenience.

**A sync branch is a rendering of the engine, not only of canon, and so it has a shelf life.** The
branch holds whatever the engine did at generation time, and merging an old one re-applies behaviour
that has since been fixed. Before merging, check the branch's creation time against the last change
under `sync/lib/`; if the engine moved in between, regenerate rather than merge.

**That check covers only one of the branch's two inputs.** A rendering is a function of the engine
*and* of canon's content, and the engine check passes cleanly while the payload is months old. libro's
blocked `#37` was generated at `2026-08-11T04:27:21Z`; **75** canon PRs merged after that head commit,
including the authorship and peer-gate rules at `11:21:19Z`, and its `AGENTS.md` blob contains neither
phrase. Nothing about the branch is defective — it is a faithful rendering of a canon that has moved.
So compare the branch head against the last change to the **managed sources**, not only to `sync/lib/`,
and expect the two answers to differ.

**A sync PR makes a member current as of its generation, not as of its merge**, which inverts the
intuition that a long-delayed merge delivers more. The shortfall grows with precisely the interval
that makes the PR feel overdue, and it is measurable rather than merely suspected — count the canon
commits touching managed sources since the branch head, and that is the gap you will still have
afterwards.

**The gap is most dangerous immediately after the merge succeeds.** While blocked, the PR is a visible,
tracked, repeatedly-discussed reminder that the member is behind. Merging removes the reminder without
closing the gap: the residual staleness becomes unobservable at the exact moment its tracking artifact
disappears, and a green merged sync PR reads downstream as *this member is current*. **Draining a
queue is not the same as reaching the head of it** — after merging a delayed wave, either regenerate
immediately or record the remaining distance somewhere that outlives the PR.

**Run that check unconditionally, because nothing in the artifact will prompt you to.** A generated
file carries no evidence of its own staleness. Its bytes are self-evidencing: a wrongly-ordered
`.gitattributes` really is wrongly ordered, the reading is correct, and the artifact points nowhere
at the generator that produced it or at when. So there is no observation you can make *of the branch*
that triggers the question — which means the check cannot be prompted by suspicion and has to be run
because the file is generated at all. This is why "verify before asserting" is not enough on its own:
verification confirms what the artifact says, and what the artifact says is true. Every session that
mis-diagnosed a stale branch as a live engine bug during the first rollout had read it correctly.

**Re-read state immediately before acting on it, not while composing the argument for acting.** The
same shelf life applies to your own checks. During the first rollout, sessions acted on stale reads
repeatedly — a PR believed open that had been closed two hours earlier, a default branch believed
current that had advanced, a branch tip cited seven commits after it stopped being the tip, an audit
that read a file repaired sixty-six minutes before. None of these were careless readings; all were
correct when made, which is precisely what removed the impulse to make them again. In a fleet where
several sessions write to the same repositories, "I checked" ages as fast as "I observed". Treat any
verified fact quoted from earlier in an exchange as expired, and re-query the cheap things — PR
state, branch tip, default-branch content — at the moment of use.

**A placement fix does not repair anyone already mis-placed, so the fleet needs both a fix and a
report.** Because `buildFile` chooses placement only on the no-markers path, the prepend fix reaches
members adopting a managed region for the first time and no one else. A member that already merged a
bottom-placed region stays that way permanently: every later sync rewrites canon's block in the wrong
position, below the carve-outs it silently overrides, and reports nothing. The fix and the damage
therefore cover disjoint populations, with the damaged one on the side the fix never touches.

This is why the precedence reporter exists alongside it. Detection is by *precedence*, not position —
a comment above the region carries none, and a rule byte-identical to canon overrides nothing — so
the report fires on members the fix cannot help without firing on the two harmless shapes. Treat the
pair as the unit: a fix that changes future behaviour, and a report that surfaces the existing state
it cannot change. The correct repair on a flagged member is constrained too — move the *member's*
rules below the region, never the region itself, since editing a managed region is drift and is
discarded on the next sync.

That is worth a real check rather than a habit, because the engine's non-relocation guarantee turns
one class of staleness into permanent damage. A managed region is replaced *where it already is*, so
a region merged into the wrong position is never repaired by a later sync. A branch generated before
the `.gitattributes` prepend fix appends the region instead, leaving canon's `*` wildcard as the last
matching line and every more specific member rule silently downgraded — and, where the member's file
already held canon's stanza unmarked, leaves that stanza in the file twice. Merging such a branch
costs a human edit to undo; regenerating it costs nothing.

This is not hypothetical and it is not confined to unmerged branches. `jrmoulckers/finance` merged
one such branch during the first rollout and lost every carve-out in its `.gitattributes`:
`gradlew.bat` and `*.cmd` went from `eol: crlf` to `eol: lf`, and `*.png`, `*.jar` and `*.keystore`
from `text: unset` to `text: auto`. `gradlew.bat` is the sharp case — the only tracked `.bat`, stored
with 91 CRLF pairs, on a repo where Windows is a first-class build target and `cmd.exe` is unreliable
with LF-only scripts. It produced no conflict, no failing check and no diff noise; it surfaces later
as a corrupted checkout. The member found and repaired it within fifteen minutes, which is the only
reason it was cheap.

**Audit the process, not the moment.** A fleet audit run after that repair reported zero exposure,
because a point-in-time check cannot distinguish "never broken" from "broken and already fixed" — it
returns green for both. The same audit missed a live hazard in an open PR that was not in the set it
examined. Two rules follow, and both are cheap:

- Enumerate what is open rather than the PRs you know about — `gh pr list --state open` per member.
  A snapshot of a set you assembled by hand answers "the state of these", not "what exists".
- Prefer a check that can return something other than *clean*. An audit whose only outcomes are
  "clean" and "found it" is silent about exposure that was repaired and about exposure that has not
  landed yet, which are the two states that matter for a fleet mid-rollout. Comparing the default
  branch against every open branch, with `git check-attr` on the paths a member protects, answers the
  question the snapshot cannot.

### Sweeping the fleet for attribute damage

The historical version of that question — *did any member already lose a rule when it adopted canon?* —
is answerable in one pass, and worth re-running whenever the merge behaviour of a managed target
changes. For each member, find the commit that introduced the region, then compare git's own
resolution across it:

```sh
git clone --filter=blob:none --no-checkout https://github.com/<owner>/<repo>.git
sha=$(git log --format=%H -S'studio:base:start' -- .gitattributes | tail -1)
files=$(git ls-tree -r --name-only "$sha")
git check-attr --source="$sha^" text eol -- $files >before.txt
git check-attr --source="$sha"  text eol -- $files >after.txt
diff before.txt after.txt
```

Three traps, all of which make the sweep report *clean*:

- **Do not feed paths through `--stdin` from a shell that terminates lines with CRLF.** A path ending
  in CR matches no pattern, so every entry resolves to `unspecified` and the diff is empty. Pass the
  paths as arguments, in batches if the list is long.
- **Do not route the command through `cmd.exe`.** The caret in `<sha>^` is cmd's escape character, so
  the parent ref silently fails to resolve and both sides come back empty.
- **Filter `unspecified` before diffing.** A member that had no `.gitattributes` at all reports every
  path as changed, which is a first-time adoption rather than a regression. Only transitions between
  two *specified* values are interesting.

Exposure requires the member to have had rules already, since the failure is canon's `*` overriding
something that existed. At the time of writing, of six members with a region on their default branch,
three had prior rules and only one — finance — was ever damaged; it is repaired. The other three
adopted normalization for the first time and had nothing to lose. A member whose region is appended
but who has no rule for the wildcard to override is unaffected, which is the common case and the
reason the defect survived a full wave unnoticed.

**Establish that the check can return a positive before believing that it returned none.** All three
traps above were found only because finance at `a450c472` was a known-positive whose known damage
failed to appear; without that fixture the sweep would have certified the fleet twice while inert.
The fixture has to be shaped like the defect being hunted, not merely be some case that fails — a
harness that reports empty because it is broken is indistinguishable from one that reports empty
because nothing is wrong, and a wrongly-shaped fixture certifies the wrong path.

**Store the fixture's bytes; record the ref as provenance only.** `a450c472` above is a live ref in
a repository this one does not control. Force-push, GC or a branch deletion and it stops being
known-bad — and it does not stop loudly: the check errors on a missing object, or resolves to a
descendant that is clean, and reads as a fixture that has nothing to say. A fixture that quietly
stops being bad reinstates the exact silence it was installed to break, so a control keyed to
another repository's history is keyed to something outside its own suite. Vendor the bytes and cite
the commit as where they came from. This applies to any citation that reads as helpfully concrete
while being a dependency in disguise.

**Break the invocation before either.** A fixture and a mutation both prove the harness can produce
*a* positive; neither proves the command actually ran against the input you believe it did. Two of
the three sweep defects above were invocation-level — one compared CR-terminated paths that match
no pattern, the other never resolved the parent ref — and a fixture catches neither, because a
fixture that is never reached is indistinguishable from one that reports clean. So the cheapest
check is to corrupt the invocation deliberately: point it at a nonexistent ref, feed it a path that
cannot match, and confirm it complains rather than returning empty. A sweep that stays green when
given garbage is not measuring.

The three controls are ordered, not alternatives:

| | Control | Use when |
| --- | --- | --- |
| 1 | Break the invocation | Always, first — it is the only one that tests whether the check ran |
| 2 | Mutate the code under test | The check is code and there is a live path to break |
| 3 | Vendor a known-bad fixture | The check is a command or sweep with no code to mutate |

Where a check is code rather than a command, the general form is cheaper and stronger than keeping a
fixture: introduce the regression deliberately, confirm the check fails, then revert. Doing this to
`sync/lib/rekey.mjs` — adding an `existsSync` guard to the rekey loop, which is what a future reader
would plausibly propose as a safety improvement — is what established that the order-independence
test in `sync/test/rekey.test.mjs` was load-bearing rather than incidentally green.

**Mutate rather than curate where you have the choice.** A fixture is a second artifact that can
drift from the thing it certifies and has to be maintained; a mutation exercises the live path and
leaves nothing behind. Reserve the vendored fixture for checks with no code to break.

**Confirm the mutation applied before believing its result — a no-op mutation and a vacuous test
report the same `pass`.** This is the invocation-level failure of control 1 reappearing inside
control 2, and it is easy to miss precisely because mutation is the control you reach for once you
have stopped trusting a green. A mutation run driven from PowerShell reported two fresh assertions
vacuous; they were not, the harness was. The replacement text was a double-quoted string containing
backticks — PowerShell's escape character — so the substitution silently matched nothing and the
suite passed for the reason it always had. The check is one line: after mutating, assert the file
actually changed on disk, or have the mutation step fail when its match count is zero. A mutation
that reports "still passing" is only evidence if it reports "and here is the diff I applied."

The reason any of this is worth the trouble: **a check guarding a loud failure is exercised by the
failure itself, while a check guarding a silent one is only ever seen passing, so its green is never
questioned.** Silent, unrecoverable failures are exactly where an inert check survives longest.

**Mutation proves a test is non-vacuous; it cannot prove the test is faithful.** A passing mutation
shows the code does what the *test* says, and says nothing about whether the test describes the state
a member is actually in. A suite whose fixtures encode a believed shape will confirm that belief
rigorously — `report.abandoned` shipped with a mutation-proven suite and a false negative on the very
member its own PR body named, and the miss surfaced only when someone rebuilt that member's real
state and ran the engine against it. The stronger the mutation table, the less need anyone feels to
go and look, which makes this the more dangerous half of the practice. So mutation answers "is this
check load-bearing", and only a reconstruction of the real case answers "is it pointed at the right
thing" — naming a real member as the motivation is the trigger to go and build it.

**A test that iterates a discovered population reports `pass` when the population is empty.** The
explicit form is a conditional `skipTest`, and the trap there is that the skip condition is usually
the failure mode restated: skipping because a synced file is absent means the test goes quiet in
exactly the state a broken sync produces. The implicit form — a `for` loop over a `filter`, or an
`?? []` on a missing key — is worse, because a skip at least prints `skipped` in the summary while
an empty loop is indistinguishable from a real assertion and the run reports `skipped: 0` besides.
Three checks in `sync/test/` had this shape, each iterating a population that is non-empty only by
coincidence of today's data; a filter mutated to match nothing left the suite fully green. So assert
the population before iterating it, and say in the message that the check would otherwise assert
nothing. Where a genuine precondition exists, key the skip to the thing that *decides* whether the
file is owed — the lockfile entry — and fail when the entry exists but the file does not, rather
than keying it to the file's own presence.

**Count marker *delimiters*, never marker names — but the anchoring is the load-bearing half, and
the comment syntax must be left open.** `basemerge.mjs` matches a full line, trimmed, against text
whose fenced blocks have been masked, and both hardenings are there because the region's own body
documents the convention it implements. Canon's `copilot-instructions.md` mentions
`` `studio:base:start` `` in prose at line 44, so the bare name occurs **twice** in an emitted file
while the delimiter occurs once — a check counting the name reports two marker pairs on every member
in the fleet. The failure direction is the damaging one: "two pairs" reads as exactly the corruption
such a check exists to catch, and the obvious remedy is to delete one, which means editing canon's
own prose out of the managed region.

**Do not hardcode `<!-- … -->`.** The marker syntax varies with the target — see the treatment
below — and a predicate fixed to the HTML form returns **zero** regions on a hash-marker file such as
`.gitattributes`, so the file becomes invisible. That is the empty-population failure again, reached
this time by way of the fix for the name-matching bug. **Anchoring is the load-bearing half and the
delimiter is not**: a full-line match is what excludes prose, since a sentence mentioning the marker
is never a line consisting solely of it, while pinning the comment characters does no work and only
narrows the population. A member told to "match the delimiter" without being told to leave the syntax
open has been handed the next bug.

Note that the exported reader defaults to the HTML pair — `extractBlock(content)` with one argument
silently assumes Markdown — so calling the shared function is not by itself sufficient. Call it as
`extractBlock(content, markersFor(targetPath))`, the form `sync/README.md` prescribes for member-side
checks.

**The two failures look alike and carry opposite risk, so size the response to the direction rather
than to the shape.** A predicate that under-matches fails **silently and unsafely**: canon goes
unexamined and is severed from sync with nothing printed. A predicate that over-matches — classifying
a member's own file as canon because it *documents* the convention — fails **loudly and safely**: a
red build on a file the member owns, self-announcing and cheap. Same predicate, same file, and only
the first is an emergency.

Note also that *found the markers* and *found the region* are different successes, so a reader should
hard-fail on inverted or missing markers rather than returning an empty region.

The general point outlives the specific bug. This defect was not in the engine, which has been right
about it for as long as the prose has existed; it was in a check that silently re-derived a weaker
predicate and dropped both hardenings. It was first found in a specification written **in prose**,
and the tempting reading is that prose is the problem — but the member that diagnosed it then shipped
the same weak predicate **in code**, hours later, in the very script written to fix the neighbouring
bug: a bare-name substring test that classified any member file *documenting* the convention as
canon. So the rule is not about prose. Any re-expression of a predicate, in any medium, by anyone who
has just read the correct one, is where the accumulated corrections get dropped. The rule for
answering a
report is to cite the artifact rather than explain it; the rule for *specifying* a check is the same
one and it is stronger, because a re-derived predicate does not merely fail to convince — it ships,
and it ships fleet-wide with the engine's accumulated corrections stripped out. Point at the exported
function.

**The reading side of the same rule: a comment is not evidence of behavior, because it cannot come
back negative.** A docstring asserts what a function does with no mechanism to disagree with the
code beside it, so it can drift indefinitely and be contradicted by nothing — an instrument that
cannot return a different answer is not measuring, applied to prose. A member reported that
ambiguous relocations were "reported, not guessed at" and sourced it from the docstring rather than
from the function, with the module open at the time; the comment was stale, and the claim inherited
its staleness. Note the two faults are separable and only one of them is about this comment: the
inaccuracy made the claim wrong, and consulting prose for behavior made it *unverified*, which
remains true on every occasion the comment happens to be right. Prose about behavior is a
hypothesis; the function and its tests are the evidence. This applies with full force to the present
document, which is prose about an engine it does not execute.

**And the marker syntax varies by target, so a check keyed to one syntax is keyed to the
wrong unit.** `.gitattributes` delimits its region with `# studio:base:*` because an `<!-- … -->`
line there would be read as a pattern; `AGENTS.md` and `.github/copilot-instructions.md` use the
HTML form. A checker that hardcoded the HTML pair found no region in `.gitattributes`, fell back to
hashing the whole file, and reported drift on correct content — the same class of defect as the one
that made *provenance* comment syntax per-target, arriving one level finer because the first repair
was scoped to "all managed files" when the property varies per target.

Two sets are involved and they are **not** the same set, which is the next wrong-unit bug waiting:

| | Set | Members today |
| --- | --- | --- |
| Managed-region targets | region merged between markers | `AGENTS.md`, `.github/copilot-instructions.md`, `.gitattributes` |
| Hash-comment targets | provenance header is a `#` line | `.gitattributes`, `agency.toml`, `.gitignore` |

`agency.toml` takes the `#` comment and is copied **wholesale**, so "takes a hash comment" does not
imply "has a managed region". `markersFor` defaults to HTML, so a future managed target with a `#`
grammar would silently receive `<!-- … -->` delimiters. `manifest.test.mjs` now asserts both that
every managed target's marker syntax matches its own provenance syntax, and that the two sets have
not converged — the second because a check keyed to one set answers correctly for the other only
while they differ, and nothing maintains that.

**Audit that exposure with git's resolver, not with the region's position.** The obvious check —
"the managed region should be the first non-empty line" — is itself keyed to the wrong unit, and it
was written and run against the whole fleet before the mistake showed. It returned two hits, and
both were false positives. In one member every line above the region is a *comment*, which carries
no precedence at all; in another the single rule above it is byte-identical to canon, so ordering is
moot. Position is a proxy. The property that matters is whether any member rule is outranked by
canon's wildcard, and only git can answer that:

```sh
git check-attr --source=<ref> text -- <path-the-member-protects>
```

Run it against the default branch and against the candidate branch and compare. `text: unset` on one
side and `text: auto` on the other is the regression, stated in the terms the damage actually occurs
in. A fleet audit by this method found **zero** exposure: the only carriers were two unmerged
branches from the same pre-fix generation wave.

This is worth stating plainly because it recurs: **a fix for a wrong-unit bug is itself liable to be
keyed to the wrong unit.** The member checker that missed the appended region validated the block's
*content* — hash and markers — and said nothing about precedence. The natural repair is to assert
position, which is the same error one step over: still a proxy, still not the property, and it goes
green or red for reasons unrelated to whether anything is actually overridden. When the original
defect was a proxy standing in for a property, prefer a check that asks the authority directly.

**But keep the position check as well, at a lower severity — the resolver replaces it only for the
question it asks.** The two answer different questions and diverge on a live member:

| Question | Instrument | Severity |
| --- | --- | --- |
| Is this **sound**? Are member rules above the region void of effect? | position | informational |
| Is this **damaged**? Does an attribute change on a protected path? | `git check-attr` | failing |

`docket` is the case. Its region sits at line 3 with one member rule above it — the fleet's only
remaining structural instance — and that rule is byte-identical to canon, so `check-attr` reports it
clean, correctly. A resolver-only audit therefore passes on the last real instance in the fleet, and
passes while doing nothing. A position-only audit fires on it and on the two false positives above.
Collapsing the pair loses a real defect in one direction or cries wolf in the other, because
`docket` is unsound but undamaged: a coincidence is doing the work, and coincidences are not
maintained. Report it, and do not fail on it.

So a wrong-unit repair has a second failure mode beyond being keyed to another proxy: it can
**discard a coarse instrument that was answering a question the fine one does not ask.** Replacing
is the reflex; the coarse check usually survives as a demotion.

**The same test also retires checks, and a before/after diff over `check-attr` is one.** An earlier
proposal here was to capture attribute output before and after a merge and diff the two. The
reporter above supersedes it, because a diff fires only on a **transition**: a member file that was
never correct presents no merge to be the "before", so the diff reports clean in perpetuity —
`homelab`'s `*.glb` case exactly. The reporter asks whether canon's wildcard outranks a member rule
in the file as it stands, needs no baseline, and therefore has no baseline to be wrong about.
Nothing the diff answered is left without an instrument, so it retires outright rather than being
demoted. Keep the before/after form only for the narrower job it is good at: confirming that a
*specific* resolution you are about to push changed nothing, where the transition is the question.

Members that validate their own generated assets must also respect two contract details, or they
will report false failures — both were live in `jrmoulckers/homelab` on first sync:

- **Managed-region files are not whole-file copies.** For every managed-merge target — `AGENTS.md`,
  `.github/copilot-instructions.md` and `.gitattributes` today, per `sync/lib/copier.mjs` —
  `targetSha256` is the hash of the **inner managed block**, not the file. The file legitimately
  carries member content outside the markers, so a whole-file hash could never be stable.
- **The provenance marker is not always an HTML comment.** It follows the target's own comment
  syntax, per the list above. A checker hardcoding `<!-- … -->` reports `agency.toml` as unstamped.

### Answering a member session's report

A member session is not required to watch this repository's issues, pull requests or merges, so when
it reports a problem here, three states it needs to distinguish — not received, received and
disputed, received and already fixed — are opaque to it in practice. Resolving them is the
answerer's obligation; a reporter should not have to poll.

**But they are not invisible *by construction*, and saying so was a load-bearing error.** This
repository is public, and every session in this fleet authenticates as the owner besides, so canon is
readable through the same token either way:

```sh
gh api repos/jrmoulckers/.github/pulls/281 --jq .merged_at   # 2026-08-11T08:02:12Z
```

Two independent reasons the claim fails, and the second is the fact recorded in
`jrmoulckers/.github#286` — a shared account makes `author.login` useless for telling an agent from a
human. There it made an authorization gate fail *permissively*; here it made an information claim
fail *restrictively*. One fact, two entries, opposite directions.

The consequence is that the sentence produced the condition it described: a member session told it
is blind stops looking, and one re-sent a settled item three times that a single `gh api` call would
have closed at any point. A reporter's cheap self-service check does not discharge the answerer's
obligation, but it does terminate the exchange when an answer crosses or goes missing, and canon had
closed that route by assertion.


**Answer a report by naming an artifact the reporter can check without another round trip.** A
prose confirmation — *I read the source, the hazard cannot occur* — may be entirely true and is
still unusable, because it is a second opinion rather than an instrument, and a second opinion
cannot come back negative. `sync/test/rekey.test.mjs:199`, merged in #220, can: the test may be
absent, may not assert what the reply claimed, may be skipped. That it can disagree is the whole
value, and it is the same rule as the known-bad fixture, applied to a sentence instead of a check.

The practical tell is repetition, but it does not have a single cause and the obvious remedy fits
only one of them. A report arriving again is *sometimes* evidence that the previous answer was
**unciteable** rather than that the reporter is insistent — the cleanup-before-rekey hazard was sent
three times, having been investigated, disproved and regression-tested after the first, and each
reply asserted the finding while none named the test. Re-sending was the correct move on the
information the reporter had.

**Do not stop at that diagnosis.** A later exchange repeated an item whose answer named a file, a
line range and a merged pull request — citeable by any standard — so at least two other causes are
live, and writing a better citation addresses neither:

| Cause | What actually fixes it |
| --- | --- |
| The answer was unciteable | Name an artifact that can disagree |
| The answer and the re-send **crossed** | A timestamp the reporter can compare against their own send time |
| The reporter believes the artifact is unreachable | Correct the belief — see the opening of this section |

So carry a **merge time**, not only a reference. A reference answers *what*; only the timestamp lets
the reporter distinguish an answer that never arrived from one that was already in flight, which is
the distinction they are actually stuck on.

**The same measurement is timestamped or unmoored depending on the channel it travels in, and only
one of the two channels attaches the timestamp for you.** A test count in a commit message or a pull
request body is safe by construction: it is bound to the revision it is attached to, and a reader
resolves it against that revision without being asked to. The identical sentence in a cross-session
message is read as *current*, because it arrives carrying no revision and lands in a conversation
about now. Same words, different truth conditions, decided entirely by the medium. Three stale facts
crossed between sessions in one night — a test count, a claim about a member's `.gitattributes`, an
abbreviated quotation of a managed region — and every one of them travelled by message rather than by
file. So: **in a cross-session message, a measurement without its SHA is not a measurement.** Not
because the number is wrong when taken, but because the channel strips the only thing that would let
a reader discover it had aged. This is why the merge time above is required rather than courteous;
that rule is this one applied to a single kind of claim.

The corollary constrains what to build next. Nothing in canon quotes a test count — verified across
every tracked `.md`, zero hits — so a guard pinning the suite size would have **no live instance**
and would be the shipped-documented-inert pattern acquiring a fresh example rather than losing one.
The hazard is real and the docs are not where it lives; it lives in a channel no test can reach.
Symmetry with an existing guard is not evidence that a new guard has anything to catch.


Citing an artifact also terminates the exchange, which prose cannot do: prose's only confirmation
channel is another message, and that message is subject to the same defect.

**Replacing a rule leaves its justifications behind, and they survive as competing rules.** Every
other duplication rule in this document treats duplication as something an author introduces through
carelessness or convenience. This kind is produced by a **correct fix**. When assertion 2 was changed
from equality-with-a-reference to provenance, the statement was updated and the places that had
argued for it were not, because a fix draws attention to what a rule says and not to where it was
justified. What remained two paragraphs below was a rationale for capturing the pre-rebase hash on
the superseded grounds that equality with it was the property — beside the current grounds that it is
merely expensive to recover afterwards. Two rules, neither a paraphrase of the other, so the
delete-don't-paraphrase rule does not reach them, and each reading perfectly well in isolation. This
variety is more durable than ordinary duplication precisely because the survivor was correct when it
was written. **After changing what a rule asserts, search for the text that explains why** — the
reconciliation at *Capture the pre-rebase hashes* below is what that search produces, and it happened
only because a reader went looking.

**Write a hazard and the invariant that detects it in the same place.** The merge hazard above and
the provenance assertion were written the same night against the same failure and did not reference
each other, because one was filed as a warning and the other as a check. That mattered: of the three
assertions, provenance is the only one that tests whether the region is *unmixed*, which is exactly
the property a conflict prompt on backbone-owned lines invites a resolver to violate. Filing them
apart cost the link between the two, and neither reader had cause to look for it.

**Qualify every issue and PR number that leaves this repository — `jrmoulckers/studio#73`, never
`#73`.** A citation discharges the obligation above only if it denotes the same object in the
reader's namespace, and a bare number does not: the recipient resolves it against *their* repo,
where it succeeds and returns a different issue. It does not error, it fails plausibly, and GitHub
renders it as a live link wherever it is pasted, so the wrong answer arrives looking more
authoritative than a missing one would. This repository sits between eight members, so nearly every
number it forwards crosses a boundary — one such relay reached a member session tonight and resolved
there to an unrelated issue. Paths, SHAs and blob hashes are namespace-free and need no
qualification; issue, PR and discussion numbers always do.

**The same defect has a positional form: a reference that is unique only by *position* is resolved
against the reader's copy of the ordering.** An ordinal — "assertion 3", "the second table", "step
4" — behaves exactly like a bare issue number: it does not error, it resolves, and it resolves to
whatever occupies that slot for the reader. It happened in this thread. A member raised "assertion
3" meaning the region-provenance rule; in this document provenance is **assertion 2**, and assertion
3 is the outside-the-markers check, so the reference silently designated an unrelated item on
arrival. Ordinals are also less stable than issue numbers, since any edit that inserts an item
renumbers everything after it while every existing citation keeps pointing at a slot. Cite the
content — the rule's name, its opening words, or a quoted line — and let position be a convenience
rather than the identifier.

**Line numbers are the purest form of this and were not covered by the rule that named ordinals.**
The rule above was written keyed to a *form* — "assertion 3", "the second table" — and a file
coordinate does not look like an ordinal, so it read as exempt. It is not: `docs/sync.md:521-533` is
position and nothing else. This was demonstrated at cost. A member was instructed to cite
`docs/sync.md` L521-533 for the Prettier traps; by the time they went to use it the traps had moved
to L532-547 and L521-533 had become unrelated text about vendor trees, displaced by edits landed
the same night by the author of the instruction. The citation did not survive the session in which
it was issued. **Key the rule to the property — a reference resolved by position — not to the
vocabulary of ordinals.**

**A measurement attributed to the wrong session is the same defect with no resolution mechanism at
all, and it is a hazard of the hub rather than of any member.** Relaying one member's figures to
another, this repository wrote *"your 447 → 264"* to a member whose measurements that night were
`4033/4033/5346` and a `16/5 → 23/23` lockfile delta. The numbers were real and correctly measured;
they belonged to a different repository. The recipient could only catch it by recognising the absence
of their own work — which is the whole problem, because **a bare figure carries no field that can
fail.** A wrong `#N` resolves to something visibly unrelated, and a wrong line number at least lands
in a document someone can open; `447 → 264` resolves to nothing, agrees with any context fluent
enough to receive it, and is falsifiable only by the one party who knows it is not theirs.

Two consequences. **Attribution is a citation, so name the source of every figure you relay** — the
member and, ideally, the artifact it was derived from, exactly as a quotation names its document.
And note where the risk concentrates: members hold only their own measurements and cannot cross-check
each other, so **the coordinating node is the only place where two members' numbers can be confused,
and the only place with no peer able to detect it.** A hub that relays measurements inherits an
obligation the members do not have.

**The line-number failure is worse than the bare-issue-number failure, for a reason specific to
well-organised documents.** A bare `#N` resolves to an arbitrary issue, which is often visibly
unrelated. A stale line number lands in the *neighbourhood* of its target, because related material
is written together — so it returns real, plausible, on-topic prose and reads as confirmation. A
member sent here for the provenance assertion landed twice, at two different revisions, on
provenance-adjacent text while the assertion itself sat further down. The better the document's
organisation, the more convincing the wrong answer.

A range that had fallen off the end of the file looks **safer** — an error is a signal, a near-miss is
not — but that is only true for a reader holding the true artifact, and it was falsified here. The
member's `~L1986-2036` was far past the end of a **1872**-line file and did **not** read as an error to
them, because their decoder had inflated their copy to 4314 lines, where it lands mid-document. **Past
the end of the file is a relation between a coordinate and the reader's copy, not a property of the
coordinate**, so the one failure mode that was supposed to announce itself is silenced by exactly the
corruption that most needs announcing. Out-of-range is a signal only to whoever holds the real file,
which is generally not the person who needs it.

The worked example originally recorded here — *two readers, one file, two disagreeing coordinates and
one agreeing locator* — has been **withdrawn**. There was no disagreement: one coordinate was real and
the other was an artifact of the sender's decoder, retracted by them twelve minutes before this entry
merged. The rule is unaffected and the genuine demonstration is the recipient's own `L785` read, which
returns real conflict-resolution guidance at `5fcd296` while the assertion sits at `L831`.

**Note where the correction had to be made twice.** When the decoder was found, this entry was amended
where its *reasoning* lived — the analysis below — and the fabricated *demonstration* above it was
left standing, so canon carried a claim and its refutation forty lines apart with nothing linking
them, and the reader meeting the demonstration first had no reason to read on. An amendment goes to
the argument, because that is what the correction is about; the evidence is a separate paragraph that
nothing prompts you to revisit. **After withdrawing a claim, search for the passages that were
offered as proof of it** — they do not mention the claim by name and will not surface in a search for
it.

**And keep the withdrawn claim's own wording inside the withdrawal.** The sentence above retains
*two readers, one file, two disagreeing coordinates and one agreeing locator* on purpose. Delete the
wording and a reader who remembers the claim searches for it, finds nothing, and concludes the entry
was **never there** rather than that it was retracted — absence is not a distinguishable state, so a
clean deletion makes the retraction invisible to precisely the reader who needs it.

The aggravating case is who that reader is. **Whoever searches for a withdrawn claim's phrase is
usually whoever acted on it** — they remember the wording because they used it — so the population
that most needs the retraction is the one a tidy deletion serves worst, and it fails silently for
them, because a zero-hit search reads as a settled question.

This is also load-bearing for a procedure canon publishes. Members are told to search the exact
phrase, not its topic, when checking whether a rule reached them; that instrument cannot separate
*never existed* from *deleted on retraction*. So deleting a withdrawn claim's words does not merely
lose history, it degrades a check the fleet is instructed to run.

So the earlier split — paths are namespace-free, numbers are not — is too coarse, because
`docs/sync.md:785` is a path *and* a number, and only the path half survives:

| Locator | Survives |
| --- | --- |
| Path, SHA, blob hash | any reader, any revision |
| Bare `#N` | one repository |
| `path:LINE` | one revision |
| **Quoted content** | any reader, any revision — and self-verifies on arrival |

A line number is namespace-scoped exactly as a bare issue number is. Its namespace is a *revision*
rather than a repository, and canon advances daily, so `path:LINE` was usually true when written.

**Quoted content is the only locator that carries its own check.** Every coordinate resolves silently
to whatever occupies the slot and none can report having landed in the wrong place; a distinctive
phrase can, because the reader sees the text fail to match and recovers with `git grep` instead of
with a question. That is the rule about naming an artifact that can come back negative, applied to
the **address** rather than to the evidence — and it is why a quoted phrase beats a line cite for
the same reason `sync/test/rekey.test.mjs:199` beat citing a pull request number.

**But that check has a bound, and the bound is the reason the table above keeps four rows.** Content
resolution verifies that *a* document contains the phrase. It cannot verify that the document is the
one under discussion, because a reader holding the wrong artifact still finds the text and reads the
hit as confirmation. A member reported that a `path:LINE@SHA` cite had failed at the pinned revision,
quoting real prose from this file as proof, and concluded that pinning fixes provenance but not
correctness and that the table should collapse to content alone. Measured at that commit
(`b52e4a00`, blob `4ec5029d`), the file is **1684 lines**, the cited range held exactly the passage
claimed for it, and the prose they quoted as the occupant of that range sits at **L302**. The
relocated passage they offered instead was at **L2032 — past the end of the file.**

**They were not holding a different artifact.** That was the reading recorded here first, and it was
wrong: the reporter found the mechanism and retracted, and blob comparison has since confirmed it
outright — both sides hold `4ec5029d` at that revision, byte for byte. They were holding *this*
document through a decoder that destroyed it. `gh api --jq .content` returns base64 as roughly 2630
sixty-character lines, and their shell decoded each **separately** and rejoined with newlines, so
every 60 bytes became its own line and the file inflated 2.56×. That factor is visible in both
discrepancies: their `L2032` is `794 × 2.56`, and the prose they quoted for `L785` sits at
`L302 ≈ 785 ÷ 2.6`. Nothing was random; the coordinates were consistently *scaled*.

**That is a stronger case for keeping both rows than the one originally recorded here.** The
corruption preserved every word and destroyed every line boundary — so it was invisible to content
resolution *by construction*, and detectable only by a coordinate. The two instruments did not merely
happen to catch different faults; this fault was located precisely in the dimension one of them
cannot see. A decoder that mangles structure while leaving prose fluent is the exact adversary that
defeats quoting.

Two further things came out of the retraction, and both are about verifying one. **A retraction needs
measuring exactly as much as the claim it withdraws** — accepting it unverified is the same
deference, inverted. Measured across the four revisions, the passage sits at `750 → 785 → 794 → 825`,
which confirms the withdrawn half was the error: `path:LINE` **does** decay, ordinarily, and the
original entry stands unamended. It also shows the first cite was never wrong at its own revision,
and that the cited *range* `785-803` still contained the passage nine lines later — a range degrades
more gracefully than a point.

And verifying it broke an instrument here. `git show <sha>:docs/sync.md | Measure-Object -Line`
reported **1401** lines against the true 1684, because `Measure-Object -Line` counts lines *within*
each string and an empty string contains none: it silently returns the **non-blank** count, short by
exactly the 283 blank lines. It fails toward a plausible number, on prose it scales with formatting
rather than content, and it disagreed with a correct earlier measurement of the same blob. Count
elements, not `-Line`. Recording it because the sequence is the point: a member's broken decoder was
caught by a coordinate, and the audit confirming it ran on a counter that was quietly wrong in the
same direction.

**And this entry then failed to protect its own author, which is the more useful half.** Hours after
it was written, a peer reported a two-blob census of this file; their line counts disagreed with mine
by 461 and 452, and my counts came from `Measure-Object -Line`. The measured split was exactly the
recorded one — `.Count` returned 2887 and 2792 against the cmdlet's 2427 and 2341, and the gaps were
the 460 and 451 blank lines. Their figures were right and my instrument was wrong, in the file
carrying the warning, while reading that file.

Note the near miss in the direction that matters: the undercount was **plausible**, so the disagreement
read as *their* error. Had I trusted the cmdlet I would have corrected a correct peer with an
authoritative-looking figure produced by a command. **An instrument that fails toward plausibility does
not merely mislead its user; it arms them**, because the output is then spent on somebody else.

The rule this confirms is the one about recorded rules not being applied ones, and the remedy is the
same shape: not a restatement, but a property of the recorded commands. Every counting step in this
document's standing checks reads `.Count` or `@(...).Count`, and `-Line` appears in canon only in
this passage, as the example of what not to use — verified rather than asserted. A rule that has now
failed its own author does not need saying more loudly; it needs to stop being reachable.

Every instrument that member trusted agreed with them. The quoted phrase resolved, the SHA was pinned
and exact, and the neighbourhood was on-topic. The coordinate was the only thing that dissented — it
was past EOF, and a line beyond the end of a file returns nothing rather than near-missing.

**That was recorded here as the coordinate working as a detector. It is withdrawn: it fired by
arithmetic accident.** The reporter's objection is right and the numbers settle it. Detection required
the scaled coordinate to clear the end of the file — `L × 2.56 > 1684`, so `L > 658`. The cited
passage sat at **L794**, clearing the threshold by 136 lines. Had the cited passage been anywhere in
the **first 39% of the document**, the same corruption by the same factor would have produced a
coordinate landing comfortably *inside* the file, on plausible neighbouring prose, and dissented
about nothing.

So the detection was conditional on the product of three quantities none of which the reader
controls: the inflation factor, the position of the cited passage, and the length of the file.
**A detector whose sensitivity depends on where in the document you happened to be pointing is not a
detector**, and generalising from the case where it fired means reading a 61% coin as an instrument.

**The bias is worse than a fixed coin, because it moves the wrong way.** Detection needs
`L × f > N`, so the blind region is the first `N/f` lines — a blind *fraction* of `100/f`,
independent of file length:

| inflation factor | blind fraction |
| --- | --- |
| 1.2× | 83.3% |
| 1.5× | 66.7% |
| 2.56× | 39.1% |
| 4.0× | 25.0% |

As `f → 1` the blind fraction → 100%. So the detector is most sensitive to violent corruptions,
which any instrument catches and which a reader often notices unaided, and blindest to mild ones —
where every other instrument also stays quiet and the mangled prose reads most plausibly. **Its
sensitivity is anti-correlated with the need for it.** The observed 2.56× sat near the favourable
end of that range, so the one case it fired on was close to its best.

That is a sharper reason to withdraw it than the coin-flip framing: an instrument with a fixed
success rate is merely weak, while one whose success rate rises with the ease of catching the fault
some other way contributes nothing at the margin where instruments matter.
The narrower, defensible statement is the one recorded earlier and unaffected: past-the-end is a
*relation* between a coordinate and the reader's copy, not a property of the coordinate — which is
precisely why it cannot be relied on, since the relation is destroyed by the same corruption that
would need to announce it.

What survives is the conclusion, not this argument for it: **content and coordinates detect different
faults and neither subsumes the other.** Content catches landing in the wrong *place*; a coordinate
catches holding the wrong *document*. That still holds, and the bound on content stands independently
— content resolution verifies that *a* document contains the phrase, never that it is the document
under discussion. It simply was not demonstrated by this episode, because both readers were holding
the same document all along.

Note also the general hazard the withdrawal does *not* license: **a detector that returns a confusing
negative has not failed, and removing it on that evidence removes the finding along with the
confusion.** When a locator class appears to fail, first ask whether it failed *as an instrument*.
That rule survives; what it does not license is the converse, which is what was recorded here — **a
detector that fires once is not thereby shown to be sensitive.** A single success is compatible with
any sensitivity above zero, and the case for an instrument has to come from the conditions under
which it would have stayed silent.

The remedy the episode argues for is the row most likely to be dropped as redundant: a **blob hash**
denotes the bytes themselves, with no namespace, no revision, and no position, so two readers holding
different artifacts discover it in one comparison instead of four exchanges. Pair it with a quoted
phrase and the two failure modes are covered; either alone leaves one open.

This one is not an inference — it is what closed the dispute. The reporter and this repository
compared `4ec5029d…` at the pinned revision and it matched byte for byte, which ended a four-message
argument in a single exchange and established the fact every other instrument had failed to settle.
Note the asymmetry that makes the row worth keeping even so: the two sides' hashes for `main`
*differed*, correctly, because canon had advanced in between. **A hash mismatch is not evidence of a
different artifact; it is evidence of different bytes**, which is a stronger and narrower thing, and
it is the only reading that survives a repository that commits daily.

#### A recorded rule is not an applied rule

The failure above was found by applying a rule this document already contained. One entry earlier it
records: after withdrawing a claim, search for the passages offered as proof of it, because an
amendment goes to the argument while the evidence sits in a separate paragraph that never names the
claim. That is exactly what happened here, in this section, by the same author, within the same day —
the retraction was incorporated into the paragraph that stated the artifact-mismatch conclusion, and
the paragraph that used it as a worked detector was left standing.

Worse, the two sat in a readable order that concealed it: a conclusion asserted, then reversed three
paragraphs later, then relied upon again nine paragraphs after that. A reader who stops early gets the
withdrawn claim, a reader who reads on gets the correction, and a reader who reaches the end gets the
withdrawn claim again as a general principle. Each paragraph is locally coherent.

So **write the withdrawal at the point of the claim, not after it.** A correction placed downstream of
what it corrects depends on the reader continuing, and every use of the claim upstream or downstream
of that point remains live. And treat "I have recorded this rule" as no evidence at all that the
corpus complies with it — the recording is one edit, compliance is a property of every passage, and
the gap between them is where a rule that everyone agrees with keeps producing defects.

**The same check applies before an artifact is read at all, and it is cheaper than either.** A member
fetched `sync/lib/basemerge.mjs` through the contents API, decoded the base64 and wrote it out with
`Out-File`, producing 8429 bytes against the 8067 the API had declared in the same response. In the
mangled copy `HASH_MARKER_TARGETS` appeared exactly once — used, never defined — and they were one
step from reporting an undefined-reference crash in the merge engine. The file is fine; the transport
was not.

Note what the corruption produced: not obvious garbage, but a **specific, plausible, actionable**
defect, which is the same near-miss property that makes a stale line number worse than a broken one.
Parsing successfully is not integrity. **An artifact fetched over a transport that can transform it
must have its integrity checked before it is read as evidence** — and the check normally costs
nothing, because `size` was already sitting in the response that delivered the content. This is the
generalisation of the earlier finding rather than a separate one: there the two readers held
different artifacts and only a coordinate dissented; here one reader held a corrupted artifact and
only a byte count would have dissented. Content resolution cannot detect either, because in both
cases the text found is real.

**Each detector covers one fault and is blind to the others, so adopting one is not adopting
integrity.** The same member applied the size check twice within an hour and it worked both times —
catching a truncated decode, then a 404 whose 127-byte JSON error body `Select-String` searched
happily, reporting zero matches for a claim and thereby *confirming* it had been removed. Then they
quoted canon's billing text as current and asked for a reopen. The text was real, it was in this
repository, and it had been replaced one commit earlier: they were reading the parent of the fix.
Size could not catch it — the file was intact — and content could not, because the words were
genuinely canon's. Only a revision identifier distinguishes a stale artifact from a current one:

| Fault | Detected by |
| --- | --- |
| corrupted or truncated bytes | size, hash |
| wrong artifact entirely | hash — a coordinate only when the corruption happens to push it past EOF |
| wrong location within the right artifact | quoted content |
| **right artifact, wrong revision** | **SHA or blob hash — nothing else** |

Two properties are worth carrying out of this. First, **transport failures bias toward reassurance**:
a truncated file yields a plausible defect, a 404 body yields zero matches that read as *fixed*, and
a stale copy yields a claim that reads as *unrepaired*. None arrives as an error. Second, the
integrity habit does not transfer between them — the member who had internalised the size check most
thoroughly was the one it could not help, because a stale read passes every check that a corrupt read
fails. **Report the revision you read, not just the text you found**, and the failure becomes visible
to the reader who can resolve it.

**Sync manufactures the wrong-revision fault deliberately, and gives the reader no way to name it.**
The entry above treats a stale read as a transport accident. In this fleet it is a design output:
every member holds a generated copy of canon at a path mirroring canon's own, so at any moment there
are at least two real artifacts with the same basename and different content, and during a
distribution outage the gap grows without bound. One member reported the same billing claim across
four crossings, in good faith each time, and the resolution is not that they were careless:

| artifact | its L181 | real? |
| --- | --- | --- |
| canon `HEAD` (`defb562`, blob `7f306e2e`) | *canon claimed otherwise until a member falsified it* | yes |
| that member's synced `.github/instructions/` copy | *Actions is free on public repositories for every runner type, so this cannot happen there* | yes |
| canon `9011023^` | the narrowed larger-runner exemption | yes |

Three artifacts, one path, one line number, three incompatible claims — and their `:181` citation is
**exactly right for the copy in their hands**. So the reply *"that is stale, you read an old
revision"* is itself the wrong move: it charges the reader with an error for holding the artifact
this engine published to them.

Two things follow, one of them an engine gap. **A published copy is a claim this engine made, so its
disagreement with canon is this engine's defect and not the reader's** — and while distribution is
blocked the same correct report will keep arriving, because nothing else can happen; fix the
distribution, not the reporter. And the round trip could not self-terminate because **the copy cannot
name its own origin revision**: `PROVENANCE_NOTE` records the source repository, and
`.studio-sync.lock.json` records `backbone` and `generatedAt`, but neither carries a canon SHA. The
reader is asked to report the revision they read while holding an artifact that does not know one.
Stamping the canon revision into the provenance header closes this, and is deliberately **not** done
here: that header sits on every synced file in every member, so changing it rewrites all of them and
invalidates the sync PRs the billing outage is currently holding open. Right change, wrong moment —
land it in the wave that drains those PRs, not before.

**And that warning was attached to the one input with a perfect stability record, while the real
hazard shipped twice through the renderer.** Extracting `PROVENANCE_NOTE` at all seven revisions of
`provenance.mjs` shows it byte-identical at every one — it has never moved. `inject` moved twice in
two days: `31b5271` gave `.kt`/`.swift` compilable block comments, and `e4e8f23` unified the
classifier and changed six of sixteen types from the HTML fallback to `#`. Recognition does not
compare the note; it compares the **rendered file**. So the invariant is not *the note is stable*,
it is *`inject` output is stable*, and the note is merely one of several inputs to it.

The mechanism is `attachCanonHistory` in `sync/lib/assets.mjs`: it reconstructs past engine output
by rendering **historical raw canon through the current renderer**, then matching hashes. Every
rendering change therefore orphans every file stamped in the old form — those bytes are no longer
reproducible, `isHistoricalCanonOutput` misses, and the member is reported as having modified a file
it never touched. A member holding a `.editorconfig` or `.npmrc` stamped before `e4e8f23` is in
exactly that state now. **`inject` is a hashed interface, not a formatter**; there is no such thing
as a cosmetic change to it.

Three things generalize past this engine.

**A guard attached to a name leaves the rest of the class open.** The hazard was held as *do not make
`PROVENANCE_NOTE` revision-valued* — a true statement about one identifier — when the actual hazard
is *do not change what `inject` emits*, of which the note is one instance. Both real breaks were made
by someone editing comment syntax, who had every reason to believe they were changing formatting.
The warning was not where they were working, and could not have been, because it was addressed to a
different editor. Name the invariant by the property that must hold, not by the variable you happened
to be looking at when you noticed it.

**A stability record is an argument against warning there, not for it.** The instinct that put the
warning on the note is that the note is important, and important is not the same as volatile. Seven
revisions of never changing is the strongest available evidence that the next change will not be
there either — so effort spent guarding it is effort not spent on the code that moved twice in the
same window. Rank guards by what has moved, which is measurable, rather than by what would be bad,
which is intuition.

**And the commit that fixed the defect was itself an instance of the hazard the same conversation was
describing.** `e4e8f23` closed the HTML-fallback gap correctly and broke recovery for six types while
doing it, in the window where both parties were discussing recovery fragility — because the fragility
was under discussion by name, and the fix was to something with a different name. Being mid-discussion
about a hazard does not confer any protection against committing it; the discussion has to be about
the shape.

The pin now lives in `sync/test/rendering-stability.test.mjs`, which states the rendered first line
of every classified type and fails on any change to it. Mutation-proved by moving `.editorconfig`
back to the HTML family — the reverse of the real `e4e8f23` edit — and confirming it reports `was: #
…` against `now: <!-- … -->`. What the pin does **not** do is repair members already holding orphaned
bytes; that needs the recovery set to be rendered by the renderer of its own revision, or recorded
at publish time rather than recomputed, and it is filed separately rather than guessed at here.

**What makes a line number uniquely bad is that the act which invalidates it is correct, unrelated,
and elsewhere.** A renamed function breaks its references visibly; a moved file breaks a link; a
changed API breaks a build. Editing a document *above* a cited range breaks every citation into it
and produces no diff at the citation site, no conflict, no failing check, and no notification to
anyone holding the reference. Nothing anywhere is wrong. Measured across this document's own history,
by resolving the target heading by content at each revision:

| revision | `### Members must exclude canon from their formatters` | the traps passage |
| --- | --- | --- |
| `86cd28d` | L462 | L521 |
| `5afec6e` | L462 | L521 |
| `e1c12c7` | L471 | **L530** |

The nine-line shift was caused by inserting new guidance at L433-441 — a correct edit, in a different
section, by the same author who had just issued `L521-533` as a citation. So the reference went stale
between being written and being used, with no act of carelessness anywhere in the sequence. **A
locator whose validity depends on every future edit made above it is not a locator.**

Note that the heading column does not move at all across the first two revisions and shifts once
with the section itself, while the passage column shifts independently — which is the property the
name-based ruling below depends on, measured rather than asserted.

**The mechanism behind all of this arrived from a correspondent, and it is the sharpest form: writing
a rule down changes what you would say if asked; it does not change what you emit by habit, because
those are different systems.** This subsection's opening rule treats compliance as a property of the
corpus — one edit to record, every passage to satisfy; this is the same gap on the author side, and it
explains why every instance collected here has the identical shape — a rule already agreed with,
already written, failing anyway.

The confirming evidence arrived from both sides within one hour. They adopted *date the fetch, not the
commit*, then authored the next five fetch timestamps by hand rather than reading a clock. I landed
*before characterizing a message, paste the line* and failed it for the third time. And this document
already held the remedy for a defect I spent an entire loop rediscovering.

So **a rule that has failed after being written is not evidence that it needs restating** — restating
is precisely the intervention that already did not work. The rules that hold change an **artifact or a
procedure** rather than an intention. Their own example is the model: their footer became trustworthy
when the timestamp started being emitted by the same command that performs the fetch, not when they
agreed it should be. Everything on this side that stuck has that property — the insertion checks, the
diff-scoped non-latin sweep, `--body-file` over `--body`. None of them are things to remember; they
are commands that fail loudly.

Before landing a rule here, ask what artifact or command it changes. **If the honest answer is "the
author will be more careful," it will fail — and it will fail in the message where it is being
invoked against somebody else**, which is where three of the instances recorded above were found.

#### A name must be resolved as a heading, not as a substring

This table originally labelled its own column with a citation to a section named "Two Prettier API
traps" — a string that appears in this document, at the line the column reports, and **has never been
a heading at any revision.** What is there is a bold paragraph lead-in, `**Two Prettier API traps,
both live, one silent.**`. Bold text gets no anchor, so the citation fails both as a heading scan and
as an in-page link. The table documenting locator breakage was labelled with a locator that never
resolved.

Two readers validated it independently, both "by content", both landed on the correct line, and both
were wrong about what kind of thing was there. **The procedure used to validate the name-based scheme
cannot test the property that scheme depends on.** `§ X` asserts that X is a structural element;
substring resolution confirms only that those characters occur somewhere, and returns the same answer
whether the match is a heading, a bold lead-in, a table cell, or a line inside a fenced block. It is
not a weaker check of the right thing — it is a check of a different thing that agrees with the right
one on every input except the failing ones.

So resolve a cited name with a heading-anchored, fence-masked pattern (`^#{1,6}\s`), not with a plain
search. The negative result is the informative one: a name that appears but is not a heading is
precisely the case a substring search reports as success. This document currently contains **35** bold
paragraph lead-ins, every one of which reads like a nameable section and none of which is one, so the
population that can produce this error is large and is not shrinking.

The relationship to the staleness failure above is worth naming, because the two are complementary
rather than similar. A stale line number is **right-shaped and wrong-valued** — it resolves, to the
wrong place. A name that is not a heading is **fresh and wrong-shaped** — it never resolved, and the
check that was supposed to catch that reported success. Content-resolution fixes the first and is
blind to the second, which is why adopting the name-based scheme did not by itself retire the
problem. Both are the same underlying mistake at different levels: reading Markdown as flat text
rather than as structure.

The check that enforces this rule (`every heading citation in canon resolves to a real heading`,
`sync/test/instruction-integrity.test.mjs`) reproduced the same substitution three times while being
written, which is the best evidence that the class is not exotic:

1. The obvious pattern `` `#{1,6} …` `` matched `# synced from jrmoulckers/.github`, an inline
   `.prettierignore` comment. **`#` is comment syntax as often as it is a heading marker** — the
   collision already recorded for `.gitattributes`, arriving in a third place.
2. It then matched `` `## Needs Human Action` ``, which names a section the reader is instructed to
   *write*. **Backticked heading syntax is not the same predicate as "a citation"**; one is a shape,
   the other a speech act, and no regex separates them.
3. With both narrowed away it still failed — on *this passage*, because the prose describing the
   broken citation had quoted it verbatim. A checker cannot distinguish **use from mention**.

The third is the one with a standing consequence: **do not write an unresolvable citation in canon
even as an example of one.** There is no markup that says "this locator is being exhibited, not
followed," so the illustration is indistinguishable from the defect, both to a checker and to a reader
who skims. Name the broken locator in prose instead, as done above. The rule generalizes past
citations — any document that carries a counter-example in the same notation as the real thing has
made its own check impossible.

Note the direction of the reasoning, too. Each of the three was found by *running* the check, not by
review, and each looked correct when written. A check that fails on its first three runs against a
corpus its author believed clean is doing the work; one that passes immediately has usually
encoded the author's assumptions rather than tested them.

Note also which numbers agreed — and, on re-examination, what that agreement was actually made of.
The claim recorded here was that two sessions reported different totals for this file, 1349 against
1622, while both resolved the heading identically, and that the load-bearing measurement agreeing
while the incidental constant diverged is the corroboration signature of two instruments rather than
one reading copied.

The signature is real and the reasoning stands, but **this was the wrong instance of it.** The second
session states it never reported 1622; its totals were 1873 and 1940. And 1622 is not an invented
number — it is the exact split-count of this file at `86cd28d`, the oldest revision in the table. So
the figure is a true measurement of a real revision, attributed to a session that did not make it and
to a revision it was not measuring. **A number can be simultaneously correct and misattributed, and
being correct is what stops anyone checking the attribution.**

Two things worth carrying, since the same passage now demonstrates both:

**The one input a two-instrument check cannot cross-validate is a reading only one instrument
produced.** The whole force of the argument is that two independent measurements diverged; if one of
the two figures came from neither instrument, there was one measurement and a recollection. Divergence
between a measurement and a misremembering looks identical to divergence between two instruments, and
is evidence of nothing.

**Which makes the authorship query load-bearing, and the obvious one is blind.** Checking whether a
disputed sentence was actually mine, the natural search — this session's `turns.assistant_response`
for the hash under dispute — returned **zero rows**, and the sentence was mine. Outbound
cross-session messages are sent as tool calls, so their text lives in the call arguments and never
appears in the assistant response body. The default authorship query therefore excludes, by
construction, the entire population at issue in any cross-session dispute: everything this session
said to another one. It reports that absence as a clean negative, which reads as *I never wrote
that* — the most confident possible answer, produced by not having looked. Search `search_index`, or
the recipient session's `user_message`, and confirm the query can find a message known to have been
sent before trusting it to say one wasn't.

**Measured properly, the mechanism above is right and its explanation was incomplete.** A member
challenged it and forced the measurement. In this session `assistant_response` is *not* empty — 159
of 160 rows are populated — but every one holds the short user-facing reply that closes a turn,
around 1,500 characters, never the 5,000-character message sent to another session in the same turn.
So the column is not blind to this session's output in general; it is blind to output that leaves by
a tool call. Meanwhile the outbound text **is** present in the recipient's `turns` row, in
`user_message`.

The correct statement is therefore: **the store records delivery, not authorship.** Nothing is
written at the sender; the text is written at the receiver, where it is filed as what that session
*received*. A member read this as the record asserting someone else's authorship, which over-reads
the schema — `user_message` means *the input to this turn*, and a cross-session message genuinely is
that. But the practical consequence is theirs: authorship of any cross-session sentence is
recoverable only from the receiving side, by inference, and never by asking the session that wrote
it.

**Do not state a property of the store from one session.** The same member reported 0 of 39 rows
with an `assistant_response` and generalized it to the store; this session's 159 of 160 refutes the
generalization while leaving their own count intact. Whatever produces the difference, it is a
session-level property, and a schema-level claim needs rows from more than one session. Note also an
unreconciled discrepancy: an identical FTS phrase query on the same local store returned 2 rows for
them and 10 here, and neither of us can currently explain it — recorded rather than resolved.

**A half-failed query that still answers is more dangerous than one that fails.** Every cloud query
in that exchange timed out and the tool **silently fell back to the local store**, returning rows
plus a warning. Reproduced here: a `COUNT(*)` against the cloud store timed out at 60s and came back
with a local count and `_query_source = local`. Failure is self-announcing; a partial answer is
indistinguishable from a whole one at the point of use, and the sentence *"`assistant_response` is
empty for all turns"* would have been true of everything measured and false of the store.

**And note where each system put its caveat.** The fallback warning is printed *below* the result;
this session's own corpus-size sanity check was printed *above* one. Neither was read. Position does
not matter — **qualifying information adjacent to an answer is not read, because the answer is what
the eye was sent for.** The design that works is the `_query_source` column, because it lives
*inside the row*: it survives copying, filtering, and quotation, whereas a marginal note is stripped
by the first person who pastes the number somewhere else. Put the caveat in the row, not in the
margin.

**The generalizable test, which is the member's and is better than "is my instrument reliable":**
ask whether the disputed population is the one the instrument was built to ignore. Blind spots are
not randomly distributed with respect to subject matter — a tool built for the normal case
systematically excludes exceptional traffic, and disagreements between sessions are *made of* the
exceptional traffic. This is not covered by the exact-phrase rule: that failure is a correct
exact-phrase search against a corpus that structurally cannot contain the phrase.

**A second agent in the same repository is invisible in the artifact, and I attributed its work to a
correspondent.** Reading three studio commits that implemented a correspondent's analysis and cited
an issue of mine, I credited that correspondent. They had not written any of them: a different
session was operating in studio, and neither of us had modelled it. The inference — *this content
matches what they proposed, therefore they produced it* — is the same move as asserting a HEAD from
memory, raised one level: it attributes the **cause** of a state rather than the state, and content
is a much more persuasive fingerprint than a remembered SHA, which is what makes it worse.

The correction is not *attribute more carefully*, because the discriminating evidence does not
exist. Both sessions commit as the same git identity and push under the same account, so
`commit.author.name` reads `Jeffrey Moulckers` for every commit either produces, and no field in the
artifact separates them. The correspondent knew the work was not theirs only because they knew what
they had done — a private record, unavailable to me and unavailable to any future reader of the
repository. **Where the artifact cannot carry the distinction, the available options are to ask or
to not claim; there is no third one reachable by looking harder.** This is the same shape as the
blind authorship query above, and the more general lesson: check whether the fact you are asserting
is recoverable from the evidence at all before deciding which evidence to consult.

A corollary for this repo specifically: a member's HEAD can advance from a source that is neither of
the two correspondents discussing it, so *no news from you* is not evidence of *no change there*.
Studio moved five commits past the tip that message asserted, in the interval it took to arrive.

**And the tip I carry for a member is the value least likely to be re-derived, because it arrived as
a correction.** finance corrected me from `16fae203` to `234528e4`; I adopted it into the standing
status line at the foot of my messages, restated it verbatim across several turns, and it was
written into checkpoint records as fact — until finance corrected the same slot again, to
`ae36d0ca`. Measured while writing this, finance was at `3861a00c` and both later figures were
already stale. Three real values, each correct when taken, none current.

Two things are specific to this repo and worth keeping. First, the harm does not stop at the
conversation: a status line gets copied into durable session artifacts, so a figure that would have
decayed harmlessly in a message is preserved as a recorded measurement and re-read later as one.
Anything restated by habit should carry the timestamp of its measurement into the checkpoint, or be
recorded as *last seen* rather than as state. Second, I am the party maintaining a table of twelve
member tips, which makes this the failure mode I am structurally most exposed to — every row is a
value someone else corrected me into, and the table is never the subject of the message it appears
in. **Re-derive the rows you are about to publish, or publish the date you took them.**

**A premise adopted from vocabulary survives any amount of careful reasoning built on it.** A member
called `agent-layer` a *required check* for ten messages and reasoned meticulously about what a
skipped required check does to a merge — while the repository had no branch protection at all, so
nothing was required and no check state could have blocked anything. The downstream analysis was
correct and load-bearing on a premise nobody had measured, and *required check* is simply the phrase
one reaches for when talking about CI. Two API calls would have settled it, free, at any point.

The reason this class is hard to catch is that careful reasoning **feels like** verification: each
step is checked against the one before it, so the chain gets stronger while its anchor stays
unexamined, and the growing confidence attaches to the conclusion rather than to the premise that
was never in question. Related to the clean-audit rule above, but distinct — there the audit was
performed and could not see the property; here no audit was attempted, because the property arrived
already stated. When a chain of reasoning turns out to rest on an unmeasured premise, the length of
the chain is evidence of nothing.

Worth recording as the concrete asymmetry it exposed: **this repository is the only one in the fleet
with branch protection**, so the merge doctrine written here is derived entirely from the one member
that has a platform enforcing it, and distributed to eleven where the gate is discipline. That is
the keyed-to-one-instance failure at the level of a whole practice rather than a predicate.

**And a systematic offset is a convention, not a second instrument.** Re-measuring all five revisions
here gave 1621, 1629, 1648, 1847, 1939 against the other session's 1622, 1630, 1649, 1848, 1940 —
exactly one less, at every revision. That is not two readings of a file; it is one file under two
definitions of "line", `LF`-count versus split-count on a file ending in a newline. Both are right
under a stated convention and neither is stated. A constant offset across every point is the
signature of a convention difference; corroboration requires the *residual* to vary, and here it is
identically zero. Which is the same trap recorded above under agreement deserving suspicion, arriving
one level down: the five-row agreement between those two tables is not five confirmations, it is one
convention applied five times.

**A constant offset is equally the signature of a constant lag, and the two are indistinguishable
by the residual test.** The same pair of sessions then diverged by ~34 lines, twice, at unrelated
revisions — an offset far too large and too repeatable to be the trailing-newline convention, which
explains exactly 1. It was not a convention at all. Both figures were measured at the merge
immediately preceding the one they were published under:

```
5e9c4ef 2223  ->  bfc9a1c 2257    consecutive merges, +34
b5c2bb2 2470  ->  15b5b9f 2504    consecutive merges, +34
```

A habit of quoting the last measurement while naming current `HEAD` produces an offset equal to the
document's growth over the lag, so on a document growing at a steady rate it is **constant, and
looks exactly like a convention**. Here the two magnitudes matched to the line by coincidence — two
consecutive merges that each happened to add 34 — which made the convention reading more attractive
still. The discriminator is not the shape of the offset but re-measurement: a convention difference
survives re-measuring both figures at the same named revision, and a lag vanishes. So when an offset
repeats, resolve both figures against the revision named before reaching for a definitional
explanation, because *we are using different definitions* is the reconciliation that lets both
parties keep their numbers.

**A stable residual establishes the convention and certifies nothing about the corpus — which this
episode also demonstrates, against itself.** Re-measuring the five revisions to check the offset
reproduced four of them exactly and returned 887 against the other session's 2421 on the fifth. That
row was labelled `main`. Three documents were being called that in one exchange: their `main` was
`48f45f4`, the tip when they measured; mine resolved to `0cc1b44`, a **stale local branch** from the
previous evening that no fetch had touched; the actual `origin/main` was `355cac4` at 2802. The
residual was exactly 1 in all three. So the quantity the argument leans on held perfectly while the
two parties were measuring different files, and would have held at any revision either picked — a
quantity invariant across inputs cannot discriminate between inputs. Agreement on the residual is
therefore consistent with disagreement about the document, and the convention question and the
revision question have to be settled separately.

**A branch name in a column of SHAs is not a coordinate.** It reads as one, sitting among immutable
values in the same column, and it is a query evaluated at read time against whatever ref namespace
the reader holds. The failure is silent in the worst way available: a stale *local* ref resolves
without a fetch, without a warning, and without anything marking the row as incomparable to the four
above it. This is the named-tip rule one level down — there the name was correct and the figures
beside it were not; here the name never denoted a revision at all.

None of this disturbs the heading resolution itself, which reproduced independently and is what the
argument actually rests on.

**A named tip certifies every other number in the message, whether or not it was measured there.**
The same passage's coordinate for the next heading after `L471` was published as `L649` in a message
that also announced `main` at `bfc9a1c`. At `bfc9a1c` that value is **683**; `649` is correct at
`5e9c4ef`, a revision the message never named. Fence-aware over all 212 revisions of this file, `649`
resolves at five published ancestors of `main`, so the figure was real, reachable, and attached to
the wrong revision *in the same sentence that named a revision*.

That is the previous entry from the other side — there, someone else's figure was relayed to the
wrong source; here, an own measurement was published against the wrong tip. The new part is that the
SHA made it worse. A reader binds every figure in a message to the revision it names, so **citing a
tip raises confidence in numbers never measured against it**, and naming a revision reads as rigour
while supplying the false coordinate the reader then trusts. Measure at the tip you name, or attach a
revision per figure.

**A negative result inherits the scope of the population searched.** The member disputing that
coordinate scanned five revisions and reported that it "matches no revision I can fetch". It matches
five — none of them in their sample, one of them the very PR they had used elsewhere as a bound.
Their instrument was fine and their population was wrong, which is invisible in the reporting because
*not in these five* and *not in any* are written the same way. State what you searched, not just what
you failed to find.

**And stability across the revisions you sampled is not structural invariance.** The same report
offered a consolation — fence-aware heading count was 28 at every revision measured, while the span
moved 125 lines — as evidence that structure is the stable thing to cite. It is 36 at `main`. The
quantity was not invariant, only *slower*, and anything that changes on some commits will look fixed
to any sample that misses them. Anything counted from a growing document is a coordinate with a
longer half-life. Only a **name** is genuinely revision-independent.

**When correcting a citation, quote it from the message being corrected.** That same correction
attributed a pair, `L649/L692`, of which only `L649` was ever written; `L692` appears nowhere in the
corrected party's messages, and the half that could not be resolved was the fabricated half. A
correction is a claim and needs measuring exactly as much as what it corrects — including the
question of what was actually said.

**That rule has now failed three times, and the third failure was mine against a message I still
held.** I characterized a correspondent's status list as omitting a pull request. The list named it,
in each of the last two blocks, with a titled section in both — and the message I read as omitting it
is the one that had introduced that PR to me. I did not quote it. The rule was already written, in
this document, from an earlier instance of itself.

So the operative constraint is not that the rule is unknown but that **it is invoked at the moment
one is confident about the record**, which is exactly the moment quoting feels redundant. A claim
about what a message said is a measurement whose artifact is *in hand* and therefore never fetched;
the cost of checking is one search, and it is nearly always cheaper than the argument being built on
top of it. **Before characterizing a message, paste the line.** If the line cannot be found, that is
the finding.

**And that rule has a hard limit — but it was written wider than it measures.** The claim here was
that *outgoing messages leave no artifact on this side at all*. Half of that is false: the session
store retains this session's visible responses across compaction and is searchable by phrase, so a
peer's report of what I said is checkable against my own record, and a positive attribution to some
*other* session is available too.

The surviving half is the load-bearing one, and only a control found the boundary. Two phrases, both
from text emitted in the same minute:

```
a phrase that appeared in a reply to the user   -> found, in this session's own turns
a phrase that appeared only in a peer message   -> 0 rows
```

**Visible responses are recorded; the bodies of messages sent to peers are not.** So a phrase search
over one's own history is blind in precisely the channel that correspondence disputes concern, and it
reports that blindness as a confident zero rather than as an error. The usefulness is inverted: the
record is complete for the audience that already holds the message and empty for the audience that
does not.

Without the control, a `count(*)` of zero would have been reported as proof of non-authorship. That
is the whole hazard in one step — the instrument answers, the answer is well-formed, and its
domain excludes the question. Run a phrase you know you sent through the same query first; if it
cannot be found either, the search has established nothing.

So when a correspondent reports that a figure I attributed to them appears nowhere in their output, I
can now check part of what I sent, and must still say which part. The honest form is unchanged and
merely better bounded: **"not found in what I can recover," stated as a bounded search rather than a
denial**, with the bound named. Over-denying is the mirror of the over-accepting this document warns
about, and a search that cannot see the disputed channel licenses neither.

**The inbound half fails differently.** Received messages *are* stored, so what a peer said is
recoverable — but the delivery envelope naming the sender is discarded before the body is retained.
Searching one's own turns for a peer's repository can return zero while that peer's messages sit in
the same column, indexed under their text alone.

| | body | envelope |
| --- | --- | --- |
| messages I send | absent | n/a |
| messages I receive | present | discarded |

This was nearly shipped as a false negative one exchange after the rule above was written. A query
for a correspondent's repository returned zero and was about to be reported as *this peer has never
written to me*; the messages were there, found by searching a phrase from their content instead.
**Query the text, never the envelope**, and treat a search keyed on any field the store does not
retain as unrun rather than as negative.

**But the stronger claim first drawn from this — that correspondence is unattributable in both
directions — was false, and measuring it is what showed why the envelope framing matters.** Sender
identity does survive, in the one place a transport cannot destroy it: authors who prefix their own
messages with a repository tag put attribution *inside* the body, where it is retained and
searchable like any other text. Across the fleet, 184 of 273 peer messages carry such a tag. So
attribution is not a property of the store at all — it is a property of each author's habit, and it
is sharply bimodal: four sessions tag essentially every message, three tag none, and the session
that wrote the false claim had tagged 3 of its own 31.

**That is the same wrong-grain error the entry was landed alongside** — a peer had just demonstrated
that a column's population varies per turn and not per session, and generalizing a session-level
count to a store-level rule is exactly the move that finding forbids. It was verified, agreed with,
written into the same change, and then committed in the next measurement, against a session whose
0-of-31 tag rate is the fleet's extreme rather than its norm. **Concurring with a rule is not
applying it**; the concurrence and the violation can travel in one commit, because agreement is
cheap at the paragraph you are writing and the error is in a paragraph you are not.

The surviving operational form is narrower and holds: what a transport strips is gone, but what an
author writes into the body survives the transport. **Durable attribution must be carried in the
content, never in the delivery** — which is the same design claim as putting a caveat in the row
rather than the margin, and it is why a convention that looks like decoration is load-bearing.

**And a phrase count over a corpus you are also writing to measures the discussion, not the prior
art.** A term under active debate was counted at 2, then 10, then 12, then 15 across four
measurements by two parties, rising monotonically because each exchange added occurrences and each
checkpoint re-indexed them. Two distinct defects sit inside that number: the corpus grows in response
to being queried, and one utterance yields several index rows — the same phrase was recorded as a
turn, a history checkpoint and a technical checkpoint, so the count enumerates index entries rather
than mentions. Before citing a phrase frequency, exclude the sessions doing the citing, and state
whether the unit is an occurrence or a row.

**The consequence for canon is the load-bearing one: entries outlive the messages that justified
them, so a rule stays checkable while its supporting instance does not.** Verified here by
accident — a correspondent credited me with a finding I could not remember making, and the proof that
I had made it was the canon entry derived from it, still in this file. Canon is the only surviving
record of my own correspondence, and it is a lossy one: it preserves the rule and compresses the
instance, which is precisely the half that was drawn from an artifact nobody will hold later. That is
the mechanism behind the fabricated instance corrected earlier tonight — not carelessness at
authoring, but an instance whose source expired while the entry stayed, leaving nothing that could
ever contradict it.

So when landing an entry drawn from correspondence: **cite the artifact, not the conversation.** A
`repo@sha`, a run id, an API path and its response — anything a later reader can resolve without the
messages. Where the instance is *only* a conversational fact, say so in the entry, so a future reader
knows the claim was never independently resolvable rather than assuming it was checked and has held.
The repository outlives the conversation on both sides; nothing else does.

**A citation also only discharges the obligation if the artifact is reachable by the audience.** This
document is backbone-internal: `docs/sync.md` is not a canon kind, appears in no member's lockfile,
and is distributed to nobody. Telling a member to "see `docs/sync.md`" names an artifact they cannot
open, which is worse than restating the reasoning, because it reads like a resolvable pointer and
fails only at the moment someone tries. The rule about naming an artifact the reporter can check
assumed a shared filesystem; across a repository boundary that assumption has to be tested rather
than inherited.

So for anything crossing into a member: **keep the reasoning inline, and cite this document by
section name rather than by line range.** A name survives edits above it and degrades to a search
rather than to silence. The inline copy is not duplication under the delete-duplicates rule, because
the alternative is not a single source of truth — it is a dangling pointer. If the duplication is
genuinely unacceptable, the fix is upstream: promote the section to a distributed instructions file,
and only then may the member delete its copy and cite it.

**The sharper form of the same boundary: decide which half of canon a correction belongs in before
recording it.** The rule above covers *pointing* at this document. It does not cover *writing the
correction here* while the distributed instructions go on asserting the thing that was refuted —
which is worse than a dangling pointer, because nobody is pointed anywhere and nothing indicates a
correction exists. The readers governed by the rule keep the false rule **and** lose the chance of
rediscovery, because the question now looks settled to everyone who can see the analysis.

This has happened twice in consecutive messages, so treat it as the default failure rather than an
edge case. Distributed canon asserted that quoted content self-verifies for as long as it took
someone to argue the opposite point; the correction had been recorded here the whole time. In the
next exchange, the only positive recommendation the locator argument produced — that a range degrades
more gracefully than a point — was likewise recorded here and absent from the file that actually
governs citation. **After landing any correction, ask what the distributed half now says about the
same subject**, and treat "the analysis is fixed" as only half the work.

### What belongs in the member's own region

Everything above concerns the *managed* region. The region **outside** the markers is the part
members actually author, and it carries an ownership rule that no tooling enforces:

Read the provenance marker as scoping the **region**, not the file. `AGENTS.md` and
`.github/copilot-instructions.md` carry the marker and are still partly member-owned, so a reader
who takes the marker to make the whole file read-only will stop maintaining the very section this
page says to maintain — and that failure is invisible, because an unmaintained local section throws
no error. Whole-file canon is read-only end to end; a managed-region file is read-only only between
the markers. (Formatter exclusions are the deliberate exception: they stay whole-file, because a
formatter cannot be aimed at half a file.)

**Root `AGENTS.md` owns policy. A member's local section is a pointer, never a second copy.** Keep
only what exists nowhere else in Copilot's default context — pointers to repository-specific
documents, exact local commands, and facts true of this repository alone. Delete anything that
restates a rule `AGENTS.md` or canon already owns, rather than paraphrasing or relocating it.

This matters because Copilot reads the *whole* file, not just the managed block, so a local section
that restates policy reintroduces exactly the drift the canon split removes. The failure is quiet:
drift detection hashes only the inner block, so duplicated policy outside the markers is invisible
to the sync engine and to member asset checkers alike. It is a review-time obligation.

**Delete duplicates; don't paraphrase them.** Softening a duplicated rule instead of removing it is
strictly worse than either keeping or deleting it, because a paraphrase matches nothing canon would
ever overwrite — so no future sync can correct it, and a subtly wrong restatement survives
indefinitely. That asymmetry holds even when you are wrong about *why* a line is a duplicate:
deleting a line that turns out to be load-bearing is a visible, recoverable mistake, while
paraphrasing one is a silent, permanent one.

**The exception is a line that is the only written record of a real local constraint.** That is not
a duplicate, and the trim rule does not reach it — the test is whether canon or root `AGENTS.md`
actually owns the rule, not whether the line reads as generic. When a genuinely local constraint is
sitting among generic neighbours, move it into an explicitly scoped local section and **say in the
PR that you over-kept it**, so a reviewer can drop it deliberately. Over-keeping visibly is
recoverable at review; deleting the sole record of a constraint is not recoverable at all, because
nothing remains to notice its absence. The live case was a member whose generic-looking bullets
included three real finance-specific rules (domain terminology in identifiers, integration tests
required for sync operations, dependency security posture for financial libraries).

The risk comes from **product overlays**, not from canon. The live example was a member holding the
same product design rules in three places — its `DESIGN.md`, a "Product design constraints" section
in root `AGENTS.md`, and its local section of `.github/copilot-instructions.md`. Name one owner and
let the other two point at it.

**Underneath both rules: when uncertain, prefer the error that leaves a trace.** Delete rather than
paraphrase, because a deletion is recoverable from canon and a paraphrase is indistinguishable from
it. Over-keep and say so, because an over-keep is visible in review and an over-delete leaves nothing
to notice. Both directions are mistakes and both are possible under genuine uncertainty — the choice
is not about which is less likely but about which one someone else can still act on. Prefer the
findable error; a paraphrase and a silent over-delete both fail by becoming unfindable.

### A guard and the branch it guards must share one predicate object

`hasFrontmatter` decided whether a file had frontmatter; `injectAfterFrontmatter`, which runs only
when that guard passes, decided where the frontmatter *ended*. Both answer "is this line the closing
delimiter," and both had their own answer for it — the guard matched `---` at column 0, the branch
matched `lines[i].trim() === '---'`, which also accepts an indented one. Nine lines apart, in the
same file.

A markdown horizontal rule inside a YAML block scalar is enough to separate them:

```yaml
---
description: |
  A rule, then a horizontal rule:
  ---
  and more text after it.
name: example
---
```

The guard sees frontmatter ending at the real closer; the branch stops three lines early and splices
the provenance stamp **inside** the frontmatter, into the middle of `description`. It stays valid
YAML, because the comment is just more text in a literal block, so no parser objects and no test
fails. The stamp is still emitted, still on its own line, still exactly the expected string — it is
simply no longer provenance, having become part of a value.

**And no human objects either, because the rule that protects the block retires its last reader.**
A member-side conformance check cannot help here: it asserts against the lockfile, so it catches a
member drifting from what the engine produced and certifies whatever the engine produced, however
malformed. That leaves a person reading the file as the residual instrument — and managed regions
carry `do not edit here`, which is precisely the instruction that removes any reason to read them
closely. The sync PR is the one moment those bytes are seen at all, and the review question defaults
to *did this come from canon?*, which is conformance one level up. So a rendering defect is invisible
to the parser, to the tests, to the member's checker, and to the member, in that order, and each of
those four is silent for a different and individually sound reason.

This is why the fix belongs engine-side and structurally: a member cannot validate a rendering
without reimplementing the renderer, at which point it is the vendored-copy problem again, and a
reimplementation that agrees with the engine proves nothing about either.

Three things generalize past this bug:

**The guard's promise does not constrain the branch when the branch re-derives the predicate.** A
proof that "the stamp always lands one line after the frontmatter ends" is a property of the code and
so inherits every branch of the code — including the branch that computes "ends" differently from the
guard that let it run. The proof was sound and the conclusion false, which is only possible because
the two functions did not share the term.

**The permissive copy is the dangerous direction.** A re-derivation that is *stricter* than its guard
fails closed and shows up as an unhandled case. One that is *looser* runs on inputs the guard never
admitted reasoning about, and there is nothing downstream to catch it, because everything downstream
was written against the guard's meaning.

**That is stated for a guard, and it is false for a locator — as the paragraph below this one
demonstrates without saying so.** A guard returning `false` declines to proceed, so stricter really
does fail closed. A locator returning "not found" hands control to whatever handles the miss, and
here the miss path *writes*: the strict re-derivation destroys the frontmatter outright on a file the
loose original handled correctly. So a stricter predicate is not conservative in general — it selects
a different code path, and whether that is safer is decided by what the miss path does, never by
which predicate is narrower. A member measured this by mutation and named the discriminator:
**fail-closed intuition is correct for verdicts and wrong for locators.**

Recording it as a defect in this document rather than a refinement, because both claims were written
here in one pass, twelve lines apart, and each reads as obviously true on its own. **A contradiction
between two paragraphs is invisible to the check that each paragraph is correct**, which is the only
check prose normally gets.

**The comment stated the correct predicate the code ignored.** The line above the loop read "find the
next line that is exactly `---`" while the code called `.trim()`. Prose adjacent to code is not a
weaker specification than the code; here it was the *accurate* one, and its accuracy is what made the
divergence invisible — a reader checking the loop against its own comment finds them in agreement.

The fix is not to correct the second predicate but to delete it: one exported `DELIMITER_RE`, used by
both. Correcting it in place reproduces the defect in a new position — and the obvious correction
here, strict `lines[i] === '---'`, does exactly that. The guard tolerates trailing spaces or tabs on
the closer, so strict equality is narrower than the guard, the loop finds no delimiter, and the
fallback prepends the comment **before line 1** — destroying the frontmatter outright rather than
misplacing a stamp inside it. A fix that re-expresses the rule a third time has to be checked against
the guard exactly as carefully as the bug did, which is the argument for there being nothing to check.

Pin a repaired divergence by **mutation**, not by the repaired code passing: revert to the original
predicate and confirm the new test fails, then substitute the *rejected* fix and confirm the other new
test fails. Two assertions that both pass against the fix prove only that the fix is self-consistent;
each one earns its place by naming a specific wrong implementation it excludes.

### Repairing one copy of a duplicated predicate leaves the pair worse than it found it

The rule above says delete the second predicate rather than correct it. Here is the cost of doing
half of that, discovered by `jrmoulckers/studio` while verifying the repair that caused it.

`basemerge.mjs` answered "which comment syntax do this file's managed-region markers use?" and
`provenance.mjs` answered "which comment syntax does this file's header use?" — the same question,
asked by two callers, from two tables. When `markersFor` lost its default and became
derive-or-throw, its table was widened to be correct. The other was not. The pair then disagreed by
**eight types** — `.conf .dockerignore .editorconfig .gitmodules .npmrc .prettierignore .properties
.sh` — with `basemerge` advertising hash-comment support for files the stamper was prepending
`<!-- … -->` to. The disagreement was one-directional: a strict superset, so no reverse case existed
to make it obvious.

**Both copies being wrong together is a more stable state than one being right.** While both tables
were narrow, a reader who thought to compare them found agreement and correctly concluded there was
no divergence *between them*. Repairing one destroyed that: the pair became inconsistent, and the
inconsistency is visible only to a reader who diffs two tables in two files and knows they are meant
to be the same table. A duplicated predicate has no partially-correct state — improving one copy
converts a shared error into a divergence, which is the harder defect to see.

**Rank a shared default by its worst caller, not by its typical one.** The default that was removed
and the fallback that survived are the same construct, and the survivor was the more dangerous of
the two on both axes that matter:

| | removed default (`markersFor`) | surviving fallback (`inject`) |
| --- | --- | --- |
| population | closed — canon-authored target paths | **open** — any unclassified extension |
| path | read and write; the reader was loud | **write only** |

A default over a closed population can be audited by enumerating the population. A default over an
open one cannot, because the inputs that break it do not exist yet. That the removed one was easier
to reason about is why it got fixed first, and is unrelated to which one should have been.

**An obligation stated in prose fires in nobody's run.** The surviving fallback was not undocumented.
Its header comment diagnosed it exactly — HTML is "often *silently* wrong for anything with a real
grammar," so a new extension "must be classified here" — and prescribed manual enumeration, the
mechanism deleted nine files away for that same reason. The two conclusions shipped simultaneously,
in sibling modules.

What makes the prose remedy unenforceable is not that people ignore comments. It is that **the
enumeration and the event that invalidates it live in different repositories.** The table is canon's;
the act of emitting a new file type belongs to whichever repo owns a distribution — `@jrm/tokens` in
studio, which that comment names. Studio's CI cannot read canon's table. Canon's tests cannot know
studio added an output format. So the obligation binds an author whom no run can check, in the repo
that did not change. A `throw` binds nobody and catches everybody: it fires in canon's own test run,
on the first artifact that needs classifying, without either side having to remember the other
exists.

Prefer the throw wherever an invariant spans a repository boundary. A rule enforced only where it is
written is enforced only against the people who were already going to follow it.

### A validator must not enumerate from the artifact it validates

Canon already requires pinning a discovered population before iterating it, because an empty loop
reports `pass` rather than `skipped` and is indistinguishable from a real assertion. There is a
strictly worse version of that failure, and `assert.ok(n > 0)` does not catch it: **a population that
is non-empty but is derived from the thing under test.**

A member-side checker keyed on its own lockfile is immune to misreading any file's content, and
guarded against an empty `entries`. It is nonetheless **structurally blind to tree-minus-lock** — a
canon-managed path present in the working tree but absent from the lock is never enumerated, so the
check reports green on it forever. No count reveals this, because the population is not empty; it is
*incomplete*, and completeness is not a property any count has access to. The check answers "is
everything the lock declares intact" while appearing to answer "is everything canon manages intact".

The distinction to carry: **a count tests non-vacuity, and only an independent enumeration tests
completeness.** If the list of things to check comes from the same artifact whose integrity is in
question, the checker can detect corruption of what that artifact declares and never omission from
it — and omission is the failure mode an attacker or an ordinary mistake produces first, because it
requires deleting a line rather than forging a hash.

The engine avoids this by construction and the property is now pinned. `enumerateTargets` builds the
plan from **canon plus the member's manifest opt-in**, and never reads `.studio-sync.lock.json`; the
lock is a baseline store consulted *per already-enumerated target* (`entries[spec.targetPath]`), not
an index of what to look at. So a target missing from a member's lock still appears in the plan and
is adopted or written — which is exactly why first-run adoption works at all. A test asserts both
halves, and fails if `assets.mjs` acquires any reference to the lock.

Two consequences for anything built beside the engine. **Enumerate from canon's manifest, not from
the member's lock** — the lock's job is to answer *what did this file look like last time*, and using
it to answer *which files exist* silently converts an omission into a pass. And note that a stamp and
a lock fail to cover for each other in precisely this seam: the stamp is unreliable per-file but can
only ever *add* candidates to an enumeration, while the lock is reliable per-entry but cannot report
what it never recorded. Neither is sufficient; their union is what closes it.

**Insertion purity and correct placement are different properties, and one check does not see
both.** The standing guard for a prose edit here is `git diff -U0 | Select-String '^-[^-]'`, which
must show zero removals. It reliably proves *nothing was lost* — it has caught a heading dropped from
a replacement, a paragraph split by a mid-sentence anchor, and a sentence truncated by a partial
anchor. It is structurally blind to *where the new text went*: an insertion that lands under the
wrong heading removes nothing, so the guard passes. A peer reported the same shape from the other
direction, where replacing the block that ends a section silently reparents what followed.

A rule filed under the wrong heading is worse than an absent one, because it will be found by
readers of a section it does not govern, and canon is consumed by search. So run a second, separate
check after every insertion — resolve the nearest preceding heading for each added hunk and confirm
it is the section you intended:

```powershell
$f = 'instructions/workflow.instructions.md'
$new = @(Get-Content $f)
function Get-Heading($lines, $line) {
  $inFence = $false; $last = $null
  for ($i = 0; $i -lt $line -and $i -lt $lines.Count; $i++) {
    if ($lines[$i] -match '^\s*```') { $inFence = -not $inFence; continue }
    if (-not $inFence -and $lines[$i] -match '^#{1,6} ') { $last = $lines[$i] }
  }
  if ($last) { $last.Trim() } else { '(no heading)' }
}
git --no-pager diff -U0 -- $f | Select-String '^@@' | ForEach-Object {
  if ($_ -match '\+(\d+)') { [int]$Matches[1] }
} | ForEach-Object {
  "line $_ -> $(Get-Heading $new $_)"
}
```

**That snippet masks fenced blocks, and the earlier version did not — which is the more instructive
half.** A `#` comment on the first line of a shell block matches `^#{1,6} ` exactly, so an unmasked
scan can name a code comment as the governing section. Measured on the two canon files: the unmasked
predicate finds 47 and 45 "headings" where 36 and 36 are real — **11 and 9 false positives, about a
fifth of every answer it gives.** It reported `# repair: strip the stray CRs and commit` as the
section governing an edit.

The uncomfortable part is that the fence population was **already measured in this very passage** —
the table below counts `in-fence` headings at 12 and 11 and reasons about them — and the rule was
already stated one section away, where resolving a cited name is required to use a *fence-masked*
pattern. So the knowledge was present, adjacent, and written down, and the placement snippet still
shipped without it. **A rule stated for one instrument does not propagate to the next instrument that
needs it**, and neither proximity nor having personally measured the population is sufficient to
carry it across.

**That predicate reads `^#{1,6}` rather than `^#{2,4}` for a reason worth stating, because the
narrower form was wrong only contingently.** A peer measuring this file's headings reconciled a census
disagreement to two lines — one of predicate, one of revision — and the predicate line was an `H1` that
a `^#{2,4}` real-side scan excludes. Reproduced over the same two blobs, so the predicate is the only
free variable:

| blob | `^#{1,4}` real / in-fence | `^#{2,4}` real / in-fence |
| --- | --- | --- |
| `db6335a8` | 37 / 12 | 36 / 12 |
| `01957f8d` | 36 / 11 | 35 / 11 |

`H1` outside fences is **1** at both revisions, and `^#{1,6}` and `^#{1,4}` return identical in-fence
counts, so the entire real-side gap is the `H1` and the entire in-fence gap is drift. The narrow
predicate never misreported placement here **only because both canon files carry exactly one `H1` and
it is the title** — an insertion above the first `H2` therefore reports `(no heading)`, which is loud.
Add a mid-file `H1` and the same check walks past it to the previous section's `H2` and names the
wrong section silently. **The check was correct by a property of the corpus rather than by
construction**, which is the condition a guard cannot detect about itself; widening the predicate
costs nothing and removes the dependency.

The general form is the one that keeps recurring: **a passing check licenses exactly the property it
measures**, and a guard that has caught several real faults earns a trust that quietly extends to
faults it cannot see.

**Duplication is the third member of that blind set, and it is already in the tree.** Verifying an
unrelated citation against `sync/lib/provenance.mjs` surfaced two byte-identical copies of the same
two-paragraph header comment, with the `commentSyntaxFor` import wedged between them — introduced by
`e4e8f23`, carried through `fdab6f6`, and reviewed by nobody as a defect because it reads as
plausible prose in both positions. A duplicated block removes nothing, so purity passes; it lands
under the heading it was copied from, so the placement check passes too. **Both standing guards are
insertion-only, and duplication is a pure insertion.**

The cheap third check is a repeat count on a distinctive phrase from anything inserted, which costs
one command and is the only one of the three that would have caught this:

```powershell
git --no-pager diff -U0 -- $f | Select-String '^\+[^+]' |
  ForEach-Object { ($_.Line.Substring(1)).Trim() } |
  Where-Object { $_.Length -gt 40 } |
  ForEach-Object { [pscustomobject]@{ n = (Select-String -Path $f -Pattern ([regex]::Escape($_)) -SimpleMatch).Count; line = $_ } } |
  Where-Object { $_.n -gt 1 }
```

**That `-gt 40` is a proxy for "distinctive," and on code it separates signal from noise by accident.**
A peer swept the threshold against the two revisions above, and the sweep reproduces here exactly:

| threshold | known-bad `fdab6f6` | known-good `29ce030` | verdict |
| --- | --- | --- | --- |
| 10 | 6 | 1 | noisy |
| 30 | 5 | 1 | noisy |
| 40 | 4 | 0 | discriminates |

The single false positive below 40 is legitimately repeated *code*, and the signal is *prose*, so the
length rule works here only because the copied block happened to be long comments. **Filtering to
comment lines measures the property directly and the constant disappears** — measured across all four
revisions, including the two not used to derive it:

```
fe37635 (clean, held out)  0      fdab6f6 (known-bad)   5
e4e8f23 (introducing)      5      29ce030 (known-good)  0
```

Zero false positives with no length floor, and it recovers a fifth line the threshold drops:
`// points at the true origin.` — 29 characters, the *closing* line of the duplicated paragraph.
Harmless here because four others still fire; not harmless in general, since comment paragraphs
routinely end short and a duplicated block of uniformly short comment lines is invisible to a length
rule while being exactly the fault.

One detail the peer left unstated and it is load-bearing: **bare comment markers must be excluded**,
because `//`, `/**` and `*/` repeat legitimately in every file. Including them puts the known-good
revision at 1 and the whole discrimination collapses. Their reported figures are reproducible only
with that exclusion.

The general rung, which is theirs and is the part worth carrying: a check can be **right on the right
question for a reason that will not generalize.** This guard fires correctly on the only instance
either party has seen, and its discriminating power comes from a property of *that instance* rather
than of the fault class. There is no failing test to find, and no run will reveal it — only sweeping
the free parameter against a known-good control does. **A constant in a guard is an unstated
hypothesis about the faults you have not seen yet.**

For prose canon the threshold stays, because Markdown offers no equivalent structural filter and
short repeated lines there are usually real. That is a stated limitation rather than a solved one:
**the Markdown duplication check cannot see a duplicated line under 40 characters**, and a repeated
short heading or one-line rule is precisely the shape it would miss.

Note how the duplicated comment block was actually found: not by a guard, not by review, but by
diffing a file because a correspondent cited a stale blob hash for it. The defect had been committed
for two merges. **A fault invisible to every standing check is found only by an errand that had no
reason to look**, so when an errand does put you in front of a file, read what is there rather than
only the lines you came for.

**A check written after the work does not inherit the care that went into the work.** A member
session hit the same defect in three instruments in one hour, and the instructive pair is the last
two: a verification assertion bolted on after a patch script matched only the correction note the
patch had just written, and the patch script itself shipped without the idempotency guard that an
*earlier* script by the same author that same night already had. Neither guard was unknown. Both
were **possessed and not carried across**, and what the two omissions share is position in the
writing order — the verification was an afterthought to the patch, and the guard was skipped because
the patch felt one-shot. The main work gets the attention; whatever is appended to confirm it gets
whatever attention is left, which is why an appended check is the natural place for a known defect to
reappear. **Put guards in the tool rather than in the author's continuity of attention**, and treat
"I'll just add a quick check that it worked" as the highest-risk line in the session rather than the
safest.

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

### A revision in the provenance header is inside the target hash

`sourceSha256` is `hashText(raw)` and `content` is `inject(targetPath, raw)`, so **`targetSha256`
covers the provenance header and `sourceSha256` excludes it**. Putting a revision in that header is
therefore not a cosmetic change, and it fails in two ways that point in opposite directions.

If the header carries canon **HEAD**, every file's rendering changes whenever HEAD moves. `planFile`
decides `unchanged` purely on the rendered hash, so every synced file becomes an `update` and lands
in the PR — a member with 59 locked files whose content is 56/59 current gets all 59 rewritten.
`sourceSha256` is untouched, so the engine stays correct and nothing errors; only the member-visible
diff is destroyed. Stamp the **per-file last-modifying commit** instead. The header then changes iff
the file changes, and it answers *which revision is this artifact* rather than *when did sync run* —
a question `lock.generatedAt` already answers.

That is necessary and not sufficient. `attachCanonHistory` reconstructs prior engine output by
injecting **today's** note into historical raw blobs, and those blobs come from `rev-list --objects`,
which carries no commit identity. A member file stamped when the note held a different revision
matches nothing, `isHistoricalCanonOutput` returns false, and the target falls through to `drift` —
**the member is told they modified a file they never touched**. Measured against a real canon file
with 39 historical versions: a different note value is not recognized, the same note value is
(control). So any revision-valued note requires reconstruction to pair each historical version with
its commit — a commit walk, not a blob enumeration — or it swaps loud churn for silent false drift,
which is worse. `assets.mjs` already states the principle (*"hashing the raw blob alone would produce
a set that matches nothing and disable recovery with no error"*); it just does not reach the case
where the note itself is revision-valued.

None of this is load-bearing for detecting staleness. `sourceSha256` is the hash of the canon body,
so a member can check currency against canon's tree today with no engine change. The header answers
naming, not detection, and must not be rushed ahead of its prerequisite.

### Currency must be measured on what the engine hashes

A member reported its instruction files as *byte-current with canon HEAD except one*, from a
comparison of file bodies. The lock disagreed: **every** entry's `sourceSha256` differed from
`hashText` of the corresponding canon source. Both readings were accurate about what they measured,
and the reconciliation is one line — a change landed that night added a `description:` frontmatter
field to all seven canonical instruction files. Four members' files differed from canon by exactly
that line, which a body comparison discards before it compares anything.

**So *byte-current* was not measured on bytes.** It named a normalization it did not state, and the
normalization removed the only region that had changed. The direction is the harmful one: a
body-scoped check reports a member *more current than it is*, and it does so precisely for changes
confined to frontmatter — which is where `applyTo`, `description` and every future routing field
live. A currency claim must name what it hashed, and the only claim the engine will honour is
`sourceSha256` against `hashText(source)`, because that is the comparison the copier itself performs.

**The near-miss is the part worth keeping.** The lock-based check here was correct and was
disbelieved, because it disagreed with a peer's confident figure. Four successive probes went into
auditing the instrument — line endings, the hash function, the source reader, the spec builder — and
none into auditing the claim, before checking the file's history settled it in one command. The
asymmetry was not evidential; a disagreement is symmetric and **a peer's claim is a hypothesis on
exactly the same footing as one's own measurement**. Deference had selected which side to debug, and
the cost of that selection is a correct instrument nearly discarded for agreeing with nothing.

Note that the member had opened the same message by observing that *a predicate described in prose is
not a predicate*, and then published *byte-current* as prose two paragraphs later. Naming a hazard
does not exempt the naming, which is now the third instance recorded in this document.

### Canon at merge and canon in force are different claims

Delivery is not merge. A rule enters canon when its pull request lands and enters a member when sync
next runs, and the interval between those events is not zero — measured here at roughly a day, during
which the member held **23 of 46** headings of the file this correspondence had spent the night
writing to. Nothing was broken: no drift, the lock intact, the engine correct, sync simply had not
run. The gap is invisible from both ends, because canon sees its own tree current and the member sees
its own lock clean, and neither view contains the distance between them.

Two consequences. **A correspondent quoting *this is now canon* has not established *this is now in
force*** for the party being told, so a rule cited at a member should be cited with its delivery
state or fetched. And the member supplying the evidence for a rule is routinely the last to receive
it — the rule derived from a member's own work reaches that member only on the next sync, so
improvisation there is not negligence but latency, and it should be read as a measurement of the
pipeline rather than of the member.

## Vendored tokens (`@jrm/tokens`)

The design-token package `@jrm/tokens` lives in the **other** backbone repo
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

### Reviewing a token update: `Updated` does not mean "additions only"

The engine is a byte-mover. It compares hashes, not meanings, so it cannot distinguish a **new**
token file from one whose **values changed**: both appear under **Updated** in the member PR as a
path. That is a deliberate limit — teaching the engine to diff token semantics would make it parse
the artifacts it is supposed to carry opaquely — but it means the file list under
`vendor/@jrm/tokens/**` is not a safety signal.

This matters because the two failure modes are inverted from the usual ordering:

| Change | How it surfaces | Risk |
| --- | --- | --- |
| Token removed or renamed | Build breaks, or a CSS variable resolves to nothing | **Loud** — someone investigates |
| Token **value** changed | Everything compiles, every test passes | **Quiet** — layout and contrast move unreviewed |

So a `chore(sync)` PR touching vendored tokens should be verified visually, not just read. Spacing
and radius shifts move layout; color shifts move contrast ratios and can turn a previously passing
WCAG 2.2 AA check into a failing one without any test noticing.

The announcement is the owning repository's job — `jrmoulckers/studio` is the only place that knows
a value moved rather than a file appeared. See
[`instructions/tokens.instructions.md`](../instructions/tokens.instructions.md) for what a value
change must state.

### The `dist/` path contract (interface between the two repos)

This is the byte-for-byte interface the studio-side session must match. Under
`sourceBase` (`packages/tokens/dist/`), `jrmoulckers/studio` commits — and the engine reads and
mirrors — the whole tree, expected to contain at least:

| Path under `packages/tokens/dist/` | What | Consumers |
| --- | --- | --- |
| `css/default/tokens.css` | CSS custom properties (light/base) | web (finance `@import`s these) |
| `css/default/tokens-dark.css` | dark theme custom properties | web |
| `css/default/tokens-dark-oled.css` | dark-OLED theme | web |
| `css/default/tokens-high-contrast.css` | high-contrast theme | web |
| `css/default/tokens-high-contrast-dark.css` | high-contrast-dark theme | web |
| `css/default/index.css` | barrel that `@import`s the above | web |
| `tailwind/default.cjs` | Tailwind preset | future Tailwind consumers |
| `js/**` | typed JS/TS (`*.js`, `*.d.ts`, source maps), one module per theme | future JS consumers |
| `native/compose/JrmTokens.kt` | Compose color schemes + token objects | `apps/android` |
| `native/swift/JRMTokens.swift` | SwiftUI color schemes + token constants | `apps/ios` |

**The distribution is not web-only.** The `native/` tree is why the vendored `targetPath` must be
the repo root for multi-platform members: Compose and Swift sources buried under `apps/web/` are
unreachable by the sibling native apps. That defect is what
[#108](https://github.com/jrmoulckers/.github/issues/108) fixed — see
[Manifest, target path, and opt-in](#manifest-target-path-and-opt-in) below.

The engine mirrors **whatever `dist/` actually contains** (whole-tree copy), so this table is the
_expected minimum layout_, not a hard allowlist — if studio adds files under `dist/`, they are
vendored too, with no change here. That property is load-bearing rather than incidental: studio has
added a component token layer and promoted a fifth theme since this table was written, growing the
distribution from 18 files to 21, and the sync engine required no change because
`enumerateTokenTargets` walks the tree rather than consulting a list. Nothing on this side pins a
file count. Files that can't hold a comment (`.map`, `.json`) are copied verbatim and are still
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
"tokens": { "enabled": true }              // follows the default path
"tokens": { "enabled": true, "targetPath": "packages/ui/vendor/@jrm/tokens" }  // pin elsewhere
"tokens": { "enabled": false }             // score-king / jrm-recipes declared but off
```

An override that **restates** `tokens.targetPath` is rejected by manifest validation. It is not
just redundant: it is indistinguishable from a deliberate pin and behaves identically to one
until the default changes, at which point every other member follows the new path and this one
silently does not — no diff on its line, nothing failing. Remove it to follow the default, or
pin a path that actually differs. No member overrides the path today.

The whole `sourceBase` tree is mirrored today. The schema leaves room for a future optional
per-member `include` (an array of sub-globs under `sourceBase`) to narrow what a member receives,
addable without a breaking change; it is intentionally **not** built yet.

Vendored files land under a **`vendor/@jrm/tokens/…`** convention (app assets, not `.github`
config; `vendor/` signals third-party/generated, and `@jrm/tokens` preserves the package
identity). The default is repo-root and every member uses it today. An override exists for a
member whose consumers all live under one sub-tree, but it is a trap for multi-platform repos:
`@jrm/tokens` ships native Compose and Swift sources next to the web artifacts, so burying the
vendored tree inside a single app directory puts those sources out of reach of the sibling
native apps. `finance` (`kmp-web`, with `apps/android`, `apps/ios`, `apps/web`, `apps/windows`)
previously vendored to `apps/web/vendor/@jrm/tokens` for exactly that reason and was moved back
to the root. Each file carries a source-aware provenance header —
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
| Contents | Read and write | every repo in `members` + `jrmoulckers/jrmoulckers` |
| Pull requests | Read and write | same set |

Contents write covers branch pushes; Pull requests write covers opening and reusing sync PRs.
`jrmoulckers/studio` is one of the members and the token source, so its read needed for
vendoring is already included in the member Contents grant. Nothing else is exercised.

**Grant the list, never a count.** A repo added to `members` does not add itself to the PAT, and the
result is a `403` on `git clone` for that one member: every other member syncs, the run exits
non-zero, and the weekly job goes permanently red. It failed that way for five consecutive weeks on
`jrmoulckers/windows` because the token instructions still said "nine members" after the fleet had
grown past nine (#176). A guard test now fails if any tracked file states a member count that
disagrees with `studio.config.json`.

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
