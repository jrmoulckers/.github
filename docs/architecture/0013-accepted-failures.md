# ADR-0013: A known fault is recorded and narrowed, never allowed to hold the alarm

## Status

Accepted

## Context

The sync run publishes one bit. That bit has been red on every scheduled run since 2026-07-13.

`jrmoulckers/windows` is a governed member whose clone 403s: `STUDIO_SYNC_TOKEN` carries no write
access to it, so the engine cannot read the repository at all. The engine handles this exactly as
designed — it isolates the failure, warns, syncs the remaining eleven members normally, and exits 1
naming the target that failed. Nothing about the delivery path is broken.

The alarm is what broke. Five consecutive scheduled runs failed for one owner-gated reason that no
agent can fix, and the run list cannot distinguish that steady state from a fleet-wide outage. A
monitor that is always red has no detection power: the next genuine failure produces the same red
bit in the same place, and nobody looks, because the last five meant nothing.

[ADR-0012](0012-recorded-exclusions.md) settled the neighbouring question — a deliberate absence is
recorded rather than inferred — and `renderRunSummary` had already addressed half of this one by
naming what succeeded, so the red is *legible*. But legibility is only available to a reader who
opens the run, and detection happens before anyone opens anything.

Two shapes were rejected:

- **Remove `windows` from `members`.** This is the `excluded` mechanism, and it would be a lie: the
  owner has not decided to stop governing the repository, only failed to grant a token. It would
  also make the member silently disappear from every count in the fleet.
- **Downgrade clone failures generally, or failures at `windows` generally.** This is the defect
  rather than the fix. A class-wide downgrade absorbs the next unrelated failure, and — worse — it
  outlives the fault that motivated it. The exemption stays after the grant lands, and no one ever
  learns that it is now suppressing something real.

## Decision

`studio.config.json` carries an `expectedFailures` array. Each entry names a `repo`, the `signature`
matched against the failure message, the `reason`, and the `issue` that closes it. A recorded
failure does not fail the run. Everything else does.

Three constraints make this a narrowing rather than a downgrade, and all three are enforced:

1. **Pinned to the fault, not the repository.** The entry matches only when repository *and*
   message signature both match. `windows` failing for any other reason is unexpected and red.
2. **Self-liquidating.** If a recorded repository is contacted and does *not* fail, that is a
   blocking error instructing the operator to delete the entry. The record cannot outlive its
   fault, because the run that would let it do so is the run that goes red.
3. **Never silent.** Expected failures are printed, counted as failures in the run summary, and
   annotated with their issue. Green means "delivery is healthy apart from a fault the owner has
   already seen and recorded" — never "all clear", and never that the member was synced.

Staleness is only evaluated for repositories the run actually contacted. A member-filtered or dry
run says nothing about whether a fault is fixed, and reading "recovered" from a repository nobody
called is absence mistaken for evidence.

`expectedFailures` is the inverse of `excluded` and its validator inverts accordingly: an excluded
repository must **not** be a member, while an accepted failure must be one. A fault can only be
accepted where the engine actually calls; recorded anywhere else it is inert on arrival and stale
forever after.

## Consequences

The next real sync failure is visible, because the steady state is finally green.

The cost is that a member can be unsynced while the run is green, which is precisely the condition
the record must keep loud. It is mitigated by the required `issue` — an accepted failure with no
route to a fix is indistinguishable from an abandoned member, so the manifest refuses one — and by
the summary continuing to count the member as failed.

When the token grant lands, the run goes red with `recorded in expectedFailures but synced
successfully`. That is the design working: the fix announces its own arrival instead of being
absorbed by the exemption that was waiting for it.

`partitionFailures` in `sync/lib/runner.mjs` holds the logic; `sync/test/runner.test.mjs` pins all
three constraints, including the two ways staleness can be got wrong.
