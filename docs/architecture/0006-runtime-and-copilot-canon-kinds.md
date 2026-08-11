# ADR-0006: Independent runtime and Copilot-surface canon kinds

## Status

Accepted

## Context

The backbone distributed `AGENTS.md` and `agency.toml` together as a single `base` kind, selected by
one boolean. That coupling had a consequence nobody chose: an infrastructure member that declined the
studio operating guide — because its own root guide is authoritative for a homeserver or a device
fleet — also silently declined the reviewed MCP server and tool-allowlist policy. Three members
(`studio`, `homelab`, `windows`) were in exactly that position, running with no canonical runtime
policy at all, purely as a side effect of how two unrelated files had been bundled.

At the same time, `.github/copilot-instructions.md` was not canon in any form. Four members had each
written their own. Because GitHub Copilot reads both `AGENTS.md` and `.github/copilot-instructions.md`
on its surfaces, the natural thing for a member to write in that file was a restatement of the
operating policy it had just read — and one member had restated the entire Human-Gated Operations
section verbatim. That is precisely the duplicated normative text
[ADR-0003](0003-four-authority-topology.md) forbids: two copies, no identifiable owner, guaranteed
drift.

The engine could already solve the second problem. `basemerge.mjs` materializes a canonical region
between `studio:base` markers while leaving everything outside them member-owned. That mechanism was
hardcoded to `AGENTS.md`.

## Decision

Split the former `base` kind into three independent boolean kinds, and generalize the managed-region
merge so more than one file can use it.

| Kind | Canon | Target | Materialization |
| --- | --- | --- | --- |
| `base` | `AGENTS.md` | `AGENTS.md` | Managed-region merge |
| `runtime` | `agency.toml` | `agency.toml` | Whole-file copy |
| `copilot` | `copilot-instructions.md` | `.github/copilot-instructions.md` | Managed-region merge |

Each is selected by its own boolean. Declining one says nothing about the others: a member may take
canonical MCP policy and Copilot orientation while keeping a locally authored operating guide.

`copier.planAgentsMd` becomes `planManagedMd` and resolves its target from `spec.targetPath` rather
than a hardcoded file name. `MANAGED_MERGE_TARGETS` in `manifest.mjs` maps each managed kind to its
required target path, and manifest validation enforces two rules: a managed kind declares **exactly
one** file, and it resolves to **exactly** its mapped path.

### Division of content between the two managed files

`AGENTS.md` owns policy: golden rules, the Definition of Done, the issue-first workflow, and the
human gates. `.github/copilot-instructions.md` owns Copilot-surface orientation: what the installed
AI layer is, how to use the agents, skills, prompts, and scoped instructions, what read order to
follow, and that generated files must not be edited locally. It states that `AGENTS.md` is
authoritative and, where the two could appear to conflict, that `AGENTS.md` wins.

The canonical Copilot block must never restate a rule `AGENTS.md` owns. Members keep repository-
specific Copilot orientation outside the markers, where sync never touches it.

## Rejected alternatives

**Add `copilot-instructions.md` to the existing `base` kind.** Rejected because it reproduces the
exact coupling this ADR removes: the three members that most need Copilot orientation are the ones
with `base: false`.

**Generate `.github/copilot-instructions.md` as a pointer file with no local region.** Rejected
because members demonstrably have legitimate repository-specific Copilot guidance — design context,
inventory-parsing rules, host-change protocols — and a whole-file copy would either destroy it or
report permanent drift.

**Make `.vscode/mcp.json` a canonical kind alongside `agency.toml`.** Rejected for now. It is an
editor-specific format for one host, while `agency.toml` is the runtime-agnostic policy. A member
with genuine additional server needs keeps a documented local overlay whose divergence from
canonical policy is visible rather than assumed.

**Leave the coupling and hand-copy MCP policy into the three affected members.** Rejected because
hand-copied canon is the failure mode the sync engine exists to prevent, and because the lockfile
would report it as drift forever.

## Consequences

- Every member now receives canonical MCP policy and Copilot-surface orientation, including the
  three infrastructure members that previously received neither.
- The managed-region merge is reusable. A future canonical file that must coexist with member-owned
  content needs a `MANAGED_MERGE_TARGETS` entry and nothing else.
- Members' existing `.github/copilot-instructions.md` files are preserved: the first sync inserts a
  managed region and leaves all local content in place, exactly as the `AGENTS.md` rollout did.
- Two validation rules now fail loudly where the old shape failed silently — a managed kind with two
  files, or one relocated away from the path Copilot actually reads.
- `optIn.base` no longer implies runtime policy. Any future member entry must set all three booleans
  deliberately; the manifest's `optInSyntax` comment records why.
- Preserving local content has a cost paid once per member: the first sync leaves each member holding
  both the canonical block and whatever policy it had already written by hand, so the duplication
  this kind exists to remove survives until that member trims its local region. Trimming cannot be
  automated — only a reader of the file can tell a restated rule from a genuinely local one.
- Landing a canon kind in a **formatted** path is a cross-repo event, not a backbone-only one.
  `.github/copilot-instructions.md` falls under members' `prettier --check .`, and canon is not
  formatted to any one member's config, so this kind's first distribution failed CI in four members
  until each ignored the path. That config is member-owned, so the sync cannot fix it; see
  [`docs/sync.md`](../sync.md#members-must-exclude-canon-from-their-formatters).
- Member-side asset validators that assumed "synced file" meant "whole-file Markdown copy" need
  updating: managed-region files hash only their inner block, and `agency.toml` carries a `#`
  provenance comment rather than an HTML one. Both assumptions were live in `jrmoulckers/homelab`
  and produced false failures on first sync.
- **The rollout's three defects were one pattern: a rule keyed on the wrong unit.** The two above
  keyed on the file rather than the managed block, and on one comment syntax rather than the target's
  own; canon separately declared `.github/` read-only, keying on the directory rather than each
  file's provenance marker, which is wrong wherever canonical and member-authored agents share a
  directory. Each rule was right for the common case and silently wrong for a legitimate one, because
  its unit was coarser than the unit the property varies over — canonical content varies per block,
  comment syntax per file type, provenance per file. Such rules cannot be repaired case by case:
  special-casing `.toml` would have re-broken at the next kind in a new file type, and no path-shaped
  rule about `.github/` could ever have been correct. When writing a rule about canon, identify the
  unit the property actually varies over and key on that, preferring the marker or lookup the engine
  itself uses over a path- or filename-shaped proxy.

  Two further instances arrived after this was first written, and both sharpen it. Conflict-resolution
  guidance told members to take canon's side wholesale — file-shaped advice that silently reverts
  merged member work in a managed-region file. And the fix for the `.github/` defect, which moved the
  provenance rule from the directory to the file, itself became a wrong-unit rule at the next level
  down: the marker scopes a *region*, so a reader applying the per-file rule literally stops
  maintaining the member-owned section. **Fixing an instance can create the next one**, which is the
  argument for naming the pattern rather than repairing cases as they appear.

- **Diagnostic: suspect the unit before the content.** What makes this pattern a debugging trap
  rather than a design nit is that a coarse-unit rule does not error. It quietly matches nothing, or
  matches too much, and the result reads as ordinary drift — a content problem, at the boundary of
  the coarse unit, far from the rule that caused it. So: **when a check reports drift on content you
  have independent reason to believe is correct, suspect the unit the check is keyed to before
  suspecting the content.** That is what turned "`agency.toml` is unstamped" into "the checker
  hardcodes one comment syntax," and it is cheaper than rediscovering the same shape per instance.
  The corollary for authors: a rule that can only fail silently needs its authority read, not
  summarized — see the provenance table note in `docs/sync.md`.
