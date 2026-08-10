# Studio sync engine

Distributes the canonical AI layer from the backbone repo (`jrmoulckers/.github`) to the
member repos declared in [`studio.config.json`](../studio.config.json). One-way only:
backbone → members. See [`docs/sync.md`](../docs/sync.md) for the design and rationale.

Zero runtime dependencies — Node.js **≥ 24**, built-ins only (`node:fs`, `node:path`,
`node:crypto`, `node:child_process`, …).

## Usage

```bash
node sync/index.mjs [options]
node sync/validate-prompts.mjs
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

# Validate prompt schema, runtime dependencies, references, and member closure.
node sync/validate-prompts.mjs
```

## Member entries

Each entry in `studio.config.json`'s `members[]` array describes one product repo:

| Field | Validated? | Used for |
| --- | --- | --- |
| `repo` | ✅ must match `owner/name` | Clone target, `--members` filter, PR destination. |
| `mode` | ✅ `application`, `infrastructure`, or `pre-bootstrap`; omitted entries default to `application` | Selects the checkout evidence contract; never selects files. |
| `optIn.base` / `.runtime` / `.copilot` / `.agents` / `.skills` / `.prompts` / `.instructions` | ✅ keys against `KINDS`, names against `canon.<kind>`; boolean-only kinds rejected if given arrays; prompt-to-agent closure is enforced | **Executed** — what canon the member receives. |
| `optIn.health` | ✅ native-kind shape | **Recorded reliance only** — never copied. |
| `optIn.workflows` | ✅ names against canon; actual calls are checkout-verified | **Availability declaration** — current or planned use, never copied. |
| `localAgents` | ✅ kebab-case list; cannot overlap selected canon | Locally authored roles/replacements available for handoffs but never synced. |
| `tokens` | ✅ shape (`enabled` boolean, optional string `targetPath`) | Vendored `@jrm/tokens` opt-in + destination. |
| `framework` | ✅ non-empty string when allowed; checkout-verified | Descriptive — `--dry-run` label; checked against supported repository signatures. |
| `packageManager` | ✅ non-empty string when allowed; checkout-verified | Descriptive — `--dry-run` label; checked against the root lockfile. |
| `notes` | ❌ free-form | Human/agent context. |

**Two keys inside `optIn` do not behave like the rest.** `health` and `workflows` are
`NATIVE_KINDS` ([`lib/manifest.mjs`](lib/manifest.mjs)): community-health files are inherited from
this backbone repo by GitHub itself, and reusable workflows are called via
`uses: jrmoulckers/.github/.github/workflows/*@<reviewed-commit-sha>`. Both are resolved and
reported, then skipped
before any write ([`lib/assets.mjs`](lib/assets.mjs)). So `"agents": "*"` and
`"workflows": [...]` sit in the same object with the same shape, and one decides which files exist
while the other declares availability. Schema validation catches a *misspelled* name in either.
During a real sync or `--check`, checkout inspection records each actual backbone use with its
workflow name, ref, file, and line. Undeclared or non-SHA uses fail. Extra declarations are reported
as currently unused but remain valid because they can record intended adoption.

### Repositories that are deliberately not members

The engine only ever touches `members[]`. Every other repository in the org is untouched, which
means a repo nobody has onboarded yet and a repo the owner has decided to leave alone look
identical from outside the manifest — and only one of the two is a gap.

The top-level `excluded` array records the second case so it does not get re-flagged as drift:

```jsonc
"excluded": [
  { "repo": "jrmoulckers/game-library", "reason": "Private Go CLI tooling, deliberately ungoverned...", "decided": "2026-08-10" }
]
```

| Field | Validated? | Used for |
| --- | --- | --- |
| `repo` | ✅ must match `owner/name`; must not also appear in `members` | Identifies the excluded repository. |
| `reason` | ✅ must be a non-empty string | Why it is not governed. |
| `decided` | ❌ free-form | When the call was made. |

**The engine never reads this list.** It skips nothing, filters nothing, and suppresses no report —
a repository is synced because it is in `members`, and an unlisted one is untouched because it is
not. The field is inert by construction, deliberately: a list that *could* suppress a write would be
a way to silence drift, and recording a decision must not share a mechanism with hiding a failure.

`reason` is mandatory because an exclusion without one is the same unexplained absence the list
exists to remove. Validation also rejects a repository appearing in both `members` and `excluded`,
so onboarding an excluded repo later cannot leave a stale contradiction behind. Nothing detects a
repository that is neither listed nor excluded; the backbone has no inventory of the org. See
[ADR-0012](../docs/architecture/0012-recorded-exclusions.md).

Note that `game-library` appears throughout [ADR-0009](../docs/architecture/0009-canonical-line-ending-normalization.md)
and [ADR-0011](../docs/architecture/0011-managed-region-placement.md) as the real-world case that
motivated *strengthening* an existing `* text=auto` rule instead of overwriting it. That reasoning is
about merge behaviour and stands on its own; it is not an argument that the repository should be
onboarded.
### Member modes and evidence

`mode` has three closed-schema values. Omitted legacy entries default to `application`, but the
canonical manifest declares every mode explicitly:

| Mode | Manifest facts | Checkout rule |
| --- | --- | --- |
| `application` | `framework` and `packageManager` are required. | Preserves the original strict behavior: derive exactly one supported framework and exactly one root lockfile package manager, then compare both claims. Missing, conflicting, or mismatched evidence fails. |
| `infrastructure` | Either fact may be omitted; any present fact must be a non-empty string. | Inspect both signals independently. An omitted fact is valid only when that evidence is absent; detected evidence must be declared and declared evidence must be detected. Nested lockfiles do not become a root package-manager claim. |
| `pre-bootstrap` | Both facts must be omitted. | Accept only while neither supported framework nor root package-manager evidence exists. The first detected signal fails with instructions to upgrade the mode and facts before syncing. |

Fact values remain open strings so new stacks do not require a schema release. `resolve.mjs` passes
the mode and applicable facts through to the dry-run label
(`▶ jrmoulckers/libro  (application · svelte · pnpm)`). `packageManager` evidence comes from a root
lockfile; framework evidence comes from root package metadata or the Gradle/Kotlin Multiplatform +
web project shape.

This is **not a verification bypass**. Every checkout-owning operation (real sync, `--check`, and
`--work-dir`, including its dry-run form) verifies the selected contract and scans called backbone
workflows before reading the sync lock or applying files. Ambiguous evidence, malformed package
metadata, undeclared evidence, stale claims, and unlisted workflow calls all fail closed. Repository
identity is still established by cloning the declared repo or by the existing `--work-dir` origin
guard. Modes change which facts apply; they do not suppress evidence checks.

Manifest-only `--dry-run` deliberately remains offline: it performs no clone and therefore prints
the claims without certifying them. The zero-network test suite likewise tests derivation against
synthetic checkouts rather than copying current product facts into a second expected-value table.
That avoids converting one hand-entered error into two agreeing errors. Two rules follow:

- **Verify against the member's default branch**, not an onboarding PR — an unmerged PR is not the
  repo. `cartridge` was registered as a pnpm Next.js app from its onboarding PR #1, which was
  closed without merging; `main` is an npm Svelte PWA.
- **Use a real sync, `--check`, or verified `--work-dir` to certify checkout-derived facts.**
  Manifest-only `--dry-run` validates manifest shape and plan resolution only.

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

The bar for "deliberately" is the part worth stating, because we got it wrong once. `cartridge`'s
hand-seeded tree carried 11 of the then-current 19 agents, 11 of 15 skills and 5 of 7 prompts, and
that subset read as a coherent fit decision: every business, backend, data and i18n role was absent
from what looked like an offline game catalogue. It was registered with explicit arrays on that
reading, and the reading was wrong.

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

Instructions use explicit authority profiles:

| Members | `optIn.instructions` |
| --- | --- |
| Applications and Studio | `agents`, `docs`, `skills`, `tokens`, `workflow` |
| Homelab | `agents`, `infrastructure-operations` |
| Windows | `agents`, `docs`, `infrastructure-operations`, `skills` |

The instruction-integrity validator pins these profiles. Homelab's local eight-role schema remains
authoritative because `agents.instructions.md` recognizes declared `localAgents` and documented
local schema extensions; its live authority comes only from local routing and operator policy.
Windows keeps relevant generated-agent/skill/docs rules but not token or product fleet workflow
assumptions.

### `optIn.workflows` vs. what the member actually calls

`workflows` is a native kind: nothing is written, so `optIn.workflows` is an *availability
declaration*. Checkout inspection separately scans every YAML file under `.github/workflows/`
during a real sync or `--check` and records each use of this backbone's
`.github/workflows/*.yml|yaml` with its full ref, file, and line.

Two invariants are enforced: **every reusable workflow a member calls must appear in
`optIn.workflows`, and every call must pin a full 40-character commit SHA.** Listing one it does not
call yet is fine and common — it is reported as available-but-unused without failing because the
entry can record an intended direction. An undeclared or mutable call is an error because the
registry or executable provenance is then false.

This check runs against the clone already required by the operation, so it adds no fetch or API
request. The offline suite supplies synthetic workflow trees and verifies the scanner and
comparison rules without pinning private member state. `cartridge` is the worked example in both
directions: it inlined its own semantic-PR-title job while `reusable-ci-lint` could not be called
without lint commands, so the entry was correctly absent; once the empty-command guard shipped it
adopted the workflow, and the manifest had to follow.

#### Name collisions: a member may define its own workflow with a canon filename

The checkout scanner reads `uses: jrmoulckers/.github/.github/workflows/<name>.yml`, so a workflow the member
defines *itself* and calls via `uses: ./.github/workflows/<name>.yml` is invisible to it by
construction. If that local file happens to share a name with a canon workflow, the two are
indistinguishable from either side.

`jrmoulckers/finance` exposed the live instance in August 2026. It called **zero** backbone
workflows while carrying its own `.github/workflows/reusable-smoke-test.yml`, substantially larger
than canon's and **not a superset** of it, and its registry entry nevertheless listed
`reusable-smoke-test`. Finance established that the file was independently authored, renamed it to
`reusable-release-smoke-test.yml`, and updated both relative callers. The backbone registry now
records finance's evidence-backed empty workflow set.

Nothing was written either way, since `workflows` is a native kind. The risk was latent and
specific: **switching that relative call to a backbone workflow without reviewing the semantic gap
would silently have replaced finance's definition with a shorter, different one** — no diff in
either repo, no error, and CI green while the job changed underneath it. The rule that avoids this:
**give a genuinely local workflow a local name, or reference canon at a reviewed immutable ref —
never both.**

This is deliberately not asserted in the test suite. Detecting it needs the member's full workflow
directory, which the offline suite does not have, and pinning each member's local filenames would
be a fact-test of the kind that goes stale and then certifies the wrong value. It is recorded here
as an operational caveat instead.

Finance's file was later promoted into canon as `reusable-native-smoke-test` (see
[ADR-0008](../docs/architecture/0008-canonical-native-smoke-test.md)), which closes the underlying
gap the collision exposed: the capability was missing from the backbone, not duplicated in it. The
naming rule above is unchanged — the promoted workflow has its own canon name, and a member calls
it at a reviewed immutable SHA rather than keeping a same-named local copy.

## What gets synced

Resolution follows each member's `optIn` in the manifest:

- `"*"` → the full canon of that kind, an array → those names, `false`/omitted → opt out.
- `base`, `runtime`, `copilot` and `health` are booleans (`BOOLEAN_KINDS` in
  [`lib/manifest.mjs`](lib/manifest.mjs)).
- The **only** valid `optIn` keys are `base`, `runtime`, `copilot`, `attributes`, `agents`, `skills`,
  `prompts`, `instructions`, `workflows`, `health` (`KINDS` in [`lib/manifest.mjs`](lib/manifest.mjs)).
  Anything else — notably `optIn.tokens` or `optIn.profile` — fails validation with *"is not a known
  kind"*. Tokens and the profile README are configured elsewhere; see the two rows below the table.

| Kind | Shape | Target | Notes |
| --- | --- | --- | --- |
| `base` | `AGENTS.md` | member root | **Merged** into a managed region (see below); member content outside the markers is never touched. |
| `runtime` | `agency.toml` | member root | Copied wholesale. Reviewed MCP servers and tool allowlists. |
| `copilot` | `copilot-instructions.md` | `.github/` | **Merged** into a managed region, same mechanism as `AGENTS.md`. |
| `attributes` | `.gitattributes` | member root | **Merged** into a managed region. Canonical LF normalization; the member keeps its own binary/LFS/linguist rules outside the markers. Markers and provenance are `#` lines, not HTML comments. |
| `agents` | `*.agent.md` files | `.github/agents/` | |
| `prompts` | `*.prompt.md` files | `.github/prompts/` | |
| `instructions` | `*.instructions.md` files | `.github/instructions/` | |
| `skills` | `<name>/` directories | `.github/skills/` | Whole folder: `SKILL.md` + any checklists. |
| `health` | community-health files | — | **Native** — GitHub inherits these from the backbone `.github` repo. Never written; the member must **not** keep its own copy. |
| `workflows` | reusable workflows | — | **Native** — availability only; actual calls must use a reviewed full commit SHA. Never written; the member must **not** vendor a copy. |

> **`base`, `runtime`, `copilot` and `attributes` are four independent booleans.** The first three
> were one kind until
> [ADR-0006](../docs/architecture/0006-runtime-and-copilot-canon-kinds.md). Bundling them meant an
> infrastructure member that declined the studio operating guide — reasonably, because its own root
> guide is authoritative — also silently declined reviewed MCP policy. Three members were in that
> state. Declining one of these kinds now says nothing about the others.

> **`attributes` normalizes line endings fleet-wide.** Five repos — including this backbone — had
> no `.gitattributes` at all, and `jrm-recipes` reported `pnpm format:check` failing on ~964
> untouched files in a fresh Windows checkout purely from CRLF materialization. Noise at that
> volume masks real failures. Only the generic `* text=auto eol=lf` stanza is canon; repo-specific
> rules (Studio's `packages/tokens/dist/**`, game-library's Go rules, binary patterns, LFS, linguist
> overrides) stay in the member, outside the markers. Because the region is appended at the end and
> git resolves attributes by *last matching pattern*, a member's weaker `* text=auto` is
> **strengthened** rather than duplicated or deleted. See
> [ADR-0009](../docs/architecture/0009-canonical-line-ending-normalization.md).
>
> Members that already carry the canonical line keep it *and* get the managed copy. That redundancy
> is deliberate: deduplicating would mean editing outside the markers, which the managed merge must
> never do. Delete the local line by hand if it bothers you; the sync will not object.

> **Opting in to a native kind installs nothing.** `health` and `workflows` (`NATIVE_KINDS` in
> [`lib/manifest.mjs`](lib/manifest.mjs)) are resolved and reported so the plan is complete, then
> dropped before the write list. Health records reliance; workflows record current or planned
> availability while checkout inspection records actual use. A local copy of either is **worse than
> having none**: a member's own health file overrides the one
> inherited from `jrmoulckers/.github` and freezes it, and a vendored `reusable-*.yml` is a silent
> fork with no update path. The engine cannot detect or fix either, because it never writes them.
> See [Native kinds have no transport](../docs/sync.md#native-kinds-have-no-transport).

Two more asset classes are synced but are **not** `optIn` kinds:

| Asset | Configured by | Target | Notes |
| --- | --- | --- | --- |
| Vendored `@jrm/tokens` | `members[].tokens` (`{ "enabled": true, "targetPath"?: … }`) plus the top-level `tokens` block | `vendor/@jrm/tokens/` (per-member overridable) | **External** — vendored from the private `jrmoulckers/studio` repo, not backbone canon. See below. |
| Profile README | not configurable per member — always `profile/README.md` in this repo | `jrmoulckers/jrmoulckers` `README.md` | Mirrored to the user profile repo once per run, and **only on unfiltered runs**: passing `--members` skips the mirror entirely. `--dry-run` reports the mirror as skipped under a filter, matching the run it previews. |

### Canonical agents and product overlays

Canonical agent bodies are authored under `agents/` here and written to
`.github/agents/*.agent.md` in opted-in members. The target files are generated, provenance-stamped
artifacts: edit canon here, or put product-specific stack/path/risk guidance in the member's root
`AGENTS.md` outside the managed block and in scoped `.github/instructions/`. Do not edit a generated
agent file. A distinct local role is allowed; a same-slug replacement must be declared in
`members[].localAgents` and omitted from the member's explicit `optIn.agents` list.

Mandatory human gates remain the floor. Root/local `AGENTS.md` and more-specific scoped instructions
then override shared defaults for routing, paths, tools, schema extensions, and operations. Declared
local replacements remain locally authored and are never overwritten by sync.

Custom-agent discovery still requires repository-local `.github/agents/*.agent.md`; official
owner-repo inheritance has not been verified. Synced consumer copies therefore remain necessary
generated artifacts. Existing authored copies of canonical roles can be reduced by moving local
facts to overlays, but the materialized files themselves must not be removed until inheritance is
verified end to end. See
[Canonical agents and local overlays](../docs/sync.md#canonical-agents-and-local-overlays).

### Deselection cleanup is manual and hash-verified

The engine does not prune. A file omitted from a new selection is absent from the write plan, but its
existing consumer file **and stale `.studio-sync.lock.json` entry remain untouched**. A later sync
neither deletes the file nor removes that lock entry.

After this instruction-profile change, later consumer work must make these exact transitions:

| Member | Add through sync | Remove through hash-verified consumer cleanup |
| --- | --- | --- |
| Applications and Studio | no new instruction | nothing |
| Homelab | `.github/instructions/infrastructure-operations.instructions.md` | `.github/instructions/docs.instructions.md`, `.github/instructions/skills.instructions.md`, `.github/instructions/tokens.instructions.md`, `.github/instructions/workflow.instructions.md` |
| Windows | `.github/instructions/infrastructure-operations.instructions.md` | `.github/instructions/tokens.instructions.md`, `.github/instructions/workflow.instructions.md` |

For each affected consumer, use a focused PR and perform the cleanup atomically:

1. Start from the consumer's current default branch and resolve the new plan from the merged
   backbone. Enumerate each candidate path explicitly; never delete by directory, wildcard, or
   recursive command.
2. Read the candidate's existing lock entry. Normalize the current file to LF and compute SHA-256
   using the same rule as `hashText`; it must equal that entry's `targetSha256`. A missing entry or
   mismatch means possible local ownership/drift: stop and reconcile instead of deleting.
3. In one commit, remove only each verified generated file and its exact lockfile entry. Preserve
   declared local files and remove a now-empty directory only after listing it and proving it empty.
   Do not rewrite unrelated lock entries or `generatedAt`.
4. Run the consumer's validation and a verified
   `node sync/index.mjs --dry-run --members <owner/repo> --work-dir <consumer-checkout>` from the
   merged backbone. Confirm the removed paths are absent from both the resolved plan and lockfile,
   selected files show no drift, and the new infrastructure instruction is planned/present.
5. Merge the cleanup PR, then run the normal authenticated sync from the merged backbone to update
   selected canon through its own reviewable PR. Recheck the default branch for the exact final
   roster and no stale lock entries.

Do not run authenticated cross-repository sync or edit consumers from a backbone policy PR. This
procedure is the required follow-up until a separately designed prune transaction exists.

### Canonical prompt integrity and runtime

Canonical prompts are authored under `prompts/` and materialized as `.github/prompts/*.prompt.md`.
[`lib/prompt-integrity.mjs`](lib/prompt-integrity.mjs) runs during every manifest load and validates:

- frontmatter schema, unique names, and exact `canon.prompts`/file parity;
- parameter types, defaults, positive bounds, and interpolation placeholder closure;
- declared Copilot App/CLI built-ins and known canonical-agent references;
- supported `gh pr checks --json` fields; and
- every member's selected-prompt/available-agent dependency closure.

The supported built-in dependency names are `task`, `code-review`, `read_agent`, `list_agents`, and
`sql_todos`. They describe Copilot App/CLI contracts, not files expected under `.github/agents/`.
Prompt `parameters` and interpolation are also runtime contracts. If a consumer runtime cannot
interpolate parameters or provide a declared built-in, it must stop before dispatch or mutation.
Dynamic fleet roles must additionally pass the consumer's root/scoped `AGENTS.md` and
`.github/instructions/` routing overlay; materialization alone is not authority.

After a canonical prompt PR merges, materialize the generated consumer copies through the normal
sync path. Preview one member with
`node sync/index.mjs --dry-run --members <owner/repo>`, then run the authenticated sync (or the
scheduled/manual sync workflow) so each affected member receives a reviewable sync PR. Do not edit
generated consumer prompt copies directly.

Every synced file carries a provenance header
(`synced from jrmoulckers/.github — canonical source; do not edit here`), rendered in the comment
syntax the target's own parser accepts: an HTML comment after the YAML frontmatter (or at the top of
plain Markdown), a leading `#` line for `.toml`/`.yml`/`.gitattributes`, a `/* … */` block for
`.css`/`.js`/`.ts`/`.kt`/`.swift`, and nothing for `.json`/`.map`.

The fallback is HTML. That is right for prose and silently wrong for source: an unclassified source
extension is written with `<!-- … -->` at the top and stops compiling, while the engine reports it
as perfectly in sync. When a distribution grows a new source file type, classify it in
`sync/lib/provenance.mjs` — this is exactly how `@jrm/tokens`' native Compose/Swift output arrived.

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
"tokens": { "enabled": true, "targetPath": "vendor/@jrm/tokens" }  // explicit repo-root pin
"tokens": { "enabled": false }                             // declared but off
"tokens": { "enabled": true }                              // default repo-root vendor/@jrm/tokens
```

The whole `sourceBase` tree is mirrored today; the schema leaves room for a future optional
per-member `include` (sub-globs under `sourceBase`) without a breaking change — not built yet.

The per-member `targetPath` override exists, but every member currently uses the repo-root
default and multi-platform members must: `@jrm/tokens` ships native Compose and Swift sources
alongside the web artifacts, so vendoring into a single app directory hides them from the sibling
native apps.

Each vendored file lands under the member's `targetPath` (default repo-root `vendor/@jrm/tokens/`,
mirroring studio's `dist/` layout: `css/default/*.css`, `tailwind/default.cjs`, `js/**`,
`native/compose/*.kt`, `native/swift/*.swift`) and
carries a source-aware provenance header
(`generated + synced from jrmoulckers/studio @jrm/tokens — do not edit here`): a `/* … */`
comment for `.css`/`.js`/`.cjs`/`.ts`. Source maps and JSON (`.map`/`.json`) are copied verbatim
(no header — a comment would corrupt them) but are still tracked in the lockfile by sha256.
Token files flow through the same lockfile, drift detection, and `chore(sync)` PR machinery as
the rest of the canon. See [`docs/sync.md`](../docs/sync.md#the-dist-path-contract-interface-between-the-two-repos)
for the exact `dist/` path contract the studio repo must match.

### Managed-region merge (`AGENTS.md`, `.github/copilot-instructions.md`, `.gitattributes`)

Three canonical files must coexist with member-authored content in the same file, so the tool manages
only a marked region within each:

```markdown
<!-- studio:base:start -->
…canonical content…
<!-- studio:base:end -->
```

The marker identifier is `studio:base` for **every** managed target, not just the `base` kind: it
names "the studio-managed region", and `copilot` has always shared it. Only the *comment syntax*
varies, because a marker has to be a comment in the file it lives in. Markdown targets use HTML
comments; `.gitattributes` has none, so it uses `#` lines:

```
# studio:base:start
…canonical content…
# studio:base:end
```

This is not cosmetic. An `<!-- studio:base:start -->` line in a `.gitattributes` is not ignored by
git — it is read as a *pattern rule*. The same applies to the provenance header, which is emitted as
a `#` comment for `.gitattributes` (see `HASH_COMMENT_NAMES` in [`lib/provenance.mjs`](lib/provenance.mjs)).
`markersFor(targetPath)` in [`lib/basemerge.mjs`](lib/basemerge.mjs) picks the syntax, and the two
syntaxes never cross-detect: HTML markers inside a `.gitattributes` are member content, not our region.

Everything outside the markers is member-local and never touched. Editing inside the block is
treated as drift; editing outside it is ignored. If a member has none of these files, one is created
containing just the managed block.

**Where the block lands in a file the member already had depends on the format, and it is not a
style choice — it decides which rule wins.** `markersFor()` returns a `placement` alongside the
marker syntax, because both follow from the same fact about the target:

| Target | Placement | Why |
| --- | --- | --- |
| `AGENTS.md`, `.github/copilot-instructions.md` | **append** | Markdown has no precedence order, so product-local preamble stays on top where a human reads it first |
| `.gitattributes` | **prepend** | Git resolves attributes by the *last* matching pattern, and canon's `*` matches everything — appended, it would silently outrank every member rule |

The `.gitattributes` case is concrete: `jrmoulckers/studio` carries
`packages/tokens/dist/** text eol=lf` so the committed token distribution is deterministic
*regardless* of git's text detection. With canon appended, that path resolved to `text: auto`
instead of `text: set` — still LF, so not a live bug, but an explicit guarantee reduced to a
conditional one. The same applies to any rule more specific than `*`: LFS entries,
`linguist-generated`, `binary`, `-diff` on generated files. Prepending makes canon a **baseline the
member can override**, which is the only coherent reading of a generic `*`.

> **An existing region is replaced in place, never relocated.** A member whose block sits in the
> old position keeps it until a human moves it. Silently reordering lines in a file the member owns
> is the failure this placement rule exists to prevent, so the engine will not do it unasked.

Prepending does **not** weaken the rule-strengthening described above: git resolves per *attribute*,
so a member's later `* text=auto` (no `eol`) leaves canon's `eol=lf` standing. That is verified with
real `git check-attr` in [`test/gitattributes.test.mjs`](test/gitattributes.test.mjs) rather than by
string matching, because the property is git's resolution and not our byte order. See
[ADR-0011](../docs/architecture/0011-managed-region-placement.md).

Which files use this is declared by `MANAGED_MERGE_TARGETS` in [`lib/manifest.mjs`](lib/manifest.mjs),
and manifest validation enforces that each managed kind declares exactly one file resolving to
exactly its mapped path. A managed kind cannot list two files — both would claim the same marker
pair and the second would overwrite the first — and cannot be relocated to a path the tooling does
not actually read. For `.gitattributes` the fixed path matters twice over: git only applies a
repository-wide `.gitattributes` from the root.

The split of content between `AGENTS.md` and the Copilot block is deliberate: `AGENTS.md` owns
policy, and the Copilot block owns Copilot-surface orientation and defers to `AGENTS.md` for every
rule. See [ADR-0006](../docs/architecture/0006-runtime-and-copilot-canon-kinds.md).

**A marker only counts when it starts at column 0 on a line of its own, outside any fenced code
block.** That strictness exists because the natural thing for a member `AGENTS.md` to do is
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
reported with an explicit *"check `<target>` for stray `studio:base` markers"* note naming the
offending file, and a skipped `AGENTS.md` gets its own warning line rather than being one entry in a
drift list.

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

**Same-day re-runs never force-push.** A dated branch is fetched and reused only while it belongs
to an open PR, so reviewer commits on active work are preserved (and logged) and the update is a
plain fast-forward. Reviewer edits to synced files are evaluated as ordinary drift — flagged and
left alone rather than overwritten. A retained branch from a merged or closed PR is stale: the
engine leaves it untouched and creates a clean `studio-sync/<date>-rerun-N` branch from current
default if another write is needed that day. Later runs reuse that rerun branch while its PR remains
open. If an active branch moves mid-run, the push is rejected loudly instead of overwriting it.

> The engine previously rebuilt the branch from the default branch each run and pushed with
> `--force-with-lease`. That never destroyed anything — without an explicit `=<ref>:<expect>` the
> lease needs a reflog entry proving the local side observed the remote value, and a fresh shallow
> clone has none, so Git refused with `stale info`. It failed *safe*, but it failed: the
> "update the open PR in place" path could never succeed, and the failure was fatal to the run.
> Reusing the remote branch fixes both — the push succeeds *and* nothing can be clobbered.

**One member's failure no longer aborts the run.** Each member is synced inside its own
try/catch ([`lib/runner.mjs`](lib/runner.mjs)): a git or network error is reported, that member is
skipped, and the remaining members — and the profile mirror — still run. The process exits non-zero
with a summary of every failed target. The engine touches nine member repositories plus the profile destination over the network, so
treating the first error as fatal turned one transient failure into a total outage.

**Recovering from a bad run:** pass a fresh `--date`. The branch is `studio-sync/<date>`, so a new
date means a new branch and a new PR, leaving the previous attempt untouched for inspection.

## Authentication

Set `STUDIO_SYNC_TOKEN` to a **fine-grained** PAT with Contents + Pull requests **Read and write**
on all nine member repos and `jrmoulckers/jrmoulckers`. `jrmoulckers/studio` is both a member and
the private token source, so the member Contents grant includes the read needed for vendoring. The default
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
| `test/branch-reuse.test.mjs` | Sync-branch lifecycle: active reviewer work survives; squash-merged and closed branches are bypassed; clean reruns and first runs start from default; a diverged active remote is rejected instead of force-pushed. |
| `test/basemerge.test.mjs` | Managed-block detection: markers quoted in prose, shown in a fenced example, or indented as a code block do not form a block; real blocks are still replaced; a canon change after adoption updates in place without duplicating markers; genuine edits are still drift. |
| `test/runner.test.mjs` | Per-member failure isolation: one member's error does not stop the others, and is reported rather than thrown; drift warnings name every exact skipped path. |
| `test/copier.test.mjs` | add / unchanged / drift / `--force` / adoption and the lockfile write rule; raw-canon stamping; exact historical-output recovery; empty-evidence and one-byte-mutation refusal; recorded targets never use first-sync recovery. |
| `test/history.test.mjs` | Full-history enforcement and committed-blob enumeration; end-to-end target enumeration recovers a member holding a prior engine rendering. |
| `test/manifest.test.mjs` | The real `studio.config.json` validates; all nine consumers and their explicit modes are registered; disabled infrastructure members produce no writes; local-agent metadata remains compatible; application defaults, Docket's completed mode transition, and mode-specific fact schema are enforced; `canon` matches disk; native kinds are never written. |
| `test/instruction-integrity.test.mjs` | Canonical instruction filename/roster parity, deterministic `applyTo` scopes, source/materialized ownership, precedence, curated member compatibility, infrastructure routing, local-agent collision safety, and immutable reusable-workflow examples. |
| `test/agency-integrity.test.mjs` | Exact reviewed MCP package versions and tools, safe default server profile, pinned optional Playwright/memory profiles, and rejection of mutable specs, the nonexistent Playwright package, and wildcard grants. |
| `test/member-facts.test.mjs` | Synthetic checkout derivation for each mode, independently optional infrastructure facts, pre-bootstrap transitions, root package managers, supported framework signatures, ambiguous/missing evidence, SHA-pinned backbone workflow calls (including aliases, flow mappings, quoted keys, and block scalars), shell-scalar exclusion, and field-specific diagnostics. No member facts or network access are pinned. |
| `test/workflow-integrity.test.mjs` | Canon/file parity, practical zero-dependency YAML surface checks, full-SHA action refs and version comments, permissions ceilings, timeouts, concurrency ownership, checkout credentials, shell interpolation, artifact contracts, Pages authority split, digest-pinned security scanning, change detection, and private-by-default Lighthouse behavior. |
| `test/provenance.test.mjs` | Every real write equals `inject(targetPath, canon)` and never canon verbatim — so the documented hand-audit baseline stays correct; and that check is line-ending agnostic on the member side. |
| `test/prbody.test.mjs` | An adoption-only run's PR body says its entire diff is the lockfile, and does not claim that when the run also wrote files (including via `--force`). The drift note states that `--force` is run-wide, offers the by-hand remedy first, and neither appears when the run has no drift. |
| `test/workdir.test.mjs` | `--work-dir` guards: a parent directory, a missing path and a file are all rejected; a git worktree (whose `.git` is a file) is accepted; identity resolves to `match` / `mismatch` / `unverifiable` across URL spellings and case, both failing verdicts abort, the refusal names the self-certifying lockfile, and `--allow-unverified-work-dir` overrides them without ever marking a matching checkout as overridden. |
| `test/cli-workdir.test.mjs` | The same guards **through the CLI**: every operation — apply, `--check`, `--dry-run` — exits 1 on a wrong or absent origin; refused and fact-verification failures leave no file or lockfile; the override flag says what it suppressed; dry-run reports mode and zero-write members; checkout facts are verified before the sync lock is read or applied. |

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
