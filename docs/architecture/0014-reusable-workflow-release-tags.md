# ADR-0014: The backbone publishes SemVer release tags so members' SHA pins can be updated

## Status

Accepted

## Context

`GH-ACT-003` requires every member to call this repository's reusable workflows at a full 40-character
commit SHA, and `instructions/workflow.instructions.md` told members to "configure Dependabot,
Renovate, or equivalent automation to propose SHA update PRs".

That instruction did not work, and a member proved it rather than reasoned it. `jrmoulckers/cartridge`
added a `.github/dependabot.yml` with a `github-actions` entry covering `/` with `patterns: ['*']`.
The first run opened 8 pull requests, every one of them for `actions/checkout` or
`actions/setup-node`, and **not one for any of its seven backbone reusable-workflow refs**.

The cause is upstream and specific: the `github-actions` updater resolves a SHA pin by looking for a
newer **release or tag** in the source repository. This repository published zero of each
(`gh api repos/jrmoulckers/.github/tags --jq length` → `0`), so there was nothing to resolve the pin
against and the ref was skipped — silently, with no PR, no warning and no error. Upstream issue:
[dependabot-core#15577](https://github.com/dependabot/dependabot-core/issues/15577).

The failure mode is the one this repository keeps rediscovering: **a quiet updater and a current pin
produce identical output.** A member reading eight green dependency PRs concludes its automation is
working, and it is — over a population that excludes exactly the refs that matter.

The fleet diverged accordingly. `libro`, `docket` and `score-king` each sit on a *different* stale
SHA, and `cartridge` sat ten commits behind until a human looked.

Staleness here is not cosmetic, which is the argument against deferring this. `reusable-caller-permissions`
checks out `sync/lib/caller-permissions.mjs` **at the pinned revision**. At one older pin, a scan that
read zero workflow files produced zero findings — byte-identical to a clean pass. A stale pin rendered
a broken lint green, so a pin can be out of date in a way that removes a check rather than merely
delaying an improvement.

Two shapes were rejected:

- **Tell members to bump pins by hand on a schedule.** This is what happens today with the schedule
  left implicit, and it produced four members on four different SHAs.
- **Publish a moving major alias (`v1`) for members to track.** A moving alias is precisely the
  mutable reference `GH-ACT-003` forbids. Two members pinned to the same name would carry different
  code at different times, and the immutability that makes a SHA reviewable would be gone.

## Decision

This repository publishes **SemVer tags of the form `vMAJOR.MINOR.PATCH`**, created by the
dispatch-only `Release` workflow (`.github/workflows/release.yml`), which validates the shape and
refuses to move an existing tag.

- **No moving aliases.** No `v1`, no `latest`. Every tag names one commit forever.
- **Dispatch-only.** A person picks the commit and the version. The tag is what the whole fleet's
  pins will move to, so publishing is not left to a schedule.
- **Members still pin a SHA, never a tag.** The tag exists so the updater has a resolution target;
  what lands in a member's `uses:` is the commit the tag resolves to, with the version as the
  trailing comment (`@<sha> # v1.2.0`) so a human can read what a 40-character string means.
- **Semantics.** MAJOR for a change that breaks a caller — an input removed or renamed, a required
  input added, an output withdrawn, a permission a caller must now grant. MINOR for a new optional
  input, output or job. PATCH for a fix with an unchanged interface. The versioned surface is the
  reusable workflows and the scripts they check out at the pinned revision; canon assets travel by
  sync and are not part of it.

## Consequences

Members with a `github-actions` Dependabot or Renovate configuration begin receiving pin update PRs
once the first tag exists — and not before. Until then a quiet updater still means nothing, which is
worth saying out loud to anyone auditing pins in the interval.

Publishing becomes a deliberate act with a cost: a change to a reusable workflow does not reach
members until someone dispatches a release. That is the intended trade. The alternative — members
tracking `main` — is the mutable reference the principle rules out.

The first tag is `v1.0.0` against the current state of the workflows rather than a reconstruction of
history. Backfilling versions onto past commits would invent a compatibility record nobody verified.
