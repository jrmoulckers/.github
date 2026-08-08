// Opt-in resolver. Turns a member's `optIn` selection into concrete groups the asset
// layer can enumerate.
//
// Selection semantics per kind:
//   - base / health : boolean
//   - other kinds   : "*" (all canon of that kind) | string[] (explicit names) | false/omitted (opt out)
//
// Native kinds (health, workflows) are still resolved and listed so the plan reflects
// the manifest, but they never produce written files (GitHub inherits health files;
// reusable workflows are called via `uses: …@<reviewed-immutable-ref>`).

import { NATIVE_KINDS, DIR_KINDS, memberMode } from './manifest.mjs';

/**
 * @returns {{
 *   repo: string, mode: string, framework?: string, packageManager?: string, notes?: string,
 *   groups: Array<{kind, mode, names, sourceBase, targetBase, native, external?}>,
 *   tokens: null | {enabled, sourceRepo, package, sourceBase, targetBase},
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

  // tokens — vendored from an EXTERNAL repo (jrmoulckers/studio @jrm/tokens), not backbone canon.
  // Opt-in and the optional target override live in member.tokens, kept apart from optIn.
  const tokens = resolveTokens(manifest, member);
  if (tokens) groups.push(tokens.group);

  return {
    repo: member.repo,
    mode: memberMode(member),
    framework: member.framework,
    packageManager: member.packageManager,
    notes: member.notes,
    groups,
    tokens: tokens?.plan ?? null,
  };
}

/**
 * Build a member's token plan + display group, or `null` when tokens are not enabled.
 * The plan drives external enumeration (assets.enumerateTokenTargets); the group only exists so
 * the dry-run plan reflects the manifest. Both carry `external: true`.
 * @returns {null | { plan: object, group: object }}
 */
export function resolveTokens(manifest, member) {
  if (member?.tokens?.enabled !== true) return null;
  const cfg = manifest.tokens ?? {};
  const targetBase = member.tokens.targetPath || cfg.targetPath;
  const plan = {
    enabled: true,
    sourceRepo: cfg.sourceRepo,
    package: cfg.package,
    sourceBase: cfg.sourceBase,
    targetBase,
  };
  const group = {
    kind: 'tokens',
    mode: 'dir',
    names: [],
    sourceBase: cfg.sourceBase,
    targetBase,
    native: false,
    external: true,
    sourceRepo: cfg.sourceRepo,
    package: cfg.package,
  };
  return { plan, group };
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
