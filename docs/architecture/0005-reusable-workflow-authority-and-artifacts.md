# ADR-0005: Reusable workflow authority and artifact contracts

## Status

Accepted. Amended by
[ADR-0007](0007-private-registry-authentication.md), which permits a single optional registry read
secret (`NODE_AUTH_TOKEN`) in the Node-installing reusable workflows.

## Context

The backbone exposed five reusable workflows, but callers could pass shell commands directly into
generated scripts, preview deployment mixed arbitrary commands with a deployment token, and
Lighthouse always published results to temporary public storage. Web CI, preview, performance, and
smoke repeated installs and builds. There was no canonical production Pages or security workflow,
and `optIn.workflows` blurred intended availability with observed calls.

Reusable workflows execute code from consumer repositories. A pull request artifact is therefore
untrusted even when its build succeeds. Deployment authority, secrets, and public report storage
must not share a job boundary with PR-controlled code.

## Decision

1. Every remote action and consumer reusable-workflow call is pinned to a full commit SHA. Canonical
   examples use `<reviewed-commit-sha>` until a reviewed commit exists. Consumer dependency
   automation may propose SHA update PRs, but branches and tags are never runtime trust anchors.
2. Reusable workflows default permissions to none and declare least job permissions, bounded
   timeouts, and `persist-credentials: false`. Caller workflows own CI concurrency so parallel
   reusable jobs cannot cancel one another. Pages alone owns non-cancelling repository deployment
   concurrency. Commands remain trusted repository configuration, travel through environment
   variables, and never receive secrets in untrusted build jobs.
3. `reusable-ci-web` may produce a named build artifact. Preview, performance, and smoke may consume
   only a named artifact from the current workflow run. Callers establish producer order with
   `needs`; consumers expose no repository, run ID, or token input. Standalone frozen-install modes
   remain available.
4. Preview canon is artifact-only. `provider`, `preview-command`, `DEPLOY_TOKEN`, and `preview-url`
   are removed. Provider deployments require separately reviewed consumer workflows with explicit
   secrets and protected environments.
5. Production Pages uses a fixed artifact handoff. Its build job has `contents: read`; its deploy
   job runs no caller code and has only `pages: write` plus `id-token: write`, with the
   `github-pages` environment and deployment URL.
6. Security CI isolates package audit, digest-pinned TruffleHog scanning, and pull-request dependency
   review. Change detection accepts bounded JSON data, validates literal path prefixes and full
   base/head SHAs, and invokes Git with argument arrays rather than dynamic shell.
7. Lighthouse temporary public storage defaults off. Explicit opt-in is limited to intentionally
   public, unauthenticated targets and emits a warning.
8. `optIn.workflows` means availability for current or planned adoption. Checkout-derived
   `workflowUses` records actual name, SHA, file, and line. Undeclared and non-SHA uses fail;
   available-but-unused declarations are reported without failing.
9. Zero-dependency integrity validation is part of manifest loading and CI. It checks roster parity,
   action pins, permissions ceilings, timeouts, concurrency, shell boundaries, artifacts, Pages,
   security, change detection, Lighthouse privacy, and immutable examples.

## Consequences

- Consumers using removed preview inputs must migrate to artifact mode before updating their pin.
- Callers must grant the union of permissions needed by the reusable workflow's jobs; Pages callers
  additionally configure protection on the `github-pages` environment.
- Artifact reuse reduces repeated work without allowing cross-run artifact selection or transferring
  secrets into PR artifacts.
- Existing member workflow selections remain intentional availability declarations. This change
  does not claim a consumer calls canon and does not edit or sync consumer repositories.
- Consumer migrations occur through focused per-repository PRs after this canonical commit is
  reviewed and merged.

## Rejected alternatives

**Keep custom preview deployment for compatibility.** Rejected because step-level secret scoping
does not isolate a credential from earlier untrusted code on the same runner.

**Use version tags for readability.** Rejected because tags can move and executable provenance must
be immutable. Update automation can preserve review ergonomics while retaining SHA pins.

**Accept arbitrary path-filter code.** Rejected because dynamic expressions or generated shell
would recreate injection risk. Literal prefix groups cover the audited Finance use case.
