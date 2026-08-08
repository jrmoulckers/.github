# Agent operations

These Draft principles govern `.github`-owned GitHub Copilot and AI agent configuration and
operation. They apply to agents, skills, prompts, instructions, evals, capability rosters, tool
permissions, dispatch, and session operation. They reference rather than duplicate
[ADR-0003](../../docs/architecture/0003-four-authority-topology.md), repository governance, and
GitHub Actions principles.

## GH-AIOPS-001 — Author AI configuration once

- **Status:** Draft
- **Statement:** Author each shared agent, skill, prompt, instruction, eval, and runtime setting in
  one canonical `.github` source and materialize or reference it through the declared distribution
  path instead of maintaining member copies.
- **Rationale:** Multiple authored copies create silent behavioral forks and prevent one reviewed
  correction from reaching every consumer.
- **Verification / evidence:** [`studio.config.json`](../../studio.config.json) names canonical
  rosters, source paths, target paths, and member selections; generated materializations carry
  provenance and local authored replacements follow ADR-0001 rather than editing generated files.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Product, Engineering, and Studio keep repository-specific facts in
  their owned sources or local overlays. `.github` owns generic AI canon and its distribution, which
  does not transfer authority over those facts.
- **Legacy inputs:** `ai-process.md §1`

## GH-AIOPS-002 — Reconcile schemas, files, and capability rosters

- **Status:** Draft
- **Statement:** Reconcile every declared agent and dependency with its definition file, required
  schema, allowed values, referenced skills and prompts, and each member's selected capability set
  before dispatch or distribution.
- **Rationale:** A roster that diverges from executable definitions advertises missing capabilities
  or leaves real capabilities undiscoverable and ungoverned.
- **Verification / evidence:** [`instructions/agents.instructions.md`](../../instructions/agents.instructions.md)
  defines the frontmatter contract; [`sync/test/agent-integrity.test.mjs`](../../sync/test/agent-integrity.test.mjs)
  rejects name, schema, roster, section, handoff, skill, prompt, and member-selection disagreement.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Local authorities declare only supported overlays and replacements;
  `.github` owns capability schema and reconciliation without redefining domain responsibilities.
- **Legacy inputs:** `ai-process.md §1.1`, `ai-process.md §4`

## GH-AIOPS-003 — Grant least-privilege tools and writes

- **Status:** Draft
- **Statement:** Grant each agent only the tools, write scope, paths, credentials, and remote
  operations required by its documented workflow, and require reviewed justification for every
  expansion.
- **Rationale:** Unused capability widens the blast radius of mistaken or compromised agent action.
- **Verification / evidence:** Agent frontmatter maps `tools`, `write_scope`, `primary_paths`, and
  `risk_level` to concrete workflow steps; reviewers and
  [`sync/test/agent-integrity.test.mjs`](../../sync/test/agent-integrity.test.mjs) reject missing or
  inconsistent declarations, and read-only roles have no edit grant.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Each authority identifies task data and owned paths; Engineering owns
  generic authorization mechanisms. `.github` owns Copilot/agent tool and write grants.
- **Legacy inputs:** `ai-process.md §2`, `security.md §4`

## GH-AIOPS-004 — Assign one accountable lead per path

- **Status:** Draft
- **Statement:** Assign each task and mutable path to one accountable lead agent, declare exclusions
  and handoffs, and prevent concurrent implementers from owning overlapping changes.
- **Rationale:** Competing ownership produces conflicting edits, unclear review responsibility, and
  duplicated decisions.
- **Verification / evidence:** Agent `primary_paths`, File Ownership, Boundaries, and handoff
  references identify one lead; the dispatch record names that lead and explicit read-only
  specialists; overlapping session changes are refused or re-scoped before implementation.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** ADR-0003 determines domain authority; local `AGENTS.md` overlays name
  product paths and risks. `.github` owns agent assignment and conflict prevention, not the domain
  decision.
- **Legacy inputs:** `ai-process.md §3`

## GH-AIOPS-005 — Structure prompts as testable contracts

- **Status:** Draft
- **Statement:** Structure prompts and instructions with an explicit goal, inputs, owned files,
  exclusions, tasks, safety limits, validation, and completion output instead of relying on ambient
  or open-ended context.
- **Rationale:** A prompt can be reviewed and regression-tested only when its obligations and
  boundaries are observable.
- **Verification / evidence:** [`skills/prompt-engineering/SKILL.md`](../../skills/prompt-engineering/SKILL.md)
  supplies the canonical prompt shape; prompt review traces each acceptance criterion and forbidden
  action to text or an inherited instruction and exercises missing, conflicting, and adversarial
  inputs.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** The task's authority supplies outcomes, constraints, and evidence;
  `.github` owns the prompt contract that carries them without inventing domain policy.
- **Legacy inputs:** `ai-process.md §5`

## GH-AIOPS-006 — Block behavior changes on agent regressions

- **Status:** Draft
- **Statement:** Block agent, skill, prompt, instruction, model, tool, permission, or dispatch
  changes until representative golden, failure, adversarial, and permission-regression cases pass.
- **Rationale:** AI configuration can regress behavior without producing a syntax or build failure.
- **Verification / evidence:** The changed asset names its eval cases, rubric, baseline, and result;
  CI runs the executable gate. The declared `evals/**` surface in
  [`agents/ai-ops-engineer.agent.md`](../../agents/ai-ops-engineer.agent.md) must contain the relevant
  gate before a behavior-changing asset ships, and mutations prove the gate can fail.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Engineering owns generic test and CI mechanisms and supplies
  security cases; Product and Studio supply their domain cases. `.github` owns agent-specific evals,
  rubrics, and regression gates.
- **Legacy inputs:** `ai-process.md §6`, `testing.md §7`, `testing.md §8`

## GH-AIOPS-007 — Stop for human-gated operations

- **Status:** Draft
- **Statement:** Stop before any human-gated operation, present the exact action, scope, evidence,
  and risk, and proceed only after the authorized human explicitly approves it.
- **Rationale:** Agents may prepare evidence but cannot assume standing for protected, destructive,
  secret-bearing, publishing, deployment, or third-party decisions.
- **Verification / evidence:** Root [`AGENTS.md`](../../AGENTS.md) enumerates mandatory gates; agent
  definitions repeat role-specific gates without relaxing them; session logs show approval before
  the gated tool call and refusal when approval is absent.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** The authorized repository owner or responsible human decides the
  gated action; `.github` owns the agent stop-and-request protocol.
- **Legacy inputs:** `ai-process.md §7`

## GH-AIOPS-008 — Version every behavior-bearing configuration

- **Status:** Draft
- **Statement:** Version prompts, models, agents, skills, instructions, evals, tool definitions, and
  runtime adapters in reviewable source, and identify the exact revisions that produced reported
  behavior.
- **Rationale:** Untracked console edits, floating aliases, and environment-only settings cannot be
  diffed, reproduced, bisected, or rolled back.
- **Verification / evidence:** A report records repository commit plus relevant model and tool
  versions; behavior-bearing changes appear in the pull-request diff; sync provenance and lock
  records identify canonical and rendered hashes for distributed assets.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Engineering owns generic configuration and release mechanisms;
  member authorities own local facts. `.github` owns versioning and provenance for AI behavior.
- **Legacy inputs:** `ai-process.md §8`

## GH-AIOPS-009 — Keep secrets and sensitive data out of context

- **Status:** Draft
- **Statement:** Keep secret values, credentials, private URLs, and real personal or confidential
  data out of prompts, instructions, skills, eval fixtures, reports, memory, and committed agent
  context.
- **Rationale:** Agent context may be logged, synchronized, retained, or transmitted to model and
  tool providers beyond the original file boundary.
- **Verification / evidence:** Prompts reference secret names rather than values; fixtures are
  synthetic; tool grants and path scopes exclude unrelated sensitive sources; secret scanning and
  review cover every AI asset and generated report.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Product classifies obligations and data; Engineering owns secret and
  privacy mechanisms. `.github` owns what AI context, tools, fixtures, and reports may receive.
- **Legacy inputs:** `ai-process.md §9`, `compliance.md §8`

## GH-AIOPS-010 — Stage work from plan through monitoring

- **Status:** Draft
- **Statement:** Stage agent work as Plan, Implement, Verify, Ship, and Monitor, and require each
  stage to produce the artifact or evidence needed by the next.
- **Rationale:** A named sequence prevents implementation before ownership is clear and prevents
  completion claims before repository checks and remote state are known.
- **Verification / evidence:** [`instructions/workflow.instructions.md`](../../instructions/workflow.instructions.md)
  defines issue, worktree, validation, pull-request, CI, and mergeability evidence; agent definitions
  map their workflow to those stages and reports distinguish completed, refused, and pending steps.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Domain authorities supply plan decisions and acceptance evidence;
  Engineering supplies repository checks. `.github` owns agent workflow staging and GitHub state
  reporting.
- **Legacy inputs:** `ai-process.md §10`

## GH-AIOPS-011 — Factor reusable expertise into focused skills

- **Status:** Draft
- **Statement:** Factor reusable agent expertise into composable, single-responsibility skills with
  explicit triggers, inputs, outputs, boundaries, and related-skill references.
- **Rationale:** Focused skills can be loaded and corrected independently, while duplicated or
  omnibus guidance drifts and obscures which rule applies.
- **Verification / evidence:** [`studio.config.json`](../../studio.config.json) declares the skill
  roster; agent Related skills blocks name dependencies; agent-integrity tests reject unavailable
  member selections; skill review rejects duplicated responsibilities and undeclared dependencies.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Other authorities supply domain sources and local overlays; `.github`
  owns the reusable AI skill interface and dependency graph.
- **Legacy inputs:** `ai-process.md §11`

## GH-AIOPS-012 — Dispatch from declared capability

- **Status:** Draft
- **Statement:** Dispatch each task deterministically to one declared lead by matching
  `when_to_use`, owned paths, write scope, risk, and required tools, and record why that lead won.
- **Rationale:** Vague or order-dependent routing sends work to the wrong specialist and makes
  repeated runs disagree.
- **Verification / evidence:** Agent frontmatter supplies machine-readable routing inputs;
  [`prompts/team.prompt.md`](../../prompts/team.prompt.md) maps work through labels and ownership;
  dispatch evals cover positive, negative, overlap, and no-match cases.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** ADR-0003 and local overlays determine the responsible domain and
  paths; `.github` owns the deterministic routing algorithm and dispatch record.
- **Legacy inputs:** `ai-process.md §12`

## GH-AIOPS-013 — Execute in isolated repository sessions

- **Status:** Draft
- **Statement:** Execute each mutable task in one session, worktree, feature branch, and owning-agent
  assignment based on the intended revision, and never share mutable checkout state between
  concurrent implementers.
- **Rationale:** Isolation makes changes attributable and prevents unrelated sessions from
  contaminating files, branches, validation, or cleanup.
- **Verification / evidence:** `GH-REPO-007` remains the repository-isolation rule; session metadata
  names repository, base, worktree, branch, and owner; dispatch records prevent duplicate
  assignments, and [`sync/test/workdir.test.mjs`](../../sync/test/workdir.test.mjs) verifies
  worktree acceptance and repository identity.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** The task authority supplies decisions and review; `.github` owns
  agent assignment inside the already-defined GitHub session isolation contract.
- **Legacy inputs:** `ai-process.md §13`

## GH-AIOPS-014 — Vet and pin external AI tools

- **Status:** Draft
- **Statement:** Vet each MCP server and external AI tool for source, version, data flow, purpose,
  permissions, and failure behavior; pin an immutable version and expose only required operations.
- **Rationale:** An external tool is executable supply-chain code and a potential data boundary, not
  a harmless capability label.
- **Verification / evidence:** [`agency.toml`](../../agency.toml) is the declared MCP inventory and
  must contain reviewed versions and narrow tool lists rather than floating `latest` or wildcard
  grants; change review records provenance, data classes, consumers, and rollback evidence.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Engineering owns generic supply-chain and isolation mechanisms;
  Product defines data obligations. `.github` owns AI tool admission and runtime exposure.
- **Legacy inputs:** `ai-process.md §14`, `security.md §2`

## GH-AIOPS-015 — Enforce artifact shapes and local overlays

- **Status:** Draft
- **Statement:** Define and validate the required metadata and sections for every AI artifact type,
  and keep product stack, paths, commands, and risks in supported local overlays rather than
  modifying generated canon.
- **Rationale:** Machine-readable shapes enable integrity checks, while explicit overlays preserve
  local authority without forking generic assets.
- **Verification / evidence:** [`instructions/agents.instructions.md`](../../instructions/agents.instructions.md)
  and [`instructions/skills.instructions.md`](../../instructions/skills.instructions.md) define
  current shapes; ADR-0001 defines overlay precedence and replacement rules; executable validators
  reject missing structure and sync tests protect generated materializations.
- **Owner / ratification:** `.github` owns this principle; it remains Draft until the repository
  owner ratifies it through a reviewed pull request.
- **Cross-authority handoff:** Product, Engineering, and Studio own their local facts and
  constraints; `.github` owns artifact schemas, generated canon, and safe overlay mechanics.
- **Legacy inputs:** `ai-process.md §16`
