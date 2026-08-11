# ADR-0006: Independent runtime and Copilot-surface canon kinds

## Status

Accepted

## Context

The backbone distributed `AGENTS.md` and `agency.toml` together as a single `base` kind, selected by
one boolean. That coupling had a consequence nobody chose: an infrastructure member that declined the
studio operating guide — because its own root guide is authoritative for a homeserver or a device
fleet — also silently declined the reviewed MCP server and tool-allowlist policy. Three members
(`studio`, `homelab`, `windows`) were in exactly that position, running with no canonical runtime
policy at all, purely as a side effect of how two unrelated files had been bundled.

At the same time, `.github/copilot-instructions.md` was not canon in any form. Four members had each
written their own. Because GitHub Copilot reads both `AGENTS.md` and `.github/copilot-instructions.md`
on its surfaces, the natural thing for a member to write in that file was a restatement of the
operating policy it had just read — and one member had restated the entire Human-Gated Operations
section verbatim. That is precisely the duplicated normative text
[ADR-0003](0003-four-authority-topology.md) forbids: two copies, no identifiable owner, guaranteed
drift.

The engine could already solve the second problem. `basemerge.mjs` materializes a canonical region
between `studio:base` markers while leaving everything outside them member-owned. That mechanism was
hardcoded to `AGENTS.md`.

## Decision

Split the former `base` kind into three independent boolean kinds, and generalize the managed-region
merge so more than one file can use it.

| Kind | Canon | Target | Materialization |
| --- | --- | --- | --- |
| `base` | `AGENTS.md` | `AGENTS.md` | Managed-region merge |
| `runtime` | `agency.toml` | `agency.toml` | Whole-file copy |
| `copilot` | `copilot-instructions.md` | `.github/copilot-instructions.md` | Managed-region merge |

Each is selected by its own boolean. Declining one says nothing about the others: a member may take
canonical MCP policy and Copilot orientation while keeping a locally authored operating guide.

`copier.planAgentsMd` becomes `planManagedMd` and resolves its target from `spec.targetPath` rather
than a hardcoded file name. `MANAGED_MERGE_TARGETS` in `manifest.mjs` maps each managed kind to its
required target path, and manifest validation enforces two rules: a managed kind declares **exactly
one** file, and it resolves to **exactly** its mapped path.

### Division of content between the two managed files

`AGENTS.md` owns policy: golden rules, the Definition of Done, the issue-first workflow, and the
human gates. `.github/copilot-instructions.md` owns Copilot-surface orientation: what the installed
AI layer is, how to use the agents, skills, prompts, and scoped instructions, what read order to
follow, and that generated files must not be edited locally. It states that `AGENTS.md` is
authoritative and, where the two could appear to conflict, that `AGENTS.md` wins.

The canonical Copilot block must never restate a rule `AGENTS.md` owns. Members keep repository-
specific Copilot orientation outside the markers, where sync never touches it.

## Rejected alternatives

**Add `copilot-instructions.md` to the existing `base` kind.** Rejected because it reproduces the
exact coupling this ADR removes: the three members that most need Copilot orientation are the ones
with `base: false`.

**Generate `.github/copilot-instructions.md` as a pointer file with no local region.** Rejected
because members demonstrably have legitimate repository-specific Copilot guidance — design context,
inventory-parsing rules, host-change protocols — and a whole-file copy would either destroy it or
report permanent drift.

**Make `.vscode/mcp.json` a canonical kind alongside `agency.toml`.** Rejected for now. It is an
editor-specific format for one host, while `agency.toml` is the runtime-agnostic policy. A member
with genuine additional server needs keeps a documented local overlay whose divergence from
canonical policy is visible rather than assumed.

**Leave the coupling and hand-copy MCP policy into the three affected members.** Rejected because
hand-copied canon is the failure mode the sync engine exists to prevent, and because the lockfile
would report it as drift forever.

## Consequences

- Every member now receives canonical MCP policy and Copilot-surface orientation, including the
  three infrastructure members that previously received neither.
- The managed-region merge is reusable. A future canonical file that must coexist with member-owned
  content needs a `MANAGED_MERGE_TARGETS` entry and nothing else.
- Members' existing `.github/copilot-instructions.md` files are preserved: the first sync inserts a
  managed region and leaves all local content in place, exactly as the `AGENTS.md` rollout did.
- Two validation rules now fail loudly where the old shape failed silently — a managed kind with two
  files, or one relocated away from the path Copilot actually reads.
- `optIn.base` no longer implies runtime policy. Any future member entry must set all three booleans
  deliberately; the manifest's `optInSyntax` comment records why.
- Preserving local content has a cost paid once per member: the first sync leaves each member holding
  both the canonical block and whatever policy it had already written by hand, so the duplication
  this kind exists to remove survives until that member trims its local region. Trimming cannot be
  automated — only a reader of the file can tell a restated rule from a genuinely local one.
- Landing a canon kind in a **formatted** path is a cross-repo event, not a backbone-only one.
  `.github/copilot-instructions.md` falls under members' `prettier --check .`, and canon is not
  formatted to any one member's config, so this kind's first distribution failed CI in four members
  until each ignored the path. That config is member-owned, so the sync cannot fix it; see
  [`docs/sync.md`](../sync.md#members-must-exclude-canon-from-their-formatters).
- Member-side asset validators that assumed "synced file" meant "whole-file Markdown copy" need
  updating: managed-region files hash only their inner block, and `agency.toml` carries a `#`
  provenance comment rather than an HTML one. Both assumptions were live in `jrmoulckers/homelab`
  and produced false failures on first sync.
- **The rollout's defects were one pattern: a rule keyed on the wrong unit.** Two of the first three
  keyed on the file rather than the managed block, and on one comment syntax rather than the target's
  own; canon separately declared `.github/` read-only, keying on the directory rather than each
  file's provenance marker, which is wrong wherever canonical and member-authored agents share a
  directory. Each rule was right for the common case and silently wrong for a legitimate one, because
  its unit was coarser than the unit the property varies over — canonical content varies per block,
  comment syntax per file type, provenance per file. Such rules cannot be repaired case by case:
  special-casing `.toml` would have re-broken at the next kind in a new file type, and no path-shaped
  rule about `.github/` could ever have been correct. When writing a rule about canon, identify the
  unit the property actually varies over and key on that, preferring the marker or lookup the engine
  itself uses over a path- or filename-shaped proxy.

  Further instances arrived after this was first written, and they sharpen it. Conflict-resolution
  guidance told members to take canon's side wholesale — file-shaped advice that silently reverts
  merged member work in a managed-region file. And the fix for the `.github/` defect, which moved the
  provenance rule from the directory to the file, itself became a wrong-unit rule at the next level
  down: the marker scopes a *region*, so a reader applying the per-file rule literally stops
  maintaining the member-owned section. **Fixing an instance can create the next one**, which is the
  argument for naming the pattern rather than repairing cases as they appear.

  That progression also supplies the stopping test the rule otherwise lacks: **move the unit until it
  matches whatever the tooling already keys on.** Directory → file → region is precisely the chain
  `provenance.mjs` and `planManagedMd` were implying the whole time — the engine hashed only the
  inner block from the start, so the implementation held the correct unit and only the written rule
  lagged. When canon and the engine disagree about granularity, the engine's granularity is good
  evidence for what the rule should say, because it is the granularity that actually runs. A
  hand-maintained list sitting beside a code path that enumerates the same thing is the same
  duplication problem one level down, which is why the file-type list was reconciled against its
  source rather than re-typed.

  **The test terminates a search; it is not a source of truth.** It is sound only while the tooling's
  own granularity is correct. Applied to an engine that keys on the wrong unit, it would ratify the
  bug and lend it the appearance of canonical backing. The practical tell is whether the tooling's
  unit was **chosen for the property in question** or **fell out of an implementation convenience**:
  `planManagedMd` hashes the inner block *because* that is the region it owns, which is the property
  itself, and that is strong evidence. A file boundary that exists because it is what the directory
  walker happened to yield is weak evidence for anything. When engine and canon disagree, the engine
  is usually right about granularity — and occasionally it is the engine that must move.

  The stopping test matters most when a fix **narrows** a unit. Narrowings must choose where to stop
  and have no natural floor, so they overshoot or undershoot far more readily than widenings —
  directory → file was a narrowing, and stopping one level short of `planManagedMd`'s inner-block
  hash is what produced the next instance. Narrow until the rule's unit matches what the code already
  keys on, then stop.

- **A rule change must land in the explanatory docs, not only the normative source.** The per-file
  provenance fix updated `copilot-instructions.md` and left `docs/sync.md` asserting the superseded
  rule in two places, each individually defensible, which is why neither was flagged. A confident
  wrong statement is worse than a missing one: nothing signals to the reader that they should go
  check, so the stale copy is read as authoritative. When changing a rule, grep for every place that
  restates it and fix them in the same PR.

  **Sweep the ADRs too, including this one.** They are the highest-risk restatement site, not the
  lowest: an ADR carries the strongest presumption of correctness in the tree, so a superseded
  statement inside one is the most authoritative-looking wrong statement available. The trap is that
  ADRs feel like history — a record of what was decided — which makes leaving them untouched seem
  correct rather than negligent. The distinction is between the *decision*, which is immutable and
  should never be rewritten, and any *general rule* the ADR states, which is live text and goes stale
  exactly like the normative source.

  This ADR proved the point on itself. Its consequence heading read "the rollout's **three** defects
  were one pattern," with a later paragraph adding "**two** further instances" — counts that were
  accurate when written and wrong by the next amendment, in a section that has since been amended
  many times. A count is a summary of the instance list keyed to its length, so it is guaranteed to
  go stale on the next append while still reading as settled fact. **Prefer formulations that do not
  encode a count**, and treat any number in a heading as a maintenance obligation you are unlikely to
  meet. That is the wrong-unit pattern applied to a document's own bookkeeping: the claim varies per
  instance, the count keys on the list length.

  **Enumerations flatten, and that is the more expensive half.** Going stale is the visible cost of a
  count; the quiet one is that listing things together asserts they behave alike. `.gitattributes`
  joined `AGENTS.md` and `.github/copilot-instructions.md` as a managed-region target, and the prose
  said only the *comment syntax* varied between them — true when there were two Markdown targets, and
  false the moment the third arrived, because placement is cosmetic in Markdown and **semantic** in
  `.gitattributes`, where the last matching pattern wins. The list grew by one entry that did not
  obey the shared rule. Nothing about a list signals that, which is why the correction to the count
  did not surface it: fixing "two" to "three" makes the enumeration accurate and leaves the
  flattening untouched. When adding an entry to any list of things "handled the same way", state what
  the shared handling actually is and check the new entry against it — the answer is often that the
  entries share a *mechanism* rather than a *behaviour*.

- **When uncertain, prefer the error that leaves a trace.** Several rules here resolve the same way
  and are worth stating as one principle. Delete rather than paraphrase, because a bad paraphrase is
  indistinguishable from canon and a deletion is recoverable from canon. Over-keep and declare it
  rather than over-delete silently, because an over-keep is visible in review and an over-delete
  leaves nothing to notice. In each case both errors are possible and one is *findable* — choose that
  one. The asymmetry is not about which error is less likely but about which error someone else can
  still act on after you are gone.

- **Diagnostic: suspect the unit before the content.** What makes this pattern a debugging trap
  rather than a design nit is that a coarse-unit rule does not error. It quietly matches nothing, or
  matches too much, and the result reads as ordinary drift — a content problem, at the boundary of
  the coarse unit, far from the rule that caused it. So: **when a check reports drift on content you
  have independent reason to believe is correct, suspect the unit the check is keyed to before
  suspecting the content.** That is what turned "`agency.toml` is unstamped" into "the checker
  hardcodes one comment syntax," and it is cheaper than rediscovering the same shape per instance.
  The corollary for authors: a rule that can only fail silently needs its authority read, not
  summarized — see the provenance table note in `docs/sync.md`.

  **Green is not evidence that you went far enough.** Because each repair moves the rule to the unit
  that was wrong *this* time, and lands wherever the current instance stopped, the pattern behaves
  less like a class of mistakes people make and more like a gradient the system pulls toward: every
  fix is a strictly finer unit than before, and the last correct-looking place to stop is exactly one
  level short of correct. Directory → file was right for `.github/agents/` — correct *and complete*
  there — and simultaneously correct and *incomplete* for provenance inside a managed file. Both look
  identical from a passing check. So when fixing a wrong-unit rule, the question is not "is this unit
  correct?" but **"what is the finest unit this property varies over, and did I go all the way
  there?"** Nothing announces stopping one level short, because the check goes green.

  **The absence of a complaint is the strongest form of that.** A failing check at least names a
  unit; silence names nothing, and the natural reading of silence is that there was nothing to find.
  The clearest case is a managed-region merge: the failure mode this ADR's own guidance warns about —
  canon's side silently restoring member content that was trimmed after the branch was cut — produces
  **no conflict marker at all**, because the two sides touch different regions of the file and git
  merges them without complaint. "It rebased cleanly" is therefore not evidence the member's work
  survived; it is a precise description of the circumstance in which its loss goes unnoticed. The
  member that hit this ran an explicit invariant assertion after *each* rebase instead — one marker
  pair, region matching canon, member content outside the markers byte-identical to the default
  branch — and so could report zero conflicts and a verified-intact trim as two independent facts.
  Where a failure is defined by the absence of a signal, the check has to assert the property
  positively; nothing else can distinguish "nothing went wrong" from "nothing was looking".

  **The pattern has a read-side twin: a correct query answering the wrong question.** Every instance
  above is a *rule* keyed to the wrong unit, but the same shape appears when gathering evidence, and
  it is harder to catch because nothing is broken. Reading a three-dot diff to decide whether a file
  exists on the base, or looking up a known list of PR numbers to decide what is open, are both
  queries that return entirely accurate data about a unit adjacent to the one in question. Deltas
  answer "what changes"; sets of known identifiers answer "what is the state of these". Neither
  answers "what exists". Two sessions made exactly these two errors during the first fleet rollout,
  within an hour of each other, and both produced confident, fully-evidenced, wrong conclusions —
  one concluded a file was newly created when the branch appended to an existing one, another
  concluded a PR did not exist because it was outside the set queried. The diagnostic transfers:
  when a conclusion rests on a query, ask what unit the query is actually keyed to, and whether the
  claim varies over that unit or a different one. The tell is that verification feels unnecessary
  because the data was real.

  **The reference is part of the unit.** A third read-side instance chose the right *kind* of
  comparison and the wrong thing to compare against: a session established supersession from content
  rather than chronology, exactly as required, but diffed its generated file against a sibling sync
  branch instead of against canon. Two branches are two renderings of the same source at different
  moments, so the comparison reports which is newer and says nothing about what is at risk — it found
  real content genuinely absent from the sibling while canon held a superset of it. "From content,
  not chronology" was followed and still produced the wrong answer, because a rule that names an
  operation without naming its reference is only half-specified. For generated assets the reference
  is canon; for member-authored content it is the member's default branch. Compare against whatever
  will regenerate the file, since that is what decides whether losing it costs anything.

  **Artifacts are renderings of the tooling, not only of its inputs.** The same instance carried a
  second, sharper version of the wrong-unit error. A sync branch is usually treated as a snapshot of
  canon, but it equally freezes the engine's behaviour at generation time, so a branch predating an
  engine fix reintroduces the bug on merge. The reporting session read one such branch as evidence of
  a live engine defect exposing the whole fleet — when the defect had been fixed hours after the
  branch was cut, on that same session's own earlier report. Age, not the engine, was the variable.
  Before merging any generated artifact, ask what the generator looked like when it was produced.

  This one deserves a check rather than a habit, because a safety property converts it into permanent
  damage: managed regions are replaced where they already sit and are deliberately never relocated,
  so a region merged into the wrong position is never repaired by any later sync. The guarantee that
  the engine will not silently reorder a member's file is the same guarantee that it will not
  silently fix one. Every invariant that protects against unasked-for change should be read twice —
  once for what it prevents, once for what it therefore cannot undo.

  **A fix for a wrong-unit bug is itself liable to be keyed to the wrong unit.** The clearest
  instance closed the loop inside a single exchange. A member's asset checker missed an appended
  managed region because it validated the block's content — hash and markers — and said nothing
  about precedence; the natural repair, proposed by that session and independently implemented here,
  was to assert that the region sits first in the file. Run across the fleet it produced two hits and
  both were false positives: in one member everything above the region was comments, which have no
  precedence, and in another the single rule above it was byte-identical to canon. Position was a
  proxy for precedence exactly as content had been, so the repair reproduced the original defect one
  step over. The lesson is not that the check was sloppy — it is that when a defect turns out to be a
  proxy standing in for a property, the replacement proxy deserves more suspicion than a first
  attempt would, not less. Where an authority can answer the question directly, ask it: `git
  check-attr` settles precedence in the terms the damage occurs in.

  **A snapshot cannot distinguish "never broken" from "already fixed".** The read-side twin has a
  temporal form that is worth separating out, because it produced the most confident wrong claim of
  the rollout. A fleet audit for a known defect returned clean and was reported as zero exposure. One
  member had in fact merged the defect and repaired it sixty-six minutes earlier, and a second was
  carrying it in an open PR that the audit's hand-assembled set did not include. Every byte the audit
  read was current and correct. The claim varied over the *process* — what has happened, what is
  pending — and the query was keyed to a *moment*. The usable tell: **an audit whose only outcomes are
  "clean" and "found it" is answering about a state, not a process**, and is therefore silent about
  both the damage already repaired and the damage not yet landed, which mid-rollout are the two
  states that matter.

  **Knowing the rule does not prevent breaking it.** The same audit enumerated the pull requests it
  already knew about rather than querying what was open — the precise error recorded above as the
  read-side twin, filed as an issue hours earlier by the author of the audit, after another session
  made it. Documenting a rule is therefore not sufficient to prevent its violation, and this ADR
  should not be read as if it were: these are failure modes that recur under time pressure and
  familiarity, not gaps in knowledge. Where a rule can be made mechanical — a test, a required
  command, a check that fails loudly — that is worth more than another paragraph here.

  **A broken check fails clean.** Sharper than the above, and the reason this consequence keeps
  earning entries. A fleet sweep for attribute damage was written, run, and returned no findings. It
  was inoperative: shell-quoting defects meant one revision of it compared CR-terminated paths that
  match no pattern, and the next never resolved the parent ref at all. Both produced an empty diff,
  which is the same output a genuinely clean fleet produces. The bugs were found only because one
  member was a *known positive* and its known damage failed to appear.

  So a negative result carries information only from a check that has been shown capable of returning
  a positive one. The rule is cheap and mechanical: **keep a known-bad fixture and run the check
  against it first.** Note the direction of the failure — of the three defects, the two that produced
  reassurance were nearly shipped as a second false all-clear an hour after the first was corrected,
  while the third produced false alarms and was caught immediately. A check is far more dangerous
  when its bugs are silent than when they are noisy, which is worth weighing when choosing how a
  check reports.

  **Status of this consequence: promising, not established.** Every instance was found by one
  rollout, and the diagnostic above has so far only been validated by the people who wrote it.
  Recorded because the reasoning is cheap to apply and the failure it prevents is expensive — not
  because it has been demonstrated.

  **Promotion requires a report of use, not a measured outcome.** The obvious bar — someone outside
  this group hits a red check, applies the diagnostic, and reaches the cause faster — is not
  observable. Nobody logs the counterfactual, and success here looks like an uneventful debugging
  session that leaves no trace, so that bar can never visibly clear. Silence would then read as
  failure, or the hedge would sit untouched until someone strips it as stale. So promote on a single
  report from outside this conversation that the diagnostic was *used* — "I hit a red check,
  suspected the unit, and that was it." Weak evidence that can actually be collected beats strong
  evidence that cannot. A rule keyed to something unobservable is a rule that cannot announce whether
  it is working, which is the same defect this section is about, one level up.

  Note what the status marker is doing, because the editorial instinct will be to tidy it away: a
  section whose subject is rules that fail silently in the safe-looking direction would otherwise
  itself contain a hypothesis dressed as a finding, with nothing signalling a reader to check. The
  marker is not caution about the diagnostic — it is the diagnostic applied to itself. Keep it until
  it is earned, then remove it deliberately and say who earned it.
