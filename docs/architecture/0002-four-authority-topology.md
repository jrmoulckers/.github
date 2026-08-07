# ADR-0002: Four-authority repository topology

## Status

Accepted

## Context

JRM Studio has four shared repositories whose outputs can be consumed across the fleet. Calling
`jrmoulckers/.github` the single source of truth for the whole studio obscures which repository may
set a normative rule. It also confuses an operational edge, such as reading or distributing an
artifact, with ownership of that artifact's source policy.

This decision applies the existing **single source of truth** and **simplest boundary** principles:
each concern has one owner, selected by the concern's domain rather than by where its output is
consumed. It also preserves the established ownership of GitHub-native reusable workflows: members
call the workflows maintained here instead of carrying local copies, as documented in
[`docs/sync.md`](../sync.md#native-kinds-have-no-transport). These principles are cited rather than
restated; their owning repositories remain authoritative.

`jrmoulckers/engineering` and `jrmoulckers/product` are private, UNLICENSED repositories. Access to
them does not grant a right to republish their normative content.

## Decision

The studio uses four authorities:

| Authority | Normative ownership |
| --- | --- |
| `jrmoulckers/studio` | Design and UI principles and implementations: visual, interaction, accessibility, and localization UX; semantic tokens and themes; UI contracts; reusable platform implementations; UI presets; and visual validation. |
| `jrmoulckers/engineering` | Engineering principles and implementations: architecture; browser and frontend engineering; APIs and backend systems; data systems; security and privacy mechanisms; testing; performance; local-first behavior; observability; build and release mechanics; and shared engineering configurations and libraries. |
| `jrmoulckers/product` | Product and operations principles and implementations: strategy; planning; business; discovery; experimentation; metrics; compliance obligations; delivery and go/no-go decisions; content operations; and process templates. |
| `jrmoulckers/.github` | The GitHub, Copilot, and AI control plane: GitHub governance and Actions; GitHub Copilot and AI principles and implementations; agents, skills, prompts, instructions, and evaluations; GitHub-native templates; the fleet registry; and sync and provenance mechanics. |

`jrmoulckers/.github` is therefore not the source of design, engineering, or product policy. It may
hold links, ownership metadata, generated materializations, and automation that applies those
authorities' decisions, but those operational artifacts do not transfer source ownership.

### Handoff and dependency direction

For cross-domain work:

1. Product defines the obligation or intended outcome.
2. Engineering defines the technical mechanism and evidence.
3. Studio defines the user-facing expression.
4. `.github` automates applicable checks and distribution.

These are handoff seams, not permission for one authority to absorb another. Normative dependencies
point to the repository that owns the subject. An authority may reference another authority, but it
must not restate that authority's normative rules. If an artifact spans domains, split its policy,
contract, implementation, and automation into their owning repositories and connect them with
references or versioned interfaces.

Operational reads and distribution are explicitly non-owning edges. In particular:

- `.github` automation may read source-owned metadata or artifacts to validate and distribute them.
- GitHub may expose community-health files by inheritance and members may call reusable Actions from
  this repository.
- The sync system may materialize a source artifact in a consumer with provenance.
- Existing token distribution may continue to read Studio-owned token outputs and deliver them to
  opted-in members.

In every case, the source authority remains canonical; a generated, inherited, vendored, or called
copy is not a second normative source.

Only the repository owner may ratify principles. Agents and other contributors may propose changes,
but acceptance requires owner ratification in the owning authority.

### Forbidden ownership

- `.github` must not originate or ratify design/UI, engineering, or product/operations policy merely
  because its automation checks or distributes the result.
- Studio must not become the source of engineering mechanisms, product obligations, or GitHub,
  Copilot, and AI governance.
- Engineering must not become the source of user-facing design rules, product decisions, or GitHub,
  Copilot, and AI governance.
- Product must not prescribe technical mechanisms, user-facing implementation rules, or GitHub,
  Copilot, and AI governance.
- No consumer or materialized copy may silently become authoritative because it is easier to access.

## Consequences

- Every design, engineering, product, GitHub, Copilot, or AI concern has one canonical authority.
- Cross-domain work requires explicit contracts and handoffs rather than duplicated policy.
- Public automation can depend on private authority outputs only through access-controlled,
  intentionally exposed interfaces; private, UNLICENSED normative content must not be copied here
  as a convenience.
- Some existing documents may need later, separately reviewed changes from embedded rules to
  non-normative links. Until migrated, ownership follows this ADR rather than file location.
- Distribution can make an artifact widely available without changing who may ratify it.
- The four repositories remain independently maintainable, at the cost of cross-repository
  references and coordinated changes when a concern crosses domains.

## Transition

1. Treat this ADR as the authority map for new work.
2. Inventory existing shared documents and implementations in separately scoped changes.
3. Replace cross-domain normative restatements with references, then move source artifacts only
   through reviewed migrations that preserve history, provenance, and consumer compatibility.
4. Keep current paths and interfaces until each migration is ready; do not create placeholder
   duplicates in the destination authority.

This decision changes documentation only. It does not change `studio.config.json`, the sync engine,
workflow behavior, or token distribution. ADR-0001 remains in force for canonical agent
materialization and product overlays.

## Rollback and recovery

Because this ADR changes no runtime behavior, rollback is a reviewed documentation revert or a
superseding owner-ratified ADR. If a later migration assigns or publishes an artifact incorrectly,
stop that distribution, restore the last known-good source from version control, and restore
consumer materializations from provenance. Recovery must not weaken repository access controls or
promote a generated copy to canonical status.

## Alternatives considered

**Keep `.github` as the authority for all shared policy.** Rejected because central distribution is
not central expertise, and the boundary would permit design, engineering, and product rules to drift
away from their implementations.

**Duplicate normative rules in every repository that needs them.** Rejected because multiple
sources of truth create ambiguous precedence, stale copies, and incompatible ratification histories.

**Assign ownership to the repository that executes a check or distributes an artifact.** Rejected
because it mistakes operational read/distribution edges for source ownership and would pull most
cross-cutting policy into the control plane.

**Use one undifferentiated Studio authority.** Rejected because the simplest stable boundary is the
domain boundary: design, engineering, product, and GitHub/Copilot/AI evolve under different evidence,
implementations, access controls, and review responsibilities.
