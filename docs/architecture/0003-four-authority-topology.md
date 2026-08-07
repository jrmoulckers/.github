# ADR-0003: Four-authority repository topology

## Status

Accepted

## Context

JRM Studio shares principles, implementations, automation, and generated artifacts across several
repositories. Without explicit domain boundaries, a convenient file location or distribution path
can be mistaken for source ownership. That ambiguity encourages normative rules to be copied,
allows operational automation to become an accidental policy source, and makes it difficult to
identify the one canonical owner for a concern.

The topology must assign design, engineering, product, GitHub, Copilot, and AI concerns to exactly
one authority while preserving existing token distribution, sync behavior, and
[ADR-0001](0001-canonical-agent-overlays.md). Repository ownership also needs to remain distinct
from the handoff by which an outcome becomes an implemented and verified user experience.

## Decision

The repository owner alone ratifies principles. Agents may research, draft, and propose changes,
but an agent proposal is not normative until the owner accepts it through the repository's review
process.

The four canonical authorities are:

| Authority | Owns |
| --- | --- |
| **Studio** | Design and UI principles and implementations: visual design, interaction, accessibility, localization UX, tokens, themes, UI contracts, platform UI implementations, presets, and visual validation. |
| **Engineering** | Engineering principles and implementations: architecture, browser and frontend engineering, APIs and backend systems, data systems, security and privacy mechanisms, testing, performance, local-first behavior, observability, build and release engineering, configurations, and libraries. |
| **Product** | Product and operations principles and implementations: strategy, planning, business, discovery, experimentation, metrics, compliance obligations, delivery and go/no-go decisions, content operations, and product or operations templates. |
| **`.github`** | GitHub governance, GitHub Actions, GitHub Copilot and AI principles and implementations, agents, skills, prompts, instructions, evaluations, GitHub-native templates, the fleet registry, and sync provenance and distribution. |

Engineering and Product are private repositories and are UNLICENSED. A reference to either
authority permits reading by an authorized participant; it does not grant a license or permission
to redistribute its contents.

### Handoff contract

The authorities collaborate without transferring ownership:

1. Product defines the obligation and intended outcome.
2. Engineering defines the mechanism and evidence that satisfy the obligation.
3. Studio defines the user-facing expression of the outcome and mechanism.
4. `.github` automates applicable checks and distribution.

An artifact that spans domains is split at those seams or links to the canonical source for each
concern. Authorities may reference another authority's normative rule by stable link or identifier,
but must never restate that rule. Explanatory non-normative context must remain clearly labeled and
must not become a substitute policy.

### Allowed dependency and read directions

- Product may consume discovery, feasibility, evidence, and validation from Engineering and Studio
  while retaining ownership only of obligations, outcomes, and product operations.
- Engineering may read Product obligations and Studio-owned UI contracts to produce mechanisms,
  platform contracts, and evidence. It may reference `.github` for GitHub, Copilot, or AI rules.
- Studio may read Product obligations and Engineering contracts or evidence to produce user-facing
  expression and visual validation. It may reference `.github` for GitHub, Copilot, or AI rules.
- `.github` may operationally read all authorities to run checks, maintain provenance, or distribute
  an authority-owned source. This operational read or distribution edge never transfers source
  ownership to `.github`.
- Every authority may link to another authority's canonical source. No authority may copy another
  authority's normative text into its own source tree.

### Forbidden ownership

- Studio does not own product obligations, engineering mechanisms, or GitHub, Copilot, and AI
  governance merely because those concerns affect a user interface.
- Engineering does not own product strategy or user-facing design merely because it implements
  them, and it does not own GitHub, Copilot, or AI policy merely because it supplies tooling.
- Product does not own UI expression or technical mechanisms merely because it approves an outcome
  or a go/no-go decision.
- `.github` does not own design, engineering, or product sources merely because Actions, the fleet
  registry, sync, or provenance machinery reads, checks, or distributes them.
- Generated copies, caches, registries, manifests, and validation output are never new normative
  sources.

### Transition compatibility

This topology classifies ownership; it does not migrate files. Existing repository paths, principle
identifiers, token distribution, generated materializations, and sync selections remain unchanged.
ADR-0001 continues to govern canonical agent materialization and product overlays.

New or substantively changed sources must follow this topology. Legacy sources that do not yet
match it remain compatible until a focused migration is approved. Such a migration must preserve
stable references, replace duplicate normative text with links, and avoid copying Studio's former
principle tree into another authority.

### Rollback and recovery

Because this decision changes documentation only, it can be rolled back by reverting this ADR and
its authority-map link; no runtime or sync recovery is required. If a later migration assigns a
source incorrectly, restore the last canonical version from history, return it to the correct
authority, replace duplicates with references, and regenerate distributed artifacts from that
canonical source while verifying provenance. A replacement topology must supersede this ADR rather
than silently redefining an authority.

## Rejected alternatives

**Keep all principles in Studio.** Rejected because design adjacency does not make Studio the owner
of engineering, product, GitHub, Copilot, or AI concerns, and copying the former principle tree
would preserve ambiguous ownership.

**Make `.github` the canonical source for everything it distributes.** Rejected because operational
reading and distribution are transport concerns, not transfers of design, engineering, or product
ownership.

**Allow each repository to restate shared rules for local convenience.** Rejected because duplicated
normative text drifts and prevents a single canonical owner from being identified.

**Create a fifth umbrella principles authority.** Rejected because it would separate principles from
the implementations and evidence needed to maintain them, adding another handoff without resolving
domain ownership.

## Consequences

- Every design, engineering, product, GitHub, Copilot, or AI concern has one canonical authority.
- Cross-authority documents use references and explicit handoffs instead of duplicated rules.
- Distribution, provenance, and automated checks can operate across repositories without making
  `.github` the owner of the sources they process.
- Some legacy content may require later, separately reviewed migrations; this ADR intentionally
  causes no implementation, sync, registry, token, or generated-file change.
- Access controls and the UNLICENSED status of Engineering and Product constrain who can follow
  their references and how their content may be reused.
