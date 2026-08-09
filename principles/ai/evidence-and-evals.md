# AI evidence and evals

These Draft principles govern how agents verify, communicate, and preserve evidence. They convert
durable lessons from legacy AI operations into short operating rules; incident narratives,
case-specific measurements, and unsupported "AI brain" proposals remain in Git history.

## GH-AIEVAL-001 — Supersede corrections explicitly

- **Status:** Ratified
- **Statement:** Supersede an incorrect or stale agent report explicitly, name the claim and report
  replaced, re-read mutable facts at correction time, and link durable evidence instead of relying
  on message history.
- **Rationale:** A correction that travels beside the original lets later sessions select either
  version and relay stale state as current.
- **Verification / evidence:** The correcting artifact contains `Supersedes`, identifies the prior
  report, distinguishes immutable observations from mutable state, records checked revisions or
  timestamps, and links the executable result for behavioral claims.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** The authority owning the underlying fact reviews its meaning;
  `.github` owns agent report freshness, correction shape, and relay behavior.
- **Legacy inputs:** `ai-process.md §17`

## GH-AIEVAL-002 — Route decisions to the party with standing

- **Status:** Ratified
- **Statement:** Route intent, obligation, and acceptance decisions to the authority or repository
  owner with standing to make them, while agents and file owners supply independently checkable
  evidence.
- **Rationale:** Ownership of a central file does not grant knowledge of why a governed repository
  chose a value or whether an outcome is acceptable.
- **Verification / evidence:** A decision record names the decision owner, affected repositories,
  consulted evidence, objections, and resolution; central configuration changes link review from
  the governed authority rather than treating schema consistency as consent.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Product decides outcomes and obligations; Engineering decides
  technical mechanisms; Studio decides UI expression; repository owners ratify principles.
  `.github` routes the agent decision and records evidence without assuming their standing.
- **Legacy inputs:** `ai-process.md §18`

## GH-AIEVAL-003 — Challenge congenial premises first

- **Status:** Ratified
- **Statement:** Challenge the premise that most supports the agent's preferred conclusion first,
  trace it to the governing artifact and revision, and include a case that could disprove it.
- **Rationale:** Agreement encourages unverified summaries to be repeated until repetition is
  mistaken for corroboration.
- **Verification / evidence:** The report lists each material premise, source, revision, and
  disconfirming probe; adversarial evals alter the supportive premise and fail when the agent merely
  repeats an upstream summary or inspects only the claimed location.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** The source authority decides what its artifact means; `.github` owns
  the agent verification order and evidence trace.
- **Legacy inputs:** `ai-process.md §19`

## GH-AIEVAL-004 — Treat tools and checkouts as versioned inputs

- **Status:** Ratified
- **Statement:** Treat every tool, cache, vendored source, checkout, and remote-tracking ref used in
  verification as a versioned input, and fetch or identify its exact revision before reporting.
- **Rationale:** A local checkout answers confidently from an age and state the current task did not
  choose.
- **Verification / evidence:** Reports record tool versions, repository refs, commits, and fetch
  time; remote claims use a live read or explicitly dated snapshot; tests mutate a stale
  `origin/main`, cache, or fixture and reject conclusions that omit its provenance.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Engineering owns generic toolchain and cache mechanisms; source
  authorities own their artifacts. `.github` owns agent source-freshness and provenance behavior.
- **Legacy inputs:** `ai-process.md §20`

## GH-AIEVAL-005 — State exactly what each check proves

- **Status:** Ratified
- **Statement:** State the proposition, scope, preconditions, command, and possible failing result
  for each check before using its success as evidence, and do not extend the conclusion beyond them.
- **Rationale:** A real check against a neighboring proposition creates more false confidence than
  an acknowledged evidence gap.
- **Verification / evidence:** Eval and pull-request evidence pair each claim with the exact check
  and scope; positive and negative fixtures prove the check discriminates; mutations run against
  the claimed suite or entry point rather than a convenient subset.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Engineering owns generic test semantics and mechanisms; the domain
  authority owns acceptance. `.github` owns the scope of claims made by agents from those results.
- **Legacy inputs:** `ai-process.md §21`, `testing.md §8`, `testing.md §10`

## GH-AIEVAL-006 — Re-run baseline checks after a salient correction

- **Status:** Ratified
- **Statement:** Re-run ordinary baseline checks after adopting a salient correction, verify each
  side of a comparison independently, and prefer the cheapest real execution over extended
  inference whenever an execution path exists.
- **Rationale:** Attention spent on the latest failure mode can silently displace routine checks
  that still carry equal weight.
- **Verification / evidence:** Verification templates list subject freshness, reference freshness,
  source authority, execution result, and remaining inference as separate fields; regression cases
  combine a recently corrected defect with an unrelated stale or missing baseline.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Engineering owns executable checks; domain authorities own the facts
  they establish. `.github` owns agent attention, recency, and report-completeness protocols.
- **Legacy inputs:** `ai-process.md §22`
