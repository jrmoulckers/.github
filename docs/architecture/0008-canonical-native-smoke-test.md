# ADR-0008: A canonical native smoke test alongside the web smoke test

## Status

Accepted. Amends [ADR-0005](0005-reusable-workflow-authority-and-artifacts.md), extending its
reusable-workflow roster and applying its contracts to a multi-platform release check. Resolves the
open question left by issue #60.

## Context

The backbone's `reusable-smoke-test` is web-shaped by construction: one `smoke` job, a Node
toolchain, a build/test command pair, and an optional HTTPS endpoint probe. That is the right
check for a product whose release artifact is a deployed site.

It is not a check a native-first product can use. `jrmoulckers/finance` ships Android, iOS, web,
and Windows apps from one repository, and a release that passes a web smoke test has had three of
its four artifacts unvalidated. Finance therefore wrote its own multi-platform workflow.

Issue #60 found that file sharing canon's `reusable-smoke-test.yml` filename while being a
substantially different, larger workflow. The collision was closed by renaming finance's copy to
`reusable-release-smoke-test.yml`, but #60 explicitly left the underlying question open: was the
file an independent workflow that happened to collide, or a fork of canon that had drifted?

It is independent. That answer has a consequence: the capability is missing from the backbone, not
duplicated in it. Leaving it as a member-local file means the next native member writes its own
third variant, and the shared layer keeps having nothing to offer them.

## Decision

1. The backbone gains `reusable-native-smoke-test`, generalized from finance's workflow and
   declared in `canon.workflows`. It has six jobs: `validate`, `android`, `ios`, `web`, `windows`,
   `summary`, and exposes `result` (pass or fail) from the summary.
2. It **adds to** rather than replaces `reusable-smoke-test`. The web workflow keeps the
   endpoint-probe and same-run artifact-consumer contracts that only make sense for a deployed
   site; the native workflow validates buildability across platforms before a release is promoted.
   A web-only product should keep calling the existing one.
3. Nothing product-specific is promoted. Gradle module paths, the Xcode scheme, project directory,
   simulator destination, toolchain versions, package manager, build and test commands, and the
   bundle budget are all inputs with defaults. The workflow contains no reference to any member.
4. Platform selection is validated once and republished by `validate` as a JSON array; every
   platform job gates on `contains(fromJSON(needs.validate.outputs.selected), '<platform>')`.
   Selecting on the raw input with `contains(inputs.platforms, 'ios')` is a substring test that
   would accept a malformed value and silently skip a platform the caller believed was covered.
   A platform that was not selected is `skipped` and counts as a pass; a selected platform that did
   not succeed fails the summary and the run.
5. Every ADR-0005 contract applies unchanged: full-SHA action pins with version comments, top-level
   `permissions: {}`, per-job least permissions with exact-match ceilings, bounded timeouts,
   `persist-credentials: false`, commands reaching the shell only through environment variables,
   no `concurrency` block, and no `pull_request_target`. A `validateNativeSmokeContract` validator
   enforces the workflow-specific invariants in decision 4, with negative tests proving each bites.
6. `NODE_AUTH_TOKEN` remains the only `workflow_call` secret, per ADR-0007. Finance's workflow also
   declared `TURBO_TEAM` and `TURBO_TOKEN` for Turborepo remote caching; those are **not**
   promoted. Builds run cold, and Gradle's cache is read-only.
7. `artifact-run-id` is validated and exported to every platform job as `SMOKE_ARTIFACT_RUN_ID`, so
   a caller-supplied command can fetch artifacts from an earlier run. This workflow never
   interpolates it into a shell command and never downloads cross-run artifacts itself.

## Consequences

- Native members can delete a local workflow and call canon at a reviewed SHA. Finance's migration
  is a separate, member-owned change; this ADR does not add the workflow to any member's
  `optIn.workflows` and does not edit any member repository.
- Remote build caching is unavailable through canon, so a native smoke run is slower than finance's
  local workflow was. That is the intended trade: a release smoke test should build from source
  reproducibly, and accepting cache credentials through `workflow_call` would widen the secret
  contract that ADR-0007 deliberately holds at one entry.
- Callers must grant `packages: read` in addition to `contents: read` because the web job installs
  Node dependencies, following ADR-0007.
- The macOS and Windows runners this workflow uses are billed at a higher rate than Linux. Callers
  should narrow `platforms` on non-release runs. Note what makes this sharper than a general cost
  note: a census of canon shows this is the **only** reusable workflow declaring a non-Linux runner
  — `ios` on `macos-15` (10x) and `windows` on `windows-latest` (2x), with every other canon
  workflow `ubuntu-latest` throughout. So the multiplier is chosen here and paid by the caller,
  which sees no `runs-on` at its call site. It costs nothing today because no member opts in and
  every non-Linux runner in the fleet sits in a public repository; it is free only while that holds.
  A `runs-on` census cannot measure this exposure — a member that only calls reusable workflows
  declares zero runners and inherits all of them.
- Static validation cannot observe execution. `.github/workflows/native-smoke-harness.yml` calls
  this workflow with a trivial single-platform input set and asserts on its `result` output, so the
  normalisation, `fromJSON` gating, skipped-counts-as-pass, and output plumbing are proven on a
  runner rather than in a YAML parser. The harness and its fixture are not canon and are not synced;
  they exist so the first real execution does not happen inside a member's migration, where a
  workflow bug and a migration bug would be indistinguishable.
- A job that calls a reusable workflow cannot declare `timeout-minutes` — GitHub rejects the key —
  so `inspectWorkflowSource` exempts caller jobs from that rule. The bound still exists, in the
  called workflow's own jobs. Permission ceilings continue to apply to caller jobs, because a caller
  caps what the jobs it invokes may request.

## Rejected alternatives

**Extend `reusable-smoke-test` with platform inputs.** Rejected. It would put four toolchains and
six jobs behind one name, and every web-only caller would inherit a validate/summary indirection
for a check it does not run. The two workflows answer different questions and keeping them separate
keeps each one's contract legible.

**Leave the workflow in finance.** Rejected. It is a capability gap in the shared layer, and the
second native member would write a third variant of it. That is the drift the backbone exists to
prevent.

**Promote the Turbo cache secrets.** Rejected. Widening the `workflow_call` secret allowlist is a
security-posture decision that should be argued on its own merits, not carried in as a side effect
of promoting a workflow, and a cold build is the more defensible default for release validation.

**Copy finance's workflow verbatim and parameterize later.** Rejected. Canon with a member's Gradle
paths and Xcode scheme baked in is unusable by anyone else, and "parameterize later" would leave
the only consumer as the one repo that did not need the parameters.
