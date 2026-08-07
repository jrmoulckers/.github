// Manifest loader + validator for studio.config.json.
//
// The manifest is the single source of truth for the sync tool: the `canon` catalog,
// `sourcePaths`, `targetPaths`, and each `members[].optIn` selection. Validation is
// deliberately strict so a malformed manifest fails fast with a clear message rather
// than producing a surprising sync.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validateAgentIntegrity } from './agent-integrity.mjs';

export const KINDS = ['base', 'agents', 'skills', 'prompts', 'instructions', 'workflows', 'health'];
export const MEMBER_MODES = ['application', 'infrastructure', 'pre-bootstrap'];
export const DEFAULT_MEMBER_MODE = 'application';

// Kinds that produce written files vs. those inherited natively by GitHub/Copilot.
export const NATIVE_KINDS = new Set(['health', 'workflows']);
export const FILE_KINDS = new Set(['agents', 'prompts', 'instructions']);
export const DIR_KINDS = new Set(['skills']);

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
  validateAgentIntegrity(repoRoot, parsed);
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

  if (errors.length) {
    throw new Error(`Invalid studio.config.json:\n  - ${errors.join('\n  - ')}`);
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
    if (kind === 'base' || kind === 'health') {
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

function isObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
