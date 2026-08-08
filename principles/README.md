# GitHub principles

This tree is the canonical home for `.github`-owned principles. Its authority and boundaries come
from [ADR-0003](../docs/architecture/0003-four-authority-topology.md); this index does not restate
that topology.

All principles are **Draft**. Agents may propose changes, but only the repository owner can ratify a
principle through repository review. Draft principles are directional proposals, not yet normative
policy.

## Principle sets

| Area | Draft principles | Scope |
| --- | --- | --- |
| [Repository governance](github/repository-governance.md) | `GH-REPO-001`–`GH-REPO-007` | Branches, pull requests, native repository health, fleet facts, sync provenance, and Copilot session isolation |
| [Actions and delivery](github/actions-and-delivery.md) | `GH-ACT-001`–`GH-ACT-007` | Required checks, reusable workflows, Actions supply-chain controls, secrets, release automation, and reporting |
| [Product AI](ai/product-ai.md) | `GH-AIP-001`–`GH-AIP-008` | Model choice, prompt and UX handoffs, guardrails, evals, budgets, disclosure, privacy, and graceful degradation |
| [Agent operations](ai/agent-operations.md) | `GH-AIOPS-001`–`GH-AIOPS-015` | Canonical AI assets, schemas, permissions, dispatch, workflows, tools, sessions, and overlays |
| [AI evidence and evals](ai/evidence-and-evals.md) | `GH-AIEVAL-001`–`GH-AIEVAL-006` | Report freshness, decision standing, source verification, proof scope, and attention management |

## Draft validation

Run the repository-level principle validator:

```bash
node principles/validate.mjs
node --test "principles/test/*.test.mjs"
node principles/validate.mjs --verify-legacy
```

[`manifest.json`](manifest.json) pins every published ID and resolves each accepted legacy filename
to an exact repository, commit, path, Git blob digest, and section set. Against an existing
base-branch manifest, published ID lists are append-only. The validator rejects deletion,
renumbering, duplicate IDs, non-Draft status, missing metadata, non-imperative statements,
owner/ratification wording changes, and unresolved legacy references. Persistent negative fixtures
and in-memory mutations prove those checks fail closed. The optional live verification command
requires read access to the legacy Studio repository and confirms every cataloged Git blob and
section at its pinned commit.

The sync suite remains separate executable evidence for fleet, provenance, drift, reporting, and
normalization behavior referenced by these principles.
