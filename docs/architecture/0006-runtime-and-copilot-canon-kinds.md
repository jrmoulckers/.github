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

  **The wrong unit is often the cheap one.** A recurring reason the wrong unit gets chosen is that it
  is the only one available without leaving what you already have open. Comparing two sync branches
  against each other needs no external lookup; comparing one against its canonical source needs an API
  call to another repository. Reading a file's content is local; asking `git check-attr` what that
  content *means* is a second command. In both cases the answer that was reached for first was the
  answer that cost least, and in both cases it was keyed to the wrong unit. That predicts *when* these
  failures happen — under time pressure, mid-triage, in the sessions moving fastest — and it suggests
  the most effective repair is rarely another rule. Making the correct unit as cheap to obtain as the
  incorrect one removes the pressure that produces the error, where restating the rule only asks
  people to resist it.

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

  **Where a guarantee lives matters more than how well it is worded: prefer making the artifact
  refuse over warning the reader.** A member observed that documentation defeats itself when the
  actionable artifact and the warning are separated, because readers execute recipes and skim prose,
  and proposed co-locating them. That is right and it is the weaker remedy. `AGENTS.md` ships a
  `--work-dir` recipe to every consumer and carries **none** of that flag's three guards — they are
  documented only in `docs/sync.md` and `sync/README.md`, neither of which is distributed — and the
  recipe is nonetheless safe, because the engine refuses: not a git checkout, origin not provably the
  member, more than one member selected (`sync/lib/workdir.mjs`, `sync/index.mjs`, covered by
  `sync/test/workdir.test.mjs` and `sync/test/cli-workdir.test.mjs`). The trap that actually bit in
  the field — a run against an unrelated local repo rewriting its `AGENTS.md` from 3 lines to 145 —
  was closed by making the recipe unable to walk into it, not by moving its warning nearer. Distance
  between warning and recipe is a real defect, but it is a defect of the fallback; reach for it only
  where the artifact cannot refuse, as with a rule like *do not diff the whole file*, which no
  program is in a position to enforce.

  That fallback case arrived within the hour, and it shows the separation is worst where the prose is
  *best*. This document spent three paragraphs establishing that `i/-text` alone is not a corruption
  signal, that the bare filter returns 60 hits and no defect on a real member, and that `check-attr`
  cannot substitute for the NUL test — and then offered `git ls-files --eol | grep 'i/-text'` as
  "the portable core", for members to run in CI, with an inline comment its own preceding paragraph
  refutes. Correct prose does not protect an incorrect artifact; it is the artifact that travels,
  and being surrounded by the right explanation is not a property the reader who copies it inherits.

  **Prefer controls that fail closed over controls that merely fail loudly.** The repair here is not
  a better filter but a different shape. A filter fails *open*: a legitimate new binary produces a
  hit, hits that are usually spurious get skimmed, and the check keeps passing while training the
  reader to dismiss it — noise is not a weaker signal, it is an anti-signal that degrades the
  operator. An allowlist fails *closed*: the same new binary breaks the build until a human puts it
  on the list, which converts an unnoticed default into a recorded decision. The member's guard
  that survives this critique does so structurally rather than by foresight — `const ALLOWED_BINARY
  = new Set()`, annotated *an entry here is a decision, not a default* — which is why the allowlist
  form ports to other repositories and the filter does not. Stated generally: **enumerate, exempt
  explicitly, fail closed** — and note that a check whose discriminator is a conjunction of a
  classification and a content test can never be a filter expression at all, so reaching for a
  one-liner already presupposes the wrong shape.

  **A guard that proves it found something has bounded nothing about what it missed.** The strongest
  version of the fixture rule seen in this fleet is a canon-ownership check that refuses to report
  success when it classifies zero files, on the stated grounds that a guard silently matching nothing
  reads exactly like a passing one. Correct, and it does not fire on the defect it most needs to
  catch: the guard identifies canon by a hardcoded provenance stamp, the engine emits a *second*
  stamp for vendored assets which it builds from the plan rather than from a constant, and so an
  entire tree — the largest canon-owned surface in a consuming member, and the one with a recorded
  drift incident behind it — is never enumerated. The count is comfortably non-zero throughout.

  Non-vacuity and coverage are different properties, and only the first is self-checkable. A check
  can confirm it is alive using nothing but itself; it cannot confirm it looked everywhere without an
  independent statement of what everywhere is. So the control is not a better self-check but an
  external enumeration to reconcile against — here a lock file the engine already maintains. This is
  the population form of the entry above about mutation proving non-vacuity and not fidelity, and it
  arrived the same way: on the author of the safeguard, in the blind spot the safeguard defines.

  The asymmetry underneath it is worth stating on its own, because it names the wrong fix.
  **Recognising a stamp proves a file is canon; failing to recognise one proves nothing.** Such a
  classifier is sound as a *predicate* and unsound as an *enumerator*, and the defect is entirely in
  using it as the second — a `false` from a predicate is indistinguishable from a correct negative,
  which is why the shortfall is silent. The authoring repository's own guard scanned a fixed window
  of leading lines for the stamp, and agent and skill files open with YAML frontmatter that pushes it
  past the boundary, so an entire directory — 22 of 59 locked paths — was invisible while the count
  stayed comfortably non-zero. Widening the window is the tempting repair and the wrong one: it
  trades one arbitrary boundary for another and leaves the category error in place. Note also that
  the window contradicted documented behaviour rather than merely under-reaching it, since canon
  already specifies the stamp is rendered *after* any frontmatter.

  **Externality is not what makes the reconciling enumeration trustworthy** — a second heuristic in
  another file is external and useless. The lock qualifies because it is not produced by the same
  assumptions as the thing being checked: the classifier and the canon files share an author, a
  convention, and a failure mode, while the lock is written by a different part of the engine for a
  different purpose. That is the structural form of the entry recorded elsewhere here about two
  sessions running the same command failing to cross-check each other. The corollary is that the new
  authority inherits the vacuity obligation: hard-fail on a lock that is missing, unparseable or
  empty rather than degrading to the heuristic, and let the classifier remain as a source that can
  only *add*, so a locally seeded region the lock does not yet list is still caught.

  **The population under test is a thing to assert, not a thing to discover.** This entry, the empty
  loop that reports `pass` while asserting `skipped: 0`, and a CI job whose path filter matched
  nothing are one failure at three layers — in each, a component answered a question about *what to
  examine* and the answer went unchecked because a shortfall is indistinguishable from a correct
  negative. A discovery filter matching nothing and a fixture file that is absent are the same event
  in different clothes. Wherever a check derives its own subject matter, that derivation needs an
  assertion of its own, and it will not be supplied by the check passing.

  A synthetic fixture is the same defect in its most comfortable form. Written by the author of the
  code, it can only contain the cases that author already conceived, so it tests the implementation
  against the hypothesis space rather than against the world — and it passes, which is the trouble.
  A fixture reconstructed from a real member artifact carries the cases nobody thought to write:
  `homelab`'s actual `.gitattributes` opens with a rule byte-identical to canon, so a known false
  positive sits inline beside twenty-one genuine ones and a single test establishes precision *and*
  recall, which three purpose-built fixtures had structurally been unable to do. The corollary is
  that such a fixture is evidence only while it remains that artifact, so pin git's content-addressed
  blob id: a copy that has quietly drifted has become synthetic again while still carrying a
  provenance comment saying otherwise.

  It is also invisible where such a guard is most likely to be written. The repository that authored
  this one has no vendored tree at all, being the source of those assets, so the guard is correct
  there and silently incomplete the moment it is copied to a consumer. **A check inherits the
  population of the repository it was written in, and says nothing about that.**

  **And that population can be set by a manifest in a different repository.** The case above is
  population-by-contents, which at least a reader of the repo could notice. The sharper form is
  population-by-*configuration*: `homelab` opts out of the `base` kind in canon's
  `studio.config.json`, so `AGENTS.md` — a managed-region target here — is never written there, and
  that member's marker-dispatch code has never executed against it. Its guard is green and carries
  no information about that path. What distinguishes this from the vendored-tree case is where the
  boundary is drawn: flipping one field **in this repository** activates an untested path over
  there, with no change to the member's own code, tests or contents, and no signal to the member
  that its coverage just moved. A consumer therefore cannot enumerate its own uncovered surface from
  inside itself, and an opt-in edit here is a coverage change there.

  The control against this is itself subject to it. Canon recorded the known-bad fixture — run the
  check against an inverted ignore list, confirm it reports differently — as something an author does
  once. A control performed once certifies the check as it was on that day, and every later edit to
  the check, the artifact, or the schema is unverified; this is the ownership entry below applied to
  a safeguard rather than a gap. The member that built this check made the fixture a **mechanism**
  instead, re-running coverage against an empty probe list on every invocation. Doing so introduced
  one new ambiguity worth naming rather than hiding: an unchanged count means either the check never
  read the list or the list excludes nothing, two conditions with opposite fixes and no way to
  distinguish them from outside — the instrument added to remove ambiguity produced its own.

  **Candidate class, deliberately not promoted: a repair tool's safety guarantee can exempt exactly
  the states that need repairing.** `git add --renormalize` skips a blob git classifies binary, and a
  doubled `\r\r\n` terminator is what makes it binary — so the corruption disables the mechanism that
  would fix it and survives its own remedy, reporting success. The sync engine has a structurally
  similar case: a root-level managed target is never rekeyed onto another path, which is a real
  safety property, and it means a baseline orphaned by a genuine relocation of such a file cannot be
  carried across by the one mechanism that carries baselines. In both, the property that makes the
  tool safe is the property that makes the damage permanent, and in both the tool reports success.

  It is recorded here as a shape to watch rather than a rule, because the evidence does not support
  more. Two instances, both surfaced the same night, both from inside the same pair of cooperating
  sessions — which is precisely the population the entry on cross-session agreement says to discount.
  The generalisation is also not yet tight: one case is an idempotent formatter declining an input,
  the other a deliberate domain restriction, and calling them one class may be the wrong-unit error
  applied to this document's own taxonomy. Promotion needs an instance from outside this rollout.

  **Harmless is not the same as fixed, when a coincidence is doing the work.** The fleet sweep found
  one member whose managed region is permanently mis-placed and whose effective attributes are
  nonetheless unchanged — because the single member rule it overrides is byte-identical to canon, so
  it is overridden to itself. Both facts are true, and only the first one is durable. The property
  that makes it safe belongs to the member's *content*, which a human will edit without ever being
  told it is load-bearing; the defect belongs to the file's *structure*, which no later sync repairs.
  A carve-out added above that region is void from the moment it is written, with no failing check.
  So a defect held harmless by a coincidence should be recorded as open and fixed on its own terms,
  not closed on the strength of a green measurement — otherwise the audit that proves it safe today is
  the same audit that will keep proving it safe right up until someone edits the coincidence away.

  **Some wrong units cannot be detected by looking harder.** The instances above are mostly caught by
  asking a better question of the thing in front of you. One class is not: where the property you need
  is not present in the artifact at all. A generated file does not record which version of the
  generator produced it, so no amount of correct reading reveals that its ordering reflects a bug fixed
  hours earlier — the bytes are genuinely wrong, and the reading is genuinely right. Three separate
  sessions diagnosed a live engine bug from such a file, all correctly describing what they saw.

  This separates two remedies that are easy to conflate. *Verify before asserting* works when the
  evidence is in reach and merely unexamined. It does nothing here, because verification confirms the
  artifact and the artifact is accurate about everything except its own provenance. What works instead
  is a check triggered by the artifact's *category* rather than by anything observed in it: this file
  is generated, therefore ask when. A rule that fires on suspicion cannot cover a case that produces
  none.

  **A verification result has a shelf life, and carries no evidence of its own expiry.** The reflexive
  form of the entry above, and by volume the most repeated failure of the first rollout: a fact is
  checked, correctly, and then reasoned from minutes or hours later as though checking had made it
  permanent. Every instance was a *correct* observation — a merge cadence that was real, a branch that
  was open, a file that said what it was reported to say — reused past the point where it still held.
  Correctness at the time of reading is exactly what removes the impulse to read again.

  So "I verified it" and "it is true" are different claims, and the gap between them is elapsed time
  against a store other sessions are writing to. The practical form is to re-read state immediately
  before acting on it rather than when composing the argument for acting on it, and to treat any
  verified fact quoted from earlier in a long exchange as expired by default. The clearest
  demonstration available: the message proposing this rule cited a branch tip that was seven commits
  stale by the time it was sent, while making the point correctly.

  The framing above suggests neglect is the mechanism, and the sharper population is the opposite
  one: **the artifact under the closest attention is the one whose standing goes unnoticed longest.**
  A session held a blocked pull request for hours and re-verified it throughout — suites, region
  hashes, marker counts, member content — every check correct, every check green. When the block
  lifted the branch was three commits behind and almost wholly superseded; it merged at about a
  twentieth of its original size. No check it ran could have reported that, because *behind* is not
  a property of the branch. It is a relation between the branch and a remote that was not being
  refetched, so verifying the artifact accurately taught nothing about its standing, and the
  frequency of verification is what made the staleness feel impossible.

  Hence the distinction worth carrying: **validity** — do the contents still hold — is settled at
  the first pass and does not change while nothing is being pushed, whereas **liveness** — is this
  still the right change to land — changes continuously and is invisible from inside the branch.
  While something is blocked, re-running validation is close to information-free and its main effect
  is to raise confidence in a judgement its evidence does not support. Check position, not contents.
  This is also the cheap-unit pattern in its purest form: the local suite is already in shell
  history, `git fetch && git log HEAD..origin/main` is a command not yet run, and the reachable check
  displaced the informative one *repeatedly* precisely because it kept coming back green.

  A narrower rule sits underneath all of this: **some facts should never be recorded at all, only
  re-read.** A branch tip is a moment rather than a property, so writing one into durable state — a
  status table, a tracking issue, a summary — converts something instantaneously true into something
  that reads as an attribute of the repository. The record does not merely expire; it was a category
  error when written, because the thing recorded was never the kind of fact that persists. Both
  sessions in one exchange did this: one reported a tip in good faith, the other stored it, and it
  was stale within minutes for reasons neither could have prevented by being more careful. The fix
  is not fresher records but recording the *query* instead of its result — note that a tip is needed
  here, not which tip it was.

  The same rule governs expected values inside a check. An invariant shipped with a literal pasted
  hash has the shelf life of whatever it hashes, and it fails in the worst available direction:
  it reports drift in the one region nobody edited, sending the reader to look for a change that
  never happened. A region digest quoted at one commit was already wrong by the time the member ran
  it, because an intervening sync had legitimately replaced the region — the check was correct, its
  constant was not, and nothing in the failure distinguishes those two cases. Assert the relationship
  — *this region equals canon's body for that emission* — and compute the reference at run time.
  Any expected value pasted rather than derived is a record of a moment wearing the costume of a
  property.

  **A fix on a conditional path cannot reach the population that motivated it.** The prepend fix
  corrects placement only where no managed region exists yet, because replacement is deliberately
  in-place. So it makes every *future* adoption permanently correct and does nothing whatsoever for
  the members whose bad placement prompted it — those two populations are disjoint, and the second is
  the one that was actually damaged. The property is easy to miss because the fix is genuinely
  correct, its tests genuinely pass, and the bug genuinely stops occurring; what does not happen is
  any repair. Worse, the already-affected are then invisible, since every later sync rewrites their
  region in the wrong place without complaint.

  So a fix landing on one branch of a conditional owes a second question — *which branch are the
  already-affected on?* — and where the answer is "the other one", the fix is only half the work: the
  remainder is a detection-and-report mechanism aimed squarely at the population the fix cannot
  reach. Shipping the fix alone converts a loud bug into a silent state.

  **A document can carry both a warning and the artifact that defeats it.** The formatter-exclusion
  section named the hazard correctly — introducing a canon kind that lands in a formatted path is a
  cross-repo event — and then handed members a fixed list of paths to copy. The list is keyed to the
  kinds that existed when it was written, so the very event the warning describes is the event that
  makes the list wrong, and a member copying it would be following the section while defeating its
  purpose. The prose and the example disagreed about the unit: the prose was keyed to the set of
  emitted paths, the example to a snapshot of it.

  This is worth separating from ordinary staleness because nothing was out of date when written and
  no later edit introduced an error. A reader checking the section against reality at any single
  moment finds it consistent. The defect is that one half is a rule and the other is an instance, and
  instances are copied more readily than rules — so the failure is *caused* by the document being
  used as intended. Where a rule is keyed to something machine-readable, state the key and let the
  example be visibly an example.

  **Appending to a tally is itself an unverified classification.** The de-counting rule addresses a
  count going stale as its list grows. This is the step before: deciding an event belongs in the
  count at all. A running tally of failures accumulated during the rollout gained an entry that did
  not belong to it — an action misattributed to a human, counted as a stale read — and the increment
  was never examined, because the tally's own consistency is what gets checked, not each membership
  decision. A count that is arithmetically correct can still be wrong about every item in it.

  This makes tallies a poor summary of a pattern precisely when the pattern is being actively found,
  since each new instance is classified by whoever is most convinced the pattern is real. Prefer
  naming the shape and citing instances that can be checked individually, and treat any number
  attached to a pattern as a claim needing the same evidence as the pattern itself.

  **Cheapness and kind-triggering answer different halves.** These two consequences — that the wrong
  unit is often the cheap one, and that some wrong units cannot be detected by looking harder — have
  different countermeasures, and neither substitutes for the other. Making the correct reference
  cheap removes the *pull* toward a nearby wrong one, which is what drives the reach-for-what's-local
  failure. It does nothing where the correct unit is unreachable in principle: no amount of local
  convenience surfaces an artifact's generation time, because the artifact does not carry it. Those
  cases need a check that fires on the artifact's *kind* — this file is generated, therefore ask when
  — rather than on suspicion, since no suspicion is available to trigger on. Both failures ran
  concurrently during the rollout: sibling branches were compared because they were near, and nobody
  asked when a branch was generated because nothing in it prompted the question.

  **Agreement is corroboration only between instruments that could have disagreed.** Two sessions
  reaching the same number is worth nothing if both computed it the same way — a line count taken by
  splitting on newlines is wrong by one on every newline-terminated file, and it is wrong identically
  for everyone who takes it that way, so confirming it against another session confirms the
  convention rather than the file. What settled that count was three instruments that could have
  disagreed: a line-collection count, a byte-level LF count, and a fetch from the API. Not one
  instrument run three times.

  This is the fixture rule in social form, and a fleet of cooperating sessions is unusually exposed
  to it, because cross-checking is cheap, feels like verification, and is most often performed by
  running the same command in a different working directory. Before treating a second opinion as
  evidence, ask what result would have made the two disagree; if no such result exists, the second
  run measured nothing. An instrument that cannot return a different answer is not measuring.

  The sharpened form is worth stating because it locates where the check is needed: agreement
  between two *sessions* is more persuasive than agreement between two runs by one session, and it
  deserves less credence. The apparent independence reads as coming from the operator when it comes
  from the instrument, and cooperating sessions share a toolchain by construction. So the social
  version of this error is simultaneously likelier to occur and harder to doubt, which means the
  "what would have made us disagree?" question is most necessary exactly where it feels most
  redundant.

  **Measuring the present to conclude about the past is a distinct error from measuring something
  stale.** The staleness case is a record that was true when written; this is a reading that was
  accurate when taken and simply does not answer a historical question. A session dismissed a
  reported corruption as a rendering artifact after inspecting a default branch some hours *after*
  the repair had merged — the observation was correct, the inference backwards from it was not, and
  nothing about the measurement itself signalled that it could not settle the claim. What settles a
  past-state question is the historical object: the blob at the pre-fix ref. Before accepting a
  measurement as evidence, check that the thing measured existed at the time the claim is about.

  **A wrong measurement that agrees with a correct decision leaves no symptom.** The failure above
  is a second instrument that cannot disagree; this is the same defect one step earlier, where a
  measurement is never checked at all because nothing it produced ever conflicted with the action
  taken. A branch was reduced on a correct reading of its diff, while a separate measurement of the
  *checkout* — a file's length against canon's — was cited alongside it as corroboration. That
  measurement answered a different question and was wrong for the purpose, but it pointed the same
  way, so it was never falsified and never load-bearing. Decoration that agrees is more durable than
  decoration that conflicts, because only the conflicting kind gets investigated. When a decision
  rests on two measurements, establish which one is carrying it; if removing one changes nothing,
  it is not evidence and should not be reported as though it were.

  Read the instance above as the *lucky* case, not the definition. The decorative measurement there
  was also wrong, and being wrong is what eventually prompted the question. The unlucky case is
  decoration that agrees and is correct: indistinguishable from evidence, load-bearing in the
  reader's mind and in nothing else, and permanently uninvestigated because nothing ever conflicts.
  The removal test above catches both, which is the reason to apply it by habit rather than on
  suspicion — suspicion only ever arrives in the lucky case.

  **Hardest of the three: a premise that argued for the option you rejected can never be
  disconfirmed by the outcome.** Both cases above concern claims on the executed path, which at
  least stay exposed to contradiction. A claim supporting a path *not* taken describes a
  counterfactual, so nothing that happens afterwards touches it — it does not merely fail to object,
  it is structurally incapable of objecting. A member argued against a cherry-pick route on the
  false premise that a file did not exist on the default branch. The other route was chosen for
  independent reasons, the work proceeded correctly, and the premise survived intact; it would have
  been actively harmful in the world where the rejected route was the right one, which is exactly
  the world it would next be consulted in. **So audit the reasons you did not need.** Load-bearing
  claims are tested by reality for free, because someone acts on them and the world answers, whereas
  a claim that supported a rejected option is tested by nothing, persists unexamined, and arrives at
  the next decision with its credibility undiminished. Most errors in this rollout were
  self-correcting for precisely that reason — acting on them collided with something — while this
  one needed a human to go and read the log on purpose.

  **A systematically biased instrument still answers difference questions correctly.** This is the
  practical way out, and it is why disagreements over constants are usually not worth resolving.
  Two sessions measured the same managed region at 5346 and 5344 characters, and earlier the same
  file at 488 and 489 lines and its member content at 268 and 264 — every pair a boundary
  convention, not a discrepancy about the artifact. Asked *is this region unchanged across the
  merge*, both conventions return the same answer, because a constant offset cancels in a
  difference; the independent check here confirmed the region's hash identical on both sides of the
  merge while the file itself shrank by 183 bytes, which is exactly the delta the other session
  reported for the member-owned content. So prefer invariants stated as relations over invariants
  stated as constants: a relation tolerates an instrument whose zero point is wrong, and a constant
  requires every reader to share a convention that nobody has written down.

  **The convention is not merely unwritten — the artifact has no opinion about it, so there is
  nothing to write down.** The 2-character gap above was diagnosed exactly: two newlines, the one
  following the start delimiter and the one preceding the end delimiter. One extractor took the
  substring *between* the delimiters and kept both; the other trimmed at each boundary. A file does
  not say whether the newline adjacent to a marker belongs to the region or to the frame that
  delimits it, so neither reading is a misreading and no amount of care makes two independently
  written extractors agree on a length. **Any constant derived from an artifact encodes a choice the
  artifact never made.** That is the mechanism behind the preference stated above, and it is why the
  remedy is not to standardise the convention: the choice appears on both sides of a relation and
  cancels, and appears once in a constant and does not. Standardising would work only for readers
  who adopted the standard, whereas a relation is correct for readers who never heard of it.

  A useful consequence for cross-session corroboration: **agreement on the relation together with
  disagreement on the incidentals is the signature of two measurements; agreement on everything is
  the signature of one measurement taken twice.** The 183-byte file delta and the independently
  derived 447→264 local delta agreed on the relation while their constants disagreed, which is what
  made them worth citing together — as against the two-sessions-running-the-same-command case
  recorded further up, which produces perfect agreement and no information.

  **The strongest case for the relation is a quantity that cannot have a correct constant at all.**
  A member's classifier looked for the provenance stamp in the first eight lines of a file. Read as a
  mistuned constant, the repair is a bigger window; that reading is wrong, and the bigger window is
  the *plausible* fix that leaves the defect alive. The stamp's position is a function of frontmatter
  length, which is author-controlled and unbounded — measured across 56 emitted canon files it ranged
  from line 1 to line 26 with no gap in the distribution, and a window of 8 saw 21 of them. Any
  constant that passes today becomes a latent recurrence the first time someone writes a longer
  `description:`. The invariant underneath is exact and needs no tuning ever: **the stamp is the line
  immediately following the frontmatter, or line 1 when there is none.** That is not an observed
  regularity but a guarantee of the emitter — `injectAfterFrontmatter` in `sync/lib/provenance.mjs`
  splices the comment at `i + 1` where `lines[i]` is the closing `---`, so it holds for files that do
  not exist yet, which no measurement can establish.

  Two properties of this case are worth carrying. First, it is the preference above arriving
  prospectively rather than retrospectively: the rule was recorded before this defect was diagnosed
  and would have prevented it, which is the strongest thing that can be said for a written rule.
  Second, the two instruments here measured **different populations** — canon stores these bodies
  unwrapped, so scanning the sources in this repository finds zero stamped files and says nothing,
  while the member-side measurement finds 56. A correct instrument pointed at the wrong population
  returns a confident, uninformative answer; the emitter was the only source that answered for both.

  **Replacing a coarse unit with a fine one can discard the question the coarse unit answered.**
  The documented repair for a wrong-unit check is to ask the authority directly instead of a proxy,
  and that is right as far as it goes — but the proxy is often coarse rather than simply wrong, and
  coarseness cuts both ways. `git check-attr` answers *is this damaged* exactly; the region's
  position answers *is this sound*, which the resolver cannot ask. One fleet member is unsound and
  undamaged — a member rule sits above the managed region where canon's wildcard would void it, but
  the rule is byte-identical to canon, so nothing is currently overridden. The resolver reports it
  clean, correctly, and a resolver-only audit passes on the last structural instance in the fleet
  while doing nothing about it. The coincidence holding today is not maintained by anyone.

  So the reflex to *replace* is the error, and the usual correct move is a demotion: keep both
  instruments at different severities, sound-but-undamaged reported and damaged failing. Merging
  them loses a real defect in one direction or raises false alarms in the other, and neither is
  recoverable from the merged result. The test for whether a proxy may be retired is not whether the
  new check is more accurate, but whether any question the proxy answered has no other instrument.

  Applied honestly that test also returns *retire*, and a case from the same rollout shows what
  that looks like. A proposed check compared `git check-attr` output before and after a merge, and
  the same resolver-based reporter superseded it outright — not because it is finer, but because a
  before/after diff can only fire on a **transition**, so it is blind to a file that was always
  wrong. A member whose binary asset never had a correct attribute presents no merge to be the
  "before", and the diff reports clean forever. An invariant on the file as it stands needs no
  baseline, and therefore has no baseline to be wrong about. Nothing the diff answered was left
  without an instrument, so it retires with no demotion.

  The pair is the useful part: the same discriminator retires one check and preserves another, and
  the question is never which instrument is better. Note also that the superseded proposal was
  written by the same author who had established, hours earlier, that a diff answers *what changed*
  and not *what exists* — the rule was applied to branches and not carried to checks, which is the
  familiar shape rather than a lapse.

  One consequence of that retirement was not noticed at the time and is worth stating plainly,
  because it is the reason this entry is not yet closed. The surviving reporter detects the
  sound-but-undamaged case **by value** — someone runs it and reads the output. So the fleet's only
  structural instrument is a person choosing to look, which is the precise condition that let the
  last structural instance stay invisible in the first place. Recording a gap as known does not give
  it an owner, and a gap that is known and unowned decays to unknown: the knowledge lives in whoever
  remembers, and the next reader inherits a clean audit with nothing in it that says the audit does
  not cover this. That failure is the same one as the coincidence above, moved up a level — the
  coincidence is not maintained by anyone, and neither is the awareness of it. An unowned finding
  should therefore be written where the check runs, not only where the reasoning was recorded.

  **Absence of acknowledgement is a proxy for non-delivery, and the two diverge exactly when the
  answer was cheap to give and hard to verify.** A report answered in prose leaves its sender unable
  to separate *not received*, *received and disputed*, and *received and already fixed* — three
  states demanding different responses, collapsed into one by a reply that is a second opinion
  rather than an instrument. Re-sending is then the rational move, and a report arriving twice is
  evidence about the answer rather than about the reporter.

  What distinguishes the two is that a citation can come back negative. Naming the test that
  disproves a reported hazard lets the reporter find it absent, or asserting something else, or
  skipped; asserting that the hazard was investigated cannot fail. This is the fixture rule applied
  to a sentence, and it generalizes past sessions to any report whose answer lives somewhere the
  reporter cannot see — which is the ordinary case across a repository boundary, not an unusual one.
  Where the correct unit is unreachable in principle to one party, supplying it is the obligation of
  the party who can reach it, not a diligence failure of the party who cannot.

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
