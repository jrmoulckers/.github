# Repository governance

These Draft principles govern GitHub repository state and Copilot repository operations owned by
`.github`. [ADR-0003](../../docs/architecture/0003-four-authority-topology.md) remains the sole
authority topology.

## GH-REPO-001 — Protect canonical branches

- **Status:** Draft
- **Statement:** Protect the default branch and any maintained release branch from direct or
  destructive updates; require changes to arrive through reviewable pull requests.
- **Rationale:** Canonical branches must preserve an attributable, inspectable history and a stable
  merge gate.
- **Verification / evidence:** GitHub rulesets or branch-protection state names the protected refs,
  blocks force pushes and deletion, and requires pull requests. A repository audit can compare that
  state with the default branch returned by the GitHub repository API.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Product decides whether a release may proceed; Engineering defines
  build, test, and release mechanisms. `.github` protects the refs through which those decisions and
  mechanisms land.
- **Legacy inputs:** `process.md §1`, `process.md §1.1`, `process.md §1.2`, `process.md §4`,
  `process.md §4.1`

## GH-REPO-002 — Make merge evidence explicit

- **Status:** Draft
- **Statement:** Require a pull request to identify its issue, receive the configured review, and
  report every applicable required check before merge.
- **Rationale:** A merge decision is auditable only when intent, review, and check results are
  attached to the exact head revision.
- **Verification / evidence:** Pull-request metadata shows the linked issue, required approvals,
  current-head review status, and a terminal result for each required check; ruleset or
  branch-protection configuration names the enforced checks.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Engineering owns what technical evidence means; Product owns
  release/go-no-go obligations. `.github` records and enforces their selected checks without
  redefining them.
- **Legacy inputs:** `devops.md §1.3`, `process.md §2`, `process.md §4`

## GH-REPO-003 — Prefer GitHub-native health inheritance

- **Status:** Draft
- **Statement:** Author shared issue, pull-request, discussion, contribution, security, and conduct
  defaults in the owner `.github` repository; add a member-local file only as an intentional,
  reviewed override.
- **Rationale:** GitHub-native inheritance keeps defaults current, while copied files silently
  shadow the canonical source and drift.
- **Verification / evidence:** The member has no unintended local counterpart for inherited health
  files, and GitHub renders the expected template or community-health file. The sync manifest treats
  `health` as native, and
  [`sync/test/manifest.test.mjs`](../../sync/test/manifest.test.mjs) verifies native kinds never
  produce writes.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Product owns product/operations template content and obligations;
  `.github` owns GitHub-native template placement and inheritance. Studio-owned UI guidance is
  referenced, not copied, when a template needs it.
- **Legacy inputs:** `devops.md §11`

## GH-REPO-004 — Keep the fleet registry factual

- **Status:** Draft
- **Statement:** Record each managed repository and its declared sync selections in the fleet
  registry, and verify checkout-derived facts before any member write.
- **Rationale:** A registry is trustworthy only when descriptive claims are distinguishable from
  executable selections and checked against the repository they describe.
- **Verification / evidence:** [`studio.config.json`](../../studio.config.json) is the registry;
  `node sync/index.mjs --dry-run` validates its shape, while real sync, `--check`, or a verified
  `--work-dir` checks repository identity and derivable facts before writes.
  [`sync/test/member-facts.test.mjs`](../../sync/test/member-facts.test.mjs) and
  [`sync/test/cli-workdir.test.mjs`](../../sync/test/cli-workdir.test.mjs) exercise those gates.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Each authority owns its source artifacts and repository-local facts;
  `.github` records only the fleet facts and distribution selections needed to operate sync.
- **Legacy inputs:** `devops.md §15`, `ai-process.md §20`, `ai-process.md §21`

## GH-REPO-005 — Preserve provenance and refuse ambiguous clobbers

- **Status:** Draft
- **Statement:** Stamp generated materializations with source provenance, track their accepted
  baseline, and leave locally changed or ambiguous targets untouched unless an explicitly reviewed
  recovery path authorizes replacement.
- **Rationale:** Distribution must not turn canonical ownership into permission to erase
  member-authored work.
- **Verification / evidence:** The sync lock records source and target hashes; generated text carries
  its provenance note; drift reports name every skipped path.
  [`sync/test/copier.test.mjs`](../../sync/test/copier.test.mjs),
  [`sync/test/basemerge.test.mjs`](../../sync/test/basemerge.test.mjs), and
  [`sync/test/runner.test.mjs`](../../sync/test/runner.test.mjs) verify refusal, recovery, and
  reporting behavior.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** The source authority resolves content changes; the member owner
  resolves intentional local divergence. `.github` supplies provenance and a reviewable sync report,
  not a new normative source.
- **Legacy inputs:** `devops.md §13`, `devops.md §14`, `ai-process.md §20`

## GH-REPO-006 — Compare normalized rendered content

- **Status:** Draft
- **Statement:** Normalize platform-variant content before hashing, and compare a generated target
  with the exact rendering the generator would emit rather than with raw source.
- **Rationale:** Line endings and provenance wrappers must not create false drift or conceal real
  drift.
- **Verification / evidence:** Sync hashes use LF-normalized content, and
  [`sync/test/provenance.test.mjs`](../../sync/test/provenance.test.mjs) verifies both the rendered
  provenance form and CRLF/LF equivalence. A hand audit follows the documented
  `inject(targetPath, canon) === toLF(memberFile)` comparison.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Source authorities provide canonical bytes; `.github` owns only the
  deterministic GitHub distribution rendering and comparison rules.
- **Legacy inputs:** `devops.md §12`, `devops.md §13`

## GH-REPO-007 — Isolate Copilot repository sessions

- **Status:** Draft
- **Statement:** Give each Copilot coding session one owning worktree and feature branch based on the
  intended base revision; do not let concurrent sessions share mutable repository state.
- **Rationale:** Session isolation keeps attribution, review, cleanup, and conflict handling
  observable in GitHub instead of coupling unrelated agent work through a checkout.
- **Verification / evidence:** Session metadata identifies one repository, worktree, branch, and base;
  commits and the pull request point to that branch; the primary checkout and other session
  worktrees remain unchanged. Sync's local checkout guard in
  [`sync/test/workdir.test.mjs`](../../sync/test/workdir.test.mjs) demonstrates acceptance of Git
  worktrees and refusal of mismatched repository identity.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** The authority that owns the task supplies domain decisions and review;
  `.github` owns the GitHub/Copilot branch, worktree, and pull-request operating rule.
- **Legacy inputs:** `process.md §1`, `process.md §1.2`, `ai-process.md §13`,
  `ai-process.md §17`
