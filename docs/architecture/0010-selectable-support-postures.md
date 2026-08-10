# ADR-0010: Selectable support postures in the canonical security policy

## Status

Accepted

## Context

Canon's `SECURITY.md` defined a single **Supported Versions** rule:

> Unless a product repository documents a different policy, security fixes are applied to the
> default branch and the latest actively maintained release line.

with a table row `Latest release line | :white_check_mark: Active, when releases exist`.

The clause is permissive. The escape hatch means a repository that supports only its deployed
default branch is not in violation of anything. But it is **mis-specified**: it installs "has a
maintained release line" as the default posture and casts every other shipping model as a
departure from canon.

Most JRM Studio product repositories are continuously deployed applications, not versioned
libraries. So the common case was required to file its correct, conformant policy as an exception.
Two of two audited product repos did exactly that, against this exact clause, for the same reason:

| Repo | Issue / PR | Recorded deviation |
| --- | --- | --- |
| `jrmoulckers/jrm-recipes` | #660 / #663, merged | Deployed `main` only; no release line exists to backport to |
| `jrmoulckers/finance` | #4031 / #4035, merged | Continuously deployed from `main`, pre-1.0; no maintained release line |

Finance's own policy states the deviations are recorded "so the owner can decide whether canon
should change instead" — the member repo identified this as a canon defect rather than a local
preference.

**The problem is signal, not permission.** A `## Deliberate deviations from the canonical policy`
heading tells a reviewer *this repository diverges; weigh the justification*. An adopted variant
tells a reviewer *this repository conforms*. When the majority case is filed as an exception, the
deviation list stops being a set of claims worth reading, and a genuine divergence — one that
really does need scrutiny — sits in the same table as routine, correct policy. This is the failure
mode [ADR-0009](0009-canonical-line-ending-normalization.md) described in a different register: a
signal that reports so much that it can no longer distinguish the real finding.

It is also a duplication problem of the kind [ADR-0003](0003-four-authority-topology.md) exists to
prevent. Each continuously-deployed repo was independently writing its own prose for the same
posture, in its own words, with its own table. Two repos had already produced two different
descriptions of one policy.

## Decision

Restructure **Supported Versions** into two named, first-class postures that a product repository
**selects**:

- **Posture A — Release line.** Versioned releases that consumers pin to and run independently of
  the default branch. Fixes land on the default branch and are backported to the latest actively
  maintained release line.
- **Posture B — Continuously deployed.** Deployed from the default branch with no independently-run
  released version. The deployed default branch is the only supported version and **there is no
  backport target**, because no older line is maintained that could receive one. A pre-1.0 product
  with no maintained release line selects this posture.

Canon states plainly that selecting a posture is **conformance, not deviation**, and that it does
not need to be recorded as an exception. Each posture carries its own support table. A repository
that later begins publishing maintained releases moves from B to A.

A third clause preserves the original escape hatch for a model that fits neither posture — and
says explicitly that *that* case is a deviation and should be recorded as one. The escape hatch was
never wrong; it was carrying traffic that should not have needed it.

## Consequences

**No engine coupling.** `health` is a `NATIVE_KIND`: the sync engine resolves and reports it but
never writes it, and GitHub serves it by inheritance. Nothing in `sync/` parses or asserts against
this file's internal shape — `studio.config.json` names it in `canon.health` and that is the only
reference. No validator, test, or instruction file reads the Supported Versions section. This
change therefore ships without engine or test changes, which is a property worth stating rather
than assuming.

**This edit does not reach the two repositories that motivated it.** Both carry a local, standalone
`SECURITY.md` — `jrm-recipes` at the repository root (17,785 bytes) and `finance` at `.github/`
(17,178 bytes), against canon's 6,032. GitHub prefers a repository's own health file over the
inherited one, so both overrode inheritance before this ADR existed.
[`workflow.instructions.md`](../../instructions/workflow.instructions.md) permits a deliberate
override, and both hold substantial product-specific content that could not live in canon —
Heirloom's threat model, Finance's data-processing and bug-bounty sections. Canon offers them
something to re-align *to*; it cannot re-align them.

**It makes their deviation tables misquote canon.** Both cite a "Canonical policy" column reading
approximately *"default branch plus the latest release line"*. Canon no longer says that
exclusively. Each repo should delete its Supported Versions deviation row — the behavior it
describes is now the adopted posture — and correct the quotation. That is a change in each repo, in
its own session, not here.

**Deliberately out of scope.** The acknowledgment-timeline conflict (canon 48 hours; `jrm-recipes`
3 business days; finance matching canon at 48h) is a genuine numeric disagreement awaiting an owner
decision, not a structural mis-specification. Folding it in would have bundled a contested number
with an uncontested restructure and made both harder to review.

## Alternatives considered

**Leave the escape hatch as the mechanism.** The existing "unless a product repository documents a
different policy" wording already permits everything the two repos did, so nothing was broken in a
compliance sense. Rejected because compliance was never the issue: the clause produced accurate
policies filed under a heading that misdescribes them, and it scales badly — every future
continuously-deployed member writes the same exception again, in different words. Correct outcomes
reached through the wrong channel still cost review attention every time.

**Invert the default to continuously-deployed.** Simpler, and matches the current majority. Rejected
because it only moves the mis-specification to the other group: libraries would then file
conformant release-line policies as deviations, and the org publishes `@jrm` packages, so that
group is real and growing. The defect is a single default, not which default was chosen.

**Split the policy into two files and have members inherit one.** Rejected on transport grounds.
GitHub's health-file inheritance selects a file by name; there is no mechanism to inherit one of
two variants. It would have required making `health` a written kind, forfeiting inheritance
entirely for a problem that is two paragraphs of prose.

**Encode the posture in `studio.config.json` and validate it.** Attractive because it would make the
selection machine-checkable. Rejected as premature: with nothing writing the file, a manifest field
could record a claim but never enforce or materialize it, so it would assert a consistency the
engine cannot deliver. Reconsider if `health` ever becomes a written kind.
