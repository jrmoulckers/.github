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

### A test for a repaired bug must be checked against the bug

A test written alongside a fix passes. That is not evidence, because a test asserting nothing passes
too, and so does one that exercises a path the bug never reached. Before committing, **revert the fix
and confirm the new test fails.** If it still passes, it is pinning something other than the defect,
and you have learned that in ten seconds rather than in a later regression.

Extend the same step to fixes you rejected. When you chose a broader fix than the one proposed, the
argument for choosing it is a claim about a specific input the narrow fix mishandles, and that claim
is checkable: substitute the rejected fix and confirm a test fails. Two assertions that both pass
against your implementation show only that it is self-consistent. Each earns its place by naming a
wrong implementation it excludes — the original bug for one, the rejected fix for the other.

This matters most when the fix is to a *guard* and a *branch that runs only when the guard passes*.
Both are then expressing the same rule, and if each expresses it separately they can disagree. A
branch whose predicate is **stricter** than its guard fails closed and surfaces as an unhandled case;
one that is **looser** runs on inputs the guard never admitted, and nothing downstream catches it,
because everything downstream was written against the guard's meaning. Prefer deleting the second
predicate — one shared constant used by both — over correcting it, since a corrected third expression
of the rule has to be re-checked against the guard exactly as carefully as the bug did.

**That safe direction holds only while nothing acts on the miss.** It is stated for a guard, whose
`false` declines to proceed. A **locator** is different: returning "not found" hands control to
whatever handles the miss, and if that path performs the action anyway, a stricter predicate is not
conservative — it selects a different code path with its own behaviour. The frontmatter case above is
exactly this. The obvious strict fix, `line === '---'`, is narrower than a guard that tolerates a
trailing space, so the loop finds nothing, falls through, and the fallback writes the stamp **before
line 1**, destroying the frontmatter on a file the loose original handled correctly. So **check what
the miss path does before treating "stricter" as the safe direction**, and expect fail-closed
intuition to mislead you precisely where the fallback still writes.

**Being right about the defect gives no protection against committing it.** The rejected fix above
was proposed by someone who had quoted the guard's own regex in the message proposing it, and who had
correctly diagnosed the bug as *the rule is written twice*. The fix wrote it a third time. That is
not insufficient care; the reasoning that identifies a duplicated predicate is the reasoning that
produces one, so the diagnosis actively supplies the defect. Treat your own correct diagnosis as a
risk factor for the next edit rather than as evidence you are now clear of it.

Note also that prose beside code is not a weaker specification than the code. A comment stating the
correct rule above a line that implements a different one makes the divergence *harder* to see, not
easier: a reader checking the code against its own comment finds them agreeing.

### A probe must be shown able to return the other answer

Mutation-testing guards the case where a test **passes** vacuously. The opposite failure is more
dangerous and has no equivalent habit: while you are *hunting* a bug, your prior is that it exists,
so a probe that fails for an unrelated reason **corroborates**. It produces exactly the observation
you set out to find, and there is nothing about a confirmed expectation that prompts a second look.

The instance: a scratch repository built to reproduce a suspected defect showed `git log main..branch`
exiting 128 — apparently the defect. It was the fixture. `git init --bare` without `-b main` left an
unborn HEAD, so the clone never created a local `main`. **A fixture that fails for its own reasons is
indistinguishable from the bug you went looking for**, and unlike a vacuous test it does not merely
fail to inform, it actively misleads.

So before you believe a negative result, make the probe produce a **positive** one. A round-trip
comparison that returns `identical` is worth nothing until you have fed it known-bad input and seen
it say `different`. A reproduction that shows a failure is worth nothing until the same fixture, with
only the suspected cause removed, shows success. The point is not to test twice; it is that a
one-sided instrument cannot distinguish *the property is absent* from *I cannot detect the property*.

This applies to any measurement reported as a zero: no matches, no drift, no candidates, no
regressions. State what you did to show the instrument fires.

**And a filter that silently degrades to no filter returns the unfiltered answer — which confirms a
figure derived without one.** A path-filtered commit count built its path list from a lockfile field
that does not exist, producing an empty array, which `git log --` treats as *no restriction*. It
returned exactly the number under test. That is worse than failing to discriminate: the probe did not
merely stay silent, it **agreed with the hypothesis**, and an independent-looking confirmation is the
one result nobody re-checks. Give any filtered measurement a control whose answer must differ — a
narrower scope that has to return less — and a filter that cannot express *empty* should refuse
rather than pass everything.

**An instrument can also loudly deny a right answer, and that failure is not the safe one.** A check
written to prove a timestamp parsed as UTC compared an ISO round-trip against a seconds-precision
input and reported `false` on the millisecond field alone; the parse was correct. A false alarm looks
harmless because it fails closed, but it directs work at code that is not broken — and the plausible
"fix" for a phantom timezone bug is the coercion that introduces a real one. **A wrong verdict costs
whatever the correction costs**, in either direction, so exercise a validating check against a case it
must accept before trusting its rejections.

**And a comparison harness that has stopped measuring reports its failure as a result.** Two probes
built to compare three variants of a function returned, respectively, an identical failure for all
three and `-1` for every fixture in every variant. Both tables were well-formed, and both were empty.
The trap is specific to comparison: **uniformity is the finding such a harness exists to detect**, so
a harness that measures nothing produces output shaped exactly like *no difference between the
variants* — its strongest possible negative result. The remedy is to make the thing you are locating
locatable **by construction**: inject a known sentinel and assert the probe finds it before believing
any run in which it does not.

**The same requirement applies to agreement between two instruments, and is easier to miss there.**
Two measurements matching is evidence only if they *could* have differed. Two sessions measuring one
file across five revisions produced totals differing by exactly one at every revision — `LF`-count
against `split('\n')` on a file ending in a newline. Both conventions are defensible and neither was
stated. A constant residual is the signature of a **convention**, not of two readings: the test is
not whether the numbers differ but whether the difference depends on the input. Five matching rows
under one convention are one confirmation, not five.

**But a stable residual certifies only the convention, and nothing about the corpus.** In the same
exchange the residual held at exactly 1 in all three documents involved — including a stale one
neither party intended to measure. A quantity invariant across inputs cannot discriminate between
inputs, so agreement on the residual is fully consistent with the two parties reading different
files. Report the convention *and* the revision; the residual settles the first and is blind to the
second.

**And never write an unresolvable citation, even as an example.** There is no markup for
use-versus-mention, so a document exhibiting a broken locator to illustrate the defect is
indistinguishable from a document containing one — to a checker and to a skimming reader alike. This
generalizes past citations: **any document that carries a counter-example in the same notation as
the real thing has made itself uncheckable.** It bites hardest where the temptation is strongest, in
the docstring of the very guard that detects the pattern, since a verbatim bad example there poisons
every later search of the tree. Name the broken form in prose instead.

### An unreproducible finding resolves to a timestamp before an author

When a reported defect is not there when you look, the reading that gets reached for is that the
reporter erred. **The one that gets skipped is that it was true when reported and repaired in
between** — which has now happened three times in this fleet. Preferring the author explanation is
the expensive error, because retracting a finding as phantom sends its whole class back to looking
hypothetical, and nothing afterwards prompts a recheck.

So resolve the discrepancy on the time axis first: list the file's commits
(`gh api "repos/OWNER/REPO/commits?path=FILE"`) and measure at each revision. That converts *who
claimed this* into *when was it true*.

**Walk to the first revision carrying the property, not to the first that plausibly explains it.** A
two-point trace establishes the repair, never the origin. Canon's own `SECURITY.md` corruption was
traced across the commit that touched the file and the commit that fixed it, and the repair's
arithmetic reconciled exactly; the nine corrupted sites were nonetheless byte-identical a month
earlier in the repository's **first** commit. The commit that looked responsible — it touched the
file, grew it, and introduced characters of the same class — had not caused it.

**And a repair is not a cure.** Where the fix was made by hand, the symptom disappears while the
defect that produced it stays live, so file the recovery and the underlying cause separately.
**"I measured and it's fine" is the most misleading form of unreproducible**, because a hand-repair
erases the evidence while leaving the defect able to recur, and that erasure is what makes the next
occurrence look like a first one.

### A clean audit is not evidence when the property is not local

Reading every site of a pattern and finding nothing wrong is evidence only if the defect would be
**visible at the site you read**. Some are not, and for those a careful audit returns clean and means
nothing.

`catch { return []; }` is unremarkable where it appears — ordinary defensiveness, nothing to object
to. It becomes a defect only in relation to its **caller**: a consumer that branches on
`if (result.length)` reads an empty array from a failed network call as a confident *there are none*.
The failure is erased at a distance, in a different file, and no amount of attention to the `catch`
itself surfaces it.

Two consequences. First, when the property you are checking is a **relation between a producer and
its consumers**, an audit is the wrong instrument and the answer it gives is not reassuring —
write a structural test that asserts the shape, so the check runs on code nobody is currently
reading. Second, do not treat a prior clean audit as settling the question later; record what
property it actually tested.

And note the strongest instance of it: a defect of this class was introduced by the very change that
*reported* the class, in code whose own description warned about the shape. Holding the pattern in
mind while writing is not protection, which is the whole argument for the test.

The stronger form, from a pair of episodes pointing opposite ways: an innocuous-looking guard was
nearly reported as inert when it was fine, and an audit passed two guards that genuinely were. Both
came from judging a site by its shape instead of following it to where its output goes. So **the
shape at the site has no positive predictive value, not merely a poor one** — which converts the
advice from *look more carefully* into *the site cannot answer this question at all; follow the
value*.

### Assert both halves of an asymmetry against the same fixture

When a property is an asymmetry — tolerate X, reject Y — its halves can end up asserted in different
tests, each of which reads as complete on its own. Delete the tolerance assertion and the rejection
test still passes, the suite stays green, and the rule still reads as enforced while the tolerated
case has quietly become untested.

This is not the single-check failure covered above. Both tests discriminate correctly; what goes
uncovered is the **property spanning them**, which belongs to neither.

The aggravating case is a test whose *name* promises both halves. A name is what an auditor reads
when deciding whether something is tested, so a name that outlives the assertion behind it reports
coverage that no longer exists — worse than an unnamed gap, because it answers the question wrongly
instead of leaving it open.

So assert both halves **against the same fixture, in one test**, and treat a proposal to split them
as removing coverage rather than tidying.

### A reported near miss certifies the reasoning around it

Writing up a mistake you caught reads as an audit and functions as a **certificate**. What was
actually examined is only the part that failed loudly; everything adjacent inherits an unearned
presumption of having been checked — by the reader, and worse, by the author.

The instance: a member searched one file for a symbol, didn't find it, saw an import, and concluded
it had been refactored. The conclusion was right and the story was invented — the symbol had never
lived in that file. The invention survived because it was **load-bearing for nothing**; an
independent check settled the real question, so nothing downstream ever pressed on it. The member
then reported the episode as a near miss and a lesson about false negatives, and that framing implied
the surrounding reasoning had been inspected. It had not.

Distinguish this from two neighbours. It is not an audit that returns clean on a non-local property —
no audit occurred. It is not a safeguard that held by coincidence — that is about a near miss being
evidence of a live hazard. This is about the **reporting** of a near miss suppressing inspection of
everything it sits in.

The sharp form: **the reasoning most in need of checking is what you reached for immediately after
noticing you were wrong.** Recovery reasoning gets written under the impression that the mistake has
already been paid for, and a visible self-correction is exactly the artifact that makes everyone stop
looking.

The remedy is cheap and belongs in the write-up itself: **state what you did not re-examine.** A
self-correction that names its own boundary stops functioning as a certificate.

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

Your groups will not cover everything, and that is expected — the example above classifies
`apps/web/` and `packages/ui/` and says nothing about docs, tooling, or vendored trees. What
deserves care is that a file matching **no** group looks identical, from `changed-groups-json`, to
one correctly judged irrelevant: in both cases the group is simply absent and the gated job
skips. That is fine for a README and load-bearing for anything a build resolves at build time — a
deleted vendored asset or generated file can break a build while matching no source prefix.

The workflow therefore reports what it could not classify, through an `unclassified-files-json`
output, a step-summary section and a run warning. Nothing fails on it, because unclassified paths
are routine and a check that fired on all of them would be switched off within a week. Read it
when a change skipped jobs you expected to run, and widen a group if the residue contains
something your build actually consumes.

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
| `reusable-caller-permissions` | `contents: read` |
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

Because GitHub rejects an insufficient caller ceiling before creating any job, no step in the
affected workflow file can explain the failure. Put the canonical lint in a **separate** file so
that its run still starts:

```yaml
# .github/workflows/caller-permissions.yml
name: Caller permissions

on:
  pull_request:

permissions: {}

jobs:
  lint:
    name: Caller permission lint
    permissions:
      contents: read
    uses: jrmoulckers/.github/.github/workflows/reusable-caller-permissions.yml@<reviewed-commit-sha>
```

Do not path-filter this workflow, and make its stable check name required. A failure names the
caller workflow file and job whose ceiling is insufficient, then lists every other job in that
file that GitHub would suppress as collateral blast radius. An unsupported local YAML shape also
fails rather than being certified safe. A passing lint is the only positive evidence available for
the inspected commit: existing green history does not prove that a future reusable-workflow re-pin
has compatible permission ceilings.

### A no-log failure is not always a permissions problem

The permissions trap above is not the only way a run dies in seconds with an empty log. Exhausting
the Actions spending limit refuses the run before any job starts, with `recent account payments have
failed or your spending limit needs to be increased`.

**This is not confined to private repositories, and canon claimed otherwise until a member falsified
it.** The earlier text here said standard runners are free on public repositories so the refusal
cannot happen there. `jrmoulckers/studio` is public — `"private": false` — and run `31437443369` on
`2026-08-10T22:14:21Z` was refused with that exact annotation on **all 8 of its jobs that were
candidates to run**, every one of them on `ubuntu-latest`, `windows-latest` or `macos-latest`. No
larger runners involved. The claim was falsifiable, was load-bearing, and was false.

**And it is two episodes, not one run** — which is what makes it an account state rather than a
transient. Three weeks earlier, `29662565649` / `29662570979` / `29663406932` on
`2026-07-18T21:57–22:25Z` were refused the same way, 1-of-1 jobs each, on `ubuntu-latest`, on the
same public repository. Four runs, both `push` and `pull_request`, two separated dates. A one-run
falsification invites *some transient*; two do not.

That denominator is 8 rather than the run's 9 jobs, and the discarded job is worth a sentence because
it is the one a careless count reaches for. `security / Dependency review` reports zero steps on that
run — but it reports zero steps on green runs too, where it is `skipped` by a job conditional, so it
looks *identical* whether or not the account is refused. **The discriminator is not `steps: 0`; it is
`failure` at zero steps.** A `skipped` job at zero steps is ordinary. Counting it as a ninth refusal
inflates the load-bearing number with the only job in the run that carries no information, and
implies a partial refusal — as though one job had escaped — when that job was never a candidate.

**Do not drop it on the baseline alone, because that reason selects a larger set than the predicate
does.** The same refused run carries `lint / Semantic PR title`, which is *also* zero-step on green
runs — `skipped` there, `failure` and annotated on the refused one. So "zero-step regardless of
billing" is true of both, and a reader applying that reason drops two jobs and reports **7**. What
separates them is the `conclusion`, which is in the predicate and was missing from this prose.
**Baseline behaviour identifies a candidate for exclusion; only the conclusion confirms one.** The
justification is the portable half — it is what a reader carries to another repository — so a
justification that generalises wider than its predicate discards a real victim, and does it silently,
because the wrongly-dropped job looks exactly like the one it was right to drop.

Two habits follow. Report the population you actually measured (`8 jobs, every one a standard
runner`) rather than an `N of N` that reads as a census: the run's job count moves with the trigger —
9 here, 11 on the green runs used as the control — so the census is run-specific even when the
finding is not. And **establish a zero-step baseline from a passing run before treating zero steps as
a symptom**, because some jobs are legitimately zero-step always.

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

**The annotation is a disjunction, and its two halves have different scopes — which is probably why
the lift is uneven.** `recent account payments have failed` **or** `your spending limit needs to be
increased` are not two phrasings of one condition. A spending limit is *usage-metered*, so it needs
billable minutes and visibility and runner class genuinely bear on it. A failed payment is a *state
of the account*: nothing about free minutes requires the account to be in good standing, so that half
is visibility-independent, which is the half that admits the public-repo refusal above.

Read that way, the divergence recorded here stops being anomalous. Under a single metered cause,
public-standard recovering hours before private is hard to explain; under two clauses it is ordinary
— payment is restored and free public standard minutes resume at once, while metered private usage
stays refused until the limit itself is raised. **Two clauses, two recovery times.** Treat this as
the working explanation rather than a documented mechanism: it is inferred from the annotation's own
wording plus two observations, and GitHub's billing internals are not visible from here. It changes
no procedure — the annotation was already the thing to resolve on — but it predicts that a repository
can recover while a sibling does not, so do not read a fleet-mate's return to green as a lift.

**And it is not merely undocumented — it is unfalsifiable from the evidence this section tells you to
fetch.** All 11 annotations across all four refused runs are a single canned string, and that string
carries **both clauses joined by `or`**. GitHub is not reporting which condition fired; it is
declining to distinguish them. So no operator can ever confirm the clause from the annotation, and
the recovery-time asymmetry is the only observable bearing on it — inference from timing, not
evidence from the message. Do not present the two-clause account to anyone as diagnosable.

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

**Name the predicate, because a relation can be completed by a member that satisfies it
unconditionally.** studio's refused run censused as `total=9, steps0=9, failure=8, skipped=1,
annotated=8`, and the 8-vs-9 gap looked like two valid denominators — annotation-as-evidence against
zero-steps-as-relation. It is not. The ninth job is `security / Dependency review`, which is `skipped`
at `steps: 0` on **every green run of the same workflow**. It completes the relation without carrying
any information about the refusal, so it corroborates nothing; it merely agrees. The load-bearing
predicate is `steps == 0 && conclusion == 'failure'`, which is **8** — exactly the annotated count.
Sharpening the predicate **collapsed** the disagreement rather than splitting it, and a
reconciliation that explains why two numbers may both stand should be suspected first of having
skipped that step: *two correct denominators* is the more flattering finding and the rarer one.

**State which case a predicate has not been exercised against.** That predicate has been run over
studio's whole failure history: 8 ordinary failures (lint, build, and so on) yield zero false
positives, and all four refused runs match. But studio has **0** `startup_failure` runs ever, so it
has never been tested against the **caller-permissions trap** — the exact confusable this section
exists to separate. A discriminator validated only against the easy contrast has not been shown to
discriminate. The honest form is *no false positives on 8 ordinary failures; not yet tested against
the case it is meant to distinguish*, and the missing fixture can be built deliberately by calling
`reusable-ci-lint` without `pull-requests: read`.

**A control must be pinned to the workflow revision, not merely to the event.** Comparing that run
against a green one showed 11 jobs against 9, with `native-kotlin` and `native-swift` absent — which
reads as jobs the account was never allowed to create. They were added to `ci.yml` by `1a9d78e` at
`23:49:29Z`; the run was created at `22:14:21Z`. **A job-set delta across dates measures the workflow
before it measures the run.** The first control here was wrong twice over — a `push` run compared
against a `pull_request` one *and* a later revision — and correcting only the event mismatch produced
a comparison that still could not support the claim. **One confound corrected is not a controlled
comparison**, and finding the first one is what makes the second easy to stop looking for.

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

**The multiplier is paid by the caller and chosen by the callee.** Calling a reusable workflow adds
no `runs-on` you can see, so a member inherits a billing profile selected in another repository.
Across canon exactly one workflow carries a billed tier — `reusable-native-smoke-test`, whose `ios`
job is `macos-15` and whose `windows` job is `windows-latest`; every other canon workflow is
`ubuntu-latest` throughout. Four lines of `uses:` is therefore the most expensive edit available,
and nothing at the call site says so.

This is the **same shape as the caller-permissions trap** above: the caller cannot see the callee's
requirements, and the failure surfaces somewhere that does not name the cause. The two differ only in
latency and legibility — permissions fails immediately as an unreadable `startup_failure`, where
runner cost fails weeks later as a spending-limit refusal, attributed to whatever happened to run
most recently. Per the rule above, that is the scheduled sync.

**A `runs-on` census undercounts precisely the members most exposed to this**, because a repo that
only calls reusable workflows declares none of its own. `jrmoulckers/libro` is the case: its single
`ci.yml` has **zero** `runs-on` lines and **five** `uses: jrmoulckers/.github/…` lines. Its runners
are entirely inherited. So count the callee's runners for every `uses:`, and read a zero from
`grep runs-on` as *not measured* rather than *none*.

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

### Exclude synced canon from your formatter

Canon is authored upstream and is **not** formatted to your Prettier config, so `prettier --check .`
over your whole tree fails on files you do not own and must not fix — editing them is drift, and the
next sync skips the file. Your ignore file is member-owned, so **the sync cannot add this for you**:

```
# synced from jrmoulckers/.github — canonical source, not authored here
.github/agents/
.github/skills/
.github/prompts/
.github/instructions/
.github/copilot-instructions.md
AGENTS.md
```

**Treat that as an example, not the specification.** The rule is keyed to `.studio-sync.lock.json`:
your ignore file must cover every lock path your formatter can parse, and must be re-checked whenever
the sync starts emitting a new one. Written as a fixed list it goes stale on exactly the event that
matters — a new canon kind landing in a formatted path — and then reads as complete while being wrong.
Machine-read files no formatter touches need no entry; resolve that with Prettier's `getFileInfo`
rather than by pattern-matching.

The exclusions are **whole-file even for `AGENTS.md`**, which is only partly canonical: a formatter
cannot be pointed at half a file, and the managed region must stay byte-identical to canon or the sync
stops matching.

If you build a coverage check for this, three traps are known to be live:

- **`inferredParser: null` means both "no parser" and "ignored".** Treating it as "nothing to format,
  therefore safe" folds every correctly-ignored path into the safe bucket, and the tell is that
  **inverting your ignore list leaves the result unchanged**. Make two calls — `resolveConfig` for the
  parser, `ignorePath` for `ignored` — and report a gap only when `parser && !ignored`.
- **Ignore patterns anchor to the ignore file's own directory.** Passing an `ignorePath` from outside
  the repo root silently stops slash-containing patterns such as `.github/agents/` matching while bare
  ones such as `AGENTS.md` keep matching at any depth. It reads as partial coverage, not as a broken
  harness; one member measured 57 false gaps this way.
- **Do not re-implement a parse the engine already performs.** A member scanning this file for
  Markdown headings with `^#{1,4} ` counted 12 fenced `#` comment lines as headings — a 43% inflation
  — because `#` is a heading in Markdown and a comment in `.prettierignore` and `.gitattributes`. The
  engine masks fenced blocks before matching and has a test pinning it; a re-implementation inherits
  neither. Conform against the engine's **output** where you can.

Introducing a canon kind that lands in a formatted path is a **cross-repo event**: every affected
member needs its ignore entry before its sync PR can go green. The `copilot` kind's first distribution
failed CI in four members for exactly this reason.

## Merge Conflict Protocol

Treat conflicts with the same urgency as red CI.

**Git detects textual overlap, and the dangerous staleness in a long-open PR usually has none.** A
branch that adds a *new* file at a name someone else has since claimed produces no conflict at all,
because the two changes touch different paths — the collision is in a namespace, not in any line. A
PR open here since `2026-08-07` adds `docs/architecture/0002-four-authority-topology.md`; that ADR
landed months-equivalent ago as `0003-four-authority-topology.md`, and `0002` now belongs to a
different decision entirely. Merging it would add a duplicate ADR under a number that means something
else, and nothing in git would object.

What makes this worth its own rule is that it defeats the review habit the rest of this document
recommends. The diff is coherent, the branch is self-consistent, and its contents are exactly what
they were when they were correct — **a stale branch's own contents can never tell you that it is
stale**, because supersession happened outside it. So for any change that claims a *new named slot*
— an ADR number, a migration id, a fixture path, a workflow filename — validate the name against the
destination as it is now, not against the branch. `git ls-tree main <dir>` before merging is the
whole check.

The disposition also differs from a conflict: a superseded branch is **closed**, not resolved. If its
content already exists on the default branch, rebasing it produces a clean, mergeable, wrong change.

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

**But "has it fired?" is the wrong question, and a better one reads off the code: when this arm
fires, what still fails if the artifact is wrong?** An exemption is dangerous in proportion to what
remains asserted after it fires, not in proportion to whether it has fired. Allowlisting `neutral`
narrows a gate from *{did this check pass}* to *{}* — nothing remains, which is why its first live
instance would have been silent. An exemption that skips one assertion while another still runs
narrows *{a, b}* to *{a}*, and is inert rather than a trapdoor. **`nothing` is the alarm.** That test
costs one reading of the branch, where counting instances costs a fleet scan and answers a weaker
question.

**Non-empty is necessary and not sufficient: the surviving assertion must be load-bearing for the
same fault.** A residual that tests a different property leaves the exemption exactly as open as an
empty one, while looking safe. The engine supplies the instance. A member's content hash is the
obvious residual to lean on — but `assets.mjs:131` sets `content: inject(targetPath, raw)` and
`copier.mjs:217-218` records `hashText(rendered)` into the lock, so **the hash's reference is the
engine's own output.** It detects a member drifting from what the engine produced and is structurally
incapable of detecting the engine producing the wrong thing. When the frontmatter emitter injected a
stamp *inside* a YAML block scalar, the defective output would have been hashed into the lock,
matched on every subsequent run, and reported clean forever. So "the hash still asserts" is a real
residual for tampering and an empty one for correctness, and which of those the exemption was
covering decides whether it is inert.

Keep the justifications separate, too. An exemption that mirrors a genuine engine property — a
`.json` target cannot carry a comment, so a marker check must skip it — is justified by
**conformance**, and that argument stands whether or not anything else asserts. Stacking a weak
safety argument beside a strong conformance one lets the strong one launder the weak one, and the
weak one is what gets reused as precedent somewhere the conformance argument does not hold.

**A deliberately permissive direction is not a blind spot if it announces itself.** The sync engine
is asymmetric about reusable workflows on purpose: an *undeclared use* is a hard error
(`member-facts.mjs` raises `workflow availability does not declare checkout use …`, pinned by test),
while a *declaration with no caller* passes. That is the same permissive shape faulted above, and it
is correct here, because the gap between declaring availability and migrating callers **is** the
migration window — making it an error would forbid doing the two steps in the only order that works.
What keeps it from being a blind spot is that the tolerated state is **logged** every run
(`reusable workflow availability not currently called: …`, emitted from two call sites). The
distinction to carry: a permissive branch that is *silent* hides its own population, while one that
*prints* is an observation anybody can act on. **When you deliberately allow a state, make it
announce itself, and it becomes a window rather than a hole.**

The ordering consequence is load-bearing and easy to invert: because undeclared use is fatal and
unused declaration is benign, **availability must be declared before any caller migrates**. A member
that switches its callers first fails its own sync until the declaring change lands — so a config PR
that looks like tidy-up can be the prerequisite, and reading it as a follow-up leaves the migration
blocked with no obvious cause.

**Rank a shared default by its worst caller, not its typical one, and read/write is usually that
split.** The same `markers = MARKERS.html` default sat on a reader and a writer in this engine, and
the two ends are on opposite rows of the severity table. Given to the reader, a wrong marker set
matches nothing and returns zero regions — wrong, but loud and safe, and it fails in the direction
that gets investigated. Given to the *writer*, it emits `<!-- … -->` into a file where that is not a
comment: in `.gitattributes` those lines become patterns git tries to match, so the output is
corrupt rather than absent. **A default is not a single decision with a single severity** — it
inherits the blast radius of whichever caller it reaches, so auditing the one you happened to notice
understates it. The reader is the one you notice, because a missing region is visible; the writer is
the one that matters.

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

### Acknowledge by the timestamp of the message you are answering

Open a reply with the send time of the message it answers:

```
Re: your 03:57Z —
```

Messages between sessions cross, and a reply's *content* cannot disambiguate which message it
answers, because topics recur: a retraction and the entry it retracts are about the same subject, so
an answer to the earlier one reads as a rejection of the later one. Naming the time makes it
self-checking at zero cost. **If an acknowledgement names a time earlier than your last send, it
crossed** — you know without asking, and you can re-send rather than assume you were overruled.

It also creates a third state where there were two. Silence is ambiguous; silence plus an
acknowledgement of an older message is *distinguishable*, and distinguishable is the whole
requirement. This was proposed after four crossings in one evening, one of which put a claim into
canon twelve minutes after its author had withdrawn it — **a retraction that crosses is
indistinguishable from one that was never sent**, and the cost is paid by whoever acts on the stale
half.

### Cite by name, and resolve the name as a heading

Prefer a section name over a line range when pointing at any document. A line number is invalidated by
an edit made **above** it — an act that is correct, unrelated, elsewhere, and produces no diff at the
citation site, no conflict, no failing check, and no notification to anyone holding the reference. A
name survives edits above it and degrades to a search rather than to silence.

When a coordinate is used anyway, **prefer a range to a point**. The ordering is `name > range >
point`: a range absorbs drift up to its own width, so it keeps resolving after an edit above it that
would leave a point resolving to the wrong place. Measured on a real case, a passage cited as
`785-803` sat at `785`, moved to `794` a revision later — still inside the range, still correct — and
had left the range entirely by the revision after that. So a range **buys revisions, not
permanence**. It degrades gracefully rather than immediately, which is a genuine advantage over a
point and is not immunity; it does not make a coordinate durable, and it does not displace the name.

But a name only helps if it names a **structural element**. `§ X` asserts that X is a heading; a
plain text search confirms only that those characters occur somewhere, and returns the same answer
whether the match is a heading, a bold lead-in, a table cell, or a line inside a fenced block. So
**resolve a cited name with a heading-anchored pattern (`^#{1,6}\s`) that masks fenced blocks, not
with a substring search.** The negative result is the informative one: a name that appears but is not
a heading is exactly the case a substring search reports as success.

This is not hypothetical. A citation in canon named a section that had never existed at any revision —
the string was real, at the line reported, but it was **bold paragraph text**, which gets no anchor
and so fails as both a heading scan and an in-page link. Two readers validated it independently, both
by content, both landed on the correct line, and both were wrong about what kind of thing was there.

Two failure modes, and checking for one does not check the other:

- **Stale line number** — right-shaped, wrong-valued. It resolves, to the wrong place.
- **Name that is not a heading** — fresh, wrong-shaped. It never resolved, and the obvious check
  reports success.

Both are the same mistake at different levels: reading Markdown as flat text rather than as
structure. Whichever form you use, **quote a sentence from the target** — but do not expect the quote
to settle it on its own.

**Every locator is blind in the dimension it keys on.** Content keys on words, so it cannot see
structure. A coordinate keys on position, so it cannot see content. A blob hash keys on bytes, so it
cannot see meaning. They are not ranked and none subsumes another: they span different dimensions,
and a given fault lands in one of them. The practical test for any locator someone proposes is to ask
what it keys on — that names its blind spot.

The case that establishes it: a member's decoder inflated a document, preserving every word while
destroying every line boundary. The quoted phrase resolved perfectly against the mangled text — it
had to, every word was present — and the only thing that dissented was the coordinate, which landed
past the end of the file. The fault sat exactly in the dimension content resolution cannot perceive.

That does not promote the coordinate. It fired by **arithmetic accident**: detection required the
inflated coordinate to clear EOF, and had the cited passage sat anywhere in the document's first 39%,
the same corruption would have produced a coordinate landing quietly *inside* the file on plausible
neighbouring prose, dissenting about nothing. A detector whose sensitivity depends on where you
happened to be pointing is not a detector.

So carry more than one locator, and resist collapsing the set to whichever member last proved useful
— that is the same move as choosing the instrument that worked most recently rather than the one that
addresses the fault in front of you. When two readers may be holding different artifacts, a **blob
hash** settles it in a single comparison; pair it with a quoted phrase and both failure modes are
covered, where either alone leaves one open.

### Never enumerate from the artifact you are validating

Pin a discovered population before iterating it — an empty loop reports `pass`, not `skipped`, so it
is indistinguishable from a real assertion. But a `count > 0` guard only tests **non-vacuity**, and
there is a worse failure it cannot see: **a population that is non-empty but derived from the thing
under test.**

A checker that reads its list of files to verify out of its own lockfile, manifest, or index can
detect corruption of what that file declares and **never omission from it.** A path present in the
tree but absent from the index is never enumerated, so the check reports green on it forever — and no
count reveals that, because the population is not empty, only incomplete. It answers *is everything
the index declares intact* while appearing to answer *is everything intact*.

**Only an independent enumeration tests completeness.** Build the population from a source that
cannot be edited by whatever you are checking — for synced canon that is the backbone manifest, not
the member's lock. The lock's job is to answer *what did this file look like last time*; using it to
answer *which files exist* silently converts a deletion into a pass, and deletion is the failure an
ordinary mistake produces first, because it needs one line removed rather than a hash forged.

Note that two partial signals can be complementary here rather than redundant: a marker or stamp is
unreliable per file but can only ever *add* candidates to an enumeration, while an index is reliable
per entry but cannot report what it never recorded. Neither closes the seam; their union does.

### An invariant that spans two repos must be enforced by a throw, not by a comment

If a rule can be broken by a change in one repo and is written down in another, it is not enforced.
Neither CI can see the pair: the repo holding the rule does not know the other one changed, and the
repo making the change cannot read the rule.

The instance: canon classifies every file type it stamps, and its comment said a new extension "must
be classified here." But the enumeration lives in canon while the act that invalidates it — emitting
a new output format — belongs to whichever repo owns a distribution. Correct diagnosis, accurate
severity, and an obligation binding an author no run could check, in the repo that did not change.

**Make the invariant fail closed in the run that can see it.** A `throw` on the unclassified case
fires in canon's own tests, on the first artifact that needs classifying, with neither side having to
remember the other exists. It binds nobody and catches everybody; the comment bound an author and
caught only the people already going to comply.

This applies wherever you document a requirement for someone else's repo — an expected file layout,
a required field, a supported type. Ask which run fails if it is violated. If the answer is "none,"
you have written a preference, and it will be discovered by the outage rather than by the check.

Two corollaries worth applying directly:

**Rank a shared default by its worst caller, not its typical one.** A default over a *closed*
population can be audited by enumerating the population; one over an *open* population cannot,
because the inputs that break it do not exist yet. Being easier to reason about is why the closed
case tends to get fixed first, and is unrelated to which one should have been.

**Repairing one copy of a duplicated rule leaves the pair worse than it found it.** While both copies
are wrong they agree, and a reader comparing them correctly finds no divergence between them. Fixing
one converts a shared error into an inconsistency visible only to someone who diffs two files and
already knows they are meant to match. There is no partially-correct state for a duplicated rule —
delete the copy, do not improve it.

### A revision you assert is a claim, whether or not you fetched it

Canon already tells you to report the revision you read. That instruments a **fetch** — and the more
common way a stale revision enters a conversation has no fetch to instrument.

Both directions of one exchange demonstrated it. A member quoted canon text that had moved underneath
the quote; the quote had not arrived over the wire that message, it came from **earlier context**, so
no fetch discipline could have caught it — `gh api .../contents/<path>` with no `ref` returns
default-branch HEAD and cannot hand back a stale revision. In the same exchange the backbone asserted
that member's HEAD from its own memory of a previous report, and was two commits behind; the member's
reply asserted its own HEAD and was three commits behind by the time it was read.

| How the stale revision entered | What a recorded blob or size catches | What closes it |
| --- | --- | --- |
| stale bytes over the wire | nothing — the bytes are intact | record the SHA you fetched |
| **quoting from your own context** | **nothing — there was no fetch** | re-read before quoting |
| **asserting another repo's state** | **nothing — you never read it** | re-resolve, or attribute and date it |

The second row is the likelier one precisely because it feels redundant: re-reading a file you have
never read is obviously necessary, and re-reading one you read an hour ago is obviously not. Prose
preserves a quotation perfectly while the repository moves out from under it.

So: **before you quote it, re-read it; before you assert someone else's revision, re-resolve it**
(`git ls-remote` is one call). If you are repeating a figure you cannot currently re-derive, attribute
and date it — *"studio reported `6f98f5b` at 08:25Z"* is durable and checkable; *"studio is at
`6f98f5b`"* decays silently, and the reader cannot tell which one you meant.

### A measurement someone reports is a moment, not a standing claim

The rule above governs what *you* assert. Its mirror governs what you receive: when a report from
another repo does not match what you observe, the mismatch does not tell you which of you is wrong.
It has two explanations that look identical — **their instrument is broken**, or **the world moved
after their instrument ran** — and nothing in the result itself distinguishes them.

The instance: a member reported the contents of an engine constant. The backbone looked, found no
such constant, and concluded the member's comparator was silently passing over a missing value. In
fact the comparator raised a fatal error on exactly that case, and the constant had existed when they
measured — their run predated its removal by about ninety-five minutes. **The report was correct when
made and had since been superseded, which is not the same as having been wrong.**

Default to the instrument being broken and you impugn both the tool and the reporter, and you invite
a repair to something that was working. The discriminator costs one lookup: **compare the timestamp
of the measurement against the merge time of the change that would explain the difference.**

```
git log -S'<the thing they named>' --format='%h %ad %s' --date=iso-strict -- <file>
```

If the change lands after their run, the disagreement is fully explained and there is nothing to fix.
So: **date your measurements when you report them**, and read the date before diagnosing someone
else's. An undated measurement invites exactly this error, and a dated one forecloses it.

### Conform against a population that outlives the implementation

When you check that your copy of a rule still matches canon's, choose what to key the check on. Two
shapes look equivalent and are not:

- keyed to an **internal constant** — asks *do you still spell it this way*. Breaks on any refactor
  that preserves behaviour, and reports a difference that is not a defect.
- keyed to **inputs and answers** — asks *what do you answer for this path*. Survives refactors,
  because it names only what both sides already name.

Prefer the second. Paths, filenames, and public inputs are the durable unit: they are the vocabulary
canon and members share, and they remain meaningful after the implementation behind them is
rewritten. A member that replaced a constant-comparison with *import the engine's real function, feed
it my actual locked paths, diff the answers* found a genuine classification divergence on the first
run — one the constant-comparison could not have detected at all, because the constant it watched had
been deleted by the very change that introduced the divergence.

Note that the durable-population check is also the one that keeps working while the thing it inspects
is being redesigned, which is when you most need it and least expect to have it.

### Reporting a defect in canon from a repo that holds a synced copy

You hold a copy of these instructions at `.github/instructions/`, and it is **generated, not
authored** — it lags canon by design, and during a distribution outage it lags without bound. So
"I checked the instructions and the claim is still there" is a statement about your copy, and
canon may have repaired it several revisions ago. This has already produced repeated round trips
where both parties were reading accurately and disagreeing anyway.

The copy cannot currently tell you which canon it came from: the provenance header names the source
**repository**, and `.studio-sync.lock.json` records the backbone and a `generatedAt` time, but
neither records a canon **revision**. That is an engine gap rather than your mistake. Until it is
closed, do this:

- **Read the canonical file before reporting**, not your synced copy — `gh api
  repos/jrmoulckers/.github/contents/instructions/workflow.instructions.md` with the raw accept
  header, or `gh api .../commits/main` for the revision.
- **Report the revision you read** and the blob hash. If you cannot obtain one, say which artifact
  you read and that it was a distributed copy; that alone routes the reply correctly.
- **Quote and cite `generatedAt` from your lock** when reporting drift you believe is real. A
  timestamp does not identify a revision, but it bounds one, and it makes the lag visible instead of
  invisible.

The corollary for whoever maintains canon: a member reporting a claim that canon already fixed is
**not** making an error, and answering "that is stale, you read an old revision" misplaces the fault
onto the reader for holding the artifact canon published to them. The report is correct about the
artifact in their hands. When distribution is blocked, expect the same correct report repeatedly, and
fix the distribution rather than the reporter.

**A merged sync PR does not make you current — it makes you current as of the moment it was
generated.** Its files are pinned at its head commit, so every canon change since is still missing
after it lands. libro's blocked `#37` was generated at `04:27:21Z`; the authorship and peer-gate rules
merged at `11:21:19Z`, and its `AGENTS.md` blob contains neither. Merging it would have closed the PR
and left that gap intact.

That is worth stating because the merge is the point where the gap stops being visible. While the PR
is open it is a tracked reminder that you are behind; afterwards there is nothing to look at, and a
green merged sync PR reads to everyone downstream as *this member is current*. So after merging a wave
that sat blocked, either request a regeneration or record the remaining distance somewhere that
outlives the PR. **Measure it rather than estimating it** — count the canon commits touching managed
sources since the branch head; that number is the gap you still have.

**Name the population that does *not* count, because the wider measurement is the cheaper one.**
"Managed sources" excludes backbone-internal documentation and the sync engine's own code, and those
dominate: over one nine-hour window libro's residual was **76** canon commits unfiltered but **14**
touching sources it actually receives — 60 were `docs/`, which is never distributed, and 16 were
`sync/`. A bare `git log --since` is easier to reach for than a path-filtered one and returns a
plausible number, so **a rule that names a narrow population while remaining satisfiable by a wider,
cheaper measurement will be satisfied by the cheaper one.** State the disqualifying set, not only the
qualifying one.

**And record it where it outlives the conversation, not just the PR.** Everything establishing a
residual — the count, the window, the method — typically lives in a thread and a merged PR body in
another repository. A reader arriving later has no thread to follow, so the artifact must **restate**
the measurement rather than cite it, and should close on the regeneration rather than on the merge.

That durability is also why the figure has to be right. An artifact built to outlive its own
conversation removes every later opportunity to catch an error in it, and will be believed by someone
with no access to the reasoning. **Durability is a multiplier on correctness, not a substitute for
it** — re-derive the number against the definition the rule actually names before writing it down.

And when checking whether a rule reached you, **search the exact phrase, not its topic**. The token
`peer` occurs four times in libro's copy while the peer-gate rule is entirely absent; a keyword search
would have reported it present.

That test proves absence reliably **only when the phrase is canon's own wording**. A member that
paraphrases a rule while keeping its substance will be reported as missing it — false drift rather
than false currency. That is the safe direction to fail, and it cannot arise for synced regions, which
are byte-identical or drifted with nothing in between. It does arise for hand-seeded and
member-authored content, so treat a phrase-search miss there as a prompt to read, not as a verdict.

It also constrains how a claim gets **retracted**, since this search is what a reader runs against a
rule they remember. **When you withdraw a claim, keep its original wording inside the withdrawal.**
Delete the words and the search returns nothing, which reads as *this was never here* rather than
*this was retracted* — and the person running that search is usually the person who acted on the
claim, so the reader who most needs the correction is the one a clean deletion serves worst.

**Naming a revision does not certify the figures beside it.** A reader binds every number in a
message to the SHA that message names, so a coordinate measured at one revision and published
alongside another is trusted *because* the revision was cited. Naming the tip reads as rigour and
supplies the false confidence. Measure at the tip you name, or attach a revision to each figure
individually — and when reporting that something is absent, say which population you searched, since
*not in the revisions I checked* and *not in any revision* are written identically and differ by
everything.

**And a branch name is not a revision at all.** A row labelled `main` in a column of SHAs reads as
one more coordinate; it is a query evaluated against whatever ref namespace the reader happens to
hold. Two sessions comparing a five-revision table agreed exactly on the four rows named by SHA and
came out at 887 against 2421 on the row named `main` — one reading a stale *local* branch from the
previous evening, one reading the tip at their measurement time, neither reading the tip that
existed when the comparison was made. A stale local ref resolves **silently**: no fetch, no warning,
nothing to distinguish it from a current one. So resolve any moving name to a SHA and publish the
SHA, and treat a mixed table of names and SHAs as a table whose rows are not comparable.

### A correct verdict does not make the remedy correct

A guard that fails closed on the right input can still do harm, because the *diagnostic* is a
separate claim from the *verdict* and is usually the part that was never exercised. A member's
text-classification guard correctly flagged a staged PNG as binary and exited 1 — and every sentence
after the file list was written for a different cause, instructing the reader to rewrite the file
with LF terminators, which destroys a PNG. The verdict had been tested; the remedy had not.

Two things follow. **A condition with more than one cause needs the diagnostic to route on the
discriminator, not on the condition** — here, presence of NUL separates ordinary binary from
CR-corrupted text, and both branches can still exit 1, so nothing about the fail-closed property is
given up. And **failing closed buys the reader's attention without guaranteeing what you spend it
on**: the check has just stopped their build, so they have maximal trust and minimal context, which
makes a wrong remedy behind a correct verdict *more* dangerous than one behind a wrong verdict —
nothing downstream contradicts it. Test what a check *says* on each cause, not only which way it
exits.

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
