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

## Draft validation

Until a dedicated metadata validator is added, review every new or changed principle manually:

1. The ID is unique and matches `GH-<AREA>-NNN`.
2. Status is `Draft`.
3. Statement is imperative and GitHub-owned.
4. Rationale and observable verification are present.
5. Owner/ratification and cross-authority handoff are explicit.
6. `Legacy inputs` lists exact legacy section IDs or `none`.

The existing sync suite remains the executable evidence for fleet, provenance, drift, reporting,
and normalization behavior referenced by these principles.
