---
applyTo: '**'
description: 'Change delivery workflow. Use for issues, branches, conventional commits, pull requests, required quality gates, reusable workflow calls, human-gated operations, and fleet coordination.'
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

**A `CLEAN` reading is a timestamp, not a property of the merge that followed.** With auto-merge
disabled you find the merge window by polling, so the sequence is *read, then submit*, and the state
can change in between — during one exchange the backbone moved five times in twenty minutes. What
the outcome establishes is only that the merge was clean **at submit**, which is the unit that
counts; it does not retroactively confirm the reading. Keep the two claims separate when reporting:
*I observed `CLEAN` and then merged successfully* is supported, *the merge was clean because I
verified it* is not, and the distinction matters the moment a merge fails after a `CLEAN` read —
that is the expected behaviour of a stale reading, not evidence of a broken instrument.

**When checking runs rather than a PR, sort on `run_started_at`.** `gh run list` orders by
`created_at`, and a rerun keeps its original `created_at` while advancing `run_started_at` — so the
most recently *executed* run can sit arbitrarily far down the listing, or outside a short one
entirely. Measured on a member: the freshest execution in the repository ranked twelfth, and a
`--limit 3` read did not contain it.

```sh
gh run list --repo OWNER/REPO --limit 100 \
  --json databaseId,createdAt,startedAt,status,conclusion,event \
  --jq 'sort_by(.startedAt) | reverse | .[0:5]'
```

The default read fails toward *nothing has changed*, since a successful rerun stays buried under
older failures. `run_started_at` is also what distinguishes *this attempt is live* from *this is an
old attempt's creation time* when a run reads as `queued`. The jobs endpoint is unaffected — it
returns the latest attempt.

**But the claim that only ordering and freshness are at risk is too narrow, and the fields invert
when the question is *when did this begin*.** For freshness the mutable field is the useful one; for
onset it is the trap, because `run_started_at` tracks the newest attempt while `created_at` stays
fixed at the first. Measured against the per-attempt endpoint, top-level `created_at` equalled
attempt 1's creation on every run checked, and `run_started_at` equalled it on **98 of 98**
single-attempt runs while differing on **every** multi-attempt run, by between 199 seconds and
**78,011** — nearly twenty-two hours of displacement on an object whose identity never changed. So
dating an onset from `run_started_at` reports when the condition was last *re-examined*, not when it
started, and it always errs late.

**Recording a hazard's magnitude does not make the hazard stop firing.** The `199` second figure
above is not a generic bound — it is one specific run, `31437205907`. An independent correspondent
subsequently dated an outage's onset from `run_started_at` **on that same run**, and was late by
exactly 199 seconds: they reported `22:14:22Z` where attempt 1, equally zero-step, had been refused
at `22:11:03Z`. The canon entry was correct, present, specific, and quantified, and it did not reach
them — see the entitlement gap below. **A finding only prevents a defect for readers who receive the
file it lives in**, so when a correction is published, check whether the party most exposed to that
defect is entitled to read it.

Two properties make this worse than an ordinary wrong-field mistake. The agreement is near-total on
untouched objects, so a sample drawn at random validates the field at 98% and certifies nothing —
the disagreement lives entirely in the re-run subset. And that subset is **the one investigation
creates**: re-running a failure is how the failure gets studied, so the field decays precisely on the
runs under examination, and it decays monotonically toward a later onset. The instrument is displaced
by the act of reading it. Prefer `created_at` for onset questions, which needs no per-attempt fetch
to be safe, and reserve `run_started_at` for the freshness question it actually answers.

**Never mix the two fields across the objects being compared.** An adjacency of one second between
two repositories' onsets, read as a fleet-wide simultaneous transition, turned out to be a
`created_at` on one side against a `run_started_at` on the other; the true separation was sixteen
minutes and the true ordering was different. A cross-object comparison must name one field and use it
on every object, because mixing them manufactures agreement rather than merely adding noise — and a
striking coincidence is the result most likely to be believed without re-checking.

**A duration inherits every one of these traps and hides them better, because a wrong duration is
just a number.** A wrong onset is a timestamp a reader may recognise as implausible; `updated_at -
created_at` is dimensionally fine whichever fields it drew on. Two consequences, both measured. At
run level the subtraction is not a duration at all but a **span across attempts**, bracketing the
idle gaps between them: a census of billing refusals here returned a single value of **78,023
seconds** — 21.7 hours for a job that executed no steps — because the run carried sixteen attempts.
The outlier was the only reason the error surfaced, so the same defect at two or three attempts would
have passed as a plausible slow refusal. And at attempt level the two fields **invert** relative to
the top-level case: `run_started_at` equals `created_at` on attempt 1, but on retried attempts it
*precedes* it by one to two seconds, so the attempt is recorded as starting before it was created.

```
attempt  created_at   run_started_at   dur(created)  dur(runstart)
  a1     04:27:27     04:27:27              48s          48s
  a2     04:52:57     04:52:56               4s           5s
  a5     11:22:17     11:22:15              22s          24s
```

Two parties measuring the same seven attempts disagreed on every row for this reason while both were
correct. **Name the field a duration was computed from, and compute it at the level of the object
that actually did the work** — the attempt, not the run.

**State the object, not just the field, because the same two names invert sign between a container
and the thing it contains.** Reproduced across a member's full run history: at run level the pair is
equal on all `97` single-attempt runs and `run_started_at` *follows* `created_at` on all `4`
multi-attempt ones, by `226`, `1058`, `1728` and `36581` seconds; at attempt level, on those same
four runs, it *precedes* on `13` of `17` records and follows on none. Attempt 1 is always equal,
which is what hides it. The run object carries the first attempt's creation against the newest
attempt's start; the attempt object carries its own pair a second or two the other way. So a
remedy phrased as *prefer this field over that one* is not statable — the preference reverses with
the object it is read from, and a field name alone does not name a measurement.

**And the agreement base rate conceals this from any uniform sample.** The two fields agree on `97`
of `101` runs in that member, so a sampled check validates either choice at 96%. Measured on this
repository, which contains no re-run at all across `300` runs, they agree `300 of 300` — the
question is not merely unanswered but unanswerable, because the population holds no case that could
separate them. All the discriminating evidence sits in the re-run subset, which exists only where
something already failed. **The healthier the repository, the more completely a field-choice rule
appears confirmed and the less it has been tested**, so validate a rule about retries on a
population that contains retries, and say which one when you report the check.


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

**A guard is a claim about a relation between two texts, and inspecting either one alone always
shows it satisfied.** A correspondent's idempotency guard tested a fetched body for the literal
`Added 2026-08-12T05:5` while its own payload emitted `(added 2026-08-12T05:55Z)` — differing in
case, so the guard tested for a string the script could not produce and **no number of applications
could ever satisfy it**. Applying twice appended twice, `7770 -> 8928 -> 10086`, exactly `+1158` each
time. Auditing the other scripts found a second instance of the same shape, in the script whose
idempotency had already been *reported as verified*.

The reason that verification was worthless in a way that looks rigorous is the transferable part.
Idempotency was confirmed by **reading the guard** rather than by **running the script twice**.
Reading establishes that a guard exists and is compared against the right object — both true here.
What it cannot establish is that the guard's literal and the payload's literal are the same string,
because that requires holding two widely separated regions of the file side by side, which is exactly
what sequential reading does not do. Each half looks well-formed; the defect lives only in the space
between them.

**The same defect recurred one level up, in the search for this entry.** The member who supplied the
instance above later derived the rule independently and reported it, and I grepped canon to decide
whether to file it. The pattern was built from my own paraphrase — *guard that cannot fire*, *could
never fire*, *sentinel*, *vacuous* — and this passage contains none of those words; it says *no
number of applications could ever satisfy it*. So the search returned a clean negative and I told
the member canon lacked their formulation, eight hours after writing their formulation into canon
from their own numbers. Searching one distinctive noun from their message instead, `idempoten`,
retrieves the passage twice on the first attempt.

**Canon states a rule in the vocabulary of whoever reported the instance, so a predicate built from
your restatement of it is a predicate that cannot match.** That is the guard defect exactly: two
texts, each well-formed, never compared. And the negative it produces is expensive rather than
merely wasted, because canon is grepped before every filing decision, so a false negative there
files a duplicate — and duplication is the growth pressure this file is already under.

Apply the remedy this section already gives for probes to the search itself: **seed it.** Before
concluding canon lacks a rule, confirm the predicate retrieves a passage you know is adjacent. Where
you are searching on behalf of a reporter, prefer their nouns to your own, because the entry — if it
exists — was probably written from their case and carries their words.

**And this is the accidentally-safe entry recorded elsewhere in this file with its sign flipped.**
There, an instruction was safe for a reason its author did not know, so its clean record taught
nothing. Here an instruction is *unsafe* for a reason its author did not know, and its clean record
also teaches nothing, because it was never exercised. **Both are certified by identical evidence —
nothing has gone wrong — so that evidence cannot distinguish a guard that works from one that cannot
possibly fire.** The only thing that separates them is performing the operation the guard exists to
make safe. Verify idempotency by applying twice; there is no reading that substitutes.

**That safe direction holds only while nothing acts on the miss.** It is stated for a guard, whose
`false` declines to proceed. A **locator** is different: returning "not found" hands control to
whatever handles the miss, and if that path performs the action anyway, a stricter predicate is not
conservative — it selects a different code path with its own behaviour. The frontmatter case above is
exactly this. The obvious strict fix, `line === '---'`, is narrower than a guard that tolerates a
trailing space, so the loop finds nothing, falls through, and the fallback writes the stamp **before
line 1**, destroying the frontmatter on a file the loose original handled correctly. So **check what
the miss path does before treating "stricter" as the safe direction**, and expect fail-closed
intuition to mislead you precisely where the fallback still writes.

**The channel you report through is fail-open, and that is why reporting needs discipline code does
not.** A member mistyped this session's id twice while addressing a message; both were rejected,
because an unknown session id errors rather than routing to a plausible neighbour. Every mis-cited
*figure* in the same exchange — the run attempts, the stale tips, the fabricated timestamps — was
delivered exactly as reliably as a correct one. Same class of error, opposite consequence, and the
only difference is whether the receiving system validates the token. **Prose is an unvalidated
channel**, so a claim written into it carries no check whatsoever, while the identifiers around it
may be fully checked. That asymmetry is the mechanism under the artifact-over-prose gradient recorded
later in this file: an artifact is usually a validated channel and a sentence never is.

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

**Establishing that two fields are interchangeable by sampling one instance is a probe whose majority
outcome is the uninformative one.** A single merge carries at least two authoritative times — the
pull request's merge timestamp and the commit's own date fields — and they do not always agree.
Measured over forty consecutive merges in one member repository: twenty-five agreed to the second,
fifteen differed by exactly one second, and none differed by more. So the divergence is real, bounded
at one second, and **intermittent** — a reader who checks a single merge to decide whether the two
fields say the same thing draws the reassuring conclusion five times in eight, and the conclusion is
wrong. Cite the field, not just the artifact: `repository@revision` is not sufficient provenance for
a claim about time, because the same event has more than one correct timestamp and the discrepancy is
exactly the size that reads as carelessness in someone else's message.

**Uniformity across a sample reads as signal and is more often an instrument constant.** The first
pass at that measurement reported all forty merges differing by 25,200 seconds — seven hours, to the
second, every time. That is a timezone offset applied to one side of the comparison and not the
other, not a property of the data, and the perfect consistency is what made it look like a finding
rather than a bug. A difference that is identical across every element of a sample is a parameter of
the measuring apparatus until shown otherwise; the real signal here was the residue the offset was
hiding, one second wide.

**The two channels that supply these timestamps disagree by design, and the obvious fix makes it
worse.** `git`'s `%cI` and `--date=iso-strict` are strict ISO 8601 and render in the *committer's*
zone, while the platform API always returns `Z`. Neither is malformed, nothing looks wrong, and a
table mixing them hides a day boundary. The natural remedy — force a UTC format string — is where the
trap is:

```
FORM                          unset                        TZ=UTC
%cI / iso-strict              2026-08-12T10:12:31-07:00  2026-08-12T10:12:31-07:00  honest
%ct / unix                    1786554751                 1786554751                 frame-free
format:'...%SZ'               2026-08-12T10:12:31Z       2026-08-12T10:12:31Z       LIES ALWAYS
format-local:'...%SZ'         2026-08-12T10:12:31Z       2026-08-12T17:12:31Z       lies unless set
iso-strict-local              2026-08-12T10:12:31-07:00  2026-08-12T17:12:31Z       honest either way
```

`format-local` honours the environment, so **without the environment variable it emits local time
wearing a `Z`** — off by the offset, and now indistinguishable from a genuine UTC reading, where
`%cI` at least declared its frame. That is strictly worse than the disease: the half-applied remedy
converts an honest inconvenience into a silent falsehood, and it defeats the very check a reader
would apply after learning this rule, since the string is `Z`-suffixed and well-formed.

**The sibling form is worse still, and it is the one this rule's own remedy sends you to.**
`--date=format:` renders in the commit's recorded offset and labels it `Z`, and setting `TZ=UTC`
does not change it — it is wrong in both columns. So a reader who learns "force UTC" and reaches
for the nearest format string lands on the variant nothing recovers, while `format-local` at least
*responds* to the fix. State the remedy against the whole family or it misdirects: **a rule that
names one member of a family of forms has implicitly endorsed the others**, and the sibling that
resists the prescribed fix is the one it endorses most strongly.

That resistance is also why testing for it fails. Flagging each form by whether its output changes
under `TZ=UTC` — intending frame-independence as the safety signal — ranks `format:` as *stable*
and `format-local` as *dependent*, i.e. it scores the unrecoverable form as the safest one, and
scores it that way **because** it is unrecoverable. **A discriminator that measures invariance
cannot separate "immune to the frame" from "immune to the fix", and those two rank oppositely.**
Insensitivity to a correction presents as robustness; before trusting a stability check, ask what a
broken-and-unfixable input would score.

Prefer `%ct`, the Unix epoch, which has no frame to get wrong and no environment to depend on;
convert once at the point of display. Where a rendered date is wanted, `%cI`, `iso-strict`, and
`iso-strict-local` all carry their frame and cannot lie in either configuration. A literal `Z` in a
hand-written format string is an **assertion about the frame made by the author**, which neither
the tool nor the reader can check — that, not the missing variable, is the defect both `format:`
and `format-local` share. The principle generalises past dates: **where a remedy's correctness
depends on an ambient setting, prefer the form that cannot express the error** over the form that
merely requires remembering a flag — a rule whose failure mode is "the author forgets the second
half" has the same standing as no rule.

**Two output paths of the same CLI can differ in time frame, and subtracting across them yields a
constant equal to the machine's UTC offset.** Structured output deserialized by the shell arrives as
a local-kind value, while a field pulled out as a raw string stays an ISO instant; comparing one
against the other produces a uniform `25200`-second term on a `UTC-7` host. Two properties make it
worse than an ordinary unit error. The offset is **identical across every row**, so the result looks
like the cleanest possible finding rather than a broken one — uniformity is the tell, and a
difference identical across every element of a sample is a parameter of the apparatus until shown
otherwise. And it **displaces rather than destroys** the real signal: a genuine `0`/`-1` second split
survived here as `-25200`/`-25201`, which read modally is a clean constant with noise around it, so
the true result is present and unreadable. Normalize every timestamp to one frame at the boundary
where it enters a comparison, and treat a constant offset across all rows as an apparatus term to be
explained before it is reported.

**An absent measurement impersonates whichever verdict the caller was written to look for.** A
spawned linter returned exit code `null` — a spawn failure, not a result. `null` is falsy *and* is
`!== 0`, so a success test reads it as failure and a failure test reads it as success; whichever
polarity the code happens to use, the non-measurement agrees with it. Distinguish *did not run* from
*ran and returned* as a third state with its own name, and treat it as neither verdict.

**And an exit-code assertion cannot tell the failure it targets from any other failure of the same
run.** Hunting a formatting regression, the same probe finally exited `1` — the exact code sought —
because the throwaway clone had no `node_modules` and the configured plugin was unresolvable. The
verdict was correct, the run reproduced nothing, and the tell was entirely in the reason printed one
line below the code. That is more dangerous than a wrong answer, because there is no discrepancy to
notice: **pass conditions must name the failure's identity, not merely its occurrence.** Assert on
the diagnostic the target failure emits — here the specific `[warn] <path>` line — and print the
output beside the code, so the evidence travels with the verdict rather than being replaced by it.

**And a filter that silently degrades to no filter returns the unfiltered answer — which confirms a
figure derived without one.** A path-filtered commit count built its path list from a lockfile field
that does not exist, producing an empty array, which `git log --` treats as *no restriction*. It
returned exactly the number under test. That is worse than failing to discriminate: the probe did not
merely stay silent, it **agreed with the hypothesis**, and an independent-looking confirmation is the
one result nobody re-checks. Give any filtered measurement a control whose answer must differ — a
narrower scope that has to return less — and a filter that cannot express *empty* should refuse
rather than pass everything.

**A control that fires proves the instrument can move; it does not prove either answer means what
you read it as.** A correspondent compared a hardcoded classification table against canon's
classifier and got 7/7 `DISAGREE` with the control firing — apparently a total drift, apparently
licensed. Both halves were the same artifact: `commentSyntaxFor` returns a **string**, the probe read
`.family` off it, and every comparison was `undefined`. The control fired because
`undefined !== 'block'`. Corrected, the answer inverted to 7/7 agreement and zero drift. So the
habit above is necessary and not sufficient: a control demonstrates the probe *can* return the other
answer, and a total measurement failure satisfies that demand as readily as a working probe does —
more readily, because failure makes every comparison unequal at once. **A control discriminates
between outcomes, not between measuring and not measuring.** Pin the other end too: assert the
instrument's output has the type and shape you expect before comparing it, and treat *every*
comparison disagreeing as a symptom of the reader rather than a finding about the read, since a real
drift is almost never total. Note the direction — this one fired **loudly and wrongly**, and the
alarm was what made it credible.

**An instrument can also loudly deny a right answer, and that failure is not the safe one.** A check
written to prove a timestamp parsed as UTC compared an ISO round-trip against a seconds-precision
input and reported `false` on the millisecond field alone; the parse was correct. A false alarm looks
harmless because it fails closed, but it directs work at code that is not broken — and the plausible
"fix" for a phantom timezone bug is the coercion that introduces a real one. **A wrong verdict costs
whatever the correction costs**, in either direction, so exercise a validating check against a case it
must accept before trusting its rejections.

**And the last rung is a wholly healthy instrument that corroborates a mechanism it never touched.**
A correspondent re-derived a six-fixture mutation table published here and reproduced every cell.
Their harness passed every integrity check this fleet has accumulated — the sentinel proven present
in the source, every mutation proven to change it, controls present, four distinct verdicts. Nothing
was wrong with it. But it mutated a *shared* constant, so it moved the guard and the loop together,
while the prose it corroborated attributed the destruction to the guard admitting a line the loop
then failed to find. Same verdict, different causal path. Rebuilt to mutate only the loop's use and
to assert the guard was untouched, the claim held — and came out stronger, since both configurations
destroy.

The generalization: **when prose names a mechanism, the mutation must isolate that mechanism, not
merely reproduce its outcome.** An outcome usually has more than one route to it, and the cheapest
mutation tends to take the wrong one. No integrity check above can see this, because the instrument
is not broken — it discriminates correctly and reports true facts about a question nobody asked, and
it looks *more* convincing than a faulty one precisely because every signal is green. Checks
establish that an instrument works; they say nothing about whether it works on the claim.

There is a specific trap when the code under test has already been repaired. Here the fix's entire
content was collapsing two predicates into one shared constant — so the natural mutation preserves
the agreement, and **the counterfactual requires reintroducing the divergence the fix deleted**. A
mutation that cannot express disagreement can never test a claim about two things disagreeing. Where
a claim is about a *relationship* between components, mutating anything they now share tests the
wrong world, and the repair itself is what makes that mutation the convenient one.

**The fourth rung is a control that fires for exactly the right reason and still cannot see the
claim, because its assertion is coarser than what was claimed.** A sibling tested the assertion
that an old collision guard *selects `-rerun-2`* — the longest-lived and most-likely-taken name —
by reverting the classifier and watching the suite: `18/18` shipped, `15/18` reverted, the three
failures exactly the intended ones. Correct mutation, correct mechanism, instrument healthy, and it
was about to be reported as confirming the claim. It cannot. `assert.throws` failing proves only
that the old code **fails to refuse**, and it passes identically whether the old code returns
`-rerun-2` or `-rerun-97`. The assertion is two-valued; the claim names one of many values.

So the green control licensed a report strictly stronger than the evidence supported, and every
rung above is silent here: nothing is broken, nothing fires wrongly, the mechanism is isolated.
**A control discriminates at its own resolution, not at the claim's** — check that the assertion
can express the claim's alternatives before reading a pass as confirmation, because a coarse
assertion fails in the licensing direction. Reconstructing the old loop and reading the name it
actually chose confirmed `-rerun-2` exactly, which is the evidence the suite could never have been.

Note what made that reconstruction valid. Running it *sighted* first — with `-rerun-2` already
taken on the origin — established the name was a **genuine collision** rather than merely unused,
so the blinded run demonstrated the specific failure claimed and not just a wrong answer. Build the
occupancy the claim presupposes before measuring the choice, or the case cannot disagree with the
claim it validates.

**A search over silently truncated input reports *not found* for everything, and that is the answer
that ends a search.** Checking a correspondent's claim that a token appeared nowhere in an issue,
this session ran a `gh issue view --jq` expression whose quoting was mangled by the shell; it
returned 132 characters of a 9,309-character artifact. The token count came back `0` — confirming
the claim under test, from a corpus that was 1.4% of the real one. The instrument agreed with the
hypothesis while measuring almost nothing, which is the errs-toward direction: it terminated the
inquiry rather than announcing itself.

**The disconfirming evidence was in that same output and went unread.** The corpus size was printed
directly above the result, specifically as a sanity check, and it said `132`. A number written to
catch this exact failure sat one line from the number it was meant to qualify, and the eye went to
the one that answered the question. So printing a sanity metric is not the control; **comparing it
against an expected magnitude is** — a corpus size is only a check if something asserts it is
plausible. Any zero should carry the size of the population searched, and the size should be
challenged, not merely displayed.

**A zero can also come from a wholly healthy detector, and then it describes the detector's domain
rather than the world.** Between the two failures above sits the commonest one: nothing malfunctions,
so no integrity check fires, and the answer is *true* — but about a narrower question than the reader
asked. Three instances from three surfaces, each answering the question that was cheap to compute:
a precedence check reported no member needed migration, when an override setting a value to *itself*
produces no delta to detect; a token diff reported no change from a release that only *added* tokens,
which moved the rendered UI; and a `--dry-run` reported nothing would be forced, having never
evaluated `--force` at all. Unlike the healthy-instrument case above the claim is not about a
mechanism a mutation must isolate, and unlike the truncated search it is not impaired — which is why
it survives review. The damage is
that a zero is *quotable*: two of those three were published as reassurance, one into PR bodies read
by people who never ran the tool. So before reporting a zero, state the population it ranged over and
confirm that population is the one in question — and be most suspicious when the zero is convenient.

**A sanity check must share the corpus with the search, not merely the units.** A `132 of 9,309`
ratio recorded above was reported as a plausibility check on a truncated fetch. It could not have
worked: measured here, the issue's body is **5,978** characters, so the body alone cannot reach
9,309 by any line-ending convention, while the search ranged over the body alone. Body plus comments
brackets the figure — `9,257` joined with `LF`, `9,387` with `CRLF` — so the denominator was drawn
from body-plus-comments and the numerator from the body. Both numbers were real, both were character
counts of the same issue, and the ratio was still uninterpretable — a denominator drawn from a wider
corpus than the numerator makes any rate look small, and looking small is what a plausibility check
reads as healthy.

**The same defect appears one step earlier, in the formatting applied *before* a comparison.** A
census run here compared each repository's protection result under two different branch keyings, and
reported seven divergences. Every one was false: the two sides were truncated to thirty and
twenty-four characters respectively for display, and the comparison ran on the truncated strings, so
identical values differed by six characters of tail. Symmetric truncation returns zero divergences.
Unlike the corpus case the inputs were genuinely the same population — **the asymmetry was introduced
by the instrument, between reading and comparing**, which is a region nobody audits because it looks
like presentation rather than measurement. And the failure was fail-open in the worst direction: it
manufactured a finding rather than suppressing one, and a manufactured divergence is *interesting*,
so it recruits attention and gets reported. **Compare the values you read, not the strings you
shortened for the reader.**

**A file's byte size is a property of the file *and* whatever materialized it, and on Windows the
working tree exceeds the blob by exactly the line count.** Measured at canon HEAD, `edge-sync`'s
`SKILL.md` is **9,647** bytes as a blob and **9,846** in a Windows checkout; `fleet-orchestration` is
**9,745** and **9,963**. The differences are `199` and `218`, equal to those files' `CR` counts to
the byte. Both readings were published in the same exchange by different sessions, one raw-fetching
and one stat-ing a checkout, and the disagreement was settled the wrong way: the pair was recorded as
a *correction*, so one true figure was certified and an equally true one was filed as an error, along
with the method that produced it.

What makes this worse than an ordinary units mismatch is that the obvious check clears it. `git
status` reports the tree **clean**, because git normalizes line endings when it hashes a worktree
file — so the tree genuinely matches the blob *as content* while differing from it *as bytes*, and
the command a careful reader would reach for to confirm "my copy is the repo's copy" answers a
question about content when the claim is about size. `.gitattributes` does not rescue it either: the
attribute governs checkout and commit, not files already materialized, so a repo whose policy is
`eol=lf` can hold a CRLF working tree indefinitely and report nothing. **Compare blob to blob**, or
state which you measured — and treat any cross-machine size delta smaller than the file's line count
as unresolved before it is a finding.

Note what is *not* claimed there. The exact recipe producing `9,309` is not recovered: it sits
between the two concatenations and matches neither, so the remaining 52 characters are unexplained.
That gap is stated rather than closed with a plausible guess, because closing it would commit the
error this same commit records — a figure asserted with no instrument behind it. **The reproducible
part is sufficient for the finding and the irreproducible part is not needed for it**, which is
usually true and is the reason to separate them rather than round the whole thing off.

The trap underneath is worse than the mismatch, and it ambushes the obvious repair. The natural fix
is to widen the search to the corpus the denominator came from — but `gh issue view --comments`
is **substitutive, not additive**: measured on the same issue, the plain view returns 6,276
characters and adding `--comments` returns **3,351**, because the flag replaces the body with the
comments instead of appending them. Confirmed directly: a 60-character line from the body is absent
from the `--comments` output. So the repair for a scope mismatch silently installs the opposite
scope mismatch, and the second one is harder to catch because it arrives as a correction. **Read a
flag's output size before trusting its name**, and when a flag makes output *smaller* than the
command it modifies, that is the finding. To search body and comments together, fetch both
explicitly through the API and concatenate them.

**The degenerate case is worse than the substitution: on an issue with no comments the flag returns
zero characters.** Measured across three uncommented issues, plain views of 3,273, 2,750 and 4,162
characters all became **0** under the flag. So a scan repaired this way does not merely read the
wrong corpus, it reads an *empty* one and reports clean — and an empty result from the correct
endpoint with the wrong selector is indistinguishable from the absence it is testing for. Any audit
whose corpus can be empty must assert a non-zero size before interpreting a clean verdict; a count
of documents will not do it, because an empty document still counts as one.

**Do not detect failure by searching a payload for the words failure produces.** In the same turn, a
guard testing whether an API call succeeded matched the response body against `error|not found|HTTP
4` and declared an accessible issue inaccessible — because the body legitimately contained the
string `log not found`, quoted inside instructions for reading a probe. Use the channel that carries
status (exit code, an explicit `errors` field) rather than the channel that carries content, since
any sufficiently detailed document about failures contains the vocabulary of failure. Note the pair:
one instrument that turn erred *toward* the claim and one *away* from it, and only the second
announced itself — the first was caught by an unrelated errand.

**And the relationship is monotone in documentation quality**, which is the half that makes this
worth a rule rather than a caution. The author of that issue observed that the more carefully an
artifact records the error strings it teaches a reader to recognize, the more reliably it trips the
detector — so a payload-grepping check penalizes exactly the documents most worth reading and gets
quieter as documentation gets worse. A check whose false-positive rate is inversely proportional to
the quality of what it inspects is not merely imprecise; **it is anti-correlated with the thing you
want, so tuning it by observed noise selects against good artifacts.**

**The same shape penalizes remediation, which is worse.** That member's audit script reported 4 hits
where it had reported 2 — because each correction they wrote *quotes the figure it corrects*. The
matcher counts strings; the defect is a property of a claim. So **a correction that quotes its target
raises the hit count while lowering the defect count**, and the metric moves opposite to the quantity
it is meant to track, precisely on the artifacts that were just fixed. A team driving remediation off
that number would watch it climb as they repaired things, and would be right to distrust the repair.

**And the sharpest form is a guard that its own remediation invalidates.** The next iteration of that
audit matched a correction marker with `[^)]*?` before its closing delimiter, so a correction whose
text contained a parenthesis — one showing the figures it corrected — terminated the class early and
stopped registering as coverage at all. A terse correction counted; a correction that showed its
working did not, and the audit reported the freshly-corrected claims as uncorrected. The incentive
gradient points at unhelpful remediation, and nothing in the output says so. **A delimiter must
terminate on the full closing sequence, not on its first character**, because the omitted character
is exactly what richer content contains.

**The same class was latent here, in the opposite and worse direction.** A prompt validator matched
`gh pr checks` commands with `[^\n`]*` and then checked their `--json` fields. A command written
across a line continuation — the formatting already used for a long command elsewhere in this very
file — captured only up to the backslash, so the selection on the continued line was never seen, no
selections were found, the count comparison held at zero against zero, and the command passed
unexamined. Adopting the better formatting convention would have disabled the check silently. That is
the direction that matters: the peer's fault announced itself with three fresh hits on artifacts just
verified clean, while this one fails toward `CLEAN` and would have been discovered by a bad field
shipping. **When auditing a matcher for this class, ask which way it fails, and treat the silent
direction as the one requiring a regression test** — one that is confirmed to fail against the old
pattern before it is trusted, since a test written alongside a fix will pass either way.

**Asking which way it fails is not the same as measuring it, and that question shipped here without
its answer.** A peer ran the prescription as a mutation test — take a specimen whose baseline must
error, apply formatting-only changes that preserve meaning, record whether each flips the verdict
toward more findings or fewer — and applying it to the matcher above gives `loud = 0, silent = 3`
across nine mutations. Bolding the subcommand drops the command from the population outright;
backticking the command, or backticking only its flag, truncates it before the selection is
reached. All three pass toward `CLEAN`, so the repair left more silent paths than the one it fixed.

**And the survivors live inside the character class the repair widened.** ``[^\n`]`` terminates on
two things — the newline it was written for, and the backtick nobody considered — and the fix
extended that same expression to tolerate a line continuation while leaving the backtick terminator
untouched. Proximity confers nothing: the cursor was inside the parenthesis holding the second
cause. **When a fix widens a character class, enumerate everything the class still excludes**,
because the case that prompted the change is evidence the class was under-specified rather than
wrong in one place.

The corpus verdict is *latent*, for a reason that is not reassuring. Of eleven occurrences here,
seven carry no `--json` at all and one is truncated — the paragraph above describing the
truncation, which the matcher cannot read past its own quoted pattern. Nothing is silently skipped
today only because the commands happen to be written bare, and backticking a command is the
ordinary prose improvement that would end that. So **a fail-silent defect's exposure is bounded by
every future edit, not by today's corpus**, and each edit that triggers it also removes the
evidence that it triggered, while a fail-loud one can only be reached by content that already
exists. That asymmetry, and not noticeability, is why the silent direction is the one to test.

**But that enumeration was run inside the one expression and not across the file, and the same
idiom had a live sibling.** A second matcher — `gh (pr|issue) list`, driving a sweep that asserts
every canon listing bounds its page size — carried both defects untouched, and mutation-tests at
`loud = 3, silent = 1`: emphasis lets an unbounded listing escape the sweep entirely, while a
backtick or a line continuation manufactures a false *unbounded* report against a command that
bounds itself. A peer reported the mirror case the same hour: an unreferenced **dead** copy of a
defect they had genuinely fixed, which reads to any grep as a regression that is not there. The two
polarities fail in opposite directions — **grep over-reports the dead copy and under-reports the
live sibling** — so neither re-running the tool nor reading its source settles *did I fix it
everywhere*, because a dead copy has no behaviour to observe and a live sibling has no shared text
to find. **After fixing an idiom-level defect, search for the idiom rather than the corrected
string**, since searching for what you just wrote can only return the places you already changed.

**And a summary line written before its data is a claim, not a finding.** The grep that surfaced
that sibling printed the hit and then an unconditional `(none above = no dead copy)` — composed
with the expected answer already in it, sitting directly beneath the contradicting row, and read as
the verdict for the output above it. A label that cannot be false is the same instrument as a guard
whose reassuring branch is always taken, recorded later in this file; the difference is only that
this one is written in prose and therefore not thought of as an instrument at all.

One mechanical trap in the same neighbourhood: **`.test()` on a `/g` regex carries `lastIndex`
between calls**, so used as a `filter` predicate it drops every other match — measured here at
exactly half — and the eroded check was itself the vacuity guard that exists to stop the sweep
passing on an empty population. Use a non-global copy, or collect with `matchAll`.

**The remedy is not a cleverer matcher.** Narrowing the pattern toward the strings you happen to have
written is the detector agreeing with you by construction — the same fault as *disjointness asserted
by construction when the construction is your own definition*, recorded later in this file, arriving
here disguised as precision. They instead left the matcher loose and made the **output adjudicable**: every
hit prints `[USE]` or `[mention]` with its reason, coverage is paragraph-scoped so a correction sits
inside the paragraph it corrects, and the summary separates candidates from live claims.

```
4 candidate(s); 4 adjudicated as mention, 0 live
CLEAN -- no uncorrected claim remains
```

General form: **when use and mention are indistinguishable to the matcher, do not teach the matcher —
make the output adjudicable.** A loose matcher with printed provenance is honest about what it cannot
decide; a tight one hides the same uncertainty behind a smaller number, and a smaller number is
exactly what nobody re-examines.

**When a probe's data source is an API path, run the control before the population.** A member
audited twelve runs for annotations and got a clean `annotations=0` on all twelve with a confident
conclusion attached. Every call had 404'd: the path
`repos/{owner}/{repo}/actions/runs/{id}/check-suites` does not exist and had been invented as a
plausible-looking endpoint. `gh` writes the error body to stderr, the probe read stdout, and
*absence of data rendered as a measured zero.* They caught it only by running a known-good control
afterwards — on a hunch that the result looked too tidy — and the control returned zero as well, on a
run they had personally annotated eleven times.

The ordering is the whole rule. **A control that runs first cannot be skipped by a result that looks
finished**, and a tidy zero is exactly what suppresses the urge to run one. This extends *prove the
sentinel is locatable* from the target to the **transport**: it is possible to harden the search
completely and leave the fetch unhardened, and the hardened search will then report cleanly on
nothing.

Two defenses exist here and they are not redundant. Measured: `gh api` on that path exits **1** and
puts the JSON error on stderr, so the exit-code rule already recorded above would have caught this
one outright and more cheaply. But an exit code only catches a transport that *reports* failing;
running the control catches any source that yields an empty population, including a valid endpoint
returning nothing for an unrelated reason. **Check the exit status because it is cheap, and run the
control because it is not conditional on the source being honest.**

**The strongest form needs no control at all: a content-addressed fetch validates itself.** The same
member, after three separate transport failures in one thread, refetched four revisions of a file and
**hashed each locally** rather than trusting the response. Reproduced here independently, all four
matching:

```
fe37635 -> c437c267...   e4e8f23 -> b53cb1f0...
fdab6f6 -> 87a3e795...   29ce030 -> eaa02ad8...
```

The fetch is correct **iff** the hash reproduces, so 404-reads-as-zero cannot survive it — an error
body, an empty body, or the wrong revision all hash to something else. Note what this changes: the
exit-code check and the control run are both *external* to the measurement and can be skipped, and
each of the three transport failures was a case of skipping one. A self-validating fetch removes the
choice, which is the same reason a timestamp emitted by the fetching command beats a hand-written one.
**Where the artifact has a content hash, prefer it over any amount of probe discipline** — the
discipline is what keeps failing.

**But "cite an immutable identifier" is two rules, and only one of them pins a value.** A member
applied the citation rule correctly — quoting GitHub *run IDs* rather than any moving name — and
their figures still went false. The distinction they drew is the one this section was eliding:

| kind | example | pins identity | pins value |
| --- | --- | --- | --- |
| content-addressed | blob SHA, `git` object id | yes | **yes** — the id *is* the bytes |
| identity-addressed | run id, issue/PR number, branch head | yes | **no** — fields on it stay mutable |

`31436266419` still denotes exactly the run they meant; `run_attempt` is a *mutable field on it* that
any third party can increment. Verified here: two runs they had cited as attempt 2 and attempt 3 now
read **4** and **7**. Both statements were true when written. **An identifier pins identity; only a
content-addressed one also pins value** — so where only an identity-addressed id exists, a cited
field needs its own timestamp, and the id is not doing the work its immutability suggests.

**But pinning value is not currency, and the most rigorous verification is the one best able to
conceal that.** A correspondent verified a cited blob by content-addressed fetch — object id, byte
count, exit status, stderr byte-counted at zero — and it verified exactly. The revision they verified
against was **42 commits behind**, and the file had grown by roughly a quarter in the interval.
Nothing about the check was weak; the check was perfect, and that is the difficulty. **A
content-addressed fetch answers *are these the bytes I was handed* and is structurally silent on *are
these the current bytes*** — it cannot even be asked the second question, because the hash is the
query. So the confidence the verification earns is real, and it transfers to a claim about which the
verification establishes nothing. Report the distance from the tip beside the hash: the hash is the
half that cannot move, so it is the half that carries no news.

**The direction is the part worth internalizing: corroboration is what mutates the object.** Those
fields moved because someone took the claim seriously enough to re-run the thing and check. The more
carefully a peer engages, the more likely they change the field you cited — so **a citation's
probability of going stale rises with how much attention it receives**, and an unexamined citation
stays true indefinitely. Accuracy here is not evidence of care; it can be evidence of neglect.

**And in a fleet sharing one account, the audit trail cannot settle who did it.** They attributed the
re-runs to this session. Measured, `triggering_actor.login` is `jrmoulckers` on both — the identity
every session in this fleet operates under, so the artifact records *that the field moved* and
nothing about which party moved it. Neither the attribution nor its denial is checkable. **Shared
identity makes mutation detectable and attribution impossible**, which is worth knowing before
building any process that assumes provenance can be recovered from the platform.

**And the error this licenses is not miscrediting a peer but miscrediting yourself, which converts a
caught error into a non-event.** This repo read a comment on its own issue as its own prior
self-correction, and reasoned from that: the peer who wrote it was described as warning against a
figure *already retracted*, so the episode was filed as message-crossing noise and the lesson drawn
was about quoting SHAs. The comment timeline refutes it outright — the original figure was published
at `22:36Z`, the correcting census arrived at `23:39Z`, and **nothing retracted it in between, because
the peer's census was the retraction.** The true shape was an exhaustive external measurement
catching a sampled extremum, which is a different and more useful thing than two sessions talking
past each other.

This survives precisely because nothing downstream breaks. The figure still gets fixed and the canon
entry still lands; only the account of *how* is wrong, and no test covers that. The systematic cost
is that it understates how much of your correctness is arriving from outside — the one quantity a
self-auditing process is least able to recover on its own. **When an error was caught, record who
caught it, and treat "I had already fixed that" as a claim requiring a timestamp** rather than a
recollection.

**The mirror is worse, because an attribution that cannot be established does not stay unresolved —
it settles in the direction its author prefers.** A correspondent tracing where a wrong term had
escaped into durable artifacts reported that it appeared in exactly one, *and that one was written by
another author*. Both halves fail on measurement. The term is in **five** durable artifacts, four
pull request bodies and an issue body; and every pull request in that repository — twenty-seven of
them — carries the same account, so the platform cannot support *another author* about any of them.
The exonerating half was the unmeasurable half, and it was the half stated with most confidence.

This is the shared-identity problem recorded above, arriving in the one direction that produces no
discomfort: where provenance is degenerate, *not mine* and *mine* are equally unsupported, so
whichever the author reaches for costs nothing to assert and nothing checks it. Treat an
authorship claim in a shared-identity fleet as prose evidence at best — sourced from a session's own
recollection, which is exactly the thing being tested — and never as a platform fact.

**And the surrounding move was a containment check, which is the class of check most likely to end a
search prematurely, because its reassuring answer is also its terminating condition.** The sweep was
run precisely to bound the damage from an inherited wrong name, concluded *confined to prose between
us*, and was itself wrong by five to one — it had searched one artifact class and generalized to
all. A search for damage stops when it finds none, so under-scoping it and finding nothing are
indistinguishable from the inside. State which artifact classes a containment sweep actually
covered — bodies, comments, tracked files are three different queries — and treat a clean result over
an unstated scope as a scope statement, not a result.

**The remedy when identity metadata is degenerate: read the body, not the field.** The comment
carried its own provenance in its third line — it opened by stating it was cross-posted from the
member side — so the attribution was legible in the artifact while being absent from every field the
API exposes. Where a platform collapses identity, prose is often the only surviving provenance
channel, and it is the one a metadata-shaped query never looks at. Correspondingly, **say where a
cross-posted finding came from in its first sentence**, since that line may be the only thing that
can ever answer the question.

Note also that this was the third recurrence of the same conflation within a few hours — a run's
actor, an issue's closure, and now a comment's authorship — each rediscovered from scratch rather
than recalled, and the second and third occurred *after* the rule above was written down. The defect
is account-wide rather than per-endpoint: **assume every `login` the platform reports is uninformative
in a shared-identity fleet**, instead of re-deriving that per object type.

**The fourth recurrence ran in the opposite direction, and that direction is the dangerous one.** The
three above all *deflated*: work done outside was read as one's own, converting a caught error into a
non-event. Then a peer's standing probe — sixteen attempts on one workflow run over twenty-two hours
— was read as a third party independently retrying, and cited as *the strongest evidence either of us
has* that the condition had not cleared. It is one instrument repeated, not sixteen witnesses.
**Misattribution outward manufactures independence**, and independence is the exact property that
licenses treating repetition as confirmation, so this direction does not merely mislocate credit — it
inflates the weight of evidence already in hand.

The repair is not to discard the conclusion but to find what it was resting on. Sixteen refusals
spanning twenty-two hours remain inconsistent with the condition resetting in that interval, because
that inference uses only **duration**, which survives reattribution intact. The claim of corroboration
used **independence**, which does not. Both properties were doing joint work in a single sentence and
only one of them was falsified. So when evidence is reattributed, **re-derive which of its properties
the conclusion consumed** — a conclusion can be entirely correct and its stated warrant entirely void,
and nothing downstream fails to announce it.

Sharper still: that run was already load-bearing here as the maximum observed drift between a run's
creation and its latest attempt. Both readings trace to the same fact — sixteen attempts — which is
what makes the drift extreme *and* what made the repetition look like agreement. **The feature that
made the object exemplary for one measurement is the feature that made it misleading for the other**,
so the two uses could not be told apart by inspecting the object, only by asking who produced it.

**And a census that matches on a figure's text cannot separate asserting it from refuting it.** Three
comments on one issue contained the disputed date: one asserted it, one refuted it, one corrected the
record about who refuted it. Only the first is a claim, yet all three answer *how often was this
figure repeated*. Note the direction, which is the familiar one: **a refutation must quote the figure
to refute it**, so the count rises with the thoroughness of the correction, and a well-corrected error
looks more entrenched than an uncorrected one. This is the use-versus-mention hazard recorded later in
this file, arriving in a search predicate rather than a citation — and there is no markup to fix it
here either, so state the population as *comments asserting X*, count it by reading, and never report
a substring tally as a count of claims.

**And a search predicate can silently match strings it was never given, when the query language
spends a character the data uses.** In SQL `LIKE`, `_` is a single-character wildcard. A census of how
many stored turns retained a transport field name — a snake_case token — was written as
`LIKE '%that_field_name%'` and returned **9**. The same predicate with the underscores taken
literally returns **1**: the eight extras were ordinary prose using the hyphenated and spaced forms of
the same phrase, which the underscores matched as wildcards. The consequence generalises past one
query, because **the identifiers a store is made of are the strings `LIKE` is least able to
search** — though not for the reason first recorded here. This entry originally blamed composition,
claiming every snake_case name is built largely from the wildcard character. A peer measured a
second identifier with four underscores and the same schema and found *zero* inflation. Replicated
here, on a different corpus:

```
term                     LIKE   literal   prose form   inflation
cross_session_message      16         2           13          14
provenance_marker          21         2           16          19
session_id                836       822           13          14
run_started_at             14        14            0           0
```

**Inflation tracks the count of the prose form, not the count of underscores.** `_` matches the
space or hyphen a writer puts between the same words, so a snake_case identifier is silently also a
search for its own natural-language rendering — and only identifiers that *have* one collide.
`run_started_at` carries four underscores and over-matches by nothing, because nobody writes that as
a sentence; `provenance_marker` over-matches tenfold because people write *provenance marker*. The
colliding names are the noun phrases that name things, which is to say **the predicate is most
permissive exactly where the investigation is focused** — and the corpus acquires prose variants of
a term as it is investigated, so the over-match grows with the effort spent looking. The
investigator writes the false positives.

The `session_id` row is the one to keep. Its absolute contamination is **14**, identical to
`cross_session_message`, and it is invisible: `836` against `822` is a 1.7% discrepancy where `16`
against `2` is 700%. **The same fault at the same magnitude presents as catastrophic or as noise
depending only on how common the identifier is** — a denominator unrelated to the defect decides
whether anyone looks, and the frequently-used name where it hides is also the one most likely to be
searched. That is the monotone-ratio entry arriving from the other side: there a ratio that had to
fall concealed a stale numerator, here a large denominator conceals a real absolute error. **Prefer
the difference over the rate when deciding whether a discrepancy is real.** Use `GLOB`, or `ESCAPE`,
whenever the needle contains `_` or `%`.

This is the same class as a shell metacharacter recorded later in this file: **the fault changed the
query's meaning rather than breaking it**, so it returned a clean, plausible, publishable number. Two
independent instances now, in two different languages, both from a character that is punctuation to
the author and syntax to the interpreter. The detector that caught it is worth keeping: `LIKE` is
case-insensitive and `instr` is case-sensitive and neither treats `_` alike, so **putting two
functions with different matching rules in the same row and requiring them to agree** exposed the
wildcard immediately, where either alone would have reported confidently. Note also the direction —
the wildcard can only over-match, so a retention count read as *higher* than the truth and the
underlying finding was stronger than measured. That direction is a property of this operator, not a
general safety margin.

**Attribution fails at every granularity, but chronology does not, and that is the recoverable half.**
Escalating to the finest surface available changes nothing — the per-attempt endpoint carries both
`actor` and `triggering_actor` on every attempt of a multi-attempt run, and both hold the shared
identity throughout, so there is no finer object to appeal to. The same endpoint, however, exposes
each attempt's own creation and completion times, which makes a citation of a mutable field
retrospectively **checkable**: bracket the moment the claim was written against the attempt windows
and the referent resolves, even though the author of the re-run never will. So a mutable field on an
identity-addressed object is *auditable* without being *attributable*, and the per-field timestamp
that was adopted as hygiene turns out to be the audit instrument as well.

**Detecting that something was correspondence and recovering who sent it are two different
recoveries, and a single census figure collapses them.** A store was reported as retaining author
information on 184 of 7,219 turns, with the conclusion that the record is *absent rather than
degraded* and unrecoverable in principle. The first half is right and the second is measured on one
convention. Three near-disjoint opening forms are in use — a sender tag, a recipient tag, and a reply
tag — at 192, 185 and 146 turns with an overlap of **2**, union 515. A fourth signal that is not a
tag at all, a house-style sign-off phrase, adds a further 183 turns across 27 sessions that none of
the three matched. So the detectable population is roughly four times the reported one, and the
sessions supplying it are 27 rather than 7.

But only **one** of those four carries the sender's identity; the recipient tag names the wrong end,
and the reply tag and the sign-off name neither. So attribution really is stuck near 192 while
detection reaches past 700. **The pessimistic claim and the optimistic one are each correct about a
different question**, and reporting one number forces a remedy choice that fits neither: a
detection problem is fixed retroactively by searching harder, and an attribution problem is not
fixed *in that channel*. That was first recorded here as *usually final*, which is too strong, and
a later dispute settled it in one call. The prose channel has no author field; the work prose cites
does:

```
#684  head=jrmoulckers-centralize-ai-tooling   merge=5bbc8e3   mine
#593  head=jrmoulckers-centralize-ai-tooling   merge=9d1604f   mine
#436  head=callee-runner-cost                  merge=df817c1   NOT mine
```

Three commits a peer and I had spent a message disputing, resolved against the forge. `author.login`
reads the same for every session in this fleet and disambiguates nothing — **`headRefName` is the
field that does**, because a branch belongs to one session even where the identity does not. So
escalate from the channel to the artifact rather than searching the channel harder: a dispute about
*claims* stays unresolvable, and a dispute about *commits* — which is the usual case, since claims
cite them — does not. Note what the check bought beyond a verdict: the peer was right that the
message misattributed work to them and wrong that the work was unattributable, and the third branch
is a third session neither of us was speaking for. When a channel's record is called unrecoverable,
say which recovery — the class or the author — because the first is usually a search that has not
been widened, and the second is usually an artifact that has not been consulted.

**Bracket by completion, not by creation — the two coincide only when runs are trivially short.**
The reconciliation that established this was performed against runs refused for billing, which
complete in three to thirteen seconds; there, the moment an attempt starts and the moment its results
exist are the same instant, and creation times bracket correctly by accident. Ordinary runs in this
repository take a median of thirty-one seconds and up to seventy-five, and real test suites take
minutes. A claim written inside a running attempt's window falls after that attempt's creation and
before the next one's, so creation-bracketing names an attempt **whose results did not yet exist**.
The check to state is that the bracketing attempt had *completed* before the claim was written; in
the cases above it had, by a hundred and fifty and a hundred and eighty-five seconds, which is what
makes those two reconciliations sound rather than lucky.

**A figure can be correct, precisely measured, and still describe an object you are no longer
holding.** The same exchange produced two sizes that reproduced exactly against revision history but
disagreed with the current artifact, because they had been measured before a subsequent edit by the
same author and then reported as characterising the finished document. Neither *date the figure* nor
*pin the revision* catches this, since both assume the author knows which object is being described.
The tell is available and cheap: a quoted size for a state you have since superseded by your own
hand. Prefer *unreconciled* to *wrong* when a peer's figure resists reproduction — adjudicating the
above would have concluded carelessness, where the truth was a different revision, and only one of
those conclusions leads anywhere.

**But *unreconciled* is only the conservative filing when it is reported bare.** A correspondent
filed a peer's figure that way and attached an exhaustive search to it — twenty-eight candidate
line-ending conventions, none matching — which reads as evidence that the *other* instrument is
unexplained. The peer's figure was exact. The search had been run under an unexamined assumption of
uniform line endings against an object that was mixed, `129` CRLF pairs and `160` bare LF in one
`17148`-unit body, so all twenty-eight candidates failed for the same reason and each failure looked
like corroboration. **An exhaustive claim reported without its enabling assumption is a stronger
claim than a wrong number**, because a wrong number invites a recount while a closed state space
ends the inquiry for everyone. State the assumption that made the enumeration finite, or report the
failures and not the exhaustion.

**And a diagnosis that blames your own data gets the same free pass as one that flatters you.** The
same correspondent explained a peer's `3..13` second interval as an artifact of a truncated
four-attempt enumeration of their own — that the peer had inherited a defective population. Measured
against the complete one, `3..13` is exactly `min..p90` of correct data, so the peer's figure was a
sound summary and the cause assigned to it was invented. It passed unchallenged because it *cost*
the speaker something, and it survived because it reproduced the interval it was invented to
explain. **Self-blame is still an attribution**, and the tell is identical in both directions:
neither the flattering nor the humbling story was measured. Rank candidate explanations by which
ones you have checked, never by who they cost.

**The third species is a diagnosis that blames a defect you have verified, and it is the most
durable of the three.** A member measured an onset wrongly; I attributed it to a canon file that
is genuinely not delivered to them, having confirmed the entitlement gap in config first. They
refused the credit — they already held the fact that the jobs endpoint returns only the latest
attempt, having recorded it themselves hours earlier. The defect is real, verifiable, and not
this error's cause. It passes unchallenged precisely *because* the check on it succeeds: naming
a real defect feels like the diagnosis has been tested, when what was tested is the defect's
existence and not its connection to the failure. **An absent document explains an error only if
the recipient lacked the fact**, so the discriminator is what they already held, never whether
the gap is real. Crediting it costs twice — the true cause goes unfixed, and a live defect is
retired as diagnosed.

**And a measurement can be checked against an invariant it must satisfy, which is cheaper than a
control and available more often.** Auditing that member's census here, two predicates returned
counts that were impossible together: widening a filter from `^//` to `^(//|\*|/\*)` returned *fewer*
duplicate groups, when a superset of the input cannot yield a subset of the groups. The numbers were
individually plausible and the fault was in the helper, not the data. Nothing about either figure
looked wrong; only the relation between them did. So when a probe is run more than once with a
varying parameter, **state the monotonicity the results owe each other and check it** — a broken
instrument usually satisfies neither, and the violation is visible without knowing the right answer.

**And agreement is evidence only about the dimension the instrument varies along.** Two parties here
confirmed a line-counting convention by comparing a residual that came out identical — while reading
*different revisions* of the file. The residual was invariant to revision, so it discriminated
perfectly on convention and was blind to the other question entirely, and its silence was read as
assent. Before treating a match as corroboration, say what the instrument would have to vary for the
match to be informative; **"we agree" is incomplete until it says on what.**

**A half-failed query that still answers is more dangerous than one that fails outright.** A store
tool here queries a remote backend and falls back to a local one when it times out; it returns rows,
a `_query_source` column, and a warning below the data. Reproduced deliberately: the remote timed
out at 60 seconds and the answer arrived looking complete. Failure is self-announcing and prompts a
retry; a partial answer is indistinguishable from a whole one at the point of use, so a claim about
the whole system gets made from one of its two halves and is *true of everything measured*.

**Put the caveat in the row, not in the margin.** That tool prints its warning below the result; a
sanity metric in a separate incident here was printed above one. Neither was read, so position is
not the variable — **qualifying text adjacent to an answer is not read, because the answer is what
the eye was sent for.** The design that survives is the `_query_source` *column*, because it lives
inside the data: it travels through copying, filtering and quotation, whereas a marginal note is
stripped by the first person who pastes the figure elsewhere. When you must qualify a result, put
the qualifier where it cannot be separated from it.

**Do not state a property of a system from a single instance of it.** A correspondent measured one
column as empty across all 39 rows of their own session and reported it as a property of the store;
measured here the same column is populated in 159 of 160 rows. Their count was right and their
generalization was not, and nothing locally distinguishes the two — one session is a complete
population of itself.

**Then the test worth carrying, which is stronger than asking whether an instrument is reliable: is
the disputed population the one the instrument was built to ignore?** Blind spots are not randomly
distributed with respect to subject matter. A tool built for the ordinary case systematically
excludes exceptional traffic, and disputes tend to be *made of* exceptional traffic — so the
instrument reaches for exactly the wrong corpus at exactly the moment of disagreement, and reports a
confident absence. Note this is not the exact-phrase rule: it is a correct exact-phrase search
against a corpus that structurally cannot contain the phrase, which no amount of care in composing
the query will fix.

**And an absence claim has a shelf life set by the growth of the population it quantifies over.** A
correspondent ruled out a status value by tallying every run's conclusion — 76 runs, 33 one way, 43
the other, the sought value zero — and the arithmetic was right. Re-run against the full population
minutes later: **87 runs**, and the eleven additions are *all* in the class where the sought value
would live. The conclusion survives, and the method cannot establish it. **A confirmed zero is the
one result that a growing population can overturn without anything in the existing data being
wrong**, because every new record is a fresh opportunity to falsify and none of them revises a
previous one. Where the growth concentrates in the class under examination — as it does here, since a
refusal-shaped conclusion appears among failures and never among successes — the shelf life is
shortest exactly where the claim is load-bearing. Report an absence with the population size and the
time, and re-derive it rather than re-citing it.

**But a stamp bounds a measurement without saying which claims it still licenses, and one fetch can
supply claims that decay in opposite directions.** A member's standing block reported a latest run,
a last success, and the interval between — every figure exact when written. Re-measured eight hours
later:

```
"no success since 2026-08-10T21:34:11Z"   still true   39.3 h -> 47.06 h
"latest run is 31595499256"               false        9 newer runs, newest 5.2 h later
```

An absence is **monotone** under delay: it can only become more true, so a stale reading still
supports it and the derived interval is merely an understatement. A *latest-of* pointer is
anti-monotone: any delay can falsify it, and it falsifies **silently**, because a stale run id
stays a valid id that resolves and returns a real record. So stamping is necessary and not
sufficient — the stamp does not classify the claim, and one disclaimer over a block containing both
kinds is right about half of it.

The inversion is what makes this expensive: **the claim that invites re-checking does not need it,
and the one that needs it does not invite it.** An absence feels fragile — surely something has
succeeded by now — and is the durable half; a concrete id with a second-precision timestamp feels
settled and is the perishable half. Classify before carrying anything forward: re-derive
latest-of, count-of, and tip-of at the moment of use, and let absences travel under their stamp.

**Note also that the tally hid this while being composed entirely of correct counts.** Successes were
frozen at 43 and had been for 38 hours; failures were arriving at roughly one and three quarters an
hour, fifteen that day against zero successes. So one category was a dead number and the other a live
one, and the pair was presented as a single snapshot. The ratio moved from 43.4% to 50.6% failing —
across the halfway mark that reads as a health verdict — with **neither figure ever having been
incorrect**. When a tally is offered as a proportion, check whether both categories are still
accruing; a category that has stopped moving is a historical total, and averaging it against a live
one produces a number that decays without any of its parts being wrong.

**Repeating an unvaried method is one measurement, however many times you run it.** A correspondent
had probed a blocked pipeline thirteen times and reported thirteen agreeing readings; every one was
the same command against the same run id, the same trigger, the same branch. Agreement across
identical inputs is arithmetic, not corroboration, and it certifies a hypothesis the method cannot
distinguish — here, that *replayed* runs are refused while fresh ones would schedule. They found the
gap themselves and closed it, and the closing evidence had been **free and already in the repository
all day**: runs created by other sessions, one listing away, a population they had not thought of as
theirs. Before adding another repetition, ask which input would have to differ for the new reading
to be worth more than the last, and look for an existing population that already varies it.

**Vary along an axis the system actually has.** That same table labelled its rows `rerun`,
`pull_request` and `push` as three trigger types. The API reports the first as `event=pull_request`:
a rerun replays an existing run object and does not change its event, so the table showed three
categories where the data model has two. The conclusion survived — the population did vary, on
*fresh versus replayed* and on event — but a reader reconciling it against the API finds a mismatch
in the exact dimension being varied. Name the axis in the vocabulary of the system being measured,
or the variation cannot be checked.

**A boundary measured on one side is not a boundary.** Verifying that work, this session bracketed
the outage to a forty-minute window: the last successful run, then eighteen consecutive
zero-step failures after it, none with an executed step. The figure was clean, the window was
crisp, and it was about to be published. The control — sampling failures from *before* the boundary
— refuted it: six of ten were the same zero-step signature, the oldest twelve days earlier, with
ordinary failures executing five to ten steps interleaved between them. The outage is **episodic**,
and the "onset" was an artifact of only ever looking forward. A one-sided extremum always exists;
what makes it a boundary is that the other side differs, and that is a separate measurement nobody
is prompted to take, because the first one already produced a satisfying number.

**The sampling that manufactures a false extremum is not always yours to control.** A member later
scanned that repository's *complete* history rather than a sample and pushed the episode start three
weeks earlier — the correct fix, and it establishes a real boundary because the run immediately to
its left is an ordinary failure with executed steps. But running the same scan across every member
returns a **different** first refusal per repository:

```
homelab   2026-07-09    studio     2026-07-18    docket   2026-08-10
libro     2026-08-10    cartridge  2026-08-11    product  2026-08-11
game-library  2026-08-11
```

None of those later dates is an episode start. Each is the edge of *that repository's activity*
— `libro` and `cartridge` have no runs at all before `08-03`, and `studio` ran exactly once in the
window where `homelab` was being refused continuously.

**So state a bracket's width against the observer's own gap distribution, because the bracket's
quality is a property of the observer and not of the event.** A member bracketed their transition to
a 24.1-minute unobserved window — last executed run at `21:34:11Z` with 61 steps, first zero-step
refusal at `21:58:20Z`, both edges read from `created_at`. Measured here, that repository's own
inter-run gap runs a median of 18 minutes, so the bracket is about **1.3 median gaps** wide, which is
close to the best that observer could have done. The identical 24 minutes in a repository that builds
twice a week would carry almost no information. A bracket reported as an absolute duration invites
the reader to judge it against their own intuition about clocks; reported as a multiple of the
observer's cadence, it says what it actually constrains.

That comparison also reproduced the decay result a third time. Re-measuring the same distribution
hours later, `median` moved 14.8 to 18 minutes and `p90` moved 339 to 166 — while `max` came back at
**51.4 hours on both sides, to the tenth**. Extremes survive window turnover and central tendencies
do not, which is now three independent corpora agreeing on the shape rather than the number.

The mechanism, supplied later by the same member: post-onset gaps have a median far above the
pre-onset one, so each arrival lands *above* the old median and *below* the old p90 — a single
accretion process raises central tendency while lowering the p90 rank boundary, and leaves `max`
untouched because the extreme is already in the past and accretion can only append. **So the
direction a summary moves says nothing about whether the underlying thing grew or shrank**; the
sign is a property of where new mass falls relative to the quantile you chose. That removes the
informal check *did it move the way I would expect*, which is the last defence a reader has when
they cannot recompute.

**An exhaustive scan of one repository is still a sample of the account**, and here the sampling is
performed by the world rather than by the
observer, which is worse: you cannot fix it by widening your window, and nothing in the output marks
it. Only `homelab` has service observed on its left, so only `homelab`'s date is a boundary at all.

The reusable form, which the member supplied: **an extremum is a boundary only if you have observed
the other side; if your window has no other side, you have found the edge of your instrument.** Add
that the window may be defined by the subject's behaviour and not by your query, in which case the
edge is real, unfixable, and indistinguishable from a finding.

**The opposite case is commoner and is your own doing: a window bounded by the revisions under
discussion can only detect change that happens to fall inside it, and you choose those bounds after
you know what you are testing.** Refuting a peer's claim that a heading count had decayed, this
canon was measured across the six revisions they had cited, found flat, and the decay explanation
was rejected outright. Scanning all revisions of the path instead shows the count did move — twice,
the last time thirteen hours before the reading in question and fifty-three minutes before the
peer's measurement. The window was accurate and the conclusion drawn from it was false. An
instrument check does not save this: the quantity had changed, just not between the chosen
endpoints. **Bound by the quantity's history, not by the citation's** — scan until you find the
change or prove there is none.

Note what the correction inherited. First claim: the whole gap is decay. Correction: none of it ever
was. Truth: decay moved it by exactly one and contributed zero to the discrepancy being explained.
**Both readings were totals where the answer needed a series**, so the correction failed by the same
all-or-nothing move as the error. And the rejected hypothesis was not merely plausible — it was true
of the immediate past, off by one unit and under an hour. **A hypothesis that is almost exactly
right is more dangerous than a fashionable one**, because a fashionable one dies on contact with
data and a nearly-true one survives contact and still misattributes.

**And when you replace someone's instrument with your own, check your coverage against the case
theirs was built to observe.** A member probing one blocked repository by rerunning a single workflow
was offered a fleet-wide scan in its place — broader on every axis but one, and that one was theirs. A
rerun **keeps its original `created_at`** and advances `run_started_at`, while `gh run list` orders by
`created_at`, so the scan ranked the freshest execution in that repository twelfth and omitted it
entirely from a short listing. The replacement was strictly better on breadth and strictly worse on
the single repository and single trigger that gated the deliverable. Superior coverage is not
coverage of the same thing, and the case a bespoke instrument was built for is precisely the case a
general one is least likely to have been designed around.

Three properties of that defect generalize past the specific field. **It failed toward the false
negative** — a successful rerun stays buried under older failures, so the scan reports *still blocked*
whether or not it is, and per the rule above that verdict leaves no artifact to correct. **Its
magnitude was unbounded and set by unrelated activity**: rank twelve because eleven other runs
happened to be created afterwards, so a sweep with a `--limit N` window has a silent threshold beyond
which the run vanishes with no error and no empty result to notice. And **the defect was confined to
ordering** — the jobs endpoint returns the latest attempt, so the sweep was correct about every run it
reached. Establish which stage of a pipeline the fault is in before discarding the conclusion: a wrong
timestamp beside a sound sweep invalidates the attribution, not the finding.

**A threshold in a damage sweep is a second scope statement, and it tends to exclude the exact
artifact class the failure produces.** Following the guard defect above, the same correspondent
swept every durable artifact for duplicated content and found none — hashing paragraphs **of at least
eighty characters**. Re-run with no minimum at all the answer is the same, zero, so the conclusion
holds. But the filter was removing 48 paragraphs across the audited set, and those short paragraphs
are precisely what a mis-stamped guard duplicates: a stamp line, a status row, a table entry. The
sweep was calibrated to prose while the hazard emits markers. **A threshold chosen for signal-to-noise
in the common case is a blind spot positioned by the shape of the data, not by the shape of the
defect** — so state it, and for a bounded corpus prefer running with the filter off, since a
clean result at threshold zero costs nothing and needs no defending.

**And two checks described as complementary do not compose unless they cover the same population.**
The correspondent correctly observed that auditing scripts finds latent guards but no damage, while
hashing content finds damage but no latent guard, and that neither subsumes the other. Both true. The
two audits were then run over **different sets**: a script targeting one pull request was examined and
declared sound, and that pull request does not appear among the eight artifacts the content sweep
covered — though at 17,148 characters it is the largest artifact in the repository, nearly twice the
next. Re-measured across the union, including the four artifacts the sweep omitted, duplication is
still zero, so nothing was hiding there. The hazard is structural: **when two checks are justified by
their non-overlap, the union reads as coverage while only the intersection is actually covered**, and
the argument for running both is the same sentence that conceals the gap between them. Name the
population of each check, not just its method.

**And a population can shrink as a consequence of the repair, which the metric will report as
progress.** A member fixed a guard by deriving its marker from its own payload; that made the
file unparseable to the auditor, which regex-matched a literal assignment, so `examined 10 /
missing 1` became `examined 9 / missing 0`. The defect count improved because the defective item
left the measurable population — a fix and a blind spot arriving as one event, and worse than a
mis-specified population because nothing about the change looks like a scope change. **A
conclusion that does not reference its own denominator will report the shrinking of its
population as progress**, so gate the verdict on coverage: any unparsed member forces a non-zero
exit and no clean bill is issued.

**This repository has that defect, and a mutation test locates it.** The immutable-example check
scans a population defined by a *name pattern* — `reusable-*.yml`, ten of fourteen workflow files
— and its module gathers populations seven ways with no empty-population check anywhere. Against
an unreferenced probe file, so nothing else could couple to it:

```
baseline                                                   11 of 11 ok
violating probe named  reusable-zzz-probe.yml    check   not ok
byte-identical, renamed shared-zzz-probe.yml     check       ok
```

Identical violating content, opposite verdicts, decided entirely by the filename — and a rename
is an ordinary refactor no reviewer would flag as touching coverage. What caught the probe in
both states was a *different* checker that enumerates every file in the directory. The two
overlap by accident, and that accident is the only thing currently holding the population closed.
So the rule is sharper than naming the population: **a population defined by a name pattern
shrinks silently under renames; one defined by its container does not.** Prefer the container, or
cross-reference the glob against a declared roster, which is what makes the instruction-roster
check safe here.

**A guard's two failure directions are not equally expensive.** The same member transcribed a
sentinel rather than deriving it, so guard literal and payload were free to disagree, and the
disagreement stayed invisible until exactly the re-run the guard existed to prevent. A guard that
falsely reports *already applied* silently skips work; one that falsely reports *not applied*
silently duplicates. Same defect, and only the second corrupts the artifact.

**And a catch-all around a fetch converts every failure into the emptiest plausible answer.** The
fleet scan reported elsewhere in this section was written *after* three separate entries in this file
about absence rendering as a measured zero, and its first run reported `homelab NO RUNS` — for the
repository whose 102 runs were the entire point, two minutes after those runs had been queried
successfully by hand. Cause: passing `--paginate` alongside an explicit `page=` parameter makes `gh`
emit **two concatenated JSON objects**, `JSON.parse` throws, and `catch { return null }` reported that
as no data.

Three properties made it dangerous rather than merely wrong. It fired **only on repositories with more
than 100 runs**, so it selected against exactly the largest and most informative member while leaving
every smaller one correct and credible. `NO RUNS` is **plausible** for a quiet repository, so the
output invited no suspicion. And the whole failure lived in an error path written to be tidy. The fix
is not more care at the call site: **a `catch` that returns a value must log what it caught**, because
a silent fallback is indistinguishable from a real result, and the same edit that quieted the error is
the one that made it survivable. Once it printed, the very next run surfaced a genuine `HTTP 502` on a
different repository that would otherwise have been absorbed the same way.

**A control that cannot fire at all scores perfectly and reports nothing.** A refusal predicate
requiring `steps == 0` was censused against ordinary CI failures and returned no false positives —
but an ordinary failing job has run steps, so the two populations never overlap and that score holds
at any sample size, including one never taken. A perfect result is the least re-examined kind, and a
specific integer beside it supplies the confidence that stops the question. **Before reporting a
clean run against a control population, check the detector could have fired on it at all.** This is
the third sign of the same defect: one control fired for the wrong reason, one denied a right answer,
and this one is structurally excluded — all three present as confirmation.

**But a population that cannot answer your question is not thereby uninformative.** The correct
repair here was not deleting the count. Measured across the same runs, 143 jobs had zero steps: 135
`skipped`, admitted by the step test and excluded only by the conclusion test, and 8 `failure`, all
of them the refusal. That establishes something the census was never cited for — that neither
conjunct of the predicate is decorative, each excluding a population the other admits. Ask what a
control *can* decide before discarding it, and re-scope the claim rather than withdrawing it.

**The same defect relocates from the control to the subject, where it is much harder to see.** A
check inherits its population from the repository it runs in, so a guard wired into CI, running on
every push and passing, can be scoring against an empty set — nothing about it looks untested. A
member's binary-classification guard passed for exactly this reason: its predicate can only fire on
a file classified binary and the repository tracks none. An untested control at least invites the
question *did you test it*; an untested **population** answers that question affirmatively and
truthfully while meaning nothing. Have a check report the size of what it examined, so a green over
zero items is distinguishable from a green over some, and supply by fixture the inputs the
repository does not contain.

**An exemption list that stays empty is evidence the question was empirical all along.** That same
guard exempted through a deliberately-empty allowlist, annotated as a decision rather than a
default — which reads as discipline and was in fact disuse, since nothing was ever exempted because
no case ever required a human to decide. **A decision point that never has to decide is a
computation waiting to be written.** This bounds rather than repeals the rule above: *allowlist by
explicit declaration, never by inference* governs which kind of list to keep once a list is
warranted, and this governs whether one is. Compute what the artifact can answer and declare only
what it cannot — in that instance, *is this binary* is answerable from a NUL byte, while *does a
provenance comment survive in this file format* is a convention and must be declared. Where a list
is standing in for both, it will be empty, and its emptiness is the symptom.

**And a record cannot authorize the repair of its own corruption.** Offered a choice of evidence for
overwriting a member's file, a correspondent proposed consulting the engine's own lockfile, having
measured that it holds a complete publish-time hash of every file written — 59 of 59 recorded, the
only two disagreeing with disk being the files designed to. The measurement was right and the
proposal still fails, because both consumers are reached *only* when that record is absent or already
disagrees: one predicate is gated on there being no lock entry at all, and the other is reached only
after the recorded hash has failed to match, which is the condition that defines the case. The
datum's failure is the reason control arrives there at all.

The general test is worth applying before choosing any authority: **ask whether the datum you propose
to trust is the one whose failure defines the situation you are repairing.** It reads as prudence to
reach for the most authoritative record available, and authority is exactly what a corrupted record
retains. Note that the same correspondent had used this argument correctly to eliminate a competing
option — that one required knowing which revision produced a file, whose absence is the defect — and
did not see that it applied more sharply to the option they were advancing. **A circularity argument
is easier to aim outward than to turn around**, because the option being argued against is examined
for how it fails while the option being advanced is examined for whether it could work.


**When you retire a control that could not fire, show that its replacement can.** The fixture named
as the real test here was a run-level `startup_failure`; every such run in this fleet — twelve, across
three repositories — has **zero jobs**, because the conclusion names a run that failed before any job
existed. A job-level predicate iterating an empty list returns no hits structurally, so the successor
was excluded for a different structural reason than the one it replaced and would have passed
vacuously forever. The reflex on discovering a vacuous test is to name a harder population, and the
inattention that made the first one vacuous is what selects the second. Note also what that gap
means: a failure occurring before any job exists is invisible to every job-level predicate, and is
reported as the absence of the condition rather than as an inability to look.

**That gap is worse than *no log*: a genuine `startup_failure` carries no diagnostic text in any
field.** Measured on the run object and the check-suite together — `latest_check_runs_count` is `0`,
the check-suite has no check-runs, and therefore no annotation surface at all. Re-measured on the two
manufactured probes: both report `jobs=0` **and** `check-runs=0`, so the emptiness is structural
rather than incidental. The only non-empty strings on the run are author-supplied (`name`,
`head_branch`, `path`, `display_title`) plus `status` and `conclusion`. So the two failure modes this
section exists to separate are **asymmetrically described**: the billing refusal is *over*-described,
by a canned annotation repeated identically across every job and unable to disambiguate its own two
clauses, while the permissions trap is described nowhere. Guidance to "resolve it on the annotation"
has no object for one of the two, and an instruction that silently has no object reads as applicable.

**Verify the conclusion string before applying that claim, because the billing refusal is normally
not a `startup_failure` at all.** A peer read this passage, measured a refused run, found five
annotated check-runs carrying the payments message, and reported the claim falsified. Their own
evidence block opened with `conclusion=failure` — the run had **eight jobs**, five stepless failures
and three skipped, which is the *other* column of the discrimination table further down this
document, where the annotation is expected and a command to fetch it is given. Billing refuses jobs
that were created; permissions kills the run before any job exists. **The refuting datum was printed
inside the refutation**, one line above the conclusion it was offered against, because
`startup_failure` had become the name for *the refusal* rather than for a value of a field.

The general form is worth more than the correction: **a claim scoped to one value of a field is
refuted only by a case that carries that value, and a name that has drifted into a synonym stops
carrying its own scope.** Where a passage is keyed to a status string, quote the string and the
command that reads it, so a reader holding the wrong run discovers that before generalizing rather
than after. The two cases are one API call apart and read identically in prose.

**And do not retire an exercise gap as unfixable on the evidence of one repository.** The member who
established the emptiness above concluded that no fixture for the refusal predicate could be supplied
"from any member's history" and proposed retiring the gap. The scope error is the ordinary one, a
property of the searched repository asserted of the population; what makes it expensive is the
**direction**. Declaring a gap unfixable retires it, and a retired gap generates no further attempts,
so the error deletes the process that would have corrected it. Prefer *not obtainable from here*,
which names the boundary and leaves the question open. Note also that the two deliberately
manufactured probes among the runs above are both `startup_failure` carrying zero jobs: they show the
harder fixture is producible on demand, and exercise no job-level predicate whatever. **A probe that
fails before any job exists has probed nothing**, whatever it was named for.

**The correction first offered here was itself too narrow, and wrong in the same direction.** It read
*true of their repository; false of the fleet*, and nominated a single refusal run as supplying the
whole fixture — two stepless failed jobs as positives, three stepless `skipped` jobs annotated as
*zero-step, excluded by the conclusion conjunct* — claiming it "exercises both conjuncts and would
catch a predicate that dropped either." Mutation-testing that run against the two single-conjunct
variants refutes it:

```
baseline   steps == 0 && conclusion == 'failure'   -> 2
drop the steps conjunct                            -> 2   IDENTICAL, not caught
drop the conclusion conjunct                       -> 5   differs, caught
```

**Every job in a refusal run is stepless, so the steps conjunct excludes nothing there and deleting
it changes no selection.** The population is a sound negative control for one conjunct and vacuous
for the other — the defect this passage exists to warn about, reproduced inside the artifact offered
to cure it. The annotation is the proof, and it was written at the time: recording that the negatives
were *excluded by the conclusion conjunct* records equally that the other conjunct did no work. The
evidence of vacuity was not merely present but labelled, and the claim of exercising both conjuncts
was written in the next sentence.

So the fixture is a run **pair**, never a run: it needs one ordinary failing job with executed steps
to separate the second variant. Generally, **a conjunctive predicate cannot be exercised by a
population that its own failure mode made homogeneous.**

That last clause asserts disjointness by construction, which this section warns against elsewhere, so
it was measured rather than reasoned. Across every `conclusion == 'failure'` run in the last hundred
of each member and the backbone — **296 runs over ten repositories with failures** — runs mixing a
stepless refused job with a stepped one number **zero**. The claim survives, now on evidence rather
than on the shape of its own definition. The 143-job census earlier in this section is the same rule
seen from the other side: it found both conjuncts doing real work precisely because it was drawn
across runs, so stepped jobs were present for the step test to exclude. One population spans the
failure mode and one is contained by it, and only the containment makes a conjunct decorative.

**A stratified correction can still be computed over strata that the disputed predicate chose.**
A crude comparison showed one group scoring 11.5 points below another; stratifying by session
reversed the sign to +2.6, and a single stratum supplied more than the whole of that, so the
association was correctly retracted as a composition artifact. The arithmetic is right and the
retraction is right. What neither figure survives is that **membership in the strata set was decided
by the classifier under test**: the groups were formed from turns bearing one particular opening tag,
and two other near-disjoint tags are in equally common use. Counting all three, twelve sessions
supply members of the smaller group rather than seven — the five missing ones use a tag the predicate
does not look for — and one participant's count rises from 3 to 52, a seventeenfold undercount in the
stratum that was reported as contributing almost nothing.

So the correction inherits the defect it was correcting. **Stratifying removes composition bias only
if the stratification variable is independent of the predicate**, and here the predicate determined
which sessions existed to stratify by. The general form: when a measurement is retracted because its
population was badly composed, check whether the replacement estimate is drawn from a population the
same instrument selected — a subsample chosen by the thing under test cannot arbitrate it, in either
direction. The honest report is the one that was reached anyway, *no supportable association*, but it
should be stated over a population defined without the classifier, or the null is as
instrument-dependent as the effect was.

**The narrow claim inside a scope correction is the one least likely to be re-checked.** Widening the
population feels like the correction, so the inner assertion rides along as if it had been verified
too. Here it was worse than unverified: the pair existed in the very repository whose history was
called insufficient, and the complementary stepped run sat **nine minutes** from the refusal run whose
job census that same member had already reported line by line. The listing was open at the row that
refuted the claim.

**A constraint that is true, and was measured, still prunes a search that nothing afterwards
re-checks.** The reason the row was missed is not inattention to the listing. The clause *a refusal
run contains no ordinary failing job* is correct, was verified over 296 runs, and is precisely why
the fixture has to be a pair. Holding it then set the search to look **across repositories** — because
the clause forbids the two observations from sharing a run, and says nothing whatever about the run
nine minutes earlier in the same one. The premise was checked, the inference from it was valid, and
the region it removed contained the answer. **Verification licenses a constraint to prune, and no
later step audits the pruned region** — which makes a true premise a worse failure than a false one,
since a false premise eventually contradicts something and a true one merely removes the
counterexample from view. When a constraint narrows a search, state the region it excluded and
confirm the target could not lie there.

**A row in which nothing varies presents as a control for whichever conjunct you are testing.** The
replacement fixture is better than the cross-repository pair, and for a property neither party
claimed at first: both runs execute the same workflow file, so job names align one-to-one and the
population contains *within-name* comparisons — one job, two observations, differing in one variable.
Measured across the nine matched names:

```
isolates the steps conjunct        2    conclusion held at failure, steps 0 -> 3 and 0 -> 16
isolates the conclusion conjunct   0
both variables move                6
neither variable moves             1
```

The offered symmetry is not there. One row was nominated as the mirror control for the conclusion
conjunct on the ground that its step count is held at zero across both runs — true, and its
conclusion is *also* held, identical in both. It is the one row in the fixture where nothing moves at
all, so it isolates nothing. **A control is identified by what varies in it, not by what is held**,
and checking one is asymmetric in practice: the held-constant condition is the half you verify,
because the varying half is the thing you assumed the row was supplying. A zero-variance row
satisfies the half you check for *every* conjunct simultaneously, so it presents as whichever control
you are currently looking for.

The fixture remains sound — the mutation does catch both conjuncts, because the conclusion conjunct
is exercised *across* runs. But that is the joint exercise the pair was meant to improve on, and for
that conjunct it is unimproved. **Publish the number of controls per conjunct beside the mutation
table**, since a summary that eight of nine names flip conceals that six flip in both variables at
once and only two are controlled.

**Repeating a measurement is not a control, and the re-run rule is what disguises that.** Every
entry above describes a control that exists and is broken. This is the case where none exists and
repetition stands in for one. A session established that an engine change had reclaimed a drifting
member file by measuring at three separate HEADs and reporting their agreement — and all three were
descendants of the member's own hand-repair of that same file. The instrument was real, the readings
were careful, and they agreed; the agreement carried nothing, because the treatment was in every
sample. Re-running defends against **decay**, a figure that was correct when taken and has gone
stale. It is blind to **confounding**, a shared cause present in all samples. Both are cured by the
words *measure again*, which is why the two collapse together in practice and why the rule requiring
re-measurement is most likely to be invoked exactly where it does not apply. Agreement across
repetitions measures the instrument's stability, not the hypothesis. Before citing repeated
agreement, name the one sample that lacks the thing being credited; where no such sample exists,
report that the comparison was unavailable rather than reporting the agreement.

**Beware disjointness asserted by construction when the construction is your own definition.** The
claim that ordinary failures *cannot* trip a zero-step test defines the control population by the
very field the predicate reads. Ordinary failure is a class of causes, not a step count, so whether
one of those causes can produce a stepless job is an empirical question — answerable, and worth
answering, but not by restating the selection rule. When reporting the answer, name the population
searched, since a bounded negative and a universal one are written identically.

**An instrument's error has a direction relative to the hypothesis, and one direction ends the
inquiry.** Two filters written the same evening to check the same figure failed in opposite ways: one
over-matched and disagreed with the number under test, so its author kept pulling until the fault
surfaced; the other degraded to no filter at all and agreed, which would have closed the question.
An instrument that errs *toward* the claim terminates; one that errs *away* self-reports. Note what
that implies about remedies — the agreeing instance was not caught by its author but by an
independent re-measurement from another repository, because the terminating direction removes the
prompt to look again. **Where a checker's failure mode agrees with what you expect, self-scrutiny is
structurally unavailable; the remedy is a second party or a second method, not more care.** Buying
the bias is not free — an instrument that errs away spends investigation on true claims, which the
rule above prices — so buy it where acceptance is the default outcome.

**A durable artifact needs the measurement's procedure, not only its result.** An artifact written
to survive must restate a figure rather than cite it, or it breaks when its source moves. But the
property that makes it survive is the same one that makes it unfalsifiable in place: restating
severs the number from the reasoning that could have caught it, and a reader with no way to
re-derive has no way to doubt. This is the summary problem one level down — a restated figure *is* a
summary of a measurement, derived from a source it then cannot disagree with. Prose resolves it by
pointing at the argument; a durable artifact cannot point, so it must carry the smallest
self-contained thing that permits re-derivation. **Record the procedure beside the number, and the
faults you found in it** — not as candour, but because the procedure is the only part a later reader
can run.

**A count is a measurement whose meaning lives entirely in its predicate.** A correspondent reported
that *exactly one* error-erasing return survived an audited directory. Under their reading — returns
`null` or an empty object — that was exact. Under a second reading nobody had excluded, a predicate
returning `false` from a `catch` conflates *no* with *could not tell*, which is the same erasure, and
the population is five rather than one. Neither reading is wrong and the difference is not a
disagreement; the **inclusion rule was never published**, so the number could not be reproduced or
falsified. Publish the predicate with the count, and prefer stating what the census *excluded*, since
an exclusion is a claim about the system and a positive list is a claim about what you remembered.

**The denominator is a predicate too, and getting it wrong inverts the conclusion rather than
blurring it.** Two parties independently measured how many members carry a hand-written prose mention
of the managed-region delimiters, and reported *one in eleven* and *two in eleven*; one added that the
single instance was *possibly the only one*, concluding a fleet-wide invariant had been generalised
from one member's sentence. Measured across the roster:

```
subscribe to the managed base   6   all six carry the region
do not subscribe                5   none carries a region; one has no such file at all
carry a hand-written mention    3   all three outside their region, member-authored
```

The rate is **three of six**, not one of eleven. A member that receives no managed region cannot
mention its delimiters — it has nothing to describe — so five repositories were counted as evidence
*against* the invariant while being structurally incapable of exhibiting it. The practice is the
majority habit among members able to have it, and the conclusion reverses: not one member's idiom
generalised too far, but a convention most eligible members arrived at. **A denominator drawn from the
roster instead of the eligible population understates every rate by the share that could never have
counted**, and it fails in the flattering direction, because a small numerator over a large
denominator reads as a rare event worth writing up. This is the excluded-member defect with its sign
flipped: there an ungoverned repository inflated a sweep by appearing in reality and not in intent;
here non-subscribers deflated a rate by appearing in the roster and not in the population. Derive the
denominator from the same configuration that decides eligibility, and state it beside the count.

**That remedy is insufficient, and it stops one step short in the same direction as the defect it
repairs.** Non-subscribers are excluded because they have no region to describe. A second exclusion
exists with the opposite structural cause: a file whose managed region *is* the whole file has
nothing outside the region to describe it from. A denominator built on *has a region* counts it as
eligible, because it has one. Measured across all eleven members, on both managed targets:

```
AGENTS.md                          region carriers   6   with member-authored space   6
.github/copilot-instructions.md    region carriers   9   with member-authored space   3
```

On `AGENTS.md` the two predicates select the same six repositories. On the other target they differ
by a factor of three — six of nine files are wholly managed. **The rule was derived and validated on
the one target where the distinction is invisible**, which is the classifier-drift finding again:
latent divergence is bounded by the corpus the consumer happens to hold, and that corpus is the one
guaranteed not to exercise it.

The cause is in `buildFile`, which branches on whether the target already had content — an absent or
whitespace-only file makes the block the whole file, while a file with member text gets the region
inserted around it. **One subscription therefore produces two shapes**, and which one a member gets
is decided by whether the file pre-existed. That is a fact about history, not about configuration,
so the configuration cannot answer it and the remedy above cannot produce the right denominator. Nor
is it stable: two members carry regions at the head of `AGENTS.md` with member content below, the
fully-managed shape after someone later added text. **Eligibility is a time-varying property of the
delivered artifact, measured at a named ref** — not a property of the request that produced it.

Note the direction, because it is the part worth carrying. The original defect inflated the
denominator with repositories that could never have counted; this residue inflates it again with
files that cannot. Both understate the rate, so the correction moved the number the right way and
stopped before arriving. **A fix that fails in the same direction as the bug is the hardest kind to
notice, because the number improved.**

**And a documented explanation for a symptom becomes a misdiagnosis once a second cause produces the
same number.** Canon warns against counting the bare delimiter name instead of the anchored line, and
explains the inflation precisely: canon quotes the marker in its own prose *inside* the managed
region, so a correctly repaired file reports `2` and never reaches `1`. True, and it is the wrong
mechanism for the file above — every extra mention found there sits *outside* the region and is
member-authored. The count matches the documented prediction exactly while the cause does not, and
the explanation then sends the reader inside the region to confirm it, where there is nothing to
find. **An explanation that accounts for the number is not thereby the one that produced it**, and it
is most costly when it is independently true, since the reader stops at the first agreement. Where a
symptom is a count, name the cause by a check that distinguishes the candidates — here, the position
of the extra occurrence — not by the count they both predict.

**Correcting a coordinate does not exempt the new one from the decay that killed the old.** The same
message repaired a stale line reference from `192` to `210`, citing the drift that had invalidated
it; the site was at `239` when the correction arrived, further from the repair than the repair was
from the original. A corrected figure carries the authority of having just been checked, and its
shelf life is unchanged by the checking.

**And a comparison harness that has stopped measuring reports its failure as a result.** Two probes
built to compare three variants of a function returned, respectively, an identical failure for all
three and `-1` for every fixture in every variant. Both tables were well-formed, and both were empty.
The trap is specific to comparison: **uniformity is the finding such a harness exists to detect**, so
a harness that measures nothing produces output shaped exactly like *no difference between the
variants* — its strongest possible negative result. The remedy is to make the thing you are locating
locatable **by construction**: inject a known sentinel and assert the probe finds it before believing
any run in which it does not.

**A live instance, where the mechanism was a shell metacharacter rather than a logic error.** A
script run through a platform shell compared each commit against its parent by building the revision
string with a caret suffix. The caret is that shell's escape character, so every parent reference
silently resolved to the child, and eight independent commits each reported a delta of exactly zero.
The table was well-formed and read as *these commits contributed nothing to the section* — a finding
— rather than as *no comparison happened*. A sentinel asserting the parent differs from the child
caught it at once, and only because a uniform result prompted adding one.

The pointed part came one command later in the same script: a second metacharacter, a pipe inside a
format string, failed **loudly** with a shell error. **Identical class, identical shell, and only the
silent one produced a publishable table.** The loud failure cost a minute; the quiet one nearly cost
a false claim about authorship. Risk from a quoting fault is therefore not proportional to how badly
it breaks the command but inverse to it. Where a script builds revisions, paths or globs as strings,
pass them as an argument vector rather than through a shell, and where that is impossible, assert on
a known-unequal pair before trusting any zero.

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

**Sometimes both readings are in one message, which makes the cheapest possible check the one nobody
runs.** A correspondent reporting a de-duplicated artifact gave its size as `8929` in prose and
`8930` in the audit table eight lines below, and every one of the eight figures in that table was
exactly one above the API's own count. Detecting it required no fetch, no peer, and no second
instrument — only reading the message against itself. An internal inconsistency is the only kind that
is fully verifiable at zero cost, and it is routinely missed because self-review checks arguments for
soundness rather than figures for agreement. Before sending, diff your own numbers against each other.

**And a constant offset is equally the signature of a constant lag.** The same two sessions later
diverged by ~34 lines at two unrelated revisions — far too large for the trailing-newline convention,
which explains exactly 1. Neither figure was mismeasured: both were measured at the merge
immediately *preceding* the one they were published under. Quoting your last measurement while
naming current `HEAD` yields an offset equal to the document's growth over the lag, so on a
steadily-growing file it is constant and looks precisely like a definitional difference. The
discriminator is re-measurement, not shape: a convention survives re-measuring both figures at the
same named revision, and a lag vanishes. Reach for the definitional explanation last, because *we
were using different definitions* is the reconciliation that lets both parties keep their numbers.

**A sample cannot establish that a population is uniform, because uniformity is the one property the
sampling rule has to be cleared of first.** A session measuring how far members lag canon sampled
five, found byte-identical files, and concluded *this is not per-member drift — it is fleet-wide*.
Extending the same measurement to all nine members that receive the file:

```
9,834 bytes   one member
12,537        two members
23,263        five members   <- the sampled cohort
48,840        one member
```

**Four distinct blobs, spanning a fivefold range.** The five that agreed are exactly one cohort, and
the four never sampled hold the three other versions. Drift is per-member; the sample could not have
shown it. This is not a small-sample complaint — the numbers were right and the file identity was
right. The inference *identical, therefore uniform* requires the sample to have been drawn
independently of the thing that determines the value, and here that value is the last delivery, which
also determines which members look alike. **Members that synced together agree with each other for a
reason that has nothing to do with the fleet.**

The practical remedy is cheap and the epistemic one is not. Cheap: where a population is enumerable —
and a manifest of eleven is — measure all of it and skip sampling entirely. Otherwise **publish how
the sample was chosen alongside what it showed**, since homogeneity is uninterpretable without it: an
unstated selection rule cannot be audited, and agreement is the result it most easily manufactures.
Note the direction, which is what makes this expensive rather than merely wrong: uniformity is the
*simplifying* finding. It converts a heterogeneous repair into one action, so it terminates the
investigation that would have found the other three versions.

**The same trap caught a second session fifty-two minutes after this rule was written, and it could
not have helped them.** An independent session measured the identical five members, obtained the
identical byte count, and drew the identical inference — *identical across five, therefore no member
has any of it*. Re-measuring all nine reproduced the four-blob spread above exactly. Two sessions
reaching the same false conclusion from the same cohort, without contact, is much better evidence
that the trap is structural than one session reaching it twice: the five that agree are the five most
recently synced, so **any sampler who stops when the numbers agree stops on this cohort**, and the
agreement is manufactured by the same process that makes the sample easy to take.

The part worth carrying past this file is the timing. The rule postdated their checkout, so canon
held the warning while the person about to need it did not — **a shared document is not a shared
state**, and where many sessions author it concurrently, every reader is acting on a snapshot whose
age they have no reason to suspect. Delivery latency is usually discussed as a property of what
reaches other repositories; this is the same defect one level in, among the authors themselves, and
it is invisible because the file is *present* and *authoritative* in every one of their working
copies. Fetch before relying on a rule's absence, and treat *canon does not cover this* as a claim
with a revision attached, exactly like any other measurement.

**Their conclusion was nonetheless true, and reached through the one property that survived.** No
member had received any of that day's doctrine — established by the delivery dates, the freshest of
which predated the day entirely, not by the uniformity that was offered as its warrant and that did
not hold. Third occurrence of that structure in a single night, which retires it as a coincidence:
**a correct conclusion is not evidence that the reasoning behind it was sound**, and the cases where
it is unsound are precisely the ones nobody revisits, because the finding stands and the finding is
what gets read. Audit the warrant on claims that turned out right, or the warrants never get audited
at all.

One practical rider on the same measurement. Reporting a single deficit for the fleet — *behind by
N* — is a statement about the sampled cohort wearing fleet clothing. Across the nine, retention
ranged from under four percent to over nineteen, a fivefold spread, so the furthest-behind member is
two and a half times worse off than the nearest and any remediation ordered by one number gets the
order wrong. **Where a population is enumerable, publish the spread, not the deficit.**

**But replacing a point with a spread repairs the population error and inherits the currency error,
and it feels like it repaired both.** The correspondent who reproduced that census then published the
ratio properly as a range across four cohorts rather than the single middle figure they had quoted
five times. The range is right, and every number in it is now wrong, because a ratio has two moving
parts and only one of them was hardened. Re-measured 43 commits later:

```
member copies   unchanged, all four sizes identical in both censuses
canon           +26% over the same interval
ratio range     4.32x .. 21.46x   ->   5.45x .. 27.07x
```

**The axis made into a spread was the frozen one; the axis left as a point was the one moving.**
Member copies cannot drift while nothing delivers to them — the very condition under investigation
guarantees the denominators hold still — so the spread was taken over the stable dimension and the
volatile dimension stayed a scalar. A spread reads as the careful form of a number, which suppresses
re-derivation exactly when re-derivation is what it still needs. Before publishing a range, ask which
term in it moves, and state the revision the numerator was taken at.

**And a discriminator identical in your own negative control does no work, however carefully the
control was chosen.** The same sweep looked for an accretion pattern across the fleet, named one
repository as the negative control, and characterised the pattern by authorship: a hundred of the
last hundred commits on the accreting file by a single account. Measured on the negative control, and
on every other member: also a hundred of a hundred, the same account. The fleet shares one identity,
so authorship is constant across treatment and control and cannot separate them. This is the
zero-variance control one level up — there a fixture row held both variables fixed and presented as a
control for whichever was being tested; here a *property* is fixed across the whole population and
presents as a characterisation of the subset it was measured on. **A variable that does not differ
between the treatment and the control explains nothing about the difference**, and a saturated ratio
such as a hundred of a hundred is the most persuasive possible form of it. Measure the discriminator
on the control before it is allowed into the description.

**A third correction on the same sweep, and this one moves who owns the remedy.** The file singled
out as most exposed was described as *standing instruction, loaded every session, delivered in full*.
Loaded every session is right, and the exposure is real. Delivered is not: the managed region is
**3.7%** of that file, and the remaining 96.3% is member-authored text the sync neither wrote nor
transmits. The conclusion — that a fleet delivery finding does not reach it — survives, and its
reason inverts. It is out of reach not because delivery saturates the file but because delivery
barely touches it, so a remedy aimed at what canon distributes cannot help, and the growth is the
member's to govern. **Attributing volume to the mechanism you were studying puts the fix in the wrong
repository**, and it is easiest to do where that mechanism genuinely contributes something.

**And a census of the fastest-moving quantity in the fleet was reported as though it were static.**
The same three files were cited at sizes that had already grown by factors of 1.46, 1.73 and 1.99 by
the time the message was read — one had doubled. Nothing was mismeasured; the figures simply
described the property whose whole interest is that it accretes, and carried no revision. Where the
subject of a measurement is a growth rate, the measurement's own age is part of the reading.

**And a multiplier anchored on a plateau is insensitive to the interval, so pairing it with an
elapsed time manufactures a rate.** A section of this file was reported as having gone from 605 bytes
*yesterday* to 68,627 — **113× in 21 hours**. Both endpoints are exact. But the baseline had been
flat at 605 for **822 hours** before the growth began, and the 21-hour anchor falls inside that
plateau, so the interval was a free choice while the ratio was not:

```
anchor inside plateau, 21 h   -> 113x,  3,239 B/h
onset-dated, 15.5 h           -> 113x,  4,394 B/h
plateau start, 822 h          -> 113x,     83 B/h
```

One multiplier, a fifty-threefold spread in implied rate, and nothing in the report distinguishes
them. **The ratio's robustness is real and it transfers to the interval, which has none** — the
numerator is a property of the data and the denominator is a property of where the author happened to
look. A rate assembled this way is unfalsifiable in the direction that matters, because any challenge
to it re-derives the same defensible multiplier. Date the **onset**: the first departure from the
plateau is unique and measurable, and it is the only endpoint the data chooses for you.

**A related failure on the other side of the same message: re-measuring is not re-fetching.** The
sender had adopted the rule to re-measure at send, did so, and reported a tip **43 commits behind**
the actual one, with a byte count taken from that stale object. The rule was followed exactly and did
not help, because it addresses the age of the *reading* and the defect was the currency of the
*object*. **A fresh reading of a stale ref is worse than a stale reading**, since the timestamp is
honest, recent, and certifies the wrong thing — it converts a decayed figure into one that looks
actively confirmed. Where a remedy adds a timestamp, check that the step generating the timestamp is
also the step that refreshes what is being timed.

**And a sample taken as *the first N* inherits an ordering the endpoint never promised — which here
reverses between two routes to the same data.** Reading the annotations on a refused run, one route
returns the annotated failures first and the other returns the un-annotated skips first, over an
identical set of eight:

```
check-suites/{suite_id}/check-runs    ascending id    failure, failure, failure, ...
commits/{sha}/check-runs              descending id   skipped, skipped, skipped, ...
```

A reader sampling the first three gets `annotations_count: 1` three times on one route and `0` three
times on the other, from the same run, at the same moment. The second is the dangerous direction: a
correct endpoint queried with no selector returns a well-formed empty result that is
**indistinguishable from the absence being tested for** — one step from concluding the diagnostic
text does not exist. Select on the property (`conclusion == "failure"`), never on position.

Two things generalize past this API. **An ordering that is stable is not thereby documented**, and
one observed twice is most cheaply explained by a sort key nobody chose — here plainly the record id,
ascending on one route and descending on the other. And **a caveat can be right while the
demonstration attached to it is not reproducible**: the advice to filter by conclusion is correct on
both routes, but the observation offered as its proof holds on exactly one and silently inverts on
the other, so a reader who verifies on the wrong route concludes the caveat is imaginary. Where a
finding depends on order, name the route and the sort key, or drop the sample and enumerate.

Note that the procedure documented later in this file is immune by construction, and not by
foresight: it takes the check-run id out of the `log not found` message and fetches that one
annotation directly, so it never enumerates and never sorts. **An instruction can be accidentally
safe, which means its safety does not transfer to the obvious alternative route a reader invents.**

**And never write an unresolvable citation, even as an example.** There is no markup for
use-versus-mention, so a document exhibiting a broken locator to illustrate the defect is
indistinguishable from a document containing one — to a checker and to a skimming reader alike. This
generalizes past citations: **any document that carries a counter-example in the same notation as
the real thing has made itself uncheckable.** It bites hardest where the temptation is strongest, in
the docstring of the very guard that detects the pattern, since a verbatim bad example there poisons
every later search of the tree. Name the broken form in prose instead.

**That rule understates the failure in two ways, both measured.** A member built a detector for a
text defect, wrote its probe strings into the audit script, and harvested the reference vocabulary
from the directory holding that script; their threshold for *established word, not a defect* was
more than two occurrences. Each test run added the defect to the reference corpus, and on the third
it crossed the threshold and was reclassified as normal. **Contamination is thresholded, not
additive** — the description above is of noise, a search returning hits that are not defects, but
what occurs past a frequency cutoff is a state change in which the defect stops being reported at
all. So the instrument is disabled **in proportion to how often it is tested**, a fourth run would
have raised its confidence rather than lowered it, and the direction is silent, since *the probe
found nothing* reads as reassurance. Their remedy is the reusable half: **assert that the probe
fires before reporting any result**, which converts a silent blindness into an exit code and was
the only reason this was caught.

**And assert on a synthesised specimen, not on the corpus.** The same member's emphasis-aware
matcher had already lost its precondition: zero emphasised specimens remain in their live corpus,
so the discriminator had silently been a duplicate of the plain matcher with nothing announcing
it. Their verdict string was ambiguous by construction — *none found* is emitted identically by a
clean corpus and by a dead matcher, the reassuring output and the instrument-is-dead output being
the same bytes. A corpus can stop containing the thing an instrument detects without anyone
deciding it should, so **the guarantee has to be carried by the control rather than by the
data**: manufacture one positive of each shape the matcher claims to catch, plus a negative
proving it still rejects, and refuse to issue a corpus verdict until they pass.

**And because canon is distributed, the blast radius of this rule is the fleet, not the file.** All
nine opted-in members hold this document in their own tree, at revisions spanning 9,814 to 306,824
bytes, so a literal bad example written here lands in nine trees on the next sync — at different
times, and un-datable from inside any one member. A downstream detector that excludes its own
tooling from its own corpus, which is the correct local fix, is not protected against this: the
arriving poison is neither their tooling nor their file, and it is regenerated on every sync, so it
cannot be remediated downstream at all. **Only the hub can honour this rule on the members'
behalf**, which makes naming broken forms in prose a distribution obligation rather than a local
style preference.

**That rule was itself destroyed by a later edit, in the way this file is most exposed to.** A commit
adding a new paragraph replaced the *opening line* of the one above — `**And never write an
unresolvable citation, even as an example.** There is no markup for` — and left the remaining nine
lines attached to the previous paragraph. The result began mid-sentence, with no subject, and
survived four merges before a reader tripped over it. Recovered by `git log -G` on the orphaned text
and restored from the introducing commit.

Three properties make this class expensive. **The damage is invisible to every structural check**:
fence parity, line-count, and non-latin sweeps all pass, because nothing is malformed — a paragraph
simply lost its head. **It reads as prose**, since a fragment beginning `use-versus-mention, so ...`
looks like a continuation to a skimming reader and is only obviously broken if you are looking for
the claim it was making. And **the deletion was a side effect of an insertion**, so the author's
attention was entirely on text that was correct; nobody reviews the far edge of a hunk they did not
mean to touch.

The remedy is the one already stated for seams, aimed at the other end: **after an in-place
amendment, read the line before and the line after the hunk as a sentence.** A diff-scoped check
that inspects only added lines cannot see this, because the defect is in what an addition
*displaced*. Where an edit replaces rather than appends, the removed text is the thing to audit.

**A search for an unused name whose availability test fails toward *unused* selects the candidate
most likely to be taken.** The engine picks a non-colliding branch by probing `-rerun-2`,
`-rerun-3`, ... and stopping at the first that does not exist, where "does not exist" is a fetch
returning false. That fetch returns false for a network failure exactly as it does for a genuine
absence, so under failure *every* candidate reads free and the loop terminates on its **first**
iteration — the lowest-numbered, longest-lived, most likely to already exist. **The failure mode
inverts the loop's purpose**: a guard written to avoid collision picks, when blinded, the maximally
colliding name. The sibling call site is milder but wrong in the same direction, reporting that a
branch *disappeared* when the truth is that the lookup failed — a confident diagnosis of the one
hypothesis the evidence cannot support.

Two mitigations happen to hold here and neither was chosen for this: the push is a plain
non-forcing push, so a diverged remote branch rejects it loudly, and a fetch failure usually
predicts a push failure. Both are accidental, and the first leaves a real hole — a remote branch
whose tip is an *ancestor* fast-forwards cleanly, silently reusing a retained branch from a merged
PR, which is precisely the reuse the surrounding documentation forbids. **Count a boolean
availability probe as unsafe wherever the negative answer authorises an action**, and give it the
third state before reasoning about whether today's callers happen to survive it.

**A summarising invocation discards exactly the field that matters when the summary is bad news.**
Running the suite through a filter for the pass and fail tallies is right almost always, and on the
one run in six where a test genuinely failed it printed `fail 1` and *nothing identifying the test* —
the filter had dropped the failure block. Five clean re-runs then made the observation unrecoverable:
real, seen once, unnamed, and now indistinguishable from a misreading. **A filter tuned to the
expected outcome is an instrument that degrades precisely when it becomes useful**, which is the same
direction as a check that fails toward `CLEAN`. Capture the full output and filter the copy, never
the stream; and treat an unreproduced failure as an open observation with its identity lost, not as
noise resolved by the reruns that failed to reproduce it.

**Finally, a probe can be healthy and still be aimed at the wrong proposition.** Every failure above
is an instrument that *cannot* return the other answer. This one returns it readily — about a
neighbouring question. Guidance meant for every member was placed in `AGENTS.md` and verified with a
sync run against `engineering`, a member whose `optIn.base` is `false`: the text could not have
arrived there whether the placement was right or wrong. The run was neither broken nor vacuous — a
bad `--work-dir` would have failed it, and it produced a real correction to the wording it was
aimed at — so the remedy above was already satisfied. The probe could return the other answer; it
could not return the other answer **about the claim it was standing behind**, and the placement
defect survived to be found later, when the same guidance proved to reach 6 of 11 members.

This slips because **"does the command work" and "does this text reach every member" are both
faithful readings of "does this work"**, and nothing forces the probe and the claim to be the same
proposition. State the proposition in words *before* choosing the input, then check that the input
can falsify **that** proposition rather than merely that the run can fail. Where the claim is about
reach, the witness must be a case that would exhibit the absence: verify a distribution change
against a member that does *not* already receive the surface you are changing.

**A guard is also placed, and it can be aimed correctly at the wrong instance of its own class.** A
warning said *do not make this constant revision-valued* — true, and about one identifier — when the
property that actually had to hold was that a renderer's output never change, the constant being one
of its inputs. The constant then went seven revisions byte-identical while the renderer changed
twice in two days, both times by someone editing what looked like formatting and who never saw the
warning, because it was addressed to a different editor in a different file. **Name the invariant by
the property that must hold, not by the variable you were looking at when you noticed it** — a guard
written against the instance you saw sits wherever you were standing, which is rarely where the next
instance arrives.

**Rank guards by what has moved, not by what would be bad.** The instinct that protects a long-stable
constant is that it is important, and important is not the same as volatile; a perfect stability
record is the strongest available evidence that the next change will not be there either. Revision
history is measurable and the intuition is not, so before deciding where a guard goes, count where
the edits have actually landed. And note the sequel, which is the same lesson at a different scale:
the commit that *fixed* the underlying defect was itself an instance of the hazard being discussed
in the same conversation, because the hazard was being discussed under a name and the fix touched
something with a different one.

**Where the fault being fixed is silent omission, the unknown case must be the loud one.** A guard
that enumerated one known integrity lock passed a tree in which eight hash-pinned files sat
unprotected, because an unregistered lock presented as *absence* and absence was the passing answer.
Rewritten to enumerate every lock and treat an unrecognized one as a hard failure, the same guard
reports the gap it had been blind to. The corollary concerns the exemption list: **allowlist by
explicit declaration, never by inference**, since an inferred allowlist grows silently as the
repository does and each new member joins it without anyone deciding. Note also why the first
version looked finished — it was named for a property and written against a single instance of it,
and only a new instance, rather than any amount of re-reading, exposed the gap.

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

**First establish that the repository has required checks at all — most of this fleet does not.**
Measured across the fleet, the protection endpoint returns three different answers, and the two that
mean *nothing is enforced* are not the same finding:

```sh
gh api "repos/OWNER/REPO/branches/$(gh api repos/OWNER/REPO --jq .default_branch)/protection"
# 200 -> protected; read .required_status_checks.contexts
# 404 "Branch not protected"            -> protectable, nobody has configured it (a choice)
# 404 "Branch not found"                -> you asked about a branch that does not exist
# 403 "Upgrade to GitHub Pro ..."       -> not protectable on this plan (not a choice)
```

**`404` is two states, and the status code does not separate them — only the message body does.**
Querying a branch name the repository does not have returns `404 "Branch not found"`, which a census
bucketing on the code alone files as *protectable, unconfigured*. The backbone demonstrates it on
itself: `.github` is the one repository here that enforces anything, and asking it about `master`
returns `404`. **So a census keyed on a literal branch name reports the most-protected member as
unprotected.** Key on each repository's own `default_branch`, which costs one field and removes the
dependency, and branch on the body rather than the code.

**Measured, that hazard does not currently bite — and the reason is the finding.** Twelve of the
thirteen repositories default to `main`; the only exception is `homelab` at `master`, and it is
masked because the plan `403` is evaluated *before* branch existence, so all three of `master`,
`main` and a bogus name return the same refusal. Keying on the literal and keying on `default_branch`
therefore agree on all thirteen today. **The bucket is right by a property of the fleet rather than
by construction**, and the single member positioned to expose it is hidden behind the very refusal
everyone is waiting to clear — so the method would begin failing at the moment the account is fixed.

At the time of writing only the backbone returned 200. A public member returned **404** and two
private members returned **403** — so the discriminator is *not* visibility, which is the tempting
generalization and a wrong one: public-and-unprotected is a real state. Distinguishing 403 from 404
matters because the remedies are unrelated. 404 is fixed by configuring the branch; 403 is fixed
only by changing plan or visibility, and until then no amount of workflow correctness makes a check
enforceable.

**That paragraph was written from a three-repo sample and is superseded by a census of all eleven
members.** Its claim that only the backbone returned 200 is now false, and the shape of the fleet is
not what a sample of three suggested:

| protection endpoint | count | members |
| --- | --- | --- |
| `200` enforced | 1 | `finance` |
| `404` protectable, unconfigured | 4 | `jrm-recipes`, `score-king`, `engineering`, `studio` |
| `403` not protectable on this plan | 6 | `libro`, `cartridge`, `docket`, `product`, `homelab`, `windows` |

The backbone is a twelfth repository at `200`. So **one member in eleven enforces anything**, and for
six of them the enforcement state cannot be read at all from this account — which is the next rule.

**Re-measured `2026-08-12` keyed on each repository's own `default_branch` — scope stated, since the
paragraph above counts the backbone separately and this one does not: thirteen repositories, being
eleven members, the backbone, and one recorded exclusion.** `200` × 2 (`.github`, `finance`), `404`
× 4 (`studio`, `score-king`, `jrm-recipes`, `engineering`), `403` × 7 (`homelab`, `libro`,
`cartridge`, `docket`, `product`, `game-library`, `windows`). So *one member in eleven* enforces
anything — still `finance` alone, the other `200` being the backbone — and `game-library` is the
addition, landing in the bucket that cannot be read. Only one `404` body occurs naturally anywhere
in the fleet — `Branch not
protected` — which is exactly why the second body is dangerous: it is never seen until the query is
wrong, so no census will ever have exercised the branch that distinguishes it.

**The `403` bucket and the Actions-refusal bucket are the same repositories, for unrelated reasons.**
Re-measured across the roster: every private member returns the plan `403` and no public member does,
and every failed job in those same private members has **zero steps** — the spending-limit signature —
while the one public member failing that day failed with a job that has steps, an ordinary red build.
Two gates, two unrelated remedies (change plan or visibility; raise the spending limit), one
population, because both key on `private`.

**Co-extensive causes cannot be told apart by a census, only by the surface each produces.** Nothing
in a list of affected repositories distinguishes them, so anyone who learns the population without the
mechanism will merge them, and the merged claim then survives every check that ranges over membership.
This is not hypothetical: a precise `plan-blocked` count of mine came back from a peer as a claim
about the Actions spending limit, and no repository list could have contradicted it. Report the
surface beside the count, because the count is the part that is identical under both explanations —
and expect the fleet to look half-fixed when one gate clears, since the same repositories keep
failing under a different signature.

**Key the sweep on step count, not on `conclusion`.** A refusal and a genuine test failure are both
`failure`; only the absence of steps separates them, so a bucket built on the conclusion field files
real red builds as billing casualties and reports a blocker wider than the one that exists.

**A sweep's population is not the manifest's, and stating the scope is not the same as getting it
right.** The paragraph above originally read *twelve members plus the backbone*, having silently
promoted `game-library` to membership because it appeared in an org-wide protection sweep.
`game-library` is the entry in the top-level `excluded` array — deliberately ungoverned, with a
recorded reason — so the thirteen repositories are eleven members, the backbone, and one exclusion.
The error survived a scope note explicitly written to prevent it, because the note fixed the
*boundary* (does this count the backbone?) and not the *roster*. Take the member list from
`studio.config.json`, never from whatever the sweep happened to return, and remember that an
excluded repository is the one population member designed to appear in org queries and in no
manifest.

**A refusal is not a reading.** A `403` says the API declined to answer; it says nothing about how
the branch is configured. A member reported one as *this repository has no protection*, reached the
right conclusion, and reached it from a fact not in evidence — an instrument that distinguishes only
`200` from *not `200`* collapses *configured as nothing* and *I may not tell you* into one bucket,
and the second is not a finding about the repository at all. The general form: **an availability
refusal converted into a factual claim is unfalsifiable by the instrument that produced it**, since
the same refusal is returned whatever the underlying state. Say *undetermined on this plan* and
carry it as undetermined. Three answers require three branches; anything that tests truthiness has
already lost one.

**Visibility does not discriminate protection, but it exactly discriminates the refusal — and those
are two questions wearing one word.** Measuring visibility and protection in a single pass across all
eleven members:

| visibility | count | protection endpoint |
| --- | --- | --- |
| private | 6 | `403` — all six |
| public | 5 | `200` × 1, `404` × 4 |

The correspondence is total in one direction: every private member is refused, every public member
answers. So the claim above is right about *is anything enforced* — four public members return `404`,
and public-and-unprotected is a real state — and wrong about *can this account read the state at
all*, where visibility predicts the outcome perfectly, exactly as the endpoint's own upgrade message
says it should. The practical consequence is not that you may skip the call: it is that a `403` is
**fully explained by visibility and carries no further information**, whereas `200` versus `404` is
only obtainable by measuring. Reporting "six members are refused" alongside "six members are private"
states one fact twice.

The general form, since *discriminator* claims are usually written after a surprise: **a statement
that some property is not the discriminator has to name the question it is not discriminating.**
Unqualified, it reads as *this property is uninformative here*, and the original sentence was
written the moment a tempting generalization failed — which is precisely when the property's real
and narrower predictive power is least likely to be looked for.

**Where nothing is required, replay the trigger predicate against the diff.** The section below
warns that a path-filtered trigger yields no check at all on an unprotected repository. The
compensating instrument is to evaluate the workflow's own filter against the pull request's actual
changed files, rather than reading the regex and judging it correct: that is the only local test
that distinguishes *the job correctly did not apply* from *the job silently never existed*. It has
to be run per pull request, because applicability is a property of the diff and not of the workflow.
On a protected repository this is redundant; on ten of eleven members here it is the whole gate.

**And doctrine gets authored where it is cheapest to be right and applied where it is hardest to
notice being wrong.** This section was written in the one repository whose platform contradicts a
mistake immediately, then distributed to eleven where, by the census above, ten enforce nothing and
six cannot even report their state. The asymmetry is self-concealing rather than merely unlucky: the
authoring environment is *selected* for having the strongest feedback, which is exactly why guidance
gets written there — so the confidence is earned in the one place the claim is cheap and spent in
every place it is expensive. When writing a rule that depends on a platform behaviour, name the
environment it was verified in, and check whether that environment is representative of the
population receiving it or is the outlier that made verification easy.

**The consequence inverts this section's failure mode.** Where checks are required, a path-filtered
trigger hangs the pull request forever — loud, and self-limiting because nobody can merge past it.
Where nothing is required, the identical misconfiguration produces a check that is simply never
created, and the pull request stays perfectly mergeable. Same defect, opposite symptom, and the
silent one ships. So on an unprotected repository the merge gate is **discipline, not a platform
guarantee**: nothing but the person merging stands between an unrun check and the default branch.
Say which of the two you are relying on when you report a PR as gated.

The rest of this section assumes required checks are in force. Where they are not, follow it anyway
— the misconfiguration it prevents is invisible rather than absent, and the repository may become
protected later, at which point every latent instance surfaces at once.

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

**That last sentence was too strong, and the fleet scan that disproved it shows how.** The clause is
not diagnosable *from the annotation* — that part stands, and no amount of re-fetching the message
will ever help. But the two clauses make **different predictions about repositories that are not
refused**, and that is an observable this section never thought to collect. Measured across every
member on `2026-08-12`:

| repo | visibility | zero-step refusals | during the current episode |
| --- | --- | --- | --- |
| `docket` | private | 341 | refused |
| `homelab` | private | 74 | refused |
| `libro` | private | 25 | refused |
| `cartridge` | private | 25 | refused |
| `game-library` | private | 11 | refused |
| `product` | private | 2 | refused |
| `score-king` | public | **0** | **16 successes**, latest `00:54:39Z` |
| `finance` | public | **0** | succeeding |
| `jrm-recipes` | public | **0** | succeeding |
| `engineering` | public | **0** | succeeding |
| `.github` | public | **0** | succeeding |

Six private repositories, every one refused; five public repositories, every one clean. A failed
payment is a state of the account and is visibility-independent — it would refuse public repos too.
Public repos are succeeding *concurrently* with private repos being refused, so **the failed-payment
clause is not the one firing; the spending limit is.**

**That inference is void, and the step that fails is the one that felt like a definition.** A payment
state is account-scoped, but its *effect on runs* is not, because Actions on public repositories with
standard runners is free and therefore consumes no billed usage at all. Both branches predict the
observed table identically: private refused, public clean. The split is a restatement of the free
tier, not evidence about which clause fired. See the diagnostic table further down for the two
measurements that do bear on it, and for the reason they still do not close the question.

**The general form survives and needs one clause it did not have: when a message refuses to say which
of two causes fired, look for a population the two causes treat differently — and verify that both
causes are actually exposed to the axis you have chosen.** Diagnosis had been framed entirely as
*read the failure more carefully*, and the failures are identical by construction, so the
discriminating evidence was never in the refused runs. The correction is that a concurrent control is
not automatically superior to a temporal one: here the concurrent axis was one arm's documented
exemption, so it discriminated nothing, while the temporal evidence was the only thing addressing the
clauses at all. **A control chosen along an axis one arm is exempt from is not a control**, and
picking the axis is the whole test rather than a preliminary to it.

**A zero-run interval measures triggering activity, not service availability.** During a refusal
episode runs are still *created* — the earlier episode on `jrmoulckers/homelab` produced 55 run
objects, every one of them refused, which is directly checkable. So an interval with no runs in it
cannot mean the service was down; it can only mean nothing pushed. Reading such a gap as a recovery
window infers the state of one system from the idleness of another, and the two are independent. The
gap in question was six days wide, and a six-day window in that position contains a month boundary
almost wherever recovery actually fell — so "the window contains the billing-cycle boundary" had no
power to discriminate, while reading exactly like evidence.

**And a commit census must declare whether its population is authored or published, because the two
diverge enormously in a shared worktree.** Two parties measured the same interval and got one commit
and twenty-one; both were correct. `--remotes` counts what was pushed, `--all` additionally counts
local-only refs, which in an environment where several sessions share a checkout means other agents'
unpushed work. Measured in this repository's worktree the gap is not marginal: **1,177 commits
reachable from all refs against 437 from remote-tracking refs**, so nearly two-thirds of the
population is unpublished, and a census that does not name which it counted is off by a factor of
nearly three. The same command reproduces to a different number on a fresh clone, which is what makes
the discrepancy read as someone's mistake rather than as two questions.

The direction matters for the case above. *The gap was idle* merely fails to explain why no runs
exist; **unpushed commits explain it positively**, because the triggers are push and pull-request
events, so work that was authored and never published produces exactly this absence. Prefer the
explanation that predicts the observation to the one that is merely consistent with it.

**But the most dangerous explanation for a discrepancy is a mechanism you have just spent hours
proving real.** A member's heading census was 17 missing; this repo measured 23 and explained the gap
as canon having grown between their reading and mine — citing, as support, the decay rule they had
themselves proposed in the message under reply. It fit, it was topical, and it was false. Walking
every commit in the window with a fence-masking counter:

```
five commits, 102 lines added
naive headings  46 46 46 46 46      masked headings  36 36 36 36 36
```

The count did not move once. The entire discrepancy was my own naive regex counting template headings
inside fenced blocks, and the member's 17 was right when taken and still right. **A live, well-evidenced
mechanism is available, plausible, and requires no instrument check**, so it is reached for first and
absorbs defects that have nothing to do with it — and the better the evidence for the mechanism, the
more completely it launders the error. The discriminator is cheap and specific: decay predicts *the
cited quantity changed*, so measure that quantity at both revisions before invoking it. A mechanism
that explains a discrepancy in general is not thereby the one that produced this instance.

Note also which way the explanation pointed. It placed the error in the peer's reading rather than in
my instrument, which was the flattering direction and the unmeasured one — the same shape as an
authorship claim recorded elsewhere in this file that settled on *not mine* because nothing could
check it. Where a discrepancy admits an explanation that exonerates your instrument, that is the
branch to measure first, not last.

**Falsifiability is a property of the claim, not evidence for it.** The withdrawn reading came with a
crisp test — *it clears on its own next cycle, or it never does* — and offering that test is what made
it feel rigorous. It invites the reader to check the future instead of auditing the derivation, and
those are not the same review. A prediction can be sharply testable and rest on nothing. Attach the
derivation to the test, or the test launders the gap.

**A withdrawal does not propagate to the summaries that restate the claim.** This was demonstrated
here at the worst possible place. The cycle-reset arm was withdrawn explicitly — *waiting it out is
not a supported plan* — and then reinstated two hours and seventeen minutes later, by the same
session, as a parenthetical in an action item: *raise the spending limit (or wait for the cycle to
reset)*. The reinstatement sat inside the write-up of a **stronger, independent** result, so the
comment most likely to be trusted carried the retracted advice.

The mechanism is worth stating because it is not carelessness. A correction is applied to the claim,
in the artifact where the claim lives. A summary re-derives the action from memory, and memory holds
the pre-correction version — nothing links the two, and compression is exactly when the link is
needed. **After withdrawing something, grep your own prior artifacts for the withdrawn arm rather
than trusting that the withdrawal reached them.** The check is cheap and the failure is silent.

**And a sibling's green does not carry the evidence this once claimed, which is the same withdrawal
reaching one paragraph further.** The rule above — that each repository's annotation is the only
evidence about that repository — was qualified here on the grounds that for an *account-level* clause
a sibling which is not refused carries evidence nobody else can get. That qualification inherited the
confounded control: the siblings that stay green are the public ones, and they are exempt from billed
usage entirely, so their green is a property of the free tier rather than a reading of the account. A
private sibling's green would carry the evidence; a public sibling's does not, and every green
sibling observed during this episode was public. The unqualified rule stands.

**When your own block lifts, the first green is a first measurement, not a recovery.** A refused run
executed no steps, so it carries no evidence about the diff in either direction — the red was a statement about the account.
There is therefore no prior known-good state being returned to, and a regression that landed during
the outage was indistinguishable from the outage the whole time it held. The trap is in how it ends:
the window does not close when the block lifts, it closes when someone re-reads the checks, and
nothing prompts that, because the repos go green on their own and a green check invites no
investigation. So the recovery erases the evidence that anything was ever concealed. After an
account-wide refusal lifts, re-run and re-read the affected PRs' checks deliberately instead of
treating the return to green as the answer, and judge the branch per hunk — an aged branch is rarely
all-good or all-stale. Full treatment in `docs/sync.md`, § *A fleet-wide outage makes genuine
regressions unreadable while it holds*.

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

**And state the population at every stage of the pipeline, because one number will be read as all
of them.** A census of this kind runs *list → inspect → match*, each stage narrower than the last,
and a scope line naming a single figure silently claims the same figure for all three. This repo
published `last 100 runs (reaching back to 2026-07-27)` for a member whose complete history is 102
runs reaching back to `2026-07-06`; `07-27` was the oldest run **matching** the zero-step signature
inside a **10-run inspected subsample**, and it was written down as the reach of the listing. The
true shape was `102 listed, 10 inspected, 6 matched`.

The consequence is not a rounding error. **Understating reach converts *I did not classify these*
into *these lie outside my window*** — 48 runs sat inside the listing, unexamined, and were made to
look excluded by it. Absence of evidence is thereby promoted to a boundary, and a boundary is
exactly what a reader reasons from: the figure turned a three-week episode into a three-day one, and
the three-day version was then used to argue about whether the current outage needed intervention or
a wait.

This is the inverse of the vacuity failure. There the narrow population goes unreported and a corpus
count stands in for it; here the narrow population's *extremum* stands in for the corpus's reach.
Both are one number doing the work of several, and the remedy for both is the same: report the
stages, and prefer *the oldest item I looked at* to *the oldest item that matched*, since only the
first bounds what you did not find.

**The correction came from outside, and that is part of the record.** This repo did not catch the
scope-line error by re-reading its own work; a peer ran the complete history and published the true
boundary, and the figure propagated from there. Kept because the earlier account of this episode
omitted it, and an entry that reads as self-caught teaches that careful re-reading suffices — when
what actually sufficed was somebody else measuring the population exhaustively. **A sampled extremum
is not reliably caught by its author**, because the sample looks complete from the inside and there
is nothing in it to prompt the doubt; the corrective is an exhaustive count, and the party best
placed to run one is usually the owner of the corpus rather than the author of the claim.

**Evaluate that predicate against the jobs API only — `gh pr checks` cannot supply its terms.** That
view renders an unfinished job as `pending 0`, where the `0` is its column for *no duration yet*, not
a step count. A member watching a healthy `native-kotlin` job saw `pending 0` for 22 minutes while it
was executing 8 successful steps on a named runner, and would have read it as a refusal had they not
gone to the API. So the two states this section exists to separate — *refused before starting* and
*running normally* — are rendered identically there, and the collision is in the field the predicate
keys on. Worse, it is the same command the Definition of Done table names for CI-green, so combining
the two instructions is the natural reading rather than a careless one.

The general form is the part to carry: **a predicate is not defined until you name the instrument
that supplies its terms.** A field name is not a field; the same word in two tools can denote
different quantities, and a predicate written against one and evaluated against the other is
well-formed, runnable, and wrong. State the API call beside any threshold you publish.

**Do not expect a run's conclusion and its check-runs to agree.** In that same run the workflow
concluded `success` while the job's check-run stayed `in_progress` and never reconciled — an
orphaned record, not a transient. Any liveness or completeness test that requires both to settle
will hang on a run that has genuinely finished.

**State which case a predicate has not been exercised against.** That predicate has been run over
studio's whole failure history: 8 ordinary failures (lint, build, and so on) yield zero false
positives, and all four refused runs match. But studio has **0** `startup_failure` runs ever, so it
has never been tested against the **caller-permissions trap** — the exact confusable this section
exists to separate. A discriminator validated only against the easy contrast has not been shown to
discriminate. The honest form is *no false positives on 8 ordinary failures; not yet tested against
the case it is meant to distinguish*, and the missing fixture can be built deliberately by calling
`reusable-ci-lint` without `pull-requests: read`.

**And a detector's noise is a property of the corpus, not of the detector, so a clean result does
not travel with it.** A peer offered canon an encoding guard — grep for `U+FFFD`, classic mojibake
sequences, and a lossy dash signature, each paired with synthetic damage asserted non-zero in the
same run so the check cannot pass by being broken. The control discipline is right and was adopted.
Measured here, two of the three patterns return zero and the third fires **111 times across 32
files**, every hit a JavaScript ternary — because their corpus is prose and canon's includes the
engine. Scoped back to `*.md` it returns 0 across 92 files, exactly as they measured. Nothing was
concealed; they named their corpus, and the number was simply taken on a population the recipient
does not have. Promotion is this repo's characteristic act, so **run a borrowed check against your
own corpus before adopting it, and promote it with its scope attached** — a pattern shipped without
its population will be applied to the wider one, and a guard that fires 111 times on a healthy repo
is one that gets disabled. This is not the entry above: that one asks which *cases* a predicate met
inside one history, this one asks whether a correct number survives crossing into a different one.

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

**Recognizing the refusal is not diagnosing it, and the annotation names two causes with different
remedies.** *"recent account payments have failed **or** your spending limit needs to be increased"*
is a disjunction: one branch costs money to clear, the other does not. Every session here has
recommended raising the limit without testing which branch was live. Two of them are testable.

The account-scoped billing endpoints are gone, and that is not the end of the enquiry — a `410`
names its successor in the response body, and following it returns per-repository, per-SKU rows:

```bash
gh api /users/OWNER/settings/billing/actions          # 410 "This endpoint has been moved."
gh api /orgs/OWNER/settings/billing/actions           # 404 on a personal account
gh api "/users/OWNER/settings/billing/usage?year=YYYY&month=M"   # 182 rows
```

Against that data, on a `type=User`, `plan=free` account:

| Branch | Test | Reading |
| --- | --- | --- |
| payments have failed | `netAmount` summed over all months | `0.0000` — no charge ever existed, so none can have failed |
| allowance exhausted | private-repo minutes, multiplier-weighted, vs the plan's included figure | `1,282` of `2,000` — not exhausted, so *waiting for the cycle boundary is not a remedy* |

Public repositories do not consume the allowance, so weight **only private ones** — and confirm
visibility with `.private` rather than from memory, which is how a seven-repository set was
published as six here for a week.

**Governance exclusion is not resource exclusion, so the allowance has a different population than
the roster.** Of the `1,282` private adjusted minutes, **126 — 9.8% — belong to `game-library`**,
which sits in the top-level `excluded` array and is deliberately ungoverned. It receives no canon, is
exempt from every sweep, and consumes the same shared monthly allowance as every member. So a
repository the fleet has decided not to manage can degrade or halt CI for all eleven that it does,
and no roster-scoped query will ever show it. **Compute allowance questions over the billing
account; compute governance questions over the roster; and never let one partition stand in for the
other.** A membership cut and a visibility cut are different cuts, and correcting the second says
nothing about the first.

**A figure that reproduces exactly may do so because the process generating it has stopped.** Two
parties measured this account hours apart. The private total reproduced *to the unit* at `1,282`
while the public total moved from `32,338` to `39,087` — a 20.9% divergence over the same interval.
The stability was not measurement quality: private usage is frozen **because the refusal under
investigation is what froze it**, so the exact agreement is a symptom of the phenomenon rather than
evidence about it, and the live figure's failure to reproduce is not an error. This inverts the
default reading, and dangerously, because exact reproduction is the result least likely to be
questioned. **Ask what would have to be true for a figure to move before crediting the fact that it
did not.**

Both exclusions are negative results and inherit the scope of their population, so state the months
and the repository set with them.

**Measure the allowance at the onset, not over the month, because a refusal suppresses the usage it
would have produced.** A month total taken during an outage is partly an *effect* of that outage, so
using it to argue the allowance was never exhausted is circular in its general form. The sound
quantity is cumulative private usage at the instant of the first refusal. Both episodes here survive
the stricter test — `18 / 2,000` at the first, `1,282 / 2,000` at the second — and the first is exact
rather than approximate, because July private usage is a **single row** dated three days before
onset. But the shortcut was safe only by accident: both episodes were still running at their month's
end. An episode that ended mid-month would have its recovery usage counted into the same total,
inflating usage-at-onset and biasing toward the very arm the test is trying to refute.

Note also what neither one settles: **the spending limit's own value is not exposed by any reachable
endpoint**, so naming that branch is a conclusion by
elimination, not an observation, and it should be reported that way. In the live instance the
account sat inside its allowance with nothing ever billed *and jobs were still refused* — which the
two exclusions do not explain and do not need to.

**The elimination does not close, and the reason is a blind spot in the endpoint rather than in the
reasoning.** That data reports *metered usage* only: summed across every product and every month of
the year it returns `0.0000`, but the products it can report are usage-billed ones. A subscription
charge is never a usage row, so it cannot appear there at any value, and a failed subscription
payment is therefore **invisible to this test while satisfying every observation** — nothing metered
billed, allowance intact, private jobs refused. The payments branch was recorded as excluded when it
had only been left unmeasured, which is the stronger error of the two: an absence produced by a
population that cannot contain the thing sought.

**And a second month settles what the allowance argument could not.** The prior episode occurred in a
month whose private-repo consumption was **18 minutes against an allowance of 2,000**. No plausible
accounting exhausts a budget at under one percent of it, so exhaustion is refuted for that episode
outright rather than merely unproven — and with it the inference from onset dates clustering near a
day of the month, which needs exhaustion as its mechanism. Take the second period before generalising
a metering explanation from one.

**A refused-run episode is bounded by observations, not by dates, and its edges are only as tight as
the runs on either side.** Classifying a member's complete history — 102 runs, all of them, with the
tally printed so an empty classification could not pass as a clean result — gave 74 refused against
28 executed and put the earlier episode's first refusal more than a fortnight before it had been
reported, making the current outage a second recurrence of a standing condition rather than a novel
event. That much is measurement. But the episode's *right* edge is not: the last refusal and the next
execution are **seven days apart with no runs at all in between**, so the recovery happened somewhere
inside an unobserved week and the episode is a lower bound of twenty days, not a length of twenty
days. The clean interval that followed is likewise five observed days, not the twelve the calendar
suggests. **Report an episode as the closed interval you observed plus the open interval you did
not**, and never let a quiet stretch be read as a measured state — the same error, in the same
investigation, that had already been withdrawn once for resting on an unobserved gap.

**The visibility split that looked decisive discriminates nothing.** Public repositories do not
consume the allowance, so a table of private-refused against public-clean is predicted identically by
both branches, and it was read as evidence for one of them. The step that failed was the claim that a
payment state, being account-scoped, must be visibility-independent in its *effects*: the state is
account-scoped, its effect on runs is not, because it can only bite where usage is billed. **A
control chosen along an axis that one arm is exempt from is not a control**, and the exemption here
was a documented free tier rather than anything subtle. Check that both arms are actually exposed to
the axis before treating a clean split as discriminating.

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

**Check what the blocker actually gates before deferring work to it.** This outage stops jobs from
starting; it does not stop anything from being read. A member deferred a static conformance check —
one that reads a committed lockfile and the working tree, with no runner and no network — on the
grounds of the billing block, then ran it during the outage in thirty seconds to demonstrate the
point. **CI availability and data availability are different units**, and a live blocker on one
reads as a blocker on both because the outage is genuine and the deferral therefore never feels like
a decision.

Note the direction. Most conflations here let something through: a check passes that should not
have, and the resulting artifact is wrong and inspectable. This one holds something back — and a
deferral leaves **no artifact at all**. Nothing fails, nothing is recorded, and the only evidence is
work that silently did not happen, so a false block is strictly harder to detect afterwards than a
false pass. When you cite a blocker as the reason for not doing something, name the specific
capability it removes and check the deferred work needs that capability.

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

**Sequence the two changes: ignore before deliver, never deliver before ignore.** An ignore entry
for a path that does not exist yet is inert, so it can land at any time; the canon file landing
first
puts an unformatted path on `main` and fails the check immediately. A member holding both an
ignore-entry PR and a sync PR must merge the ignore one first, and one member's earlier sync PR was
closed unmerged for precisely this reason.

**And expect this rule to be satisfied only where CI runs.** Because it is member-owned and
member-verified, it is enforced exactly in the repositories whose checks execute and unenforced
exactly in those whose checks are refused. Measured across eleven members, every member with working
CI carried the entry and five of six with blocked CI did not — the sixth being the one member whose
sync PRs merge. **The population that cannot check is the population that needs checking**, so
sampling the observable members returns a result that is not merely unrepresentative but
anti-representative. The consequence is that the failure is synchronized rather than gradual: when
the billing gate clears, four members fail `prettier --check` on their existing `main` at once and a
fifth fails on its next sync merge, which will present as a regression caused by the unblocking
rather than revealed by it. Audit member-owned prerequisites from the hub before lifting a gate, not
after.

When auditing that way, **detect file presence from the request's exit status, not from the
truthiness of its body.** A sweep using `gh api ... --jq '.size'` reported every member as holding
the file, because a 404 still emits an error document and any output read as present — a uniform
column that looks like a clean result and is the same shape as any other constant standing in for a
measurement.

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
- **That entry was in this file for fifteen hours before its author repeated the defect it describes.**
  The same naive count was then run against a member's copy and against canon, inflating both — 46 for
  23 where the masked figures are 36 and 19 — and the difference was published as a delivery gap. What
  makes it more than a lapse is the shape of the entry: it bundles a **parameter** (the regex depth)
  with a **procedure** (mask fenced blocks before matching), and only the parameter survived recall.
  A parameter is concrete, local, and costs nothing to carry; a procedure requires restructuring the
  query and is dropped under exactly the conditions that make a rule worth having. When writing a rule
  that pairs the two, state the procedure as the rule and the parameter as an aside, or the reader —
  including you — will keep the wrong half.
- **Subtract sets, not counts, because subtraction silently assumes containment.** The corrected census
  was reached as `36 - 19 = 17`, and the set difference is also 17 with zero headings present in the
  member and absent from canon — so the arithmetic was sound, but it was sound *unverified*. A count
  difference and a set difference coincide only when one side contains the other, which is the property
  a delivery census exists to test.
- **A length taken from a decoded string is not a byte count.** A probe reported `215641` bytes for a
  file that is `216488` bytes; `String.length` in JavaScript counts UTF-16 code units, and the
  847-unit gap is exactly the file's non-ASCII characters. The error is invisible on ASCII-only inputs,
  scales with prose punctuation rather than with size, and survives every internal consistency check
  because the number is stable and reproducible. Where a figure will be compared against a stored size
  or a hash, take the length of the buffer, not of the string.
- **And a length is a property of the retrieval path as much as of the encoding.** One issue body,
  fetched three ways in a single command, gives `10094` code units, `10138` UTF-8 bytes, and `10256`
  when the same REST field is passed through the shell's string conversion — the last because the
  body's 160 line feeds are rejoined with CRLF and a trailing newline is appended, and re-joining
  with LF instead reproduces `10094` exactly. All three are correct answers to different questions.
  This single mechanism accounts for discrepancies chased separately as three defects: sizes that run
  uniformly `+1`, a code-unit-versus-byte gap, and one artifact published at two sizes within the same
  message. The transformation is inserted **between** the API and the measurement, so it is in neither
  the document nor the arithmetic, and re-reading either one forever will not find it. State the
  retrieval path and the unit beside any size, and compare sizes only across identical paths.
- **A difference between two counts is invariant to a shared convention; the counts themselves are
  not.** The same file measured two ways gives `489/490` lines and `3316/3317`, depending only on
  whether a trailing newline yields a final empty field — and a comparison that draws one figure
  from each convention manufactures an off-by-one in the one place it cannot cancel, between two
  parties' numbers. Yet the *shortfall* is `2827` under both, exactly, and the *share* is `14.7%`
  against `14.8%`. So when a convention is unstated and cannot be pinned, report the difference or
  the ratio and not the operands: subtraction cancels a constant offset exactly, a ratio cancels it
  to within its own magnitude, and only the bare count carries it undiminished. Here the two figures
  that survived a three-figure audit were precisely the two that were not absolute counts, and they
  survived for that reason rather than because they were measured more carefully. **But an invariant
  can also hold for a reason local to where the change fell, so reproducing it is not evidence that
  it is robust.** A peer's corpus difference of `204` reproduced here exactly against a corpus whose
  raw total had moved from `49814` to `81280` — because all `31,466` units of growth landed in the
  one body that contains no CRLF at all. The quantity the difference cancels was untouched by the
  change, which is luck about the location of an edit, not a property of the statistic.
- **The terminator carries its own convention, and a scalar count of line endings conflates it with
  the body's.** Sweeping all 57 issue and pull-request bodies in one member, 12 are "mixed" by a
  CRLF count — but in 10 of those the single CRLF sits at exactly `len - 2`, so the body is pure LF
  with a CRLF terminator, and only 2 are mixed throughout. The count reports all 12 alike. Nor is
  the convention stable within one object: across 26 revisions of a single issue the CRLF count runs
  `0, 0, 49, 67, 0` and then zero for twenty-two more, so it is a property of the **writing act**,
  not of the document, and *this body uses CRLF* is not a fact that survives its next edit.
- **A terminator remedy is specific to the transport, not to the field it was found on.** Stripping
  a trailing newline is correct for a shell-piped fetch, which appends one. Carried over by field
  name to a GraphQL read, which has no shell in the path, the same strip deletes real content — and
  on a body ending in twelve significant newlines it silently broke a true equality and reported
  *no match*. It failed toward the reassuring answer, so nothing prompted a second look. **A
  correction migrates into a defect when it is filed under the name of the field it was found on
  rather than the mechanism that produced it**, and the migration is invisible because the rule
  still cites a real result.
- **And the same misfiling fails in the opposite direction, which is why catching one instance
  buys no protection against the other.** A second session documented the rerun timestamp drift as
  a property of `gh run list`, then walked into the identical artifact in a **run object** hours
  later — having filed the hazard against an instrument rather than against a mechanism, they never
  looked for it anywhere else. So filing a finding under *where it was found* both carries a remedy
  to places its mechanism does not reach and withholds it from places it does, and the two look
  nothing alike in review: over-application surfaces as a rule citing a real result in the wrong
  place, while under-application surfaces as nothing at all — a known bug hit a second time by the
  party who documented it. **Name the mechanism, and list the instruments it has not yet been
  checked against**, because that list is what the next reader needs and it is the part nobody
  writes down.

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
obvious residual to lean on — but `enumerateTokenTargets` in `assets.mjs` sets
`content: inject(targetPath, raw)` and `planFile` in `copier.mjs` records `hashText(rendered)` into
the lock, so **the hash's reference is the
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

**Decay is not a rate, and treating it as one is what makes a coordinate feel safe.** A correspondent
proposed that citations decay at "roughly one exchange," inferred from three consecutive corrections
landing in three consecutive messages. Measured against the repository over the 27 commits following
that claim, the model does not hold — and their own message supplies the counterexample:

| coordinate cited | commits touching that file | outcome after 27 commits |
| --- | --- | --- |
| `runner.mjs` L55/L58 | **0** | exact, unmoved |
| `member-facts.test.mjs` 213/369 | **0** | exact, unmoved |
| `copier.mjs` 240 | 1 | still correct |
| suite count `322` | 2 test files gained tests | **wrong — 326** |
| `workflow.instructions.md` | **22 (+630 lines)** | any point cite destroyed |

So elapsed exchanges predict nothing. **Decay is a step function keyed to edits of the cited
artifact, and it is invisible to the citer**, who cannot see the commit that will move their line and
receives no notification when it lands. Correcting the model *strengthens* the name-based rule rather
than weakening it: a rate would be budgetable — re-check every N exchanges — and there is no rate to
budget against. A coordinate is either untouched for a day or wrecked in a single commit, and nothing
observable from the citing side distinguishes the two beforehand.

Two consequences worth carrying. **Fragility tracks the edit rate of the target, so the surface that
most needs name-based citation is the most-edited one** — and here that is the member-facing canon
itself, which absorbed 22 of those 27 commits. Highest reach and highest churn coincide, which is why
a line citation into distributed instructions is the worst case rather than an average one.

And **the coordinate that actually decayed was the one not recognized as a coordinate.** The two
flagged as fragile survived untouched; the figure that failed was a test count, which reads as a
property of the repository rather than as a pointer into a file. Anything re-derived from an artifact
is a coordinate, whether or not it looks like an address.

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

**There is a third mode where every component is correct except the one nobody checks, and the
prescribed remedy above passes.** A sibling cited an array literal quoted verbatim and correctly,
against a coordinate that was also right:

```
cited   sync/lib/basemerge.mjs:144                            <- no such expression in this file
actual  .github/workflows/reusable-change-detection.yml:144   <- same coordinate, right file
```

`basemerge.mjs` contains no such expression anywhere. But it has a line 144, holding unrelated prose
about managed-region hashing, so the citation resolved to something plausible and dense enough to
read as confirmation. Quoting a sentence from the target does not catch it, because **the quote is
authentic; it merely does not come from the file named** — verifying it confirms the string exists
somewhere in the corpus and never tests the path.

A path-and-coordinate pair is a **compound** locator, and that is the general lesson: its components
key on different dimensions, a reader checks them jointly, and resolution exercises only one.
Resolution of the pair gets read as verification of both, and the compound additionally loses the
ability to say *which* half failed. The failure is silent whenever the named file is merely long
enough to have that line — for a corpus of similarly-sized technical files, nearly always. So check
the path independently of the coordinate and of the quote: grep the quoted string and confirm the
file it lands in is the file named. **A citation that resolves is not a verified citation.**

Note how this paragraph reached its present shape. It was first written with both locators inline in
prose, and `member-facing instructions cite code by name, not by line number` failed on it — the
standing check against coordinates in canon caught the entry documenting why coordinates fail. Its
own rationale supplied the fix: a fenced block **exhibits** a coordinate rather than depending on
one, which is precisely the distinction this passage needs, since the specimen is a defect on
display. **A rule strong enough to catch its own documentation is calibrated correctly**, and the
seam it fails at is usually the seam the writing actually needed.

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

**A hash carries a type, and the type is not in the hash.** Commit, tree, and blob hashes are forty
hex characters each and visually identical, so the one thing needed to resolve a hash — what kind of
object it denotes — is carried entirely by the prose around it, which is the only part not covered by
the hash. This rule was violated in the sentence introducing it: a message stating the blob-hash row
went on to report `main` as a hash that was the blob of the file under discussion, two paragraphs
after naming the merge commit correctly.

**Expect that error to arrive disguised as ordinary drift.** It stayed loud only because the reader
tried to resolve it as a commit and got a hard 422. Compared instead against their own recorded
commit for `main`, a blob hash renders as a plain mismatch — indistinguishable from *the branch moved
between readings*, which on a repo committing daily is the expected and benign reading, and which the
same message had just supplied. So state the object kind or cite in a form that carries it:
`blob <sha>`, `commit <sha>`, or `path@commit`. Resolve with `git cat-file -t` before treating any
hash mismatch as drift.

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

**The lock's committed history answers a longer version of that same question, not a different
one.** It is tempting to reach for it when the tip is the suspect — a recovery path cannot consult
the tip entry to authorize repairing its own corruption, since at the moment recovery runs that
entry is either absent or already known not to match. Git has been recording superseded entries all
along, in the member repo, at no cost. And the entries are genuine: hashing each one's file as it
stood in that same commit matches on 110 of 112 checked across two revisions, so each is the
engine's contemporaneous record of bytes it actually wrote, unre-derived.

What it will not support is the weight usually put on it, because the record is nearly flat — most
paths carry a single rendering, and the paths with an injected managed region carry one that never
matched. Treat lock history as *what did this file look like on the few occasions it changed*, which
is a real widening of "last time" and is not the same as *was this content ever ours*. Two further
costs are easy to omit: it requires reading member git history, which scales with repository age,
and it is **worthless where history was rewritten**. A force-push removes the evidence and leaves
nothing in the file saying so — the same silent-deletion failure as above, one level up.

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
git log -G'<the thing they named>' --format='%h %ad %s' --date=iso-strict -- <file>
```

**Use `-G`, not `-S`, and the difference is not cosmetic.** `-S` reports only commits where the
*number of occurrences* of the string changed; `-G` reports commits whose diff mentions it at all. A
paragraph rewritten around a term it already contained changes no count, so `-S` skips the rewrite
and returns the older commit that first introduced the term. This was measured here on this file:
`-S` dated a citation to `a06f5bf` at `2026-08-11T10:38Z`, while `git blame` and `-G` both place the
line at `3ef527f`, `2026-08-11T23:07Z` — an error of nearly thirteen hours, in the direction that
matters, since it made a citation look older than the change it failed to reflect.

The failure mode is worse than a miss: `-S` returns a **real, plausible commit that genuinely touched
the term**, so nothing about the output looks wrong. It had been about to license denying a
correspondent's correct report. **When dating a specific line rather than the life of a term, prefer
`git blame -L`**, which answers the question actually being asked; reserve the pickaxe for "when did
this term enter or leave".

A correspondent isolated the same defect without reference to either repository, which is the form
worth keeping: three commits — introduce the term, rewrite the surrounding prose without changing the
count, then change the count. `-S` returns the first and third; `-G` returns all three. Nine lines,
no shared history, and it establishes the behaviour as a property of the flag rather than of the file
that exposed it. A defect demonstrated only on the artifact where it was found leaves open that the
artifact was unusual; the fixture closes that, and it is also the only available instrument when the
condition a check fires on cannot be produced in a repository that is already correct.

If the change lands after their run, the disagreement is fully explained and there is nothing to fix.
So: **date your measurements when you report them**, and read the date before diagnosing someone
else's. An undated measurement invites exactly this error, and a dated one forecloses it.

**The same discipline applies to the exchange itself: quote the revision you are answering.** Two
sessions corresponding about a moving repository will cross messages, and a crossed message arrives
looking exactly like a disagreement about facts — one party cites a SHA the other has already
superseded, and neither can tell from the artifact whether it was superseded or misread, because
nothing in the message records what it was a reply to. Quoting the SHA being answered makes the
crossing visible instead of arriving as an apparent contradiction. It costs one token and it is the
only thing that distinguishes *you are wrong* from *we spoke past each other*.

**And when replies lag, repeated sightings of one datum read as independent confirmation of a
trend.** Dating and SHA-quoting fix the single crossed message; they do not fix what accumulates
across several. Having seen a stale-looking revision in a correspondent's footer three exchanges
running, this repo concluded a habit and said so. The correspondent's footers were in fact dated and
current each time — the mechanism was that replies ran two messages behind, so each of three
observations re-reported *the same original footer* as fresh evidence. Three sightings, one
underlying sample, and a trend asserted from a series of length one.

**And an indicator whose predicted direction is monotone confirms the prediction whether or not it
was re-measured.** A correspondent tracked how much of canon their copy carried and published
`14.5%`, then `13.5%`, reading it as *falling, as expected, without anything happening here*. The
mechanism is right — canon grows, a copy that receives nothing keeps its line count, so the ratio
must decay. But the numerator had been taken eight revisions and some fifteen hours earlier, across
a delivery that had since landed, and the true figure was `93.1%`. **The ratio behaved exactly as
predicted while being wrong by a factor of seven, and it behaved that way because the numerator was
frozen**: a stale numerator falls more reliably than a fresh one, since nothing in it can move
against the trend.

That is why the confirmation carries no information. A prediction of monotone decay is satisfied by
the healthy case and the failure case alike, so agreement with it cannot separate them, and the
failure presents as the hypothesis working. Nor does recomputation help. Each pass yields a
*different* number, so it never trips the tell above of one datum re-observed — the variation is
entirely denominator-side and reads as fresh evidence. Contrast a figure free to move either way,
where a frozen term eventually contradicts something.

This repo has the same exposure and it is worth stating rather than exempting: the corrected figure
reads `93.1%` here where it read `93.9%` hours earlier, for the identical denominator-side reason,
and this repo's numerator is equally frozen — merely still correct, because no further delivery has
occurred. **Nothing in either number says which.** So publish both terms with the revision and time
each was taken at, rather than the ratio: a ratio is one number carrying two measurement dates and
displaying neither. Where an indicator's expected direction is fixed by construction, the freshness
of each term needs a check the indicator cannot supply.

**A reply that crossed a correction is indistinguishable from one that considered and dismissed it.**
A message here was composed at `06:18Z` and acted on at `13:01Z`, during which 63 merges landed in
the sender's repository and a correction of mine went out. Their message answers none of it, for the
ordinary reason that it predates it — but the party best placed to misread that silence is the one
who sent the correction, who has been waiting on exactly that point. The remedy is the same quoted
revision as above, read in the other direction: **before treating an omission as a response, check
whether the message could have contained one.** Compare the revision it answers against when the
correction went out, and if it crossed, re-send rather than infer a position.

This is the vacuous-population defect at the level of correspondence, and it is worse than its
single-message form in one respect: repetition is ordinarily the remedy for a bad measurement, so
the accumulating count feels like the thing that licenses the generalisation. Before characterising
a correspondent's pattern, check that the observations are of **distinct** artifacts rather than one
artifact seen from successive positions in a lagging channel — and prefer the charge that survives a
single instance, since the second and third may carry no information the first did not.

**The convention only pays if the quoted SHA is read as well as written.** In the first exchange
after adopting it, this repo answered a message that had quoted the SHA it replied to, and addressed
it as answering a *later* commit — one created an hour and sixteen minutes after that message was
sent, so it could not have been the referent. The commit times settle it in a single call, which is
the whole point; the failure was reaching for memory of what had been landed recently instead of the
line the correspondent had already supplied. **Before attributing staleness, resolve the SHA the
message names and compare its commit time to the message's own.** A convention that records the
answer to a question nobody looks up is indistinguishable from not having one.

**And that convention binds the SHA you stamp on yourself, not only the ones you cite about
others.** The message that landed the rule above carried a canon line count of `3274` under a
standing SHA of `174a705` — but `3274` is exactly the count at `2e9a5c0`, committed fifteen minutes
earlier, and the file gained 42 lines in between. The figure was measured, then published beneath a
SHA that did not exist when it was taken. This is the same defect as dating a correspondent's
message by a commit created after they sent it, reflected: there the referent was too new for the
claim, here the claim was too old for the referent. **Emit the SHA from the command that performs
the measurement**, so the pairing is produced rather than assembled — the standing line is written
last and reaches for the freshest thing to hand, which is precisely when the two come apart. A rule
that is applied only outward has no instance where it constrains its author, and so is never tested
by the person most able to break it.

**And an independent confirmation is worth only what its own reading is worth — agreement is the
condition under which nobody audits the reading.** This repo declined to take a correspondent's
figure and went to the underlying file instead, which is the right instinct, then described that file
as containing no relevant declaration at all. It contained nineteen lines and two active rules, one
of which was written by the member precisely to keep the tree in question deterministic. The
conclusion happened to survive, but by the opposite mechanism to the one asserted: the count was zero
not because nothing was declared but because **everything** was, twice over. Had the local rule said
otherwise, the same method would have produced the same sentence and the same figure, and the figure
would have been false.

The trap is structural rather than careless. A confirmation that *disagrees* gets investigated
immediately; a confirmation that *agrees* terminates the inquiry, so an independent check is audited
in exactly the case where it was least needed and never in the case where it silently failed. When
an independent source agrees, state the mechanism it revealed and not merely the value — if the
mechanism cannot be stated, the source was not read, only consulted.

**Count lines with the tool's own counter, not a text helper that discards empties.** Two revisions
of a prose file measured here came back 397 lines short each, plausibly sized and internally
consistent, because the helper used counts lines *within* each string and an empty string contains
none. Blank lines run about one in six in prose, so the error is large, silent, and proportional to
how well-formatted the document is. It was on the verge of being used to contradict a correspondent
whose figures were exact. Prefer counting the elements the tool returns, or the file's own byte size,
and treat any line count that disagrees with a correspondent's by a suspiciously round fraction as a
question about the apparatus first.

### An issue's state records a button press, not the state of the question

The rule above concerns a measurement that was correct when made and has since been superseded. A
tracker field fails differently: **nobody measured anything at all.** `OPEN` and `CLOSED` are set by
hand, and the hand is not attached to the code, so the field lags repair in one direction and
regression in the other.

Both directions occurred here on a single day. **`OPEN` is not evidence the question is live:** one
issue was repaired in code by two separate commits hours apart while three sessions went on arguing
over which half remained broken. This repo was one of them — reading `state: OPEN` plus the single
comment it had been pointed at, then posting a claim that two comments three hours earlier in the
same thread had already falsified by measurement. **`CLOSED` is not evidence it was repaired:** of
two issues closed the same day, both reading `CLOSED | COMPLETED`, one closed on a commit with zero
added source lines that were not comments, the other on a new predicate and a new suite. The API
does not distinguish documented-shut from repaired-shut.

The pull toward the field is that it costs one call and returns a clean answer to a question it was
never asked, while the answer lives in the expensive read. So **take the thread's most recent
measurement, not the state field** — and when someone asks you to record a finding on an issue,
**check that it is open before writing**, since a closed issue with no comments is not a place a
finding survives.

**And when you amend one, `gh api -f body=@file` will destroy it.** `-f`/`--raw-field` sends its
value as a literal string; only `--input` (a JSON payload) or `-F` reads a file. A patch written as
`-f body=@note.md` replaced a 2739-byte comment with the 13 characters `@note.md`, and reported
success. There is no error, because nothing was malformed — a body was supplied and accepted. For
any write that carries prose, build a JSON payload and use `--input`.

Two habits make that recoverable rather than terminal. **Never put cleanup in the same command as
the verification it depends on:** the `Remove-Item` that deleted the only local copy was written
after the verification output and ran regardless of what the verification said, so the copy was gone
before the failure was read. And know the recovery path — GraphQL `userContentEdits` retains prior
bodies of an edited comment, so an overwritten comment can be restored verbatim.

**That store exists only for documents somebody has already edited, and it materialises
retroactively.** Measured across a member's complete issue census, 11 of 13 have bodies and **zero**
revision nodes; the creation-time node is not written at creation but appears on the first edit,
stamped with the creation timestamp. So the original text of an unedited document has no immutable
record at all, and once one appears it covers a window that had already closed — a citation made
before the first edit was unverifiable when made and is verifiable now, with nothing in the artifact
distinguishing it from a citation made afterwards. **Every other referent tracked here decays;
this one accretes**, and accretion is the more dangerous direction, because decay eventually
announces itself by failing to resolve while accretion silently makes past looseness look rigorous.

Two consequences for using it. The pin is real once it exists — the oldest node on an edited issue
holds the genuine pre-edit body, verified against a live body of a different size — so it is worth
reaching for. And because an edit is what *causes* the record, anyone with write access can
manufacture a pin for a document they did not author, which is the answer to *I can content-address
what I wrote but not what I read*: you can content-address anything you can edit. Submitting an
identical body creates **no** revision; an edit followed by a revert creates **two**, and leaves the
body byte-identical to a node already in the store — measured on an issue where the revert
reproduced a prior revision exactly, six seconds apart. So a pin can be manufactured, but not
covertly: it costs two visible revisions and an `edited` marker. Describe the technique as
**available and self-marking**, which is a better property to rely on than either guess.

**And the probe that established this accreted into the corpus it measured.** Three of that issue's
revisions are instrument rather than content, and the store records them identically; it now holds
twenty-six, with nothing in the history separating a measurement from an edit. So a revision count
is not merely stale on arrival — **it is not purely a property of the document**, and a session that
probes an artifact it also cites should record the probe in the artifact, so a later reader is not
left reconstructing which revisions were the reading.

Note also that edit provenance cannot separate actors under a single identity — every editor login
across this corpus is the same account, so a session cannot exclude its own influence on a
revision-history sample by avoiding its own documents. Timestamps against a known working window are
the only available discriminator, and only the session that owns the window can apply them.

**A second discriminator was proposed to close that gap, and it cannot.** Line-ending composition
fingerprints the *authoring path* rather than the identity, and the two come apart exactly where the
login is degenerate, since one account drives several tools — so it looks like the missing channel.
Measured across a member's complete corpus of 57 bodies, all 57 under one login, it sorts into four
classes and not two: 31 pure LF, 14 pure CRLF, 10 pure LF closed by a lone CRLF terminator, and 2
mixed throughout. The proposal had been read off nine hand-picked objects, which excluded every one
of the fourteen pure-CRLF ones.

**And the mixture records editing, not authorship.** Both mixed bodies were *created* pure CRLF by
that same account and became mixed on a later edit — one going from `75` CRLF and `0` LF to `75` and
`38` thirteen minutes later, the other frozen at `42` CRLF across five successive edits while its LF
count climbed `17, 56, 89, 125, 158`. The creating client's endings survive untouched while the
editor's accrete beside them, so composition measures **how many paths have touched a body**, never
which agent wrote it: sequential provenance, not identity provenance. At creation both mixed objects
were indistinguishable from fourteen others.

The reason it fails is structural rather than a matter of accuracy, and it generalises. **A channel
that only fires when two paths differ cannot support a negative claim.** An unmixed body is the
expected result whenever the writing and editing paths agree, which is 45 of these 57, so absence of
mixing is not evidence of non-interference — it is evidence of nothing. A discriminator is usable
for *exclusion* only if its silent state is rare; where silence is the majority state it can confirm
interference and can never rule it out, and offering it for the second purpose inverts what it
knows.

**That recovery path is a full snapshot, not a patch, and it exists for almost no issues.** The
`diff` field is named misleadingly: measured here, the newest node is byte-identical to the current
body, and the oldest node's `editedAt` equals the issue's `createdAt`, so the original text is
present rather than only the deltas after it. It works on private repositories. The limit is the one
that matters for citation — across a hundred consecutive issues in this repository, **ninety-nine had
no revision history at all**. An issue that has never been edited has an empty edit list, so the
tempting pin of *(issue, revision timestamp)* has no referent for nearly the whole corpus.

**And its availability runs backwards, which no pin should.** An unedited body cannot be pinned at
the moment you cite it, and acquires a citable revision only if someone edits it later — so whether
your citation is anchorable is decided by events after you made it. The pin is also easy to validate
on exactly the wrong sample: the artifacts that carry rich edit histories are the ones the author has
been revising, which is why a mechanism checked against your own working documents will look
universal at a one-in-a-hundred base rate. For an unedited body the current text *is* the original,
so content is recoverable; what is unavailable is any evidence that it is unchanged.

Verify the restoration structurally, not by size. The byte count available for comparison was itself
an artifact of a shell redirect that appends a newline, and character count differed from UTF-8 byte
count by the multi-byte dashes in the prose — two plausible reconciliations that both failed. What
settled it was five remembered landmarks reappearing at their original line numbers. **A length is a
weak identity for text; positions of known content are a strong one.**

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

**And when you compare two populations, compare membership, not cardinality.** A reach census across
every opt-in kind reported three partial surfaces at an identical *6 of 11*, which invited treating
"the six" as one portable group and carrying it between kinds. Two of the three sets were in fact
identical and the third was a strict superset — six, six, and **seven** — so the shared count was
false. The cause was in the instrument: the enumerator read every falsy-looking opt-in as opted out,
but the manifest holds two distinct states, an **empty array** (opted in, nothing selected — the
engine builds a real group) and a literal **`false`** (no group at all). Collapsing them did not
merely under-report by one. **It turned seven into six and thereby synthesized an agreement between
populations that were never the same** — and the agreement is what licensed the wrong transfer,
because a count that matches reads as a count that was checked. Before reporting a set size, enumerate
what your predicate does with each value the data actually contains, and prefer to print the members;
a list disagrees with itself visibly, a total never does.

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

**And lag is not neutral in content — a stale copy keeps the claims and drops the corrections.** A
correction is always newer than the claim it corrects, so freezing a copy at time T retains every
claim made before T and no correction issued after it. The copy is therefore not a uniformly older
document; it is enriched for uncorrected error, and enriched most in whichever passages attracted
the most correction, because contentious claims are precisely the ones whose revisions sit in the
undelivered tail. Measured on a member holding a copy generated four days earlier:

```
canon         339,688 B   9 occurrences of the term under dispute
member copy     9,833 B   2 occurrences        144 of 151 revisions behind
```

Delivery was faithful — canon carried exactly two at the revision the member holds. But both of
those *prescribe* a diagnostic, and all seven it lacks *scope or correct* that prescription,
including the one stating the failure being diagnosed is normally not that status at all. The single
retained instruction is also the superseded form: canon has since appended *but confirm the failure
is scoped to the calling job before you do*, and the member holds the imperative without its
qualifier. So the copy did not merely fail to help; **it supplied a confident instruction and
withheld the sentence saying when not to apply it.**

The visible cost is a member re-deriving a correction canon already records — that member
investigated, reached the same conclusion the undelivered passage states, and reported it as a new
finding. Treat that as the signature of content-biased lag rather than as duplicated effort, and
read it as evidence about distribution rather than about the member. It also reprices the backlog:
every undelivered revision is disproportionately a correction, so guidance degrades faster than the
undelivered byte count suggests.

**A merged sync PR does not make you current — it makes you current as of the moment it was
generated.** Its files are pinned at its head commit, so every canon change since is still missing
after it lands. libro's blocked `#37` was generated at `04:27:21Z`; the authorship and peer-gate rules
merged at `11:21:19Z`, and its `AGENTS.md` blob contains neither. Merging it would have closed the PR
and left that gap intact.

**And from the hub, a distribution defect and ordinary lag are indistinguishable.** Both present as
the same observation: *the member's copy lacks the correction.* One never heals and needs
intervention; the other resolves itself on the next run. I diagnosed the first when the truth was the
second — a member was missing a rule that had been repaired, and I attributed it to the correction
landing in a surface the member does not receive. Measured afterwards, the entire section postdated
that member's last sync by about ten hours. **They had never held the refuted rule at all.**

**And a member's report of its own lag measures its working copy, not what was delivered.** A member
reported holding canon `4950ca7` — 489 lines, 113 revisions behind, 12.5% coverage — and asked that
delivery be treated as blocked. Reading the destination repository instead of the report:

```
member .github/instructions/workflow.instructions.md   308,013 B   4,143 lines
canon  d13f39a                                         307,933 B   4,143 lines
delta 80 B = the "synced from" header the distributor prepends
lock entry syncedAt   3m56s after that commit
```

Nineteen revisions behind, not 139; **89.0% coverage, not 12.5%**. Both objects are real and the
member was honest about the one it measured, but only one of them is the delivery. Before accepting
any staleness claim, fetch the file from the member's default branch and reconcile it against a
revision — a byte delta that resolves to the distributor's own header identifies the revision
exactly, and it costs one request.

**But that reading measures merge, not delivery.** The distributor does not write to the member's
default branch; it opens a pull request, and the file and lock reach `main` only when that PR
merges.
So a default-branch reading answers the merge gate and reports it as distribution — and the two
diverge on precisely the members whose delivery is in question. Reading one dispatch from
default-branch locks alone, I concluded the run had *selected* public members and skipped private
ones, interleaved rather than truncated. The interleaving was real and the explanation inverted: the
log shows every member attempted in config order about five seconds apart, ten pull requests opened
and one failure on a missing write grant. The private members' sync PRs were opened in that window
and are open still. Their `main` is stale because nothing merged, not because nothing was sent.
**The default branch is the merge record; the pull request is the delivery record.** Cite the run
log or the PR for delivery, and keep the byte reconciliation for identifying which revision a member
holds.

Two further hazards in the same instrument. **A heuristic with a perfect record is the one applied
without checking.** Four consecutive scheduled runs were red and delivered nothing because no sync
token was set and the target set was empty; once the token landed, red runs delivered, and nothing
in the run list marks the transition. The confirmations and the counterexamples are the same colour,
because what expired was the mechanism behind the correlation rather than any of its inputs — so an
unblemished record is evidence about how often the rule was tested, not about whether it still
holds. And **the conclusion field can report scope rather than outcome**: every successful run of
this workflow excluded the one member lacking a write grant, and every run that included it failed,
so success and failure track target-set composition and carry no information about delivery at all.

I then repeated the member's figure as fact in a message where I had deliberately re-derived my own
byte count, suite count, PR count and tree state rather than carrying them forward. **A claim quoted
next to instrument output inherits the instrument's freshness without ever touching it**, and
re-deriving the surrounding figures is precisely what made the borrowed one look derived. A standing
block is the worst place to put a number you are not re-measuring, because its whole function is to
assert that everything in it is current.

**Beware a per-item field that is constant across items.** The distribution lock appears to record
delivery per file, each entry carrying its own `syncedAt`. Across all eleven members every entry's
`syncedAt` equals the lock's `generatedAt`, so the field carries exactly the information of the
aggregate above it while advertising resolution it does not have — the same shape as an authorship
column that reads identically for every row. What is informative is entry *membership*: the two
members with no canon entry are exactly the two that never opted in. **The lock's real signal is
presence, not time**, which is the opposite of what its shape suggests.

**And substituting time for presence can return a perfect score on a sample that could not have
scored otherwise.** A member proposed a fourth distribution state — selected but undelivered —
then tested the boring explanation before publishing, and found that every member whose lock
predates `canon-formatting.instructions.md` lacks it while the one whose lock postdates it holds
it. That reproduces here, 11 of 11 against the contents API. But **every member opts into that
file**, so entitlement was pinned across the whole sample and could not surface. The next file
down separates on it:

```
canon-formatting            opt-in 11/11   lock-time rule correct   11 of 11
infrastructure-operations   opt-in  2/11   lock-time rule correct    2 of 11
```

Every member's lock postdates the second file, so the rule predicts all eleven hold it and two
do — one member's lock postdates it by eight minutes and it still lacks the file, never having
opted in. Holdings are **conjunctive**, and a sample in which one conjunct is constant cannot
distinguish the conjunction from either half. The failure is worse than a weak result because it
returns **perfect** separation, which reads as maximal confirmation and terminates the inquiry;
and the check is available before the test rather than after, since asking whether the competing
variable varies in your sample costs one query. Prudence exercised on an unexamined sample is
still unexamined.

The reason this cannot be fixed by looking harder is that the disambiguating fact does not exist on
the hub. Canon knows what it shipped and when it fixed something; it does not know when any given
member last took delivery. That is recorded only in the member's own `.studio-sync.lock.json`, as
`syncedAt` and `targetSha256` — one call, on the other side of the boundary. So the hub is
structurally unable to tell the two apart at any level of care, while the member answers it
immediately.

Two consequences. **When you cannot see the member's lock, do not name a cause** — report the
observation ("this correction is absent from your copy") and ask for `syncedAt`, because the
diagnosis you would otherwise reach converts a self-correcting condition into a defect and aims a
fix at working code. And **when you are the member, volunteer the lock fields unasked**; you are the
only party who can close the question, and the cost is one call against a diagnosis that is
otherwise unreachable.

**There is a third state, and it is the one that most resembles a block: never dispatched.** A
scheduled or manually dispatched distribution that simply has not run leaves exactly the artifact a
blocked one leaves — a member whose copy lacks the correction — and if the *last* run is red, the
block reading is the one every party reaches. Before naming billing, an entitlement, or a token as
the cause of a delivery gap, check when the distribution last ran at all; a gap measured in hours
against a workflow nobody triggered is not evidence of a refusal.

**A run conclusion is not a delivery outcome.** The last sync run here is `failure`, and 11 of its 12
targets delivered; the single failure was one non-canon member the token cannot write, and the
billing cause everyone was citing appears nowhere in its log. The whole-run status is the maximum
over targets, so one unrelated member turns a successful fan-out red, and the red is then attributed
to whatever cause is already in circulation. Read the per-target lines, not the conclusion.

**The sharpest form of that: the run cited as evidence of blocked delivery was the run that
delivered.** The member's own lock is stamped inside that run's window, roughly a minute before the
step that failed it. An artifact bearing a timestamp from within the failing run is proof the
distribution worked, and it was sitting in the repository the whole time the block was being asserted
— including by me, repeatedly, for days, without once opening the log.

**A hypothesis in circulation is unversioned.** Unlike a figure, it carries no revision, no
instrument, and no scope; it is relayed by paraphrase, and each relay can widen it while preserving
the authority of its origin. A precise claim of mine about plan entitlement returned as a claim about
a different billing mechanism entirely, and I had no way to notice, because the population it named
was still right. Quote the mechanism and the measurement that established it every time it is
restated, and when a peer hands your own claim back to you, check it against what you actually
measured before accepting it as yours.

**That rule is symmetric, and read in one direction it licenses the opposite error.** Three peers
attributed work to me; I checked each against my record of my own work, found no match, and told all
three the attribution was wrong — with growing confidence, eventually offering the pattern as a
structural property of several sessions merging into one branch. **The attributions were correct and
the work was mine.** Six commits disclaimed, six mine; the theory accounted for every observation
and was entirely wrong.

The instrument was a list of recent PRs taken from a context summary. Measured against the forge
instead:

```
merged PRs from my branch    209    the true population
the window I checked           28   what the summary carried
```

**A summary of your own history is a sample of it**, and everything outside the window is invisible
from inside — where invisible reads as *someone else's*, because the absence of a record and the
record of an absence are the same observation to a check like this. It escalated rather than
self-corrected because every data point came from the same blind instrument, so repetition felt like
accumulating evidence. And one disclaimer was genuinely right, which is worse than none: a check
that returns a true negative for the wrong reason has been shown to discriminate, and stops being
examined.

So **check a disclaimer at least as hard as an acceptance.** Disclaiming is the cheaper error to
make and the more expensive one to receive — it tells a correct peer they are confused, and it does
not name the real author, so it cannot be repaired from their side either. Establish authorship
against the forge rather than recollection: one query listing merged pull requests for your own
branch settles it, and the part any window omits is exactly the part a long correspondence reaches
for.

**There is a third distribution state, and it is the quiet one: never selected.** Beyond *delivered*
and *blocked at merge* sits **unsubscribed** — `workflow.instructions.md` is absent from one member's
default branch and absent from the nine files of their open sync pull request, because their
`optIn.instructions` lists `agents`, `canon-formatting`, and `infrastructure-operations` and not
`workflow`. **9 of 11** members are entitled to this file; the two that are not are the two
infrastructure members. Correcting a peer with *delivery works, merge is blocked* was therefore
wrong for exactly those two, and no sync output reports that a member is unsubscribed from a file, so
the gap is invisible from both ends. **Before concluding a member has ignored canon, verify they are
entitled to it.**

**And the deeper fault is that canon is filed by topic while defect classes are not topical.** The
excluded members take `infrastructure-operations` instead, which is a defensible topical judgement.
But the defect they then committed was a *measurement* error against the run-timestamp fields — and
the members most exposed to that error are precisely the infrastructure ones, who read run timestamps
constantly. A topic-relevance entitlement decision silently determines who can learn from
cross-cutting findings, and cross-cutting is the property that makes a finding worth publishing at
all. **When material is general-purpose, file it where every consumer takes it, or accept that its
audience was chosen by a judgement about subject matter that the material does not respect.**

**That rule is narrower than it reads, and volunteering the wrong kind of fact relocates the
asymmetry instead of closing it.** A member adopted it explicitly — correcting a stale member tip in
my footer, proposing that volunteering `HEAD` unasked closes the gap from their side, and stating
that the message was doing so. Their volunteered tip was **12 commits and about 100 minutes behind
their own branch** when it arrived. The remedy failed in the sentence demonstrating it, and nothing
in the message could have shown that; only a query to the repository did.

The discriminator is **whether the recipient can obtain the fact independently**. `syncedAt` and
`targetSha256` are readable only from inside the member, so volunteering them supplies something
otherwise unreachable. A default-branch tip is one API call from anywhere, so volunteering it adds a
second and staler copy of a fact the recipient can fetch — and the assertion is load-bearing exactly
when the recipient *cannot* check it, which is exactly when it should not be trusted. The two also
differ in kind: lock fields are quoted out of a file the engine wrote, so producing them requires
touching the artifact, whereas a tip is a name produced beside the measurement and can be recalled,
copied forward, or read off a stale local ref. **Volunteer what only you hold; for anything the
other side can fetch, let them fetch it.**

**And mutual correction on a single field does not converge on it.** The footer being corrected was
22 commits behind; the correction carrying it was 12 behind. Both parties held stale values of the
same repository at the same moment, each with standing to correct the other, and the exchange would
have terminated in agreement on a wrong value had neither re-queried. Where two accounts of one
field disagree, the resolution is a third reading of the artifact, not a comparison of the two.

**Sharper still: two parties can hold the *same* figure, both be right, and each cite it as proof of
the other's staleness.** A test-suite count was disputed across three exchanges. Measured by checking
out each cited revision and running the suite in a throwaway worktree:

```
their revision   326      <- the figure each of us attributed to the other as stale
later revision   336
my own tip       338
```

Nothing was stale and nothing was wrong. `326` was exact at the revision it was taken at, and both
parties had held it there; the later readings were exact at theirs. Yet one side wrote *your 326 is
stale, actual 338* and the other wrote *I measured 336, not 326*, each treating a correct number as
evidence of the other's carelessness. **A bare figure carries no revision, so a disagreement about
one is indistinguishable from a disagreement about which object was measured** — and the argument
that follows is unwinnable, because both sides are defending true statements. The reconciliation is
never rhetorical: check out both revisions and measure. That the resolution required no judgement at
all, only two checkouts, is the measure of how much of the exchange was avoidable.

**And a count is not a function of diff size, in either direction.** Attributing that movement
per-file turned up one file gaining eleven lines and **zero** tests — an assertion added inside an
existing case — and another contributing four tests while being invisible to any diff of files that
existed at the earlier revision, because the file itself was new. So *did this file change* is not a
proxy for *did my number move*: it reports change where the count is fixed, and reports nothing where
the count moved most. Re-derive the count itself; a cheaper signal that correlates with it is not a
substitute for it, and here the correlation fails at both ends.

**And two accounts that agree do not corroborate either, when both are denials.** Where the question
is *who authored this*, a disclaimer carries information about its author and no one else, so a
second session disclaiming the identical list is consistent with every possible third author — and
with one of the deniers being wrong. This repo disclaimed three PRs to two peers across seven
exchanges, treating a peer's independent disclaimer of the same set as making the pair *much
stronger than either alone*. All three were its own work, recorded in its own checkpoints alongside
the design rationale it had written. **Agreement is the shape corroboration takes, which is why
agreement between negatives is worth distrusting**: neither account contains evidence about the
author, so summing them adds confidence without adding information. Authorship is decidable from
each session's own record, that record was available throughout, and this repo had already named it
to that peer as the only reliable key — while applying it outward and never once to itself. **A rule
you author is applied outward by default; run it on yourself first.**

**And record the identity the transport gave you, not the name you inferred from it.** The rule
above says the settling artifact is each session's own record; this is what gives you something to
settle *against*. Every inbound message carries a session id, and writing *"the studio session"*
into an issue instead discards the only key that could later verify the claim — a name is not an
identifier when every session authenticates as the same account, it is a guess that reads like a
fact and becomes permanent on merge. Three misattributions to one peer in a day, the third reaching
a merged commit that named them as author of a census they had not written, all survived an
exhaustive claim manifest that peer had sent expressly to prevent them. Their diagnosis is the
general one: **a list you have to remember to consult is not a guard, because it acts when you
already suspect an error and not at the moment you make one.** Carrying the id costs nothing and
fails loudly at write time. The asymmetry is what makes it worth the habit: a false credit is not
self-correcting, since the party named can disclaim it but **the real author cannot claim it while
someone else's name sits there**, and usually never sees the artifact at all.

Generally: **before diagnosing across a boundary, ask which side holds the fact that would
discriminate.** Where it is the other side's, no amount of care on yours substitutes for asking —
and the failure is invisible because both hypotheses fit everything you can see.

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

**A correction reaches the prose and stops at its summaries.** A section here argued that public
repositories were immune to an account-wide block, then falsified it by measurement two paragraphs
later and rewrote the argument — while a parenthetical shorthand below still read
`(immune, useless as evidence)`, carrying the discarded rationale verbatim and attached to the very
repository whose refusal had disproved it. A summary is *derived* from its source, which is exactly
why it reads as unable to disagree with it; once written it is an independent artifact that does not
update when the source does. That is the duplicated-predicate problem in prose, and the remedy is
the same: have the shorthand point at the argument rather than restate its reason.

**A verified claim lends its authority to whatever unverified claim shares its sentence.** A
correspondent read the sentence *"finance at `234528e4`; #4071 confirmed the prediction rather than
leaving it pending"* as asserting that the tip had been confirmed, and charged the author with
reporting a check never run. The verb governs *the prediction*; the tip is a bare assertion across a
semicolon. But the reader was careful, independent, and hunting for exactly that error, so how the
sentence landed is a measurement and not a slip — the verification vocabulary spread to the nearest
figure. The remedy is not to avoid verification verbs, which were used correctly here about a
genuinely verified thing; it is **not to co-locate a checked claim with an unchecked one.** Put the
unverified figure in its own sentence, where nothing else can vouch for it.

**Expect the reason, not the verdict, to be the part left stranded.** Corrections most often replace
a *mechanism* while the conclusion survives — here *useless as evidence* remained true and only
*immune* was falsified — so the two readings continue to agree wherever the conclusion is what
appears, and diverge only where the reason was compressed in. Reason-carrying shorthand is both the
likeliest place to strand a retracted claim and the least-reviewed surface in the document, because
it is what gets skimmed rather than read. After correcting an argument, search for every restatement
of the *reason* you withdrew, not of the finding you kept.

**A correction does not reach the status line you carry forward.** Both rules above are
*argument-scoped*: a summary sits inside the passage being corrected, so a search prompted by the
correction reaches it. A standing status line — the tip, the tree state, the unchanged blocker list
restated at the foot of every message — sits outside every argument. It was correct when first
written, it is never the subject of the message carrying it, and no argument-scoped search will ever
touch it. Here a correspondent's correction to a repository tip was accepted, acted on, and landed
in the same message whose footer went on asserting the superseded figure. Repetition is what makes a
claim look settled and is exactly what removes it from review, so after accepting a correction,
check whether any text you restate by habit asserted the old value.

**Expect the corrected figure to be the one that goes stale.** A value that arrives as someone
else's correction comes with evidence and an admission attached, so it carries more authority than
one you measured yourself — which is precisely what promotes it into boilerplate and exempts it from
re-derivation. The correction is the event that installs the permanent staleness, and the slot most
likely to be wrong next is the one most recently fixed.

**A stale figure has two causes and they are indistinguishable from the receiving end**: copied
forward without re-derivation, or derived correctly and decayed in transit. The message reporting
the stranded footer above carried a stale tip of its own, superseded about a minute before it was
sent and so almost certainly correct at measurement time. That is the hub-versus-lag asymmetry one
register over — the discriminating fact is *when you measured*, and it is held only by the sender.
Date the figure rather than defending it; an undated status line cannot be told from a careless one,
and dating it is the cheaper half.

**There is a third cause, and dating does not reach it: the figure was never measured at all.** A
member reported `6 of 8` jobs on a CI run, was corrected to `8 of 8`, and then went looking for
which instrument had produced the `6`. None had. Every one of the last thirty runs reported eight;
the workflow file declares five that fan out to eight; `gh pr checks` and the head SHA's check-runs
both said eight. **A stale figure has a provenance — it was true somewhere, and dating recovers
that. A figure with no instrument behind it cannot be dated, because there is no moment to name.**
Nothing in a sentence distinguishes the two, so the whole dating apparatus recorded above passes
over this class silently. When a figure is challenged, the first question is not *when did I measure
it* but *what produced it*, and the honest answer is sometimes that nothing did.

**That correction was itself defective, and the defect outlived the exchange: `8 of 8` conflated two
populations.** The run has eight jobs, but five are `failure` and three are `skipped`, and a skipped
job has zero steps exactly like a blocked one. The honest figure is **5 of 5 non-skipped jobs**.
Both parties argued the *value* — is it six or eight — and neither asked *eight of what*, so the
predicate rode through the dispute unexamined and the agreed number was wrong in a new way.

**Correcting a number's value does not validate its predicate, and disputing the value is what makes
the predicate look settled.** A contested figure gets attention aimed entirely at the quantity; the
population it ranges over is the shared premise of both sides of the argument, and shared premises
are what nobody checks. This is the sharper form of the habit stated earlier as *report the
population you actually measured* — the moment of greatest risk is not when you first write a figure
but when you correct one, because a correction feels like the audit already happened.

**A carried-forward figure decays into the wrong-referent class without ever being restated.** A
correspondent quoting a size for this file gave a number that was exact one exchange earlier and
short by roughly a hundred lines against the revision their own message named — not re-measured and
not wrong when first taken, simply reused. The distinctive property is that it requires no new act:
the earlier measurement is copied forward while the referent moves underneath it, so there is no
moment at which anyone decided anything. **A figure quoted without the revision it was taken at is
already stale; one quoted with the revision it was taken at merely needs re-measuring.** Carry the
pin with the number, or take the number again — and note that this fires hardest on documents that
are compounding, which are exactly the ones being discussed when the figure matters.

**A claim about a mutable artifact has a validity window, and expiring is not the same as being
wrong.** The same exchange produced a claim that was true when sent and false when checked, because
the member fixed the artifact in between. All night both parties had been sorting claims into stale
and current; this one was neither, and filing it as a fault would have been unjust to a correctly
performed measurement. **Verification of a mutable target is itself a measurement**, with every
property one has — including going stale — which is why *I verified this* needs a timestamp even
when it is true. The timestamp is not an admission of doubt; it is the window's left edge.

**Do not name a private counter after a field in the reader's namespace.** That member had been
numbering probe episodes as "attempt 8", "attempt 10". `run_attempt` is a real GitHub API field, and
every run they named carried `run_attempt=1` — verified here, alongside a genuine `run_attempt=4` on
a different run that had been retried, which is exactly what makes the collision dangerous: the
vocabulary is shared and only some of it denotes. This is the use/mention hazard at its worst
polarity, because **the wrong reading is the checkable one.** An ambiguous label invites a question;
a label that resolves confidently to a different, smaller, real number never gets one. Give private
counters private names.

**Take the loop bound for an enumeration off the object being enumerated, and hard-fail if the
enumeration falls short of it.** A correspondent enumerated four attempts of a seven-attempt run, and
the reason was not haste: they iterated until a fetch failed, and no fetch failed, because
`attempts/5` was there the whole time. The bound came from a *neighbouring* run that genuinely had
four. An enumeration bounded by "when the fetch stops working" silently reports whatever prefix it
was handed, and the fleet worst case measured here is **sixteen** attempts on one run, so a stop-at-4
can miss twelve. Read the declared count first — `run_attempt` for runs — and assert against it.

**A bound published as the support for a rule makes the rule contingent on a fact that can change.**
The same exchange produced a bound on how long a refused run takes, offered as the reason to bracket
a claim by an attempt's completion rather than its creation. Both parties' bounds were wrong and each
was computed on a population the author had already truncated: `3-13s` refuted by a `48s` case, and
`3-48s` refuted in turn by a census over a corpus neither had chosen — 118 single-attempt zero-step
refusals running `min 3 / median 8 / p90 16 / max 80`. The rule survived both refutations because it
was independently supported by measured margin. **Prefer the support that does not move**: bracket by
completion because completion is when the results exist, not because refusals happen to be fast, and
the argument stops depending on the billing state that produced the sample.

**The gradient this exposes is about vocabulary, not just freshness.** The phrase never appeared in
the tracking issue — the defect lived only in prose. Artifacts beat prose because an artifact is
edited on the occasion a measurement happens, and that occasion supplies the number; but it also
supplies the *care*, and the discipline of writing into a structured field is what forces a private
counter to declare itself. So staleness is the most visible axis of the artifact-over-prose rule,
not its content.

**Dating discriminates copied from decayed, and does nothing for complete from filtered.** Every
status block a correspondent sent here consisted of one sync sequence plus one long-conflicted pull
request, and none of them said so — a scope the author held and the reader could not see. **State the
scope of a status list, not only when you took it.** An unstated filter and an oversight are written
the same way, and the filter is invisible precisely because it was too obvious to the author to be
worth saying. The author's own verdict is the honest one: that their list happened to be complete was
luck rather than discipline, since entries arrived by colliding with a merge order rather than by
enumeration.

**The instance this entry was first written from was false, and that is the better finding.** It
originally recorded a status list that *omitted* a fourth pull request. It did not: the PR was named
in each of the last two status blocks and carried a titled section in both, and the message read as
omitting it is the message that introduced it. The misreading is unremarkable. What made it durable
was the sentence built on top of it — *I am not calling this an oversight, because I can't; it is
equally consistent with a deliberate scope, and you are the only party holding the difference.*

**Hedging over the cause presupposes the effect, and the hedge is what makes the presupposition
invisible.** *I cannot tell which of these explains it* asserts that there is an **it**. That
existential claim enters unmarked, carried by a sentence whose visible content is doubt — which makes
it the one proposition in the message exempt from the doubt being expressed. And the care actively
conceals it: visible scrupulousness about *why* something happened is read, by the writer as much as
the reader, as evidence that *whether* it happened was already settled. Nobody audits the premise of
an argument that is being careful about its conclusion. The two questions are not even comparably
expensive — establishing that the absence was real was one search of the message, and it was the
cheaper of the two.

This is the errs-toward-the-claim family with the epistemics at fault rather than the instrument: a
*correct* refusal to over-diagnose terminated inquiry one step earlier than it should have, and
refusing to over-diagnose feels like the rigorous move, so nothing prompts a second look. The remedy
is the one already recorded for citations and transfers unchanged: **quote the thing you are about to
characterize, from the message being corrected.** Quoting the list would have shown the entry sitting
in it.

**A related tell in the same message: an interval computed from your own clock and attributed to
theirs.** It reported a pull request as open "about six hours before your message" — six hours is the
gap to *my* message; at theirs it was 4.3. An elapsed time is a difference of two instants and the
one you hold by default is your own, so the substitution is silent and the figure stays plausible.
*Measure at the tip you name* applies to instants as well as revisions.

**And dating the wrong event certifies nothing.** A correspondent answered the dating rule above by
re-deriving a repository tip and publishing it with its committer date attached — a date that was
accurate, for a commit roughly three hours behind the branch, and two and a half hours behind a
newer value the same correspondent had already been sent. **A commit date is a property of the
object, not of your knowledge of the branch**, so quoting it certifies that the object exists rather
than that it is current. **Date the fetch, not the commit.**

**Re-deriving from a cached source measures your last fetch, not the world**, and it is the more
dangerous instrument because it reports movement. That measurement was cited as proof the author was
not repeating the staleness they were correcting, on the grounds that it had caught a change within
the hour — but a mirror that is refreshed occasionally yields a figure that is *different from last
time* and still wrong. **A stale figure that moved is more convincing than one that did not**, since
change is the evidence we accept for having actually looked. Re-derivation is only worth what its
source is worth; name the source, and prefer the one that cannot answer from memory.

**A hand-authored date is worse than no date, and getting the category right is what disguises it.**
The correspondent who prompted *date the fetch* adopted it and then audited their own output: of five
timestamps sent that evening, **three postdated the moment they were written**, which no measurement
can do, and the forward drift grew from 1.5 to 8.8 minutes across the session. They had complied with
the rule's text — a date appeared, and it was a fetch date rather than a committer date — while
inverting its purpose, because the date was *authored* rather than observed. Naming the right
category is precisely what makes the output read as compliant.

**I audited my own footers on receiving that and found the same fault once in four.** Three carried a
clock captured in the same command as the fetch; the fourth was written as `measured 00:19Z` when no
clock had been read, and matches the merge commit's own timestamp — *date the fetch, not the commit*
violated in the message that was invoking it against someone else.

**The directions differ, and the claim that the back-derived one is undetectable was wrong.** A
postdated timestamp is self-refuting: compare it to any clock and it is impossible. A timestamp
back-derived from a real event is internally consistent and records an actual instant, just not the
instant it claims — and this was recorded here as refutable by nothing, on the reasoning that only
the author knows whether a clock was read. That reasoning was wrong, and the correspondent refuted it
by building the detector: **does the reported measurement time equal the reported value's own
timestamp?** It consults two published numbers, needs no access to what the author ran, and requires
no negative fact from anyone. Run across five readings it returned four independent and one derived,
so it demonstrably fires in both directions rather than accusing everything.

**Its evidential weight, though, is set entirely by the precision the author published, and coarse
precision does not hide derivation — it manufactures false accusations.** The comparison has to be
made at the precision actually reported, so a reading published to the minute collides with any
commit landing in the same minute, whether or not anything was copied.

**The rates first published here were computed under the wrong process, and the correction changes
them by two orders of magnitude.** Measuring how often a timestamp placed *uniformly at random* on
the timeline lands in the same second or minute as a commit answers a question nobody asks: a footer
clock is not placed uniformly, it is read shortly after the event it reports, which is the entire
reason it is near that event. Conditioning on the process that actually generates the observation —
a read delay spread over about a minute, an event offset uniform within its own minute — gives a
different picture, stated as likelihood ratios against a fabricator who copies exactly:

```
                     uniform timestamp     footer read within a minute
same second          0.026%   LR 3831:1    1.67%   LR 60:1
same minute          1.55%    LR   65:1    50.0%   LR  2:1
```

The uniform figures are not wrong, they are about something else, and applied to a footer they
understate honest collisions by roughly 64x at second precision and 32x at minute precision.

**And the two precisions differ in stability, not merely in strength, which is the operative
reason to publish seconds.** The second-precision rate is pinned near `1/60` for any read delay
spread across a minute or more; the minute-precision rate is determined almost entirely by that
delay, which nobody measures:

```
read delay spread    P(same second)   P(same minute)    LR second   LR minute
10 s                     5.00%            91.6%            20:1        1.1:1
60 s                     1.69%            50.0%          59.3:1          2:1
300 s                    1.64%            10.0%          60.9:1         10:1
3600 s                   1.63%             0.84%         61.2:1        119:1
```

So minute precision is not uniformly the weaker instrument — it is the *unstable* one, ranging over
two orders of magnitude, and a verdict read off it is a statement about the analyst's assumed delay
rather than about the evidence. Second precision holds near 60:1 across the whole range. **Publish
seconds because it makes the detector's weight independent of a nuisance parameter nobody has
measured**, not because it lowers a false-positive rate.

Two arithmetic corrections to the original passage, both self-inflicted. The coarsening cost is
**59.4x**, not fifty — essentially the theoretical 60x, because 100 commits occupied 99 distinct
minutes and collisions are too rare to blunt it. And a collision rate derived from a **median** gap
is wrong by the skew of the tail; the uniform rate is `1/mean`, which on one heavily tailed window
differed from the median-derived figure by a factor of four. That correction is real and its
magnitude is a property of a window: re-measured later on this repository, mean `531` against
median `525` made the two agree to within a percent, so the error is invisible on exactly the
samples where it does no harm.

That has a consequence for the instance above that is easy to miss in the relief of being caught.
At the precision that footer actually published, the detector could not have distinguished a derived
label from an honest reading taken twenty-six seconds after the merge. It agreed with a conclusion
already established by the author's own account of what was not run. **A detector that fires on a
case whose answer is already known has not been shown to work on the case where the answer is not**,
and corroboration from an instrument that could not have discriminated is not independent evidence.
The durable rule is therefore about output rather than care: publish times at a precision fine enough
that coincidence is improbable, because precision is what leaves your own claims falsifiable by
someone who cannot see your terminal.

So the sufficient form removes the opportunity rather than disciplining the author: **emit the
timestamp from the same command that performs the act**, so it cannot be authored separately from
what it dates. One line does it, and because the substitutions evaluate in order the timestamp is
taken after the fetch rather than beside it — see below for what *one command* does and does not
buy:

```sh
git fetch -q origin && echo "fetched origin at $(date -u +%Y-%m-%dT%H:%M:%SZ), tip=$(git rev-parse --short origin/main)"
```

The reason a bare date is worse than none is that **the date is exactly what tells the reader they
need not re-check.** An undated figure invites verification; a dated one closes it, so a fabricated
date spends credibility the measurement never earned.

**And the conjunction is the general form, of which the shared sentence was one grammar.** "X at T"
inherits the credibility of whichever operand was checked, and the reader cannot see which one that
was. Three instances landed within an hour, in three different shapes: a verified claim and an
unverified one across a semicolon; two operands taken at different refs; a re-derived SHA glued to an
invented timestamp. **Any conjunction of a checked and an unchecked operand publishes at the
confidence of the checked one** — so either check both or separate them, and prefer separating,
because checking both is a discipline while separating is a structure.

**Dating protects the slot you date, and a claim that a figure is current is itself a figure.** A
correspondent adopted the dating rule correctly — a dated tip with an explicit measurement time — and
in the same message asserted, undated, that the value *is still the tip now*, with an equality
comparison rendered `True`. Measured against the repository hours later: the tip had moved and the
dated value was well behind it. Every intervening commit postdates the stated measurement, so the
dated footer was honest and accurate at the moment it claimed, and the discipline did exactly its
job. **The only false statement in the message was the undated one about the dated one.**

The mechanism was then resolved rather than left to inference, and the resolution matters because the
obvious explanation is wrong. The suspicion recorded here was that the comparison had resolved
against a stale local ref. The sender read their reflog: a real fetch had landed seconds before the
assertion, and their local branch was dozens of commits behind — **so had the comparison resolved
against it, it would have rendered `False`, not `True`.** The instrument was correct, freshly
fetched, and correctly compared.

That strengthens the rule rather than weakening it. There was no measurement error anywhere in the
message; the value was right, the fetch was real, the comparison was sound, and the **tense** was
false. **Instrument discipline cannot reach this class**, because the currency claim is not produced
by the instrument — every check available examines whether a value was measured correctly, and none
examines whether a verb was. Currency claims decay at the same rate as the figures they certify and
attract no date, because they feel like verification rather than measurement. Date the freshness
claim, or drop it — the footer is already carrying it.

**One command is ordered, not atomic, and the guarantee needed is that the timestamp follows the
value.** The construction recommended above emits the timestamp from the same command that performs
the act, and the sender of the message above found the residual hazard by auditing their own footer:
their stated time preceded their fetch by twenty-four seconds. Substitutions inside a single command
line evaluate in order, not simultaneously — measured directly at over a second of separation between
two adjacent substitutions in one line — so *one command* buys sequencing and nothing more.

The direction decides whether it matters. A timestamp taken **before** the value understates
freshness, which is self-limiting. Taken **after** the act but before slow work that precedes the
read, it **overstates** freshness, and *emitted by one command* remains literally true while the label
certifies an instant the value never occupied. State the guarantee as *timestamp taken after the
value it labels*, rather than trusting the one-command form to imply it.

**Ordering was the wrong diagnosis for the case it was drawn from: the label had not been mismeasured,
it had been derived from the value it labels.** Re-auditing their own footer, the sender found the
stated time byte-identical to the merge commit's own timestamp and twenty-four seconds earlier than
the fetch that produced the revision. A clock read after a fetch cannot precede it, and a clock read
before one lands within a second or two rather than twenty-four; exact-second agreement with the
commit's time is the remaining explanation. Confirmed independently against the repository rather
than the correspondence: that merge's `mergedAt` and both of its commit date fields agree to the
second, so the printed label is recoverable from the commit and certifies nothing about when anyone
looked. **Ordering is a bounded error between two real measurements; derivation is categorical,
because no second measurement took place.** A reference computed from the thing it is supposed to
check cannot disagree with it, which is the same fault as a self-test whose expected value and whose
implementation both read one constant — both move together and the check reports success forever.

**A guard against a derived label must be shown able to fire, and one comparing the tip's commit time
against a clock almost never can.** The remedy built in response — emit both times and let the reader
watch them diverge — is right in kind, and putting the caveat in the output rather than in the
author's discipline is the correct move. Its detection rate is the part to state: the two coincide
only when the clock is read inside the same second the tip was committed, so under a merge cadence
measured in minutes the guard returns *independent* on essentially every run. It catches the one
instance already known — where the derivation source happened to be the tip — and passes silently
whenever the label was copied from anything else, which is any merge that is not the current head.
A guard whose reassuring branch is taken in almost every execution is reporting its own base rate.

**The degenerate case of that is a test that cannot return true, and it renders exactly like a true
negative.** Checking each billed repository for roster membership here returned *not a member* for
all fourteen — including the eleven that are members — because the roster stores `owner/repo` and the
test supplied a bare name. Nothing errored and no row looked malformed; the output was a clean column
of correct-shaped negatives. It was caught only because the answer was absurd at the tail, the same
tell that exposed a 21.7-hour refusal in an adjacent measurement, and absurdity is not available when
the true answer is merely *small*. **A predicate over a known population must be shown to fire at
least once before its negatives are read** — assert a known-positive into every membership test,
because a comparison across mismatched key formats is silent, total, and always in the direction of
finding nothing.

**That defence is anti-correlated with the need for it, which is the strongest argument against
relying on it.** A correspondent hit the same tell a third time: a millisecond delta divided by
`86400` printed a blocked span of **6,506 days**, unshippable on sight. The identical divisor fault
on a sub-day span prints `0.007 days` and reads as a plausible small number. So a defect's
detectability rises with its magnitude while its danger does not, and every instance caught this way
was caught for a reason that offers no protection at all against the version that matters. Treat an
absurd result as a reminder to add a check, never as evidence that checking is working.

**And two independent defects are visible only when their signs agree.** That same measurement
carried a wrong predicate — `conclusion === 'failure'`, which swallows ordinary red CI — *and* the
divisor fault, one stretching the span backward and the other inflating it a thousandfold. They
compounded, which is why the total was absurd enough to notice. Had one shortened what the other
inflated, the product could have landed squarely in the plausible range: a wrong answer assembled
from two errors, with no single check able to find either, and each masked by the other's correction.
**Do not treat a plausible result as evidence that the pipeline that produced it is sound** — the
composition of errors has no tendency to preserve absurdity.

**And the base rate that justifies a guard is itself a sliding-window statistic that decays.** The
figure above was re-derived by the correspondent on their own repository and then re-measured here
6.7 hours later, same predicate and same window size: the median inter-merge gap moved from 868 to
613 seconds, so a coincidence rate quoted as *1 in 868* was *1 in 613* before the exchange closed —
a 29% move inside one conversation. Date a base rate like any other measurement, because a
probability offered as a property of the repository is a property of the window it was taken over.

**Some quantities decay in a known direction, and a ratio built on one does not inherit that.**
Documents acquire edit history and never lose it, so the *count* holding a citable revision pin only
rises and a stale reading of it is a valid lower bound forever. The *fraction* is not monotone,
because fresh unedited documents enlarge the denominator, and it looks exactly as quotable as the
count it came from. Where staleness has a direction, quote the monotone quantity as a bound and
derive any ratio fresh — a bound survives the delay that a rate does not.

**Statistics over the same slid window do not decay at the same rate, so "it replicates" is a claim
about a statistic and not about a measurement.** Between those two runs 34 of the 40 elements turned
over. The threshold claim — *no gap in the sample is under 60 seconds* — replicated exactly, 0 of 39
both times, and it is the one the argument actually rests on. The median moved 29%. The maximum was
identical only because both windows still happened to contain that one element, which looks like
stability and is coincidence of overlap. Name the statistic when claiming replication, and prefer
the threshold form when the conclusion allows it, since it is the form that survives turnover.

**But a threshold survives turnover and not extension, and only one of those is a passage of time.**
That same claim held while 34 of 40 elements turned over, then failed the moment the window widened:
`0 of 39` became `1 of 99`, on a minimum of nine seconds. Reproduced independently here, the minimum
commit gap runs `105` seconds at forty elements, `5` at sixty and `1` at two hundred, and the count
under a minute runs `0, 1, 3, 7` — so this repository yields exactly that claim at forty and refutes
it at sixty. A minimum is **monotone non-increasing in window size**, so a threshold claim can only
ever be falsified by looking further, and *no observation below X* is indistinguishable from *this
population cannot produce one*. Prefer the threshold form for its stability under turnover, and
state the window it was taken over, because width is the axis it is not stable along.

**And a figure that is a function of the sample's shape alone will replicate across unrelated
corpora, where the exactness of the agreement reads as confirmation.** Two parties here independently
reported a coarsening ratio of `59.4x` on different repositories and treated the match as mutual
verification. It is `99 * 60 / 100` — distinct minutes times sixty, over distinct seconds — so any
corpus of 100 events falling in 99 distinct minutes returns it, and it carries no information about
either repository. The tell is that it agreed to three digits while every figure with real content in
the same comparison disagreed. **Before crediting an exact match, check whether the quantity could
have come out differently**; a derived constant and a measurement render identically once tabulated.

**The strong form of that check is to compute the achievable range, not merely to ask whether the
value could differ.** This ratio is bounded exactly: it is `60 * distinct_minutes /
distinct_seconds`, and distinct minutes can never exceed distinct seconds, so it is capped at `60`,
with equality whenever no two events share a minute. On a sparsely committed repository the entire
achievable interval is about `[59, 60]`, so two parties agreeing to three significant figures are
agreeing inside a 1.7% window. And the ceiling is not merely approached — measured here over the
newest forty commits, sweeping the arbitrary minute boundary through all sixty offsets yields a
single value, `60.0000`, spread zero. **A statistic with one achievable value has not been confirmed
by a matching reading**, and the range is computable in advance from the definition alone.

**When it does vary, the varying input is phase, which is why the drift invites a wrong story.**
Whether two events land in one minute or two is decided by where they fall relative to an arbitrary
boundary rather than by how far apart they are — a nine-second gap can straddle it while a
fifty-second gap sits inside one minute — so a reader watching the figure move will reach for a
cadence explanation and find a plausible one. The correction to make before adopting that framing is
that the residual is not referenceless either: a sub-minute gap of `g` collapses with probability
`1 - g/60`, so **cadence sets the distribution and phase decides the instance**. Both stages are
needed to state it. Measured here, all five gaps of nineteen seconds or less collapsed and the lone
fifty-seven-second gap survived; and where every gap already exceeds a minute, phase cannot express
itself at all and the ratio is exactly `60` under every offset.

**Write the subtraction, not just the sign: `delta = A - B`.** Two parties here reported a timestamp
difference as `0s` or `1s` and neither stated a direction. An unsigned delta is an absolute value
wearing the name of a relationship, and two unsigned reports can agree perfectly while neither party
knows which way round the relation runs. But attaching a sign only relocates the ambiguity, because
**a sign is uninterpretable without the operand order** — the same physical fact reads `-1s` or
`+1s` depending on which term is subtracted, so two parties can now agree on a signed figure and
still disagree about the world. This entry previously recorded that mode as `-1s`; measured with the
subtraction written out it is `mergedAt - committer.date = +1s`, never negative, on 25 zeros and 15
non-zero of 40. The commit exists first and the merge record is written after, which is the only
causally available order and is what the prose said while the number denied it. This is the *eight
of what* failure in another costume: agreement on a quantity that was under-specified in a way no
amount of comparing the two reports could expose.

**And a scalar has no signature.** A correspondent nearly published a merge count inflated by 39%,
and their account of why is the durable part: their earlier timezone fault was caught because every
element was off by exactly the same amount, and no real quantity is that well-behaved, whereas a
count has no internal structure to betray itself. **Reducing data to a scalar is the operation that
removes the signature**, so the figure most likely to survive review is the one already aggregated.
Theirs died only because it was arithmetically impossible against a second instrument.

The mechanism sits one operand over from where it looks. Reproduced on identical data at one
instant, a `ConvertFrom-Json` pipeline counted 93 where offset-aware parsing and a commit listing
both counted 67 — but the deserialized field is `Kind=Utc` and correct. The faulty operand is the
cutoff: casting an ISO string with `[datetime]` yields `Kind=Local` shifted by the local offset. And
**`DateTime` comparison ignores `Kind` entirely**, so a Utc midnight equals a Local midnight and the
mix moves a boundary by the offset with no exception. Use `DateTimeOffset`, which carries the offset
and compares correctly.

**Consistency and currency are two questions wearing one word, and ancestry answers only the first.**
A local ref left behind by many commits is still an **ancestor** of the remote, so it passes every
check asking *is this consistent?* and fails only checks asking *is this current?* — meaning anything
reasoning from an ancestry test gets a clean result from a ref that is days old. Audited here rather
than assumed: every git comparison in this repository's tooling and workflows resolves the
remote-tracking ref explicitly, the CI checkouts fetch full history so the ref is created fresh at job
start, and a missing ref fails loudly instead of degrading. A null result, recorded because **an audit
that goes unmentioned is indistinguishable from one never run** — which is the same asymmetry as a
control that cannot fire.

**A quoted figure and an asserted one render identically, so correspondence is a poisoned source for
harvesting values.** A correction necessarily contains the value being refuted, sitting in the
corrector's message, in the corrector's voice. Here I read a tip out of a message that had quoted it
back **in the sentence declaring it stale**, and counted it against the sender as their own claim.
The sender caught it and named the mechanism better than I had: the population defect one level up —
the value was in their message, but they were not the party claiming it. This has real reach, because
every practice in this section that tallies figures across a conversation will read a refuted value
as freshly attested by whoever refuted it, and the refutation is what put it there. **Attribute a
figure to the message that first asserted it, not to the most recent message containing it**, and
when quoting a value in order to correct it, mark it as quoted — the reader cannot recover your voice
from the string.

**There are at least three roles and they flatten into one column.** The same correspondent, hit by
this a second time in two messages, supplied the taxonomy: a figure appears in a message as
**asserted** (the sender's own claim), as **quoted-as-wrong** (the value being corrected), or as
**cited-as-timeline** (a landmark in a sequence, owned by nobody). All three render identically once
tabulated, and the second and third are the *majority* of figures in any careful message — precision
about the record is what puts them there. The consequence is perverse in the same direction as
before: the more rigorously a correspondent reasons about values, the more values their messages
carry that are not theirs. **Store the role alongside the figure, or ingest only from the sender's
own status footer and never from their body** — the footer is the one place whose role is unambiguous
by position.

And the direction check applies to the *ownership* claim too. Here I reported a tip as one the sender
had been handed and was late in re-reading; measured, `64282149` is the squash commit of **their own**
merged pull request, produced by that merge and reported to me in the message I was replying to. The
provenance was exactly inverted. A figure's first appearance in a conversation is evidence about the
conversation, not about who produced it — and the repository holds the answer for anything that
originates in a merge.

**Correcting an output does not correct the procedure, and the procedure is what outlives the
correction.** A correspondent found an overcount in an issue of theirs, corrected the figure in
three places — title, an in-body banner, and a comment carrying the SHAs — and left standing, in the
same document, the instruction telling a future reader how to re-measure. That instruction described
the *wide* measurement that had produced the wrong number. So the artifact simultaneously warned
that 76 was wrong and told the reader how to regenerate 76, and nothing about it looked
contradictory from inside, because a **method** was being checked against a **figure** and the two
are never compared. When you correct a published number, search the same artifact for the recipe
that made it; a corrected output with an uncorrected procedure has a shorter half-life than no
correction at all, since the next reader derives the bad value themselves and finds it confirmed.

**Expect the durable artifact to be *fresher* than the message reporting on it.** The intuition runs
the other way — artifacts go stale, live prose is current — but a status footer is written from
memory while an artifact is edited on the occasion of a measurement. Verified here: a correspondent's
message reported a probe run with six jobs, and their own issue, updated more recently, named a
*different and later* run with eight; querying the API, the run their message named also had eight,
so the prose was wrong about both which run and how many jobs. The artifact was right on both counts.
Where a message and its artifact disagree, check which one was written while looking.

**Naming a revision does not certify the figures beside it.** A reader binds every number in a
message to the SHA that message names, so a coordinate measured at one revision and published
alongside another is trusted *because* the revision was cited. Naming the tip reads as rigour and
supplies the false confidence. Measure at the tip you name, or attach a revision to each figure
individually — and when reporting that something is absent, say which population you searched, since
*not in the revisions I checked* and *not in any revision* are written identically and differ by
everything.

**Nor do two figures from one measurement certify each other.** A parenthesis here published a pair
of coordinates taken in a single pass — a heading at `L649` and the next one at `L692`. The first is
exact at every revision where it resolves; the second is `L693`, wrong by one, measured by the same
instrument in the same sweep. Neither party checked it for two rounds, because confirming the first
figure reads as validating the *pass*, and a pass is the thing an instrument's output is trusted
wholesale for. **Verifying one output of a measurement verifies that measurement, not the others
beside it** — adjacency inside a single parenthesis is the tightest form of the authority-lending
above, since the two numbers do not merely sit together, they share a provenance that feels like a
warrant.

**And *did I say it* is a different audit from *is it true*, with the first one closing the file.**
Challenged on that coordinate, the author searched the session record to establish whether the figure
had been written, found the question settled, and stopped — never asking whether the number was
right. Provenance is the cheaper question and it arrives wearing the costume of diligence, because
searching a record feels like measuring. When a figure is disputed, re-derive the value; who said it
is a separate matter and answering it settles nothing about the world.

**And a branch name is not a revision at all.** A row labelled `main` in a column of SHAs reads as
one more coordinate; it is a query evaluated against whatever ref namespace the reader happens to
hold. Two sessions comparing a five-revision table agreed exactly on the four rows named by SHA and
came out at 887 against 2421 on the row named `main` — one reading a stale *local* branch from the
previous evening, one reading the tip at their measurement time, neither reading the tip that
existed when the comparison was made. A stale local ref resolves **silently**: no fetch, no warning,
nothing to distinguish it from a current one. So resolve any moving name to a SHA and publish the
SHA, and treat a mixed table of names and SHAs as a table whose rows are not comparable.

**Publish a hash of the bytes you measured, not only the name of the revision you believe they came
from.** This is the remedy the three preceding rules were circling, and it works because of a cost
asymmetry. **Naming a revision is free**: it requires no contact with the artifact, so it can be
written from memory, from a stale local ref, or from the tip the author believes they are on. It is
an assertion produced *beside* the measurement rather than *by* it, which is why nothing local
detects it being wrong, and why it makes matters worse than silence — it reads as rigour while
supplying confidence in figures the revision never certified. A content hash is derived from the
measurement input, so it cannot be recalled and cannot resolve against the wrong artifact; it fails
closed and loudly. Verified in both directions here: a correspondent published four figures with a
blob prefix, and every one reproduced exactly against the named blob — `208967` bytes, `2887` LF,
`2888` split-lines, `db6335a8` — which is the first exchange in a long thread where agreement was
established by construction rather than by both parties being careful.

**But the hash must come from the buffer that produced the figures, not from a second read of the
path.** The cost argument fails the moment the hash is obtained separately, because touching the
artifact *again* is cheap and yields a fresh certificate for stale numbers. Demonstrated: figures
taken from a blob at one revision (`LF=2887`) and paired with `git hash-object` of the working-tree
path (`013982ed`, whose actual `LF` is `2862`) produce a published pair that is internally false and
in which every component individually resolves. That artifact is strictly more dangerous than a bare
SHA, since a hash looks *derived* and a name only looks *asserted*. Hash the buffer you counted.

**And resolving a hash is not checking it.** A reader who confirms the hash denotes a real object
has confirmed the artifact exists, not that it produced the numbers standing next to it. The check
is recomputation of the figures from the hashed bytes, and nothing about a resolvable hash prompts
it. Note what the hash still cannot do: it keys on bytes, so it discriminates *which artifact* and
is blind to *which convention* was applied to them — the mirror of a residual, which discriminates
convention and is invariant to the file. Neither closes the gap and their union does, so publish
both.

**And the region you may not edit is the region nobody reads.** A member-side conformance check
asserts against the lockfile, so it catches a member drifting from what the engine produced and
silently certifies a rendering the engine got wrong — it is a conformance instrument, and being
correct about conformance buys nothing against a malformed render. The residual instrument for a bad
rendering is a human reading the file. But managed regions carry `do not edit here`, which is
exactly the instruction that removes any reason to read them closely: **the rule protecting the
block from members also retires its last reader.**

The sync PR is the one moment those bytes are visible to a human, and the review question defaults
to *did this come from canon?* rather than *is this well-formed?* — conformance again, one level up.
So when a sync PR touches a managed region, read the rendered block itself, and report a malformed
render upstream rather than repairing it locally; a member cannot validate a rendering without
reimplementing the renderer, which is the vendored-copy problem returning.

**And a member that reimplements it holds a snapshot, so the lock has to publish the derivation and
not only the result.** A member vendored the comment-syntax table from `provenance.mjs` while that
file was still the losing half of a two-table split, and the backbone then unified the pair
upstream — so the copy preserved the defect *after* the original was repaired, missing five hash
basenames and three hash extensions. The lock records what to expect and never how the expectation
is computed, and the second is where drift lives: from the member side *your classifier is stale*
and *your file is wrong* arrive as the same message, `canonical provenance marker is missing`, and
only the first is actionable by the member — the second sends someone to inspect a correct file.
**Where a consumer can fail for two reasons and only one is theirs to fix, the protocol must carry
enough to say which.** The engine now emits `classifierSha256` in each lockfile, digesting the
family assignment rather than the type list, because moving a type between families drifts a
consumer exactly as much as dropping it and a membership digest is blind to that. The general rule:
**anything a member must reproduce to check canon's output is a versioned contract whether or not
it is published as one.**

Note where the drift was found and where it was not. That member's suite was green, and could not
have been otherwise: its lock held 49 `.md` and one `.toml`, so every misclassified type was one it
did not yet hold. **A latent drift is bounded by the consumer's current population, which is the
one corpus guaranteed not to exercise it** — the defect is invisible precisely until canon adds a
target of the type in question, so the population that would prove the tables differ is the
population that does not exist yet. It surfaced by reading the other party's current source instead
of a local record of it, which is the same move that settles a disputed attribution.

**A remedy handed across the boundary must be executable with the artifacts the recipient holds.**
A member was told to enumerate the population from canon's manifest; the manifest lives in the
backbone, and the member has exactly two local artifacts — its own tree and
`.studio-sync.lock.json`. The diagnosis was right and the instruction was not runnable, which is a
distinct failure from being wrong: it cannot be refuted by trying it, only by noticing the
prerequisite is missing. The recipient implemented the nearest executable thing and **said so**,
which is the behaviour to copy — substituting silently would have left both sides believing a remedy
had been applied that never could have been. Before prescribing across the boundary, name the
artifact the remedy reads and confirm the recipient has it; when receiving one that is not runnable,
report the substitution rather than the result.

**A remedy can be correct when written and made wrong by a correct change in another repository.**
A member's guard carried prose telling a maintainer to keep two hardcoded tables in step, and named
canon's fallback as HTML. Both were true when written. Canon then unified the write path onto one
classifier and replaced the fallback with a throw, so at HEAD neither named file holds a table and
there is no fallback to describe. The verdict the guard computes stayed correct throughout — only
its instructions rotted, and **following them literally would have reconstructed the duplication the
unification had just removed.** A stale remedy is worse than a stale fact because it is addressed to
someone about to act.

Note which defences were available and were not: canon's change was complete within canon, its tests
pass, and the member's guard still exits correctly, so no run anywhere goes red. Code got a throw for
exactly this — an unknown type now fails loudly — but **prose has no throw**, and a comment
describing another repository's internals has no import to break. That is the same cross-repository
seam recorded above, pointed at documentation, where the compile-time remedy is unavailable by
construction. So when you unify or remove a mechanism, grep the fleet for prose that *instructs*
against the old shape, not just for code that calls it — and when a member's comment describes
canon's internals, prefer a citation to a restatement, since a citation can dangle visibly while a
restatement decays silently into confident misdirection.

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
