# GitHub principles

This tree is the canonical home for `.github`-owned principles. Its authority and boundaries come
from [ADR-0003](../docs/architecture/0003-four-authority-topology.md); this index does not restate
that topology.

The 43 published principles have `Ratified` target status. Ratification is effective only when the
repository owner merges the protected pull request containing the
[owner Ratification decision](decisions/0001-github-ai-owner-ratification.md); the proposed record
does not claim approval before that merge.

## Principle sets

| Area | Ratified principles | Scope |
| --- | --- | --- |
| [Repository governance](github/repository-governance.md) | `GH-REPO-001`–`GH-REPO-007` | Branches, pull requests, native repository health, fleet facts, sync provenance, and Copilot session isolation |
| [Actions and delivery](github/actions-and-delivery.md) | `GH-ACT-001`–`GH-ACT-007` | Required checks, reusable workflows, Actions supply-chain controls, secrets, release automation, and reporting |
| [Product AI](ai/product-ai.md) | `GH-AIP-001`–`GH-AIP-008` | Model choice, prompt and UX handoffs, guardrails, evals, budgets, disclosure, privacy, and graceful degradation |
| [Agent operations](ai/agent-operations.md) | `GH-AIOPS-001`–`GH-AIOPS-015` | Canonical AI assets, schemas, permissions, dispatch, workflows, tools, sessions, and overlays |
| [AI evidence and evals](ai/evidence-and-evals.md) | `GH-AIEVAL-001`–`GH-AIEVAL-006` | Report freshness, decision standing, source verification, proof scope, and attention management |

## Ratification validation

Run the repository-level principle validator:

```bash
node principles/validate.mjs
node --test "principles/test/*.test.mjs"
node principles/validate.mjs --verify-legacy
```

[`manifest.json`](manifest.json) pins every published ID and resolves each accepted legacy filename
to an exact repository, commit, path, Git blob digest, and section set. Its status catalog also pins
each ID to its path, `Ratified` status, and SHA-256 of all semantic fields except status. Against an
existing base-branch manifest, published IDs, Ratification decisions, and legacy migrations are
append-only; the initial sets remain fixed to the bootstrap history. The validator requires an
exact decision record for every Draft-to-Ratified transition, checks the transition against the
event base rather than the current head, and rejects unauthorized or mixed status, catalog drift,
semantic or Legacy-input drift, ambiguous approval, and wrong base evidence. The optional live
verification command confirms every pinned legacy Git blob and section at its recorded commit.

The sync suite remains separate executable evidence for fleet, provenance, drift, reporting, and
normalization behavior referenced by these principles. CI runs the principle and sync suites
independently, then an always-running `CI gate` fails unless both completed successfully.
