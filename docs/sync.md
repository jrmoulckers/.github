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
(`synced from jrmoulckers/.github — canonical source; do not edit here`), rendered in whatever
comment syntax the target's own parser accepts: an HTML comment after any YAML frontmatter (or atop
plain Markdown), a leading `#` line for `.toml`/`.yml`/`.gitattributes`, a `/* … */` block for
`.css`/`.js`/`.ts`/`.kt`/`.swift`, and nothing at all for `.json`/`.map`, where any comment would
corrupt the file.

**That sentence is illustrative, not exhaustive — `sync/lib/provenance.mjs` is the authority.** It
carries cases the prose elides, including basename matches for extensionless dotfiles and the full
set of script and native extensions. Anyone writing a member-side check must mirror that file by
reading it, never by transcribing this paragraph.

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

Canon is authored upstream and is **not** formatted to any one member's Prettier config, so a member
running `prettier --check .` over its whole tree fails on files it does not own and must not fix —
editing them is drift, and the next sync skips the file. Every member that runs a formatter needs
its synced paths ignored:

```
# synced from jrmoulckers/.github — canonical source, not authored here
.github/agents/
.github/skills/
.github/prompts/
.github/instructions/
.github/copilot-instructions.md
AGENTS.md
```

That file is member-owned, so the sync cannot add the entry. **Introducing a canon kind that lands
in a formatted path is therefore a cross-repo event**: every affected member needs this line before
its sync PR can go green. The `copilot` kind's first distribution failed CI in four members for
exactly this reason. Machine-read files no formatter touches (`agency.toml`) need no entry.

**Treat the list above as an example, not the specification.** The rule it illustrates is keyed to
`.studio-sync.lock.json`: a member's ignore file must cover every lock path its formatter can parse,
and must be re-checked whenever the sync starts emitting a new one. Written as a fixed list of paths,
this section would go stale on exactly the event the paragraph above warns about — the arrival of a
new kind — and would then read as complete while being wrong, which is why members should copy the
rule rather than the lines. libro states it in its own `.prettierignore` as a comment aimed at the
next reader of that file, which is the right place for it, since that is where the omission bites.

Being keyed to a machine-readable file, this is checkable rather than remembered: compare the lock's
`files` keys against what the formatter would consider, and fail when a parseable path is not ignored.
That check belongs in the member, because the ignore file is member-owned. The lock file itself is
emitted as two-space JSON and needs no entry.

Note that these exclusions are **whole-file even for managed-region targets**. `AGENTS.md` and
`.github/copilot-instructions.md` are only partly canonical, but a formatter cannot be pointed at
half a file, and the region must stay byte-identical to canon or the sync stops matching. Excluding
the whole path is therefore correct — it costs formatting on the member-owned remainder, which is a
smaller price than perpetual drift.

#### Phantom formatter failures on a pre-`.gitattributes` Windows worktree

The `attributes` kind delivers `* text=auto eol=lf`. On a Windows worktree created **before** that
landed, files checked out under `core.autocrlf=true` keep their CRLF bytes on disk, and the result
is a formatter failure git will not show you:

- `git status` and `git diff` report the file **clean**, because `text=auto eol=lf` normalizes
  worktree→index on read — git compares the normalized form and sees no change.
- `git add --renormalize .` stages **nothing**, for the same reason: the index is already correct.
  Renormalization fixes files whose *index* content is wrong, not a worktree that is stale.
- Prettier reads raw bytes, sees the CRs, and fails.

So the file is simultaneously clean to git and failing to the formatter, and it will never
self-heal. **Adding `.gitattributes` does not rewrite an existing working tree** — expect the fix to
land and change nothing for anyone who already has a clone. That is the shape most likely to be
misread as "the fix didn't work":

| Stage (scratch repo, `core.autocrlf=true`, index already pure LF) | worktree bytes |
| --- | --- |
| fresh checkout, no `.gitattributes` | `CR=3 LF=3` (`i/lf w/crlf`) |
| after committing `* text=auto eol=lf` | `CR=3 LF=3` — **unchanged** |
| after forcing a re-checkout | `CR=0 LF=3` |

The fix is to force the worktree to be rewritten from the index — delete the offending files and
check them out again, or clone fresh. `git rm --cached -r . && git reset --hard` also works, but
**it discards every uncommitted change in the repo**; commit or stash first. Fresh clones and CI are
unaffected, which is why CI never reproduces this.

Where the index is already clean, note that **`eol=lf` is the clause doing the work, not
`text=auto`.** With a correct index there is nothing for `text=auto` to normalize; `eol=lf` is what
overrides a repo-local `core.autocrlf=true` at checkout time. Canon carries both, so this is a "why
it works" note rather than a change — but it also means adopting canon in a member whose index is
already clean produces **no renormalization commit at all**, and the `.gitattributes` addition is
the entire diff. Check with `git ls-files --eol` before planning one: where the index is dirty you
get the large mechanical commit and the fixture/snapshot/`.bat` audit genuinely matters, and where
it is clean neither applies. Confirmed in `jrmoulckers/jrm-recipes` (1237 files, `i/crlf: 0`) and
`jrmoulckers/studio` (199 files, `i/lf: 199`).

Confirmed in `jrmoulckers/jrm-recipes`, where `.studio-sync.lock.json` held 302 stray CRs
while reporting clean.

Worth recognizing by shape: a formatter failing on a file `git diff` says is unmodified is almost
always this, not content. CI never reproduces it, because CI always clones fresh.

### `git add --renormalize` cannot repair a file with doubled CRs

The section above covers a **stale worktree** whose index is already correct. This is the opposite
case: the committed blob itself is wrong, and renormalization still will not fix it.

Git's binary detection is not only about NUL bytes. A file whose CR count exceeds its CRLF pairs —
one carrying doubled `\r\r\n` terminators, which is what a CRLF-writing tool produces against
content that already ended in CRLF — is classified `-text`. A `-text` file is exempt from `eol=lf`,
and `git add --renormalize` skips it. **The corruption blocks its own repair**, so it survives the
remedy, reports success, and stays invisible in a rendered diff.

All thirteen of this repo's community-health files were in exactly that state: canon's own LF rule
was inert for the files GitHub serves org-wide.

```bash
# any file listed here is classified binary, so eol=lf does not apply to it
git ls-files --eol | grep 'i/-text'

# repair: strip the stray CRs and commit. renormalize alone will not do it.
```

Telling the two apart: if `git diff` is clean and the formatter fails, it is the stale worktree
above. If `git ls-files --eol` reports `i/-text`, it is this — and the fix must be committed.

`sync/test/gitattributes.test.mjs` asserts no tracked file here is classified `-text` and pins the
doubled-CR mechanism behind that assertion. Run the check above **before** concluding that
renormalization finished the job: a clean `format:check` on Linux CI can coexist with files that
were never normalized at all.

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
# 1. exactly one marker pair — a duplicated region is a merge artifact, not canon
grep -c 'studio:base:start' <file>

# 2. the managed region is byte-identical to its OWN pre-rebase value  (not to canon)
# 3. member content OUTSIDE the markers is byte-identical to the default branch
```

Two of the three are about content the merge should not have touched at all, which is the point: the
failure is invisible in the region under review and only shows in the parts nobody is looking at.
`jrmoulckers/finance` ran this after both of its rebases and reported a clean result — zero
conflicts *and* a verified-intact trim, which are two independent facts rather than one.

**Capture the pre-rebase hashes before rebasing; canon HEAD is the wrong reference here.** The
invariant being asserted is *the rebase changed nothing*, so its reference is the branch's own prior
state. Checking the region against canon HEAD instead answers a different question — *is this branch
stale?* — whose answer on any older sync branch is a harmless yes, since canon advances daily. A
rebase-integrity check pointed at canon flags every slightly-stale branch as corrupt, and the obvious
remedy is hand-porting canon into the region, which is drift and is discarded on the next sync. Both
questions are legitimate and they are not the same question; only one of them is about staleness.

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
  grep -n 'studio:base:start'
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
`homelab` is the worked example — its `2026-08-09` PR carries one sync commit plus two authored ones
(an asset-checker fix and a local policy trim), while its `2026-08-11` PR is pure canon.

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

Where a check is code rather than a command, the general form is cheaper and stronger than keeping a
fixture: introduce the regression deliberately, confirm the check fails, then revert. Doing this to
`sync/lib/rekey.mjs` — adding an `existsSync` guard to the rekey loop, which is what a future reader
would plausibly propose as a safety improvement — is what established that the order-independence
test in `sync/test/rekey.test.mjs` was load-bearing rather than incidentally green. Prefer it for
anything guarding a silent, unrecoverable failure, since those are exactly the checks whose passing
is never questioned.

**Mutation proves a test is non-vacuous; it cannot prove the test is faithful.** A passing mutation
shows the code does what the *test* says, and says nothing about whether the test describes the state
a member is actually in. A suite whose fixtures encode a believed shape will confirm that belief
rigorously — `report.abandoned` shipped with a mutation-proven suite and a false negative on the very
member its own PR body named, and the miss surfaced only when someone rebuilt that member's real
state and ran the engine against it. The stronger the mutation table, the less need anyone feels to
go and look, which makes this the more dangerous half of the practice. So mutation answers "is this
check load-bearing", and only a reconstruction of the real case answers "is it pointed at the right
thing" — naming a real member as the motivation is the trigger to go and build it.

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

Members that validate their own generated assets must also respect two contract details, or they
will report false failures — both were live in `jrmoulckers/homelab` on first sync:

- **Managed-region files are not whole-file copies.** For every managed-merge target — `AGENTS.md`,
  `.github/copilot-instructions.md` and `.gitattributes` today, per `sync/lib/copier.mjs` —
  `targetSha256` is the hash of the **inner managed block**, not the file. The file legitimately
  carries member content outside the markers, so a whole-file hash could never be stable.
- **The provenance marker is not always an HTML comment.** It follows the target's own comment
  syntax, per the list above. A checker hardcoding `<!-- … -->` reports `agency.toml` as unstamped.

### Answering a member session's report

A member session cannot see this repository's issues, pull requests or merges. When it reports a
problem here, the three states it needs to distinguish — not received, received and disputed,
received and already fixed — are invisible to it by construction. It cannot resolve them by
checking harder, so resolving them is the answerer's obligation.

**Answer a report by naming an artifact the reporter can check without another round trip.** A
prose confirmation — *I read the source, the hazard cannot occur* — may be entirely true and is
still unusable, because it is a second opinion rather than an instrument, and a second opinion
cannot come back negative. `sync/test/rekey.test.mjs:199`, merged in #220, can: the test may be
absent, may not assert what the reply claimed, may be skipped. That it can disagree is the whole
value, and it is the same rule as the known-bad fixture, applied to a sentence instead of a check.

The practical tell is repetition. A report arriving a second time is evidence that the previous
answer was **unciteable**, not that the reporter is insistent — the cleanup-before-rekey hazard was
sent three times, having been investigated, disproved and regression-tested after the first. Each
reply asserted the finding; none named the test. Re-sending was the correct move on the information
the reporter had.

Citing an artifact also terminates the exchange, which prose cannot do: prose's only confirmation
channel is another message, and that message is subject to the same defect.

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
"tokens": { "enabled": true, "targetPath": "vendor/@jrm/tokens" }  // explicit repo-root pin
"tokens": { "enabled": false }             // score-king / jrm-recipes declared but off
```

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
`jrmoulckers/studio` is one of the members and the private token source, so its read needed for
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
