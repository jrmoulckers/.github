# Session reporting

These Draft principles govern how agent sessions report their own state to owners and to each
other. They are a distinct document from [AI evidence and evals](evidence-and-evals.md) because
that set is pinned to the owner Ratification semantic base; these principles are proposed after it
and carry no claim of owner approval.
[ADR-0003](../../docs/architecture/0003-four-authority-topology.md) remains the sole authority
topology.

## GH-AIREP-001 — State the measurement behind every status claim

- **Status:** Draft
- **Statement:** State the measurement that produced each line of a status report, match the scope
  of that measurement to the scope of the claim it supports, and treat a line that can name no
  measurement as a belief rather than a status.
- **Rationale:** A report's freshly measured lines lend their apparent currency to its unmeasured
  ones, so review that inspects the report instead of the claim passes a stale line indefinitely;
  and a line measured over a narrower window than it asserts is evidence for a different claim
  rather than weaker evidence for this one.
- **Verification / evidence:** Standing and status reports pair every line with the command,
  query, or execution that produced it and the window that execution covers; assertions that no
  action occurred name the history searched rather than resting on the absence of a recollection;
  a report carrying a line it cannot measure marks that line as a belief instead of asserting or
  silently dropping it.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Engineering owns the commands that produce measurements; domain
  authorities own the facts each measurement establishes. `.github` owns report structure, claim
  scoping, and the standing-report protocol between sessions.
- **Legacy inputs:** none
