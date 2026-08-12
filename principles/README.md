# GitHub principles

This tree is the canonical home for `.github`-owned principles. Its authority and boundaries come
from [ADR-0003](../docs/architecture/0003-four-authority-topology.md); this index does not restate
that topology.

The 43 principles covered by the owner Ratification decision have `Ratified` target status.
Ratification is effective only when the repository owner merges the protected pull request
containing the [owner Ratification decision](decisions/0001-github-ai-owner-ratification.md); the
proposed record does not claim approval before that merge. Principles published after that decision
carry `Draft` status and are listed separately below; each needs its own decision record to become
Ratified.

## Principle sets

| Area | Ratified principles | Scope |
| --- | --- | --- |
| [Repository governance](github/repository-governance.md) | `GH-REPO-001`–`GH-REPO-007` | Branches, pull requests, native repository health, fleet facts, sync provenance, and Copilot session isolation |
| [Actions and delivery](github/actions-and-delivery.md) | `GH-ACT-001`–`GH-ACT-007` | Required checks, reusable workflows, Actions supply-chain controls, secrets, release automation, and reporting |
| [Product AI](ai/product-ai.md) | `GH-AIP-001`–`GH-AIP-008` | Model choice, prompt and UX handoffs, guardrails, evals, budgets, disclosure, privacy, and graceful degradation |
| [Agent operations](ai/agent-operations.md) | `GH-AIOPS-001`–`GH-AIOPS-015` | Canonical AI assets, schemas, permissions, dispatch, workflows, tools, sessions, and overlays |
| [AI evidence and evals](ai/evidence-and-evals.md) | `GH-AIEVAL-001`–`GH-AIEVAL-006` | Report freshness, decision standing, source verification, proof scope, and attention management |

### Proposed after the owner Ratification decision

| Area | Draft principles | Scope |
| --- | --- | --- |
| [Session reporting](ai/session-reporting.md) | `GH-AIREP-001` | Status and standing reports: the measurement behind each line, and matching a measurement's scope to its claim's |

## Reach

**This tree is backbone-internal. No principle in it is delivered to any member repository.** Every
principle names a *Cross-authority handoff*, and the authority named there cannot read the document
naming it:

```
members                       11
delivered writes             653   <- enumerable from this repository
originating in principles/     0
originating in docs/           0
source trees actually delivered:
  agents/  skills/  prompts/  instructions/
  AGENTS.md  agency.toml  .gitattributes  copilot-instructions.md

additionally delivered, sourced elsewhere:
  vendor/@jrm/tokens   4 members, copied from jrmoulckers/studio
```

The second block is stated because the first is not the whole delivery. The vendored token
distribution reaches four members and is enumerated from a `jrmoulckers/studio` checkout rather
than from this repository, so it is structurally absent from the 653. It cannot carry a principle —
its bytes are not ours — which is exactly why it is safe to leave out of the tally above and not
safe to leave out of the description. A reader who takes the 653 for the delivered surface will
conclude that members receive nothing under `vendor/`, and that is false.

That has a consequence worth stating where the handoff is read rather than leaving it to be
discovered: **a handoff recorded here is not self-delivering.** Naming Engineering, or a domain
authority, or a member session as the party who must act does not put the obligation in front of
them — the citation only discharges the obligation if the artifact is reachable by the audience, and
this one is not. A principle that must reach an authority has to travel by an artifact that authority
receives: an instruction, an agent definition, or a skill.

The instance that makes this concrete is `GH-AIREP-001`, which was derived from a member session's
own finding, hands off to Engineering and to domain authorities, and cannot be read by either. It
reached the session that produced it only because the two were already corresponding.

Widening the delivered surface is an owner decision and is not proposed here. What is recorded here
is the limitation, so that no reader takes a handoff in this tree for a delivery.

## Ratification validation

Run the repository-level principle validator:

```bash
node principles/validate.mjs
node --test "principles/test/*.test.mjs"
node principles/validate.mjs --verify-legacy
```

[`manifest.json`](manifest.json) pins every published ID and resolves each accepted legacy filename
to an exact repository, commit, path, Git blob digest, and section set. Its status catalog also pins
each ID to its path, its `Ratified` or `Draft` status, and SHA-256 of all semantic fields except
status. Against an
existing base-branch manifest, published IDs, Ratification decisions, and legacy migrations are
append-only; the initial sets remain fixed to the bootstrap history. The validator requires an
exact decision record for every Draft-to-Ratified transition, checks the transition against the
event base rather than the current head, and rejects unauthorized or mixed status, catalog drift,
semantic or Legacy-input drift, ambiguous approval, and wrong base evidence. The optional live
verification command confirms every pinned legacy Git blob and section at its recorded commit.

The sync suite remains separate executable evidence for fleet, provenance, drift, reporting, and
normalization behavior referenced by these principles. CI runs the principle and sync suites
independently, then an always-running `CI gate` fails unless both completed successfully.
