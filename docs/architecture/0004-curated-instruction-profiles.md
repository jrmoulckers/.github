# ADR-0004: Curated instruction profiles for live-system repositories

## Status

Accepted

## Context

Canonical scoped instructions were previously wildcard-selected by most members. That made a single
generic workflow, documentation, skill, or token rule apply equally to application products, the
Studio token source, Homelab live operations, and Windows device management. Markdown scope also
overlapped generated AI assets, while consumer materializations could be mistaken for local editing
surfaces.

Homelab has an exact host-first/repo-first operations model and eight declared local roles with a
local flat schema. Generic product workflow and authoring instructions cannot grant those roles live
authority or replace local confirmation and reconciliation rules. The sync engine also does not
prune files when an instruction is deselected.

## Decision

1. Canonical instruction source remains `instructions/*.instructions.md`; opted-in consumer copies
   materialize as read-only `.github/instructions/*.instructions.md`.
2. Root/local `AGENTS.md` and more-specific scoped instructions override shared defaults for their
   scope. Mandatory human gates remain the floor, and generated assets never become local editing
   surfaces.
3. Applications and Studio explicitly select the five general instructions: `agents`, `docs`,
   `skills`, `tokens`, and `workflow`.
4. Homelab selects only `agents` and `infrastructure-operations`. The agent instruction recognizes
   names declared through `localAgents`, permits documented local schema extensions, and preserves
   canonical/local slug collision guards.
5. Windows selects `agents`, `docs`, `infrastructure-operations`, and `skills`; it does not receive
   token authoring or product fleet workflow assumptions.
6. `infrastructure-operations` defines repo-first and host-first modes, explicit confirmation for
   high-consequence operations, last-known-good/rollback/second-access-path requirements,
   live-to-repo reconciliation, validation/drift checks, operations logging, and local operator
   authority. It grants no generic canonical agent access to a live host.
7. Deselected generated files are removed only through a consumer PR that verifies each current
   file's normalized hash against its `.studio-sync.lock.json` `targetSha256`, removes that exact file
   and lock entry in the same commit, and reruns member validation. Automatic pruning remains out of
   scope.

## Consequences

- New general instructions do not silently enter live-system repositories.
- Homelab's local eight-role schema and operator protocol remain authoritative without losing
  canonical handoff/collision validation.
- Windows receives relevant authoring ownership guidance without unrelated token/fleet policy.
- Consumer cleanup is explicit and reviewable. A mismatched or missing lock hash blocks deletion and
  requires ownership/drift reconciliation.
- Future profile changes require manifest, integrity-test, documentation, and consumer cleanup
  review together.

## Rejected alternatives

**Keep wildcard instructions everywhere.** Rejected because repository mode describes checkout
evidence, not instruction compatibility or live authority.

**Put Homelab semantics into the generic workflow instruction.** Rejected because that would grant
product repositories irrelevant live-system behavior and make local operator authority ambiguous.

**Add automatic prune in this change.** Rejected because safe removal needs a separately reviewed
engine design for stale lock entries, locally modified files, local same-directory assets, and
atomic recovery.
