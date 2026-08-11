// Lock reconciler: keep lockfile keys attached to the current resolved plan.
//
// The lockfile is keyed by `targetPath`. That key is stable only while a member's target
// base is stable. When a base moves — a member gains a `tokens.targetPath` override, or the
// manifest repoints a kind — the entries the engine wrote under the old base stay behind and
// the files at the new base have no baseline at all.
//
// That is not a cosmetic problem. `copier.isLocallyModified()` treats an *unrecorded* target
// whose bytes differ from canon as a conflict, so every relocated file is classified as drift
// and skipped. Nothing ever writes it, so it never converges: each run reports it, `--check`
// fails on it forever, and the vendored content stays frozen at whatever the old base last
// received. Losing the key loses the engine's own record that it wrote the file.
//
// So on every run, before planning, the lock is reconciled against the plan:
//
//   rekey — a planned target with no entry adopts the entry orphaned at the same
//           plan-relative path under an abandoned base.
//   prune — an orphaned entry whose path no longer exists in the member is dropped.
//
// Rekeying is only safe when the correspondence is unambiguous, so it is restricted to
// bijective matches: the orphan must match exactly one planned target and that target must
// match exactly one orphan. Anything ambiguous is left alone rather than guessed at — a wrong
// baseline would suppress a real drift signal, which is worse than the stale key it replaces.
//
// This module never touches files. Entries are moved and dropped; nothing outside the plan is
// deleted from disk. An abandoned file left behind at an old base is a separate decision for a
// human, and pruning its lock entry is deliberately conditioned on the file already being gone.

import { existsSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Reconcile `entries` against the resolved plan.
 *
 * @param {string} memberRoot  member checkout (used only for existence checks)
 * @param {TargetSpec[]} writes  the resolved plan
 * @param {Record<string, object>} entries  lock entries (not mutated)
 * @returns {{ entries: Record<string, object>, rekeyed: Array<{from: string, targetPath: string}>,
 *            pruned: Array<{targetPath: string}> }}
 */
export function reconcileLockKeys(memberRoot, writes, entries) {
  const next = { ...entries };
  const planned = new Set(writes.map((spec) => spec.targetPath));
  const orphans = Object.keys(next).filter((key) => !planned.has(key));

  const rekeyed = [];
  for (const { from, to } of matchRelocations(writes, next, orphans)) {
    next[to] = next[from];
    delete next[from];
    rekeyed.push({ from, targetPath: to });
  }

  const pruned = [];
  for (const key of Object.keys(next)) {
    if (planned.has(key)) continue;
    if (existsSync(join(memberRoot, ...key.split('/')))) continue;
    delete next[key];
    pruned.push({ targetPath: key });
  }

  return { entries: next, rekeyed, pruned };
}

/**
 * Pair orphaned keys with planned targets that lost their baseline, matching on the
 * plan-relative path so only the base differs. Returns bijective pairs only.
 */
function matchRelocations(writes, entries, orphans) {
  const candidates = new Map(); // targetPath -> Set<orphan key>
  const claimedBy = new Map(); // orphan key -> Set<targetPath>

  for (const spec of writes) {
    if (entries[spec.targetPath]) continue; // already has its own baseline
    const rel = planRelative(spec);
    if (!rel) continue;
    for (const key of orphans) {
      if (key === spec.targetPath || !key.endsWith(`/${rel}`)) continue;
      if (!candidates.has(spec.targetPath)) candidates.set(spec.targetPath, new Set());
      candidates.get(spec.targetPath).add(key);
      if (!claimedBy.has(key)) claimedBy.set(key, new Set());
      claimedBy.get(key).add(spec.targetPath);
    }
  }

  const pairs = [];
  for (const [targetPath, keys] of candidates) {
    if (keys.size !== 1) continue;
    const [from] = keys;
    if (claimedBy.get(from).size !== 1) continue;
    pairs.push({ from, to: targetPath });
  }
  return pairs;
}

/**
 * A spec's path relative to its group's target base — the part that survives a base move.
 * Returns null when the spec carries no base (managed root files such as AGENTS.md sit at the
 * repo root and cannot be relocated), so those are never rekeyed.
 */
function planRelative(spec) {
  const base = spec.targetBase;
  if (!base || base === '.') return null;
  const prefix = `${base.replace(/\/+$/, '')}/`;
  return spec.targetPath.startsWith(prefix) ? spec.targetPath.slice(prefix.length) : null;
}
