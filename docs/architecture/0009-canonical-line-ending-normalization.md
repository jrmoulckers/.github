# ADR-0009: Canonical line-ending normalization

## Status

Accepted

## Context

Line endings were unmanaged across the fleet. Of thirteen repositories surveyed, five had **no
`.gitattributes` at all** — `jrm-recipes`, `score-king`, `cartridge`, `windows`, and this backbone
repo itself. Seven carried the generic `* text=auto eol=lf` stanza: `finance`, `libro`,
`engineering`, `product`, `homelab`, `studio`, `docket`. One, `game-library`, had a file with a
*weaker* rule (see below). Nothing kept these groups from diverging further, because nothing owned
the rule.

This is not a cosmetic split. Without `text=auto eol=lf`, a checkout on Windows materializes CRLF in
the working tree wherever `core.autocrlf` says so, and every formatter that asserts LF then fails on
files nobody touched. `jrmoulckers/jrm-recipes` reported `pnpm format:check` failing on roughly
**964 files** in a fresh Windows checkout. A failure of that size is worse than a broken check: it is
a check that can no longer distinguish a real regression from the ambient noise, in the one place a
contributor is most likely to stop reading.

The obvious fix — open a pull request per repo adding the same three lines — reproduces the problem
it solves. It leaves thirteen independently editable copies of a rule with no owner, which is exactly
the duplicated-normative-text failure [ADR-0003](0003-four-authority-topology.md) exists to prevent,
and the drift would be invisible until the next Windows contributor hit it. `game-library` is that
drift already: it has a `.gitattributes`, but the rule is weaker than canon.

Two members show why a **whole-file copy is the wrong transport**. `jrmoulckers/studio`:

```
# Normalize every detected text file to LF in the index and working tree.
# Git's automatic text detection leaves binary files byte-for-byte unchanged.
* text=auto eol=lf

# The committed @jrm/tokens distribution is copied verbatim into member repos by
# the registry-free sync engine, so its bytes must be deterministic (LF) on every
# platform regardless of core.autocrlf. Keep the whole dist tree LF.
packages/tokens/dist/** text eol=lf
```

and `jrmoulckers/game-library`:

```
* text=auto
*.go text eol=lf
go.mod text eol=lf
go.sum text eol=lf
```

Only the generic stanza is universal. Studio's `dist` rule is Studio's, game-library's Go rules are
game-library's, and other members have their own equivalents — binary patterns, Git LFS filters,
`linguist-generated` overrides. A repository's `.gitattributes` is a genuinely shared file: part
canon, part local.

`game-library` is also the sharper case, because it is not merely missing canon — it *contradicts*
it. `* text=auto` **without** `eol=lf` normalizes to LF in the index but leaves the working tree
platform-dependent, so a Windows checkout still materializes CRLF for everything that is not
`.go`/`go.mod`/`go.sum`. An "append only when the file is absent" transport would silently leave it
broken; a whole-file overwrite would delete its Go rules. The fix has to *strengthen in place*.

## Decision

Distribute the generic stanza as a new canon kind, `attributes`, materializing `.gitattributes` at
each opted-in member's root through the **managed-region merge** rather than a whole-file copy.

1. **Managed region, not whole file.** `MANAGED_MERGE_TARGETS` gains
   `attributes → .gitattributes`, joining `base` and `copilot`. The member keeps every rule outside
   the markers; the engine owns only the region between them. A whole-file copy would either delete
   a member's LFS configuration or report permanent drift, and both outcomes end with the kind being
   switched off.

   The region is appended at the **end** of the file, which is what makes a weaker existing rule
   strengthen rather than win. Git resolves attributes by *last matching pattern*, so canon's
   `* text=auto eol=lf` overrides an earlier `* text=auto` while every more specific sibling rule
   survives. Verified with `git check-attr` against `game-library`'s real file:

   | Path | Before | After |
   | --- | --- | --- |
   | `main.go` | `text: set`, `eol: lf` | `text: auto`, `eol: lf` |
   | `README.md` | `text: auto`, `eol: unspecified` | `text: auto`, **`eol: lf`** |
   | `Makefile` | `text: auto`, `eol: unspecified` | `text: auto`, **`eol: lf`** |

2. **Comment syntax follows the target file.** The marker identifier stays `studio:base` — it names
   "the studio-managed region" and `copilot` has shared it since
   [ADR-0006](0006-runtime-and-copilot-canon-kinds.md) — but the *syntax* is now chosen by
   `markersFor(targetPath)`. Markdown targets keep HTML comments; `.gitattributes` uses `#` lines.
   This is a correctness requirement, not a style preference: git does not treat `<!-- … -->` in a
   `.gitattributes` as a comment, it treats it as a **pattern rule**. The provenance header follows
   the same rule via `HASH_COMMENT_NAMES` in `provenance.mjs`. The two syntaxes deliberately do not
   cross-detect, so HTML markers sitting in a member's `.gitattributes` are member content.

3. **A fourth independent boolean.** `attributes` sits beside `base`, `runtime` and `copilot` in
   `BOOLEAN_KINDS`. An infrastructure member that declines the studio operating guide should still
   get deterministic line endings; the two decisions are unrelated, and ADR-0006 already established
   that bundling unrelated files behind one boolean produces silent opt-outs.

4. **Only the generic stanza is canon.** `packages/tokens/dist/** text eol=lf` stays in Studio,
   outside the markers, where it belongs. Canon does not encode one member's directory layout.

5. **The backbone applies its own canon.** `.gitattributes` at the backbone root *is* the canon
   source, which both fixes this repo (one of the five) and makes the rule self-enforcing: the
   source of the rule cannot stop following it.

## Consequences

- Every opted-in member converges on LF without losing its own attribute rules, and stays converged:
  a later change to canon updates the region in place on the next scheduled sync.
- The seven members that already carry `* text=auto eol=lf` end up with the rule **twice** — once
  local, once in the managed region. This is harmless (identical value, last match wins) and is
  deliberately **not** deduplicated: editing content outside the markers is the one thing the
  managed merge must never do, because that content is the member's. A member may delete its own
  now-redundant line at any time, and the sync will neither notice nor object.
- `jrm-recipes`' ~964-file `format:check` failure resolves once the synced `.gitattributes` lands and
  the affected files are renormalized. The `.gitattributes` change alone updates the index on the
  next checkout or `git add --renormalize`; members with existing CRLF *committed* may need one
  renormalization commit, which is a member-side operation and deliberately not something the sync
  engine performs.
- The managed-merge machinery is no longer Markdown-only. Any future canon file that supports `#`
  comments can be distributed the same way at no additional cost.
- A member that genuinely must not normalize can set `optIn.attributes: false` and keep its own file
  entirely. Nothing is forced.
- The `TargetSpec` type formerly written as `managed-md` is now `managed`, since the mechanism is no
  longer specific to Markdown. This is internal to the engine and the lockfile does not record it.
- **`game-library` is not a member of `studio.config.json`**, so the sync does not reach it and its
  weaker rule stands until someone acts. Adding it as a member is a deliberate decision requiring
  facts this ADR does not have — `mode`, `framework`, `packageManager`, and the exact
  `optIn.instructions` array that `instruction-integrity.mjs` pins — so it is left open rather than
  guessed.
- **`windows` has no `.github/workflows` directory at all.** Nothing here depends on that: the
  `attributes` kind adds no workflow and enforces nothing at CI time, so it is inert where there is
  no CI to run a format check.

## Alternatives considered

**A hand-written pull request per repo.** Fastest to land, and the reason the problem exists.
Thirteen unowned copies drift, and the next repository added to the fleet starts without the rule
again.

**A whole-file `literal` kind, like `agency.toml`.** Simplest transport, but wrong for a file that is
legitimately co-owned. It would have to either overwrite Studio's tokens rule, game-library's Go
rules and every member's LFS configuration, or be perpetually in drift. `agency.toml` can be a
whole-file copy precisely because no member has a reason to add to it.

**Writing `.gitattributes` only where it is absent.** Tempting, and it would have covered five of the
six repos that need something. It fails on exactly the case that matters most: `game-library` *has* a
file, so it would be skipped forever while still materializing CRLF on Windows. "Present" is not the
same as "correct".

**Forcing `packages/tokens/dist/** text eol=lf` on everyone.** Harmless in repos without that path,
but it encodes one member's layout into canon and quietly teaches the next reader that canon is a
place to put repo-specific rules.

**Configuring `core.autocrlf` in CI instead.** Fixes CI and not the contributor's checkout, which is
where the 964 files were observed. `.gitattributes` is the only mechanism that travels with the
repository.
