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
%cI                                              2026-08-11T20:13:02-07:00   honest offset
--date=format-local:'%Y-%m-%dT%H:%M:%SZ'         2026-08-11T20:13:02Z        LOCAL, labelled Z
TZ=UTC ... --date=format-local:'...%SZ'          2026-08-12T03:13:02Z        correct
%ct                                              1786504382                  frame-free
```

`format-local` honours the environment, so **without the environment variable it emits local time
wearing a `Z`** — off by the offset, and now indistinguishable from a genuine UTC reading, where
`%cI` at least declared its frame. That is strictly worse than the disease: the half-applied remedy
converts an honest inconvenience into a silent falsehood, and it defeats the very check a reader
would apply after learning this rule, since the string is `Z`-suffixed and well-formed.

Prefer `%ct`, the Unix epoch, which has no frame to get wrong and no environment to depend on;
convert once at the point of display. The principle generalises past dates: **where a remedy's
correctness depends on an ambient setting, prefer the form that cannot express the error** over the
form that merely requires remembering a flag — a rule whose failure mode is "the author forgets the
second half" has the same standing as no rule.

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

**Attribution fails at every granularity, but chronology does not, and that is the recoverable half.**
Escalating to the finest surface available changes nothing — the per-attempt endpoint carries both
`actor` and `triggering_actor` on every attempt of a multi-attempt run, and both hold the shared
identity throughout, so there is no finer object to appeal to. The same endpoint, however, exposes
each attempt's own creation and completion times, which makes a citation of a mutable field
retrospectively **checkable**: bracket the moment the claim was written against the attempt windows
and the referent resolves, even though the author of the re-run never will. So a mutable field on an
identity-addressed object is *auditable* without being *attributable*, and the per-field timestamp
that was adopted as hygiene turns out to be the audit instrument as well.

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
window where `homelab` was being refused continuously. **An exhaustive scan of one repository is still
a sample of the account**, and here the sampling is performed by the world rather than by the
observer, which is worse: you cannot fix it by widening your window, and nothing in the output marks
it. Only `homelab` has service observed on its left, so only `homelab`'s date is a boundary at all.

The reusable form, which the member supplied: **an extremum is a boundary only if you have observed
the other side; if your window has no other side, you have found the edge of your instrument.** Add
that the window may be defined by the subject's behaviour and not by your query, in which case the
edge is real, unfixable, and indistinguishable from a finding.

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

**The narrow claim inside a scope correction is the one least likely to be re-checked.** Widening the
population feels like the correction, so the inner assertion rides along as if it had been verified
too. Here it was worse than unverified: the pair existed in the very repository whose history was
called insufficient, and the complementary stepped run sat **nine minutes** from the refusal run whose
job census that same member had already reported line by line. The listing was open at the row that
refuted the claim.

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
use-versus-mention, so a document exhibiting a broken locator to illustrate the defect is
indistinguishable from a document containing one — to a checker and to a skimming reader alike. This
generalizes past citations: **any document that carries a counter-example in the same notation as
the real thing has made itself uncheckable.** It bites hardest where the temptation is strongest, in
the docstring of the very guard that detects the pattern, since a verbatim bad example there poisons
every later search of the tree. Name the broken form in prose instead.

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

Both exclusions are negative results and inherit the scope of their population, so state the months
and the repository set with them. Note also what neither one settles: **the spending limit's own
value is not exposed by any reachable endpoint**, so naming that branch is a conclusion by
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
commit landing in the same minute, whether or not anything was copied. Measured against a real merge
cadence with a median gap of about a thousand seconds: a genuine reading collides **0.03%** of the
time at second precision and **1.52%** at minute precision, fifty times more often. At second
precision a match is strong evidence; at minute precision it is a weak signal being read as a
confession.

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
