# ADR-0011: Managed-region placement follows the target's format

## Status

Accepted

## Context

[ADR-0009](0009-canonical-line-ending-normalization.md) added the `attributes` kind, distributing a
generic `* text=auto eol=lf` stanza into members through the same managed-region merge that carries
`AGENTS.md` and `.github/copilot-instructions.md`. That merge has always placed the region the same
way: when a member's file exists but carries no markers, `buildFile` **appends** the block.

Appending is right for Markdown. Markdown has no precedence order — content means the same thing
wherever it sits — so appending keeps a member's own preamble on top, where a human reads it first.

**`.gitattributes` is not Markdown.** Git resolves an attribute by the **last matching pattern**,
and canon's `*` matches every path in the repository. An appended canonical stanza therefore lands
after every member rule and silently outranks all of them.

`jrmoulckers/studio` is the real case. Its `.gitattributes` carries:

```
packages/tokens/dist/** text eol=lf
```

That line exists specifically so the committed `@jrm/tokens` distribution is byte-deterministic
*regardless* of git's text detection, because the sync engine copies those bytes verbatim into
members. Appending canon changed how git resolves it:

| `packages/tokens/dist/js/index.js` | `text` | `eol` |
| --- | --- | --- |
| Member rule alone | `set` | `lf` |
| Canon appended | `auto` | `lf` |
| Canon prepended | `set` | `lf` |

`eol: lf` survives either way, so this was **not a live bug**, and in Studio's case not even a
latent one — the dist contract already forces every file to be UTF-8-decodable, so git's heuristic
cannot misdetect them. But `text: set` → `text: auto` converts an explicit guarantee into a
conditional one, and the line was written to be unconditional. The defect is that the transport
quietly reordered a member's rule beneath canon's wildcard, which the member never asked for and
would not see.

The general shape matters more than the instance. Any member rule more specific than `*` is exposed:
Git LFS entries, `linguist-generated`, `binary`, `-diff` on generated files, lockfile rules. All of
them are legitimate, and all of them would be silently subordinated on first sync.

## Decision

**Placement is a property of the target's format, declared alongside the marker syntax.**

`MARKERS` entries now carry a `placement` field, resolved by the same `markersFor(targetPath)`
lookup that already chooses the comment syntax:

| Format | Markers | Placement | Why |
| --- | --- | --- | --- |
| Markdown | `<!-- … -->` | `append` | No precedence order; product preamble belongs on top |
| `.gitattributes` | `# …` | `prepend` | Last match wins, so canon must come first to stay overridable |

Prepending makes canon a **baseline** the member can override, which is the only coherent reading
of a generic `*` rule. It also makes the correct outcome the default rather than something each
member must know to arrange for itself — and the incorrect arrangement fails silently, which is
precisely when a default should do the work.

Both facts live on one object and are resolved by one function **on purpose**. A second table keyed
independently by kind could drift out of step with the marker table, and the resulting failure —
right syntax, wrong precedence — is invisible in the rendered text.

**An existing region is replaced in place and never relocated.** A member whose block predates this
decision keeps it where it is. Silently reordering lines in a file the member owns is the exact
failure this ADR corrects; doing it unasked, at scale, in eleven repositories, would be worse than
the original defect. Repositioning is a human's call.

## Consequences

**Prepending does not weaken the strengthening behaviour pinned by ADR-0009.** This was the live
risk in the change and was verified with real `git check-attr` before it was made. `game-library`
carries `* text=auto` with no `eol`, and canon now sits *before* it:

```
README.md: text: auto   eol: lf
main.go:   text: set    eol: lf
```

`eol: lf` still holds because git resolves **per attribute**, and the member's later line says
nothing about `eol`. Had resolution been per line, prepending would have silently undone
`game-library`'s fix. The regression test asserts through `git check-attr` rather than string
matching for exactly this reason: the property is git's resolution, not our byte order.

**Migration cost is near zero, because the fleet had barely adopted the kind.** At the time of this
decision, of eleven members: five had no `.gitattributes` at all, four had one without the managed
region, and two had the region — `jrmoulckers/studio`, which pre-seeded it at the top (already the
position this ADR mandates), and `jrmoulckers/docket`, whose only local rule is byte-identical to
canon, so ordering is moot. No member needs a migration PR.

**No member needs to pre-seed the markers, either.** Because canon is prepended, a member's own
rules land after it and remain authoritative on the first sync with no preparation. Pre-seeding was
the correct workaround while the region was appended; it is now redundant for placement purposes,
and documenting it as a requirement would spread an obsolete instruction. Studio's pre-seeded region
remains correct — it is already in the mandated position.

**The `binary` case is why this is not a stylistic preference.** `jrmoulckers/homelab` marks assets
`binary`, which is `-text` — *never inspect this file*. Measured with `git check-attr` against its
real file:

| Path | Today | Canon appended | Canon prepended |
| --- | --- | --- | --- |
| `site/assets/model.glb` | `text: unset` | `text: auto` | `text: unset` |
| `site/img/logo.png` | `text: unset` | `text: auto` | `text: unset` |
| `docker/compose.yml` | `text: set` | `text: auto` | `text: set` |

Appending would have handed binary assets to git's content heuristic. The `main.go` downgrade above
is inert in practice; this one is not, and it applies to every member using `binary`, LFS filters, or
`-text` on fixtures that must retain CRLF. Prepending reproduces the member's existing resolution
exactly, which is the property worth having: adopting canon changes what was previously unspecified
and nothing else.

**Members may still pre-seed, but the region will not be byte-identical.** Placing the markers by
hand remains valid and now agrees with the default rather than compensating for it. What a
hand-seeded region cannot reproduce is the provenance line: `inject()` adds it to the rendered
content, so it does not appear in the canonical source anyone copies from, and omitting it is
guaranteed by construction rather than caused by carelessness. Two members did exactly that
(`jrmoulckers/studio`, `jrmoulckers/jrm-recipes`, both since corrected).

The consequence is small and contained — `findBlock()` matches on markers, replaces in place, and
the first sync writes the correct bytes — but it means **a pre-seeded region is an `update` on first
sync, not a no-op.** Do not read "I copied canon faithfully" as evidence of sync-cleanliness; the
one line that distinguishes them is the one copying cannot supply. See #180.

**Audit rather than infer.** The reliable check is empirical: run `git check-attr` on a
representative file in a member before and after its first sync. Reasoning from the rendered text
is what allowed this defect to ship, because the text looked right in both orderings. For whether a
region is byte-current, `node sync/index.mjs --dry-run --members <name> --work-dir <checkout>` is
authoritative where eyeballing is not.

## Alternatives considered

**Leave `buildFile` alone and pre-seed each member.** Works — Studio proved it. Rejected because it
makes correctness depend on every member (and every future member) knowing an unwritten rule about
git's resolution order, and the failure mode for not knowing is silent. A transport that is only
correct when the destination has been prepared by hand is not a transport.

**Prepend for every managed target, Markdown included.** Simpler: one rule, no per-format branch.
Rejected because it buries each member's own `AGENTS.md` preamble beneath a large canonical block,
degrading the file for the human reader it exists to serve, in order to solve a precedence problem
Markdown does not have.

**Reorder the member's file to place specific rules after canon.** Rejected outright. Everything
outside the markers is member content, and rewriting it is the one thing the managed merge must
never do — the guarantee that makes the merge safe to run unattended.

**Emit the canonical stanza with narrower patterns instead of `*`.** Rejected as unworkable: canon
cannot enumerate the paths of eleven repositories, and `*` is the correct expression of "every text
file, unless the member says otherwise". The fix belongs in placement, not in the pattern.
