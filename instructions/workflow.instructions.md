---
applyTo: '**'
---

# Change Delivery Workflow

Read-only research, audits, and planning do not require an issue when they make no repository
change. Before the first repository change, verify or create an issue; every repository change must
trace to that issue and land through a feature branch and PR.

## Default Workflow

1. Verify or create the GitHub issue.
2. Scan for an existing worktree for the issue; resume it if found.
3. Otherwise prefer an app-native isolated project session/worktree from the default branch. If that
   capability is unavailable, require a runtime-provided, explicitly approved location allowed by
   root/scoped authority.
4. Implement scoped changes on a feature branch.
5. Commit as `type(scope): description (#N)`.
6. Run the repo's documented format, lint, type-check, test, and build commands for the affected surface.
7. Fetch and rebase onto the default branch.
8. Push the feature branch and create a PR with `Closes #N`.
9. Verify the PR exists with `gh pr view`.
10. Monitor CI and mergeability until checks are green and the PR is `MERGEABLE`.
11. Self-merge only PRs you authored when the quality gate passes and local `AGENTS.md` permits it.
12. Remove the worktree after merge.

Stopping at a local commit is incomplete. A change is done only when the PR is merged, or when a
green, mergeable PR clearly documents a `## Needs Human Action` blocker. Local `AGENTS.md` decides
self-merge and operational authority; this instruction never expands either.

## Definition of Done

| Gate | Verification | Pass criteria |
| --- | --- | --- |
| Clean tree | `git status` | No uncommitted changes. |
| Pushed | `git log origin/<branch>..HEAD` | Empty. |
| PR exists | `gh pr view <branch> --json number` | Returns a PR number. |
| CI green | `gh pr checks <number>` | Every required check reports `success`, or reaches a no-assertion state (`skipped`, `neutral`) **consistent with an independently computed precondition**. Absence of red is **not** the criterion: a `skipping` check is neither failing nor pending, so a job that was never scheduled passes a not-red test. Never allowlist a no-assertion state beside `success` — see the resolution rule below. |
| Mergeable | `gh pr view <number> --json mergeable,mergeStateStatus` | `MERGEABLE`, not dirty/behind. Note this is a reading and not a gate — `UNSTABLE` does not distinguish a check that failed from one that never started. |
| Issue linked | PR body | `Closes #N` for each resolved issue. |
| Landed | `gh pr view <number> --json state` | `MERGED`, or a documented human-gated blocker. |

## Worktrees

Prefer app-native isolated project sessions/worktrees rather than extra clones. Never invent or
hard-code a sibling worktree path. If app-native isolation is unavailable, the runtime must provide
an explicitly approved worktree location and root/scoped authority must permit it; otherwise stop.

```bash
git worktree list
git worktree add <approved-worktree-path> -b <type>/<short-description>-<issue> origin/<default-branch>
git worktree remove <approved-owned-worktree-path>
```

Record the exact branch, path, and creating session before mutation. Remove only worktrees created
and owned by the current session; never recursively delete a worktree path.

Branch types: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `ci`, `perf`.

## Issue Lifecycle

`Created → PR opened with Closes #N → PR merged → issue auto-closed`.

Rules:

- Do not close issues manually; let linked PRs close them on merge.
- Use `Closes #N` for completed work and `Refs #N` for related context.
- Put each closing reference on its own line in the PR body.

## Validation

Run the product's own commands. Prefer documented scripts over ad hoc tool calls.

Typical coverage:

- Formatter / format check.
- Linter.
- Type-check or static analysis.
- Unit/integration tests for changed behavior.
- Build/package checks for affected apps or packages.

If any check fails, fix it, rerun the relevant checks, create a new scoped commit, and push again.
Amend only when the user explicitly requests it and applicable authority permits it.

## Calling reusable workflows

Studio product repos call the backbone's reusable workflows at a reviewed immutable commit SHA:
`uses: jrmoulckers/.github/.github/workflows/reusable-*.yml@<reviewed-commit-sha>`. The reference
must be a full 40-character SHA; branches and tags are rejected. Configure Dependabot, Renovate, or
equivalent automation to propose SHA update PRs, then review the exact upstream diff and release
notes. Never resolve a mutable reference during a run.

### Keep required checks terminal

Never put `paths` or `paths-ignore` on the `pull_request` trigger of a workflow that supplies a
required check. When the filter does not match, GitHub does not start the workflow or create its
check run, so the required check remains pending and blocks the pull request indefinitely.

Trigger the workflow for every pull request in its protected scope, detect applicability in a job,
and gate the expensive job with `jobs.<job_id>.if`. A skipped job produces a terminal `skipped`
conclusion that GitHub accepts as success for a required check:

```yaml
on:
  pull_request:

permissions:
  contents: read
  packages: read
  pull-requests: read

jobs:
  changes:
    uses: jrmoulckers/.github/.github/workflows/reusable-change-detection.yml@<reviewed-commit-sha>
    with:
      path-groups-json: '{"web":["apps/web/","packages/ui/"]}'

  lint:
    needs: changes
    if: contains(fromJSON(needs.changes.outputs.changed-groups-json), 'web')
    uses: jrmoulckers/.github/.github/workflows/reusable-ci-lint.yml@<reviewed-commit-sha>
```

Event filtering is still appropriate for workflows that do not supply required checks. For a
required check, however, no workflow run is categorically different from an intentionally skipped
job: only the latter reports a terminal result. Keep the required job's name stable so the ruleset
continues to require the intended check.

**A caller `permissions:` block replaces the defaults — it does not add to them.** Every scope you
omit is set to `none`, and a called workflow can never receive more than its caller holds. So a
least-privilege `permissions: { contents: read }` in the caller silently strips the scopes the
reusable workflow declares for itself. The symptom is a bare `startup_failure` with **no readable
log**, which is easy to misdiagnose as a broken `uses:` reference.

Grant every scope the callee declares:

| Reusable workflow | Scopes the caller must grant |
| --- | --- |
| `reusable-ci-lint` | `contents: read`, **`packages: read`**, **and `pull-requests: read`** (Semantic PR Title job) |
| `reusable-ci-web` | `contents: read`, `packages: read` |
| `reusable-perf-budget` | `contents: read`, `packages: read` |
| `reusable-smoke-test` | `contents: read`, `packages: read` |
| `reusable-native-smoke-test` | `contents: read`, `packages: read` (the web job; the other platform jobs need only `contents: read`) |
| `reusable-deploy-preview` | `contents: read`, `packages: read` |
| `reusable-change-detection` | `contents: read` |
| `reusable-security-ci` | `contents: read` |
| `reusable-deploy-pages` | `contents: read`, `packages: read`, `pages: write`, and `id-token: write` |

```yaml
permissions:
  contents: read
  packages: read          # required by every Node-installing reusable workflow
  pull-requests: read      # required by reusable-ci-lint

jobs:
  lint:
    uses: jrmoulckers/.github/.github/workflows/reusable-ci-lint.yml@<reviewed-commit-sha>
    with:
      package-manager: pnpm
```

Rules:

- Before adding a caller-level `permissions:` block, open the callee and copy its declared scopes.
- Omitting `permissions:` entirely inherits the repo default — safe, but less explicit.
- If a scope truly cannot be granted, disable the job that needs it instead
  (e.g. `semantic-pr-title: false` for `reusable-ci-lint`).
- Debug a `startup_failure` with no log by checking caller permissions first — but confirm the
  failure is scoped to the calling job before you do (see below).
- Caller workflows own CI concurrency. Put the concurrency group on the caller workflow so matrix or
  multi-package reusable jobs do not cancel sibling calls. Canonical Pages deployment is the
  exception: it serializes repository deployments with `cancel-in-progress: false`.

### A no-log failure is not always a permissions problem

The permissions trap above is not the only way a run dies in seconds with an empty log. Exhausting
the Actions spending limit refuses the run before any job starts, with `recent account payments have
failed or your spending limit needs to be increased`.

**This is not confined to private repositories, and canon claimed otherwise until a member falsified
it.** The earlier text here said standard runners are free on public repositories so the refusal
cannot happen there. `jrmoulckers/studio` is public — `"private": false` — and run `31437443369` on
`2026-08-10T22:14:21Z` was refused with that exact annotation on **9 of 9 jobs**, every one of them on
`ubuntu-latest`, `windows-latest` or `macos-latest`. No larger runners involved. The claim was
falsifiable, was load-bearing, and was false.

**Do not replace it with a narrower exemption.** The failure mode was never the specific claim; it
was having *any* rule that lets a reader skip the check. The annotation fetch discriminates both
causes outright and costs two API calls, so it needs no precondition at all. A reader on a public
repo who prunes billing by construction goes hunting for a `permissions:` defect in a workflow that
is correct — and canon's own framing, that only one of the two causes is a defect in this repository,
sends them to search the branch that has none. **Repository visibility is prior likelihood. It is
never a gate.**

**In a fleet, check visibility because it is cheap, but resolve with the annotation.** The
correlation is genuine — a live incident split the twelve studio repos six green and six failing,
close to the visibility line — and the reason it is *only* a correlation is that the refusal does not
lift uniformly. Same account, same night: studio (public) was refused at 22:14Z and green again by
23:47Z, while `jrmoulckers/homelab` (private) was still being refused at 06:15Z, seven hours later.
So a green public repo does not falsify a repository-side hypothesis, and a sibling's recovery
licenses no inference about a repo that has not been re-run. **Each repository's own annotation is
the only evidence about that repository.**

A recovered repo is also not a control group. Studio spent the night looking like one, and the
correct reading is the more informative one: it did not lack the condition, it left it early. That
makes it a data point about the *scope* of a lift rather than a permanently uninformative baseline.

Discriminate before investigating, because the two look nearly identical and only one of them is
a defect in this repository:

| | Caller permissions | Spending limit |
| --- | --- | --- |
| What failed | Only the job that `uses:` the callee | **Every** job in the run, including untouched ones |
| Scope | One repository | The **account** — but observed lifting at different times per repository |
| Triggered by | Adding or narrowing a `permissions:` block | Adding an expensive runner, or simply reaching the monthly cap |
| Fixed in | The workflow file | Billing settings — nothing in the repository is wrong |

**Read `steps: 0` as a relation, not a count.** Healthy runs contain zero-step jobs routinely — a
skipped `security / Dependency review` is one — so studio's green runs carry one or two of them while
its refused run carried nine. The discriminator is that **every** job in the run is at zero, and even
that is only a symptom: the annotation is the evidence. A shorthand quoting the bare number does not
survive being repeated by someone who does not have the annotation in front of them.

**Check the run summary next: if jobs you did not touch failed alongside the one you did, stop
reading YAML and check billing.** A green history proves nothing here, because the cap is reached
by cumulative spend rather than by anything in the diff.

That check is free but not always decisive — a single-job workflow presents identically under both
causes, and a live one did: the billing-refused run in the table below contained exactly **one**
job, leaving the comparison with nothing to compare against.

**`gh run view --log-failed` settles it, and it is the fastest route.** Both causes produce a
`log not found`, but not the same one, because a permissions failure kills the run *before any job
is created* while billing creates the job and then refuses to start it:

| | Caller permissions | Spending limit |
| --- | --- | --- |
| `--log-failed` says | `failed to get run log: log not found` | `log not found: 93677247471` |
| Jobs in the run | **0** | **1**, with `steps: 0` |
| Failing check-runs | **0** | 1, `annotations_count: 1` |

**The discriminator is whether the message carries an ID** — and that ID is exactly what the
annotations endpoint needs, so the command that looks like a dead end hands over the key to the one
that answers the question:

```bash
gh run view <run-id> --log-failed          # -> log not found: 93677247471
gh api repos/OWNER/REPO/check-runs/93677247471/annotations --jq '.[].message'
```

The billing refusal carries its `recent account payments have failed…` message there. A permissions
failure has no check-run to carry one. (The endpoint returns `[]` for a healthy run.)

**Do not pin recognition to that wording.** The annotation has a structural signature that survives
a rewrite, verified identical across three runs in two repositories: `path` is `.github` — not a
real file, and its `blob_href` 404s — with `start_line` and `end_line` both `1`, null columns, and
**both `title` and `raw_details` empty**, against a check-run whose `output.title` and
`output.summary` are `null`. A genuine lint or test annotation populates at least one of those. *An
annotation with no title, no details, and a path that is not a file* is the shape to look for.

**Expect to misread this one, and know why.** An account-scoped fault strikes many repositories
within minutes of each other, taking unrelated pull requests down with the sync engine's. That
pattern reads as *"everything is broken"* and invites blaming whatever most recently touched
everything — which, in a repo family with a sync engine, is always the sync engine. It is the
standing suspect for precisely the failure class it cannot cause. Timeline evidence is real here
and still points the wrong way: *simultaneous, across repos, including unrelated work* fits **one
account-level event** far better than several independent regressions.

**This is a class, not one vendor's quota.** Any account-scoped limit can surface as a per-PR
check failure — Vercel's `Deployment rate limited — retry in 24 hours` hit a member in the same
window, from a different system with the same shape. When a check fails and no diff explains it,
ask whether the limit being hit belongs to the account rather than to the repository.

Non-Linux runners carry a minute multiplier — macOS bills at 10x and Windows at 2x — so adding a
single macOS job can exhaust a budget that Linux jobs had comfortably fit inside. Budget for the
multiplier when you add one, and prefer `ubuntu-latest` unless the job genuinely requires the
platform (Swift and Xcode toolchains do; Node builds do not).

### Taking only part of `reusable-ci-lint`

`reusable-ci-lint` carries three independent checks — lint, format-check, and Conventional-Commits
PR title — and each is opt-out, so never inline a local copy of one of them:

- No ESLint/Prettier in the repo? Pass `lint-command: ''` and `format-check-command: ''`. The lint
  job then skips entirely (no checkout, no install) and only the PR-title check runs.
- Have a linter but no formatter (or vice versa)? Empty just the one you lack.
- Can't grant `pull-requests: read`? Pass `semantic-pr-title: false`.

```yaml
permissions:
  contents: read
  pull-requests: read

jobs:
  pr-title:
    uses: jrmoulckers/.github/.github/workflows/reusable-ci-lint.yml@<reviewed-commit-sha>
    with:
      lint-command: ''
      format-check-command: ''
```

Passing an empty string is the supported opt-out. Leaving a command at its default in a repo that
has no such script fails the job; duplicating backbone logic locally makes the product repo drift
from canon.

### Smoke testing a native-first release

`reusable-smoke-test` is web-shaped: one job, a Node toolchain, and an optional HTTPS probe against
a deployed site. Use `reusable-native-smoke-test` instead when a release ships native artifacts and
a green web check would leave Android, iOS, or Windows unvalidated.

It runs `validate`, then one job per selected platform, then a `summary` that reduces the verdicts
to a single `result` output a release workflow can gate on. Unselected platforms are reported as
skipped and count as a pass; a selected platform that fails, fails the run.

```yaml
permissions:
  contents: read
  packages: read          # the web job installs Node dependencies

jobs:
  smoke:
    uses: jrmoulckers/.github/.github/workflows/reusable-native-smoke-test.yml@<reviewed-commit-sha>
    with:
      version: ${{ github.ref_name }}
      platforms: android,ios,web
      ios-scheme: ExampleApp
      package-manager: pnpm
      build-command: pnpm --filter web build
```

Narrow `platforms` on non-release runs: the iOS and Windows jobs use macOS and Windows runners,
which bill at a higher rate than Linux. Remote build caches are not accepted — builds run cold and
Gradle's cache is read-only, so a release is validated from source rather than from a cache.

### Build once and reuse same-run artifacts

`reusable-ci-web` optionally uploads a validated directory when `artifact-name` is set. Preview,
performance, and smoke jobs accept that exact same-run artifact name. The caller must declare
`needs` so the producer completes first; consumers do not accept a repository, run ID, or token, so
they cannot fetch cross-run or cross-repository artifacts.

```yaml
jobs:
  web:
    uses: jrmoulckers/.github/.github/workflows/reusable-ci-web.yml@<reviewed-commit-sha>
    with:
      artifact-name: web-build
      artifact-path: dist

  performance:
    needs: web
    uses: jrmoulckers/.github/.github/workflows/reusable-perf-budget.yml@<reviewed-commit-sha>
    with:
      artifact-name: ${{ needs.web.outputs.artifact-name }}
      output-dir: dist
```

At the caller workflow level, use a ref-scoped group for superseded CI runs:

```yaml
concurrency:
  group: ci-${{ github.workflow }}-${{ github.ref }}
  cancel-in-progress: true
```

Never pass an untrusted artifact into a job with secrets or write authority. `reusable-deploy-pages`
does not accept an arbitrary artifact: its unprivileged build job creates the fixed Pages artifact,
and its environment-gated deploy job only calls GitHub's deploy action with `pages: write` and
`id-token: write`.

### Security and preview boundaries

- Reusable commands are trusted repository configuration. Pass literal workflow values, never event
  titles, branch names, issue text, or other untrusted data.
- Never use `secrets: inherit`. `NODE_AUTH_TOKEN` is the only secret any canonical reusable workflow
  accepts, it is optional, and it must be passed explicitly when it is passed at all. When it is
  omitted the workflow falls back to the job's `GITHUB_TOKEN`.
- Preview canon is artifact-only. The removed `provider`, `preview-command`, `DEPLOY_TOKEN`, and
  `preview-url` contracts must not be recreated. Provider deployments require a separate reviewed
  job, a protected environment, explicit secrets, and no PR-controlled arbitrary shell.
- Lighthouse reports remain private GitHub artifacts by default. Enable
  `lighthouse-public-upload` only for an intentionally public, unauthenticated URL after accepting
  that report data will leave GitHub's private artifact boundary.

### Installing from a private registry

`reusable-ci-lint`, `reusable-ci-web`, `reusable-deploy-pages`, `reusable-deploy-preview`,
`reusable-perf-budget`, `reusable-smoke-test`, and `reusable-native-smoke-test` accept optional
`registry-url` and
`registry-scope` inputs plus an optional `NODE_AUTH_TOKEN` secret. Leave all three unset and the
run is unchanged: `actions/setup-node` ignores an empty `registry-url` entirely and writes no
`.npmrc`, and no token is placed in the install step's environment.

For GitHub Packages this is zero-config — pass no secret at all:

```yaml
permissions:
  contents: read
  packages: read

jobs:
  web:
    uses: jrmoulckers/.github/.github/workflows/reusable-ci-web.yml@<reviewed-commit-sha>
    with:
      package-manager: pnpm
      registry-url: https://npm.pkg.github.com
      registry-scope: '@jrmoulckers'
```

`NODE_AUTH_TOKEN` resolves as `secrets.NODE_AUTH_TOKEN || github.token`, so the job's
`GITHUB_TOKEN` is used unless the caller passes its own. Pass an explicit secret only for a registry
`GITHUB_TOKEN` cannot reach:

```yaml
    secrets:
      NODE_AUTH_TOKEN: ${{ secrets.MY_REGISTRY_PAT }}
```

Rules and interactions:

- **Authentication and authorization are separate.** A token is always required: the registry
  rejects an unauthenticated read with `401` even for a **public** package. Package visibility only
  decides *who* is allowed, not *whether* credentials are needed. So `packages: read` and a token
  stay mandatory regardless of visibility, and flipping a package to public is never a reason to
  drop either.
- Authorization depends on visibility. A **public** package needs no grant — `GITHUB_TOKEN` can read
  it. A **private** package must additionally grant the consuming repository read access under the
  package's **Manage Actions access** settings, which GitHub recommends over storing a PAT. A `403`
  (`permission_denied: read_package`) means authentication succeeded and authorization failed, so it
  points at the grant or the package, not at the token being absent.
- `packages: read` is required for `GITHUB_TOKEN` to read a GitHub Packages package at all, and a
  caller `permissions:` block must grant it. **If the caller omits it the entire run fails at
  startup**: no jobs are created, no check-run is produced, and there is no log to read — the only
  surface text is a generic "workflow file issue". The failure is whole-run, not per-job, so
  unrelated valid jobs in the same workflow file do not run either. Nothing inside a reusable
  workflow can detect or report this, because the permission ceiling is enforced before any job
  exists; it can only be caught by inspecting caller workflows before the run.
- `registry-scope` requires `registry-url`. Setting `registry-url` without a scope replaces the
  **default** registry for every package and emits a warning.
- `actions/setup-node` writes its `.npmrc` to `$RUNNER_TEMP/.npmrc` and exports
  `NPM_CONFIG_USERCONFIG`, so it is **user**-level config. A repo's own committed `.npmrc` is
  **project**-level and outranks it on every key it sets, for both npm and pnpm. A project `.npmrc`
  that points the same scope at a different registry wins and the install still fails; either delete
  that line or keep it byte-identical. A project `.npmrc` that only sets unrelated keys is fine.
- pnpm reads `NPM_CONFIG_USERCONFIG` and expands `${NODE_AUTH_TOKEN}` the same way npm does, so no
  extra pnpm-specific step is needed. `setup-node` always exports `NODE_AUTH_TOKEN` (a placeholder
  when the secret is absent), which keeps pnpm's env-expansion from erroring.
- The token reaches the install step only when `registry-url` is set. A run that does not configure
  a private registry gets an empty `NODE_AUTH_TOKEN`, so a `GITHUB_TOKEN` is never exposed to
  dependency lifecycle scripts on the default path. A consequence worth knowing: passing
  `NODE_AUTH_TOKEN` *without* `registry-url` has no effect, because there is no `.npmrc` to consume
  it.
- `reusable-security-ci` needs none of this. `npm audit` and `pnpm audit` send the bulk advisory
  request to the **default** registry, never to a scoped one, so a private scoped package in the
  lockfile does not trigger a `401`. Pointing the *default* registry at GitHub Packages does break
  audit, but with `ENDPOINT_NOT_EXISTS` (no audit endpoint) rather than an auth error — a token
  would not fix it. Note that audit does transmit private package names and versions to the default
  registry.

### Never vendor a backbone workflow or health file

`workflows` and `health` are **native** kinds: they reach product repos through GitHub itself, not
through the sync engine, which resolves and reports them but never writes a file for them. So a
product repo must contain **no copy of its own**:

- **No `.github/workflows/reusable-*.yml`.** Call the backbone's with
  `uses: jrmoulckers/.github/.github/workflows/reusable-*.yml@<reviewed-commit-sha>`, never
  `uses: ./.github/workflows/reusable-*.yml`. A vendored copy is a silent fork: upstream fixes never
  reach it and nothing flags the divergence.
- **No `CONTRIBUTING.md`, `SECURITY.md`, `CODE_OF_CONDUCT.md`, `PULL_REQUEST_TEMPLATE.md`,
  `ISSUE_TEMPLATE/` or `DISCUSSION_TEMPLATE/`** unless you are deliberately overriding the studio
  version for that repo. GitHub prefers a repo's own health file over the one inherited from
  `jrmoulckers/.github`, so a verbatim copy overrides the inherited file and freezes it at the day
  it was copied.

  If you *are* overriding deliberately — because the repo needs product-specific security content
  that cannot live in canon — that is allowed, but you own the consequence: the file is a fork with
  no update path, and canon changes will never reach it. Re-read canon when it moves.
  **Do not restate canon's policy in your own words in order to differ from it in one place**; check
  first whether canon already offers a variant you can select. Its security policy defines two
  support postures precisely so that a continuously-deployed product can *select* the right one
  rather than file a deviation against the other
  ([ADR-0010](https://github.com/jrmoulckers/.github/blob/main/docs/architecture/0010-selectable-support-postures.md)).

In both cases a local copy is **worse than having nothing**, and the sync engine cannot rescue you
— it never writes native kinds, so it can neither update the copy nor report it as drift. If you
find one in a member repo, delete it; that is the whole fix.

Opting in to `health` or `workflows` in `studio.config.json` means *"this member relies on the
backbone's"* — it is a declaration, not an install.

## Merge Conflict Protocol

Treat conflicts with the same urgency as red CI.

Detect every polling cycle:

```bash
gh pr view <number> --json mergeable,mergeStateStatus,headRefName
```

| State | Action |
| --- | --- |
| `MERGEABLE` + `CLEAN`/`UNSTABLE` | Continue monitoring CI. `UNSTABLE` never means mergeable-with-caveats: resolve it against the checks. |
| `MERGEABLE` + `BEHIND` | Rebase on the default branch and re-push. |
| `CONFLICTING` or `DIRTY` | Run the auto-resolve cycle. |
| `UNKNOWN` | Wait briefly and re-poll. |

**A `skipped` check has two causes and only one is a problem, so resolve it rather than accepting or
rejecting it.** A conditional job — `if: needs.changes.outputs.agent == 'true'` — reports `skipping`
both when its path filter legitimately matched nothing and when the upstream job it depends on never
ran at all. Demanding `success` unconditionally deadlocks the first case; accepting `skipping`
admits the second, which is how an unscheduled run passes for green.

Assert instead that the job reached a terminal state **consistent with its own precondition**:
compute the precondition independently — replay the path filter against the PR's real diff rather
than reading the regex — and require `success` only where it holds. Do not ask *did it run*; ask
*should it have run, and did it*.

**`neutral` is the same state under a different name, and the fix that closed `skipping` admitted it
in the same sentence.** The repair enumerated the conclusions it had decided were acceptable —
`success` or `neutral` — while reasoning only about `skipping`; `neutral` came along as "not a
failure." But `neutral` means *completed without asserting a judgment*, which is the property that
made `skipping` dangerous. GitHub's own branch protection treats it as passing, so it clears a gate
having checked nothing. Actions jobs effectively never emit it, which is why it survives review on a
member repo; **third-party check runs emit it routinely** — a coverage reporter with no baseline, a
linter that owns no changed files — and a fleet-wide instruction governs those by construction.

The remedy is not a narrower enum, which would deadlock the checks that legitimately have nothing to
assert. It is to stop treating the conclusion as a verdict and route **both** no-assertion states
through the precondition test above. `skipped` and `neutral` are one bucket with one handler, and
neither is a green value. Enumerating outcomes is what failed here; asserting the property is what
survives a state the author has not met yet.

**A dead permissive arm is not harmless the way a dead guard is inert.** No `neutral` exists anywhere
in this fleet — six repositories scanned, zero instances — and canon elsewhere declines to build a
guard that has nothing to catch. That rule does not transfer, because **adding a check and removing
an exemption have opposite risk profiles when neither has a live instance.** An inert guard does
nothing until someone gives it work; an unexercised exemption does nothing until the first case
arrives, and then it fires *permissively*, silently, on the reading that looks green. Absence of an
instance is a reason not to add machinery and never a reason to keep an allowlist entry: the missing
instance is precisely what stops anyone noticing the entry was wrong.

Auto-resolve only mechanical conflicts you understand: whitespace, import order, regenerated files, changelog ordering, or lockfiles recreated by the repo's package manager. Escalate semantic conflicts such as same-function edits, schema changes, security-sensitive logic, or incompatible refactors.

Use `git push --force-with-lease` only after a rebase on your own PR branch. Never use plain `git push --force`.

## Fleet Coordination

For parallel sprint work:

1. Query issues and PRs.
2. Resolve applicable roles from root/scoped `AGENTS.md`, consumer `.github/instructions/`, and
   declared local routing. A discovered `.github/agents/` file alone does not authorize dispatch;
   exclude disabled, handoff-only, read-only, and out-of-scope roles.
3. Track assignments in SQL todos.
4. Batch small related issues only when they touch the same files and keep the PR under reviewable size.
5. Publish a merge order for dependent PRs.
6. Re-dispatch failed or incomplete agents until every PR is green and mergeable.

## Commit Messages

```text
type(scope): description (#N)

Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

## PR Body

```markdown
## Summary

Brief description.

## Changes

- Bullet list.

## Issues

Closes #N

## Testing

- [ ] Repo validation command(s) run
```
