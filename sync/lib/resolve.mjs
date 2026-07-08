// Opt-in resolver. Turns a member's `optIn` selection into concrete groups the asset
// layer can enumerate.
//
// Selection semantics per kind:
//   - base / health : boolean
//   - other kinds   : "*" (all canon of that kind) | string[] (explicit names) | false/omitted (opt out)
//
// Native kinds (health, workflows) are still resolved and listed so the plan reflects
// the manifest, but they never produce written files (GitHub inherits health files;
// reusable workflows are called via `uses: …@main`).

import { NATIVE_KINDS, DIR_KINDS } from './manifest.mjs';

/**
 * @returns {{
 *   repo: string, framework?: string, packageManager?: string, notes?: string,
 *   groups: Array<{kind, mode, names, sourceBase, targetBase, native}>,
 * }}
 */
export function resolveMember(manifest, member) {
  const optIn = member.optIn ?? {};
  const groups = [];

  // base (AGENTS.md merge + agency.toml copy)
  if (optIn.base === true) {
    groups.push(makeGroup(manifest, 'base', manifest.canon.base, 'base', false));
  }

  // health — native/no-op, listed only
  if (optIn.health === true) {
    groups.push(makeGroup(manifest, 'health', manifest.canon.health, 'native', true));
  }

  // file/dir kinds
  for (const kind of ['agents', 'skills', 'prompts', 'instructions']) {
    const names = resolveSelection(optIn[kind], manifest.canon[kind]);
    if (names === null) continue; // opted out
    const mode = DIR_KINDS.has(kind) ? 'dir' : 'file';
    groups.push(makeGroup(manifest, kind, names, mode, false));
  }

  // workflows — native/no-op, listed only
  {
    const names = resolveSelection(optIn.workflows, manifest.canon.workflows);
    if (names !== null) groups.push(makeGroup(manifest, 'workflows', names, 'native', true));
  }

  return {
    repo: member.repo,
    framework: member.framework,
    packageManager: member.packageManager,
    notes: member.notes,
    groups,
  };
}

export function resolveAll(manifest, filterRepos) {
  const set = filterRepos && filterRepos.length ? new Set(filterRepos) : null;
  return manifest.members
    .filter((m) => !set || set.has(m.repo) || set.has(m.repo.split('/')[1]))
    .map((m) => resolveMember(manifest, m));
}

function makeGroup(manifest, kind, names, mode, native) {
  return {
    kind,
    mode,
    names: [...names],
    sourceBase: manifest.sourcePaths[kind],
    targetBase: manifest.targetPaths[kind],
    native: native || NATIVE_KINDS.has(kind),
  };
}

/**
 * Resolve a per-kind selection to an ordered name list, or `null` when opted out.
 * Unknown names are already rejected by manifest validation.
 */
export function resolveSelection(sel, canonList = []) {
  if (sel === undefined || sel === false) return null;
  if (sel === true) return [...canonList];
  if (sel === '*') return [...canonList];
  if (Array.isArray(sel)) return sel.filter((n) => canonList.includes(n));
  return null;
}
