// Manifest loader + validator for studio.config.json.
//
// The manifest is the single source of truth for the sync tool: the `canon` catalog,
// `sourcePaths`, `targetPaths`, and each `members[].optIn` selection. Validation is
// deliberately strict so a malformed manifest fails fast with a clear message rather
// than producing a surprising sync.

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export const KINDS = ['base', 'agents', 'skills', 'prompts', 'instructions', 'workflows', 'health'];

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
  validateManifest(parsed);
  return parsed;
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
      if (!isObject(member.optIn)) {
        errors.push(`members[${i}].optIn must be an object`);
        return;
      }
      validateOptIn(member, i, m, errors);
    });
  }

  if (errors.length) {
    throw new Error(`Invalid studio.config.json:\n  - ${errors.join('\n  - ')}`);
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
