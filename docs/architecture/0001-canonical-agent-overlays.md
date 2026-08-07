# ADR-0001: Canonical agents with product overlays

## Status

Accepted

## Context

Studio repositories need consistent, reusable agent capabilities without erasing product-specific
stacks, paths, ownership, and risk controls. Copying complete role definitions into every product
causes drift. Relying on owner-level inheritance would avoid copies, but official runtime discovery
of custom agents from an owner `.github` repository has not been verified. The current runtime
discovers repository-local `.github/agents/*.agent.md`.

The sync engine already distinguishes canonical source paths (`agents/`) from materialized consumer
paths (`.github/agents/`) and protects generated files with provenance plus lockfile drift
detection. Root `AGENTS.md` also has a managed canonical block and product-authored content outside
it.

## Decision

1. Keep product-agnostic persona, capabilities, workflow, ownership seams, and role-specific gates
   in canonical `agents/*.agent.md`.
2. Materialize opted-in agents into each consumer's `.github/agents/` directory. Treat those files
   as generated artifacts until official inheritance is verified end to end.
3. Keep concise product stack, paths, commands, domain constraints, and additional risk guidance in
   product root `AGENTS.md` content outside the managed block and in scoped instructions.
4. Apply mandatory studio safety first, product overlays second, and generic canonical role guidance
   third. Local guidance may narrow or specialize behavior but cannot relax mandatory human gates.
5. Allow genuinely product-only agents. A same-slug local replacement is supported only when the
   member declares it in `localAgents` and an explicit opt-in list omits the canonical file. Never
   select both or edit a generated materialization.
6. Validate canonical agent filenames/names, schema, sections, roster parity, and declared
   role/skill references before sync planning.

## Consequences

- Wildcard opt-ins receive new canonical roles automatically; explicit subsets remain deliberate.
- Reusable improvements land once and flow through reviewable sync PRs.
- Existing authored consumer copies can be reduced by moving product facts into overlays, but
  synced `.github/agents/*.agent.md` materializations cannot be removed today. Explicitly declared
  local replacements remain authored files.
- Product overlays remain small and authoritative without forking generic role bodies.
- The repository-local materialization cost remains until the runtime supports and documents
  central custom-agent inheritance.

## Alternatives considered

**Keep every product agent fully local.** Rejected because shared fixes and safety improvements
would continue to drift.

**Remove consumer files and rely on owner inheritance now.** Rejected because runtime discovery is
not verified; removal could make the agents disappear.

**Merge product additions into generated agent files.** Rejected because per-file merging creates
ambiguous precedence and weakens deterministic drift detection.
