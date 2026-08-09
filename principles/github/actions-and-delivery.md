# Actions and delivery

These Draft principles govern GitHub Actions and GitHub delivery automation owned by `.github`.
They do not define build, test, security, product readiness, compliance, or design policy.
[ADR-0003](../../docs/architecture/0003-four-authority-topology.md) remains the sole authority
topology.

## GH-ACT-001 — Automate authority-owned commands

- **Status:** Draft
- **Statement:** Make workflows invoke the versioned commands and checks defined by the responsible
  authority; do not let workflow wiring become a second definition of build, test, security, or
  release behavior.
- **Rationale:** Actions should make evidence repeatable without transferring ownership of the
  mechanism or obligation to `.github`.
- **Verification / evidence:** Reusable workflow inputs expose caller-supplied commands, and member
  workflows pass repository-defined commands. A review can trace each required job from the member
  call through the reusable workflow to the authority-owned script or configuration it executes.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Engineering defines technical commands and evidence; Product defines
  obligations and release decisions; Studio defines design/UI validation. `.github` schedules and
  reports them.
- **Legacy inputs:** `devops.md §1`, `devops.md §2`

## GH-ACT-002 — Give every required check a terminal result

- **Status:** Draft
- **Statement:** Trigger each required workflow for every pull request in its protected scope, and
  put conditional execution inside jobs or steps so the required check reports success, failure, or
  an intentional skip.
- **Rationale:** A required check that never starts leaves GitHub unable to distinguish inapplicable
  work from missing evidence.
- **Verification / evidence:** Branch protection or rulesets name the required checks; workflow
  event filters cover their full protected scope; representative pull requests, including
  path-limited changes, receive terminal check conclusions.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** The authority that defines a check decides applicability and success
  criteria; `.github` ensures GitHub always receives an unambiguous result.
- **Legacy inputs:** `devops.md §1.1`, `devops.md §1.3`

## GH-ACT-003 — Pin Actions and minimize permissions

- **Status:** Draft
- **Statement:** Pin every third-party Action to an immutable full commit SHA, document the human
  version, and scope each workflow token through explicit workflow- or job-level permissions to only
  the GitHub operations it exercises.
- **Rationale:** Immutable references constrain supply-chain change, while explicit least privilege
  limits the impact of a compromised step.
- **Verification / evidence:** Workflow review finds full-SHA `uses:` references with version
  comments and an explicit `permissions` block; GitHub Actions dependency review or an equivalent
  repository check rejects mutable references and unexpected write scopes.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Engineering owns generic dependency and security mechanisms;
  `.github` owns the GitHub Actions reference and token-permission configuration that applies them.
- **Legacy inputs:** `devops.md §1.2`, `devops.md §3`, `security.md §2`,
  `security.md §4`

## GH-ACT-004 — Keep secrets out of untrusted automation

- **Status:** Draft
- **Statement:** Store automation credentials in GitHub secret or environment controls, expose them
  only to the smallest trusted job and event scope, and never require real secrets to validate an
  untrusted pull request.
- **Rationale:** Pull-request code is untrusted input, and a secret available to it is a disclosure
  path rather than a validation dependency.
- **Verification / evidence:** Workflows do not embed credentials, fork pull-request jobs complete
  without repository secrets, protected environments gate sensitive jobs, and credential scopes
  match the exact GitHub API operations used. The sync workflow fails closed when its narrowly
  scoped cross-repository credential is absent.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Engineering defines application credential handling and threat
  controls; Product or Compliance defines obligations. `.github` owns GitHub secret exposure,
  event trust boundaries, and environment gates.
- **Legacy inputs:** `devops.md §1.4`, `devops.md §3`, `security.md §1`,
  `security.md §4`

## GH-ACT-005 — Own reusable workflows once

- **Status:** Draft
- **Statement:** Maintain shared GitHub Actions behavior as reusable workflows in `.github`, call it
  by repository reference, and reject member-local copies unless the member intentionally owns a
  distinct workflow.
- **Rationale:** Direct reuse keeps fixes reviewable at one source; copied workflow files silently
  fork and stop receiving updates.
- **Verification / evidence:** Member workflows call
  `jrmoulckers/.github/.github/workflows/reusable-*.yml@<reviewed-commit-sha>` and do not carry
  copied `reusable-*.yml` files. The fleet registry declares available workflows, checkout
  verification records actual calls and rejects undeclared or non-SHA refs, and native `workflows`
  entries produce no sync writes.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Engineering owns the invoked build, test, and release commands;
  `.github` owns reusable workflow interfaces and GitHub execution wiring.
- **Legacy inputs:** `devops.md §2`, `devops.md §11`

## GH-ACT-006 — Keep release automation subordinate to release authority

- **Status:** Draft
- **Statement:** Let GitHub automation prepare, attest, and publish only the artifacts authorized by
  an explicit Product release decision and produced by Engineering-owned mechanisms; do not infer
  readiness from workflow success alone.
- **Rationale:** A green workflow proves its configured checks passed, not that product obligations
  or release judgment were satisfied.
- **Verification / evidence:** A release run points to an approved revision and release decision,
  preserves artifact provenance, and uses protected environments or an equivalent approval gate for
  publication. Workflow logs distinguish preparation from publication and identify the released
  commit or tag.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Product owns release/go-no-go and obligations; Engineering owns build,
  packaging, and release mechanisms; `.github` automates their approved GitHub execution and records
  the result.
- **Legacy inputs:** `devops.md §8`

## GH-ACT-007 — Report partial and refused automation honestly

- **Status:** Draft
- **Statement:** Surface every failed, skipped, drifted, or refused target with enough GitHub-visible
  context for a reviewer to act, and never present a partial run as complete success.
- **Rationale:** Safety mechanisms are useful only when their refusal and remaining work are visible
  where merge decisions occur.
- **Verification / evidence:** Check summaries, annotations, logs, or generated pull-request bodies
  name affected repositories and paths and return a non-success conclusion when required work
  remains. [`sync/test/runner.test.mjs`](../../sync/test/runner.test.mjs) verifies member failure
  isolation and exact drift reporting; [`sync/test/prbody.test.mjs`](../../sync/test/prbody.test.mjs)
  verifies actionable pull-request wording.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** The responsible authority decides how to remedy its failed evidence or
  source content; `.github` owns accurate GitHub reporting and refusal semantics.
- **Legacy inputs:** `devops.md §1.1`, `devops.md §14`
