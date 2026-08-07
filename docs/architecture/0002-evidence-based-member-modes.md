# ADR-0002: Evidence-based studio sync member modes

## Status

Accepted

## Context

Studio sync originally treated every member as a root JavaScript or Kotlin Multiplatform
application. Verification therefore required both a supported application-framework signature and
a root JavaScript package-manager lockfile. That contract correctly protects application facts but
cannot describe infrastructure, tooling, or an intentionally skeletal product repository.

Skipping verification for those repositories would make the registry untrustworthy: repository
identity, newly appearing toolchain evidence, and reusable-workflow calls could drift without a
failing signal.

## Decision

1. Give each member a validated `mode`: `application`, `infrastructure`, or `pre-bootstrap`.
   Omitted legacy entries default to `application`; canonical entries declare the mode.
2. Keep application verification unchanged: both framework and root package manager are required
   and must match unambiguous checkout evidence.
3. In infrastructure mode, treat framework and root package manager as independently optional.
   Absence is accepted only when checkout inspection confirms absence; detected evidence must be
   declared, and declared evidence must be detected and match.
4. In pre-bootstrap mode, require both facts to be omitted and reject the first supported framework
   or root package-manager signal with transition guidance.
5. Verify called backbone workflows in every mode and retain repository-identity checks.
6. Run mode verification before reading the member lock or applying files in every checkout-owning
   operation. Manifest-only dry-run remains explicitly uncertified because it has no checkout.

## Consequences

- Non-application and skeletal repositories can enter the registry without an unverified bypass.
- A pre-bootstrap entry cannot silently become an application or tooling repository.
- Infrastructure repositories may gain one supported fact at a time, but the manifest must record
  each transition before sync proceeds.
- Modes remain descriptive/verified metadata and do not alter `optIn` or token write selections.
- New repositories can be registered with all selections disabled while product overlays are
  prepared, yet real runs still require read access to clone and verify them.

## Alternatives considered

**Add `allowUnverified` or ignore missing facts.** Rejected because it converts a temporary shape
exception into a permanent verification hole.

**Infer mode from missing facts.** Rejected because an omission would become an implicit bypass and
could not distinguish stable infrastructure from a product awaiting bootstrap.

**Treat every non-application repository as pre-bootstrap.** Rejected because mature
infrastructure/tooling repositories are not transitional and may legitimately have one applicable
root fact.
