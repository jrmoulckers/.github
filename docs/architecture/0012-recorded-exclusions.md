# ADR-0012: Deliberate exclusions are recorded, not implied by absence

## Status

Accepted

## Context

The sync engine governs the repositories listed in `members` in `studio.config.json`. Every other
repository in the org is simply untouched. That is the correct behaviour, but it makes two very
different situations indistinguishable from outside the manifest:

- a repository nobody has gotten around to onboarding — a gap; and
- a repository the owner has deliberately decided not to govern — a closed decision.

Both read as "not in `members`". An org-wide sweep therefore cannot tell them apart, and the
cheapest available assumption is the wrong one: an ungoverned repository looks like drift, gets
re-flagged, and the same question is re-litigated by whoever sweeps next.

`jrmoulckers/game-library` made this concrete. It was surveyed during
[ADR-0009](0009-canonical-line-ending-normalization.md) because it carried `* text=auto` *without*
`eol=lf` — a rule that normalizes the index but still materializes CRLF in a Windows working tree.
That made it the sharpest case in the survey, and both ADR-0009 and
[ADR-0011](0011-managed-region-placement.md) cite it repeatedly as the fixture that forced a
strengthening merge rather than a whole-file overwrite.

The side effect is that the architecture record now argues, at length and persuasively, about a
repository that is not a member — and ADR-0009 explicitly left onboarding it open. A reader
following that thread would reasonably conclude the repository was queued for adoption. The owner
has since decided the opposite: `game-library` is private Go tooling, deliberately ungoverned, with
no `.gitattributes` to be hand-added and no sync coverage.

Left alone, the most detailed writing in the repository would keep pointing the wrong way.

## Decision

Record deliberate exclusions in the manifest, in a top-level `excluded` list, each entry carrying a
`repo`, a required `reason`, and the date the call was made.

```jsonc
"excluded": [
  {
    "repo": "jrmoulckers/game-library",
    "reason": "Private Go CLI tooling, deliberately ungoverned by owner decision. ...",
    "decided": "2026-08-10"
  }
]
```

Three properties make this a record rather than a control surface:

**The engine never reads it.** A repository is synced because it appears in `members`, and an
unlisted repository is untouched because it is not there. `excluded` changes no write, skips no
check, and suppresses no report. It is inert by construction, and that is the point — a list that
*could* suppress a write would be a mechanism for silencing drift, and "we decided not to govern
this" and "stop telling me about this failure" must not share a mechanism. Being inert is also what
makes the field safe to trust: it cannot drift away from behaviour it does not affect.

**`reason` is required.** An exclusion without one reproduces the unexplained absence the field
exists to eliminate, in a more official-looking place. Validation rejects a missing or blank reason.

**A repository cannot be both.** Validation rejects any repo appearing in both `members` and
`excluded`. That contradiction would otherwise sit in the file indefinitely, and whichever entry a
reader saw first would look authoritative.

The `game-library` entry also states explicitly that its appearances in ADR-0009 and ADR-0011
describe a merge behaviour and are not a claim that it should be onboarded, and ADR-0009's open
question has been closed in place with a pointer here. The record is only useful if it reaches the
reader who is being misled, and that reader is in the ADRs, not the manifest.

## Consequences

- Absence from `members` now has two distinguishable meanings, and the manifest says which applies.
- An org sweep that finds `game-library` ungoverned has a first-party answer, dated and attributed,
  instead of re-deriving one.
- ADR-0009 no longer carries an open question that has been decided.
- The list is unenforced in the sense that nothing detects a repository that is neither a member nor
  excluded. That is intentional: the backbone has no reliable inventory of the org, and inventing
  one would mean either a network call on every validation or a second hand-maintained list that
  drifts against the first. The field improves the answer for repositories anyone has actually
  looked at, which is the case that was going wrong.
- Adding a repository to `members` later requires deleting its `excluded` entry; validation fails
  loudly if both exist, so the removal cannot be forgotten silently.

## Alternatives considered

**A note in `sync/README.md` only.** Discoverable by a human reading the docs front to back, and
invisible to anyone who starts from the manifest — which is where the member list lives and where
someone auditing membership actually looks. Prose also has no invariant: nothing would notice when a
repository was later added as a member while the note kept saying it was excluded. Documented in both
places instead, with the manifest holding the authoritative entry.

**A per-member `governed: false` flag.** Would put the record next to the members it sits beside, but
it requires an otherwise-complete member entry — `mode`, `framework`, `packageManager`, and the exact
`optIn.instructions` array `instruction-integrity.mjs` pins — for a repository that is explicitly not
being governed. That is a large amount of fabricated, unverifiable metadata to express an absence,
and every one of those fields would then be validated against a repo nobody intends to touch.

**Making the sync report excluded repositories on every run.** Rejected as noise. The exclusion is
static and the report describes work performed; a permanent "these were not synced" footer on every
run trains readers to skip the report's tail, which is where real warnings surface.

**Leaving it implied.** The status quo, and the reason the question came back. `game-library` had
already been surveyed, reasoned about across two ADRs, and left open — and the next sweep would have
started from those ADRs and reached the wrong conclusion.
