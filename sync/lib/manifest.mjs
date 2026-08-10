// Manifest loader + validator for studio.config.json.
//
// The manifest is the single source of truth for the sync tool: the `canon` catalog,
// `sourcePaths`, `targetPaths`, and each `members[].optIn` selection. Validation is
// deliberately strict so a malformed manifest fails fast with a clear message rather
// than producing a surprising sync.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateAgencyIntegrity } from './agency-integrity.mjs';
import { validateAgentIntegrity } from './agent-integrity.mjs';
import { validateInstructionIntegrity } from './instruction-integrity.mjs';
import { validatePromptIntegrity } from './prompt-integrity.mjs';
import { validateWorkflowIntegrity } from './workflow-integrity.mjs';

export const KINDS = [
  'base',
  'runtime',
  'copilot',
  'attributes',
  'agents',
  'skills',
  'prompts',
  'instructions',
  'workflows',
  'health',
];
export const MEMBER_MODES = ['application', 'infrastructure', 'pre-bootstrap'];
export const DEFAULT_MEMBER_MODE = 'application';

// Kinds selected by a plain boolean rather than "*" / a name array. Each one is a fixed,
// single-purpose file set, so there is nothing to select within it.
export const BOOLEAN_KINDS = new Set(['base', 'runtime', 'copilot', 'attributes', 'health']);

// Kinds that produce written files vs. those inherited natively by GitHub/Copilot.
export const NATIVE_KINDS = new Set(['health', 'workflows']);
export const FILE_KINDS = new Set(['agents', 'prompts', 'instructions']);
export const DIR_KINDS = new Set(['skills']);

// Canon files materialized through the managed-region merge in basemerge.mjs, keyed by kind.
// The member keeps everything outside the markers; only the region between them is replaced.
// Each kind contributes exactly one managed file, because a marker pair identifies a region
// within a file, not which file it belongs to.
export const MANAGED_MERGE_TARGETS = new Map([
  ['base', 'AGENTS.md'],
  ['copilot', '.github/copilot-instructions.md'],
  ['attributes', '.gitattributes'],
]);

export function manifestPath(repoRoot) {
  return join(repoRoot, 'studio.config.json');
}

export function loadManifest(repoRoot) {
  const p = manifestPath(repoRoot);
  if (!existsSync(p)) {
    throw new Error(`Manifest not found at ${p}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(p, 'utf8'));
  } catch (err) {
    throw new Error(`Manifest ${p} is not valid JSON: ${err.message}`);
  }
  applyManifestDefaults(parsed);
  validateManifest(parsed);
  validateAgencyIntegrity(repoRoot);
  validateInstructionIntegrity(repoRoot, parsed);
  validateAgentIntegrity(repoRoot, parsed);
  validatePromptIntegrity(repoRoot, parsed);
  validateWorkflowIntegrity(repoRoot, parsed);
  return parsed;
}

export function applyManifestDefaults(manifest) {
  if (!isObject(manifest) || !Array.isArray(manifest.members)) return manifest;
  for (const member of manifest.members) {
    if (isObject(member) && member.mode === undefined) member.mode = DEFAULT_MEMBER_MODE;
  }
  return manifest;
}

export function memberMode(member) {
  return member?.mode ?? DEFAULT_MEMBER_MODE;
}

export function validateManifest(m) {
  const errors = [];

  if (typeof m.owner !== 'string' || !m.owner) errors.push('`owner` must be a non-empty string');
  if (typeof m.backbone !== 'string' || !m.backbone) {
    errors.push('`backbone` must be a non-empty string (e.g. "jrmoulckers/.github")');
  }

  for (const section of ['canon', 'sourcePaths', 'targetPaths']) {
    if (!isObject(m[section])) errors.push(`\`${section}\` must be an object`);
  }

  if (isObject(m.canon)) {
    for (const kind of KINDS) {
      if (!(kind in m.canon)) errors.push(`canon.${kind} is missing`);
      else if (!Array.isArray(m.canon[kind])) errors.push(`canon.${kind} must be an array`);
    }
  }
  if (isObject(m.sourcePaths) && isObject(m.targetPaths)) {
    for (const kind of KINDS) {
      if (typeof m.sourcePaths[kind] !== 'string') errors.push(`sourcePaths.${kind} must be a string`);
      if (typeof m.targetPaths[kind] !== 'string') errors.push(`targetPaths.${kind} must be a string`);
    }
  }

  if (!Array.isArray(m.members)) {
    errors.push('`members` must be an array');
  } else {
    m.members.forEach((member, i) => {
      if (!isObject(member)) {
        errors.push(`members[${i}] must be an object`);
        return;
      }
      if (typeof member.repo !== 'string' || !/^[^/]+\/[^/]+$/.test(member.repo)) {
        errors.push(`members[${i}].repo must be "owner/name"`);
      }
      validateMemberMode(member, i, errors);
      if (!isObject(member.optIn)) {
        errors.push(`members[${i}].optIn must be an object`);
        return;
      }
      validateOptIn(member, i, m, errors);
      validateLocalAgents(member, i, m, errors);
      validateMemberTokens(member, i, errors);
    });
  }

  validateTokens(m, errors);
  validateManagedKinds(m, errors);
  validateExcluded(m, errors);

  if (errors.length) {
    throw new Error(`Invalid studio.config.json:\n  - ${errors.join('\n  - ')}`);
  }
}

/**
 * A managed-merge kind owns a region inside one member file, identified by a single marker
 * pair. Two canon entries for the same kind would both claim that region and the second would
 * silently overwrite the first, so the one-file rule is enforced here rather than discovered
 * as a confusing drift report at sync time. The resolved target path is also checked against
 * MANAGED_MERGE_TARGETS so a stray sourcePaths/targetPaths edit cannot relocate a managed file
 * away from the location Copilot actually reads.
 */
function validateManagedKinds(m, errors) {
  if (!isObject(m.canon) || !isObject(m.sourcePaths) || !isObject(m.targetPaths)) return;

  for (const [kind, expectedTarget] of MANAGED_MERGE_TARGETS) {
    const names = m.canon[kind];
    if (!Array.isArray(names)) continue;
    if (names.length !== 1) {
      errors.push(`canon.${kind} must list exactly one managed file, got ${names.length}`);
      continue;
    }
    const targetBase = m.targetPaths[kind];
    if (typeof targetBase !== 'string') continue;
    const actual = [targetBase, names[0]].filter((part) => part && part !== '.').join('/');
    if (actual !== expectedTarget) {
      errors.push(`canon.${kind} must materialize to ${expectedTarget}, got ${actual}`);
    }
  }
}

function validateMemberMode(member, i, errors) {
  const mode = memberMode(member);
  if (!MEMBER_MODES.includes(mode)) {
    errors.push(
      `members[${i}].mode must be one of ${MEMBER_MODES.map((value) => `"${value}"`).join(', ')}`,
    );
    return;
  }

  for (const field of ['framework', 'packageManager']) {
    if (member[field] !== undefined && (typeof member[field] !== 'string' || !member[field])) {
      errors.push(`members[${i}].${field} must be a non-empty string when present`);
    }
  }

  if (mode === 'application') {
    for (const field of ['framework', 'packageManager']) {
      if (typeof member[field] !== 'string' || !member[field]) {
        errors.push(`members[${i}].${field} is required in application mode`);
      }
    }
  }

  if (mode === 'pre-bootstrap') {
    for (const field of ['framework', 'packageManager']) {
      if (member[field] !== undefined) {
        errors.push(
          `members[${i}].${field} must be omitted in pre-bootstrap mode; ` +
            'upgrade the mode when checkout evidence exists',
        );
      }
    }
  }
}

/**
 * Validate the top-level `tokens` config (vendored @jrm/tokens from an external repo).
 * The block is optional, but REQUIRED once any member sets `tokens.enabled: true`, since the
 * engine needs `sourceRepo`/`sourceBase`/`targetPath` to vendor those files.
 */
function validateTokens(m, errors) {
  const anyEnabled =
    Array.isArray(m.members) && m.members.some((mem) => isObject(mem?.tokens) && mem.tokens.enabled === true);

  if (m.tokens === undefined) {
    if (anyEnabled) errors.push('`tokens` config is required when any member enables tokens');
    return;
  }
  if (!isObject(m.tokens)) {
    errors.push('`tokens` must be an object');
    return;
  }
  if (typeof m.tokens.sourceRepo !== 'string' || !/^[^/]+\/[^/]+$/.test(m.tokens.sourceRepo)) {
    errors.push('tokens.sourceRepo must be "owner/name"');
  }
  if (typeof m.tokens.package !== 'string' || !m.tokens.package) {
    errors.push('tokens.package must be a non-empty string');
  }
  if (typeof m.tokens.sourceBase !== 'string' || !m.tokens.sourceBase) {
    errors.push('tokens.sourceBase must be a non-empty string');
  }
  if (typeof m.tokens.targetPath !== 'string' || !m.tokens.targetPath) {
    errors.push('tokens.targetPath must be a non-empty string');
  }
}

/** Validate a member's optional `tokens` opt-in block: { enabled: boolean, targetPath?: string }. */
function validateMemberTokens(member, i, errors) {
  if (member.tokens === undefined) return;
  if (!isObject(member.tokens)) {
    errors.push(`members[${i}].tokens must be an object`);
    return;
  }
  if (typeof member.tokens.enabled !== 'boolean') {
    errors.push(`members[${i}].tokens.enabled must be a boolean`);
  }
  if (member.tokens.targetPath !== undefined && typeof member.tokens.targetPath !== 'string') {
    errors.push(`members[${i}].tokens.targetPath must be a string`);
  }
}

function validateLocalAgents(member, i, manifest, errors) {
  if (member.localAgents === undefined) return;
  if (!Array.isArray(member.localAgents)) {
    errors.push(`members[${i}].localAgents must be an array`);
    return;
  }

  const seen = new Set();
  for (const name of member.localAgents) {
    if (typeof name !== 'string' || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(name)) {
      errors.push(`members[${i}].localAgents entries must be kebab-case agent names`);
      continue;
    }
    if (seen.has(name)) errors.push(`members[${i}].localAgents contains duplicate "${name}"`);
    seen.add(name);
  }

  const selection = member.optIn?.agents;
  const selected =
    selection === '*'
      ? manifest.canon?.agents ?? []
      : Array.isArray(selection)
        ? selection
        : [];
  for (const name of seen) {
    if (selected.includes(name)) {
      errors.push(
        `members[${i}].localAgents "${name}" overlaps optIn.agents; use either the local replacement or canon`,
      );
    }
  }
}

function validateOptIn(member, i, manifest, errors) {
  const optIn = member.optIn;
  for (const [kind, sel] of Object.entries(optIn)) {
    if (!KINDS.includes(kind)) {
      errors.push(`members[${i}].optIn.${kind} is not a known kind`);
      continue;
    }
    if (BOOLEAN_KINDS.has(kind)) {
      if (typeof sel !== 'boolean') errors.push(`members[${i}].optIn.${kind} must be a boolean`);
      continue;
    }
    if (sel === false || sel === '*') continue;
    if (Array.isArray(sel)) {
      const canon = manifest.canon?.[kind] ?? [];
      for (const name of sel) {
        if (!canon.includes(name)) {
          errors.push(`members[${i}].optIn.${kind} references unknown ${kind} "${name}"`);
        }
      }
      continue;
    }
    errors.push(`members[${i}].optIn.${kind} must be "*", an array, or false`);
  }
}

/**
 * `excluded` records repositories the owner has deliberately decided not to govern. It exists so
 * that a repository absent from `members` reads as a closed decision rather than an oversight: an
 * org-wide sweep that finds an ungoverned repo can consult this list instead of re-opening a
 * question that has already been answered. Absence and exclusion look identical from outside the
 * manifest, and only one of them is a gap.
 *
 * The engine never reads this list. Nothing is skipped, filtered, or suppressed because of it — a
 * repository is synced because it appears in `members`, and an unlisted repository is untouched
 * because it does not. The field is therefore inert by construction, which is deliberate: a
 * denylist that could suppress a real write would be a way to silence drift rather than a way to
 * record a decision, and the two must not share a mechanism.
 *
 * `reason` is required because an exclusion without one is the same unexplained absence the field
 * exists to eliminate. The single enforced invariant is that a repository cannot be both governed
 * and deliberately ungoverned; that contradiction would otherwise sit in the file indefinitely,
 * and whichever entry a reader happened to see first would look authoritative.
 */
function validateExcluded(m, errors) {
  if (!('excluded' in m)) return;
  if (!Array.isArray(m.excluded)) {
    errors.push('`excluded` must be an array');
    return;
  }

  const members = new Set(
    Array.isArray(m.members) ? m.members.filter(isObject).map((member) => member.repo) : [],
  );
  const seen = new Set();

  m.excluded.forEach((entry, i) => {
    if (!isObject(entry)) {
      errors.push(`excluded[${i}] must be an object`);
      return;
    }
    if (typeof entry.repo !== 'string' || !/^[^/]+\/[^/]+$/.test(entry.repo)) {
      errors.push(`excluded[${i}].repo must be "owner/name"`);
      return;
    }
    if (typeof entry.reason !== 'string' || !entry.reason.trim()) {
      errors.push(
        `excluded[${i}].reason must be a non-empty string saying why "${entry.repo}" is not governed`,
      );
    }
    if (seen.has(entry.repo)) errors.push(`excluded[${i}].repo "${entry.repo}" is listed twice`);
    seen.add(entry.repo);
    if (members.has(entry.repo)) {
      errors.push(
        `"${entry.repo}" appears in both \`members\` and \`excluded\`; a repository cannot be ` +
          'both governed and deliberately ungoverned',
      );
    }
  });
}

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
