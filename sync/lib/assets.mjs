// Asset enumeration + rendering.
//
// Given a resolved member, walk the backbone source tree and produce the concrete list
// of target files to write. Handles both file-assets (agents/prompts/instructions, plus
// agency.toml) and directory-assets (skills = a folder of SKILL.md + checklists), and
// the special AGENTS.md managed-block target.
//
// Each write carries the rendered content (source normalized to LF + provenance) and the
// canonical source hash, so the copier can perform drift detection without re-reading
// the backbone.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { inject } from './provenance.mjs';
import { hashText } from './lock.mjs';
import { historicalFileVersions } from './history.mjs';

const FILE_SUFFIX = {
  agents: '.agent.md',
  prompts: '.prompt.md',
  instructions: '.instructions.md',
};

/**
 * @returns {{ writes: TargetSpec[], native: Array<{kind, names}> }}
 * TargetSpec = { kind, name, sourcePath, targetPath, sourceSha256, content, type }
 *   type: 'file' | 'agents-md'
 */
export function enumerateTargets(resolved, backboneRoot) {
  const writes = [];
  const native = [];

  for (const group of resolved.groups) {
    if (group.native || group.external) {
      // Native kinds are inherited by GitHub; external kinds (tokens) are vendored from a
      // different repo and enumerated separately via enumerateTokenTargets(studioRoot).
      if (group.native) native.push({ kind: group.kind, names: group.names });
      continue;
    }
    if (group.kind === 'base') {
      writes.push(...enumerateBase(group, backboneRoot));
    } else if (group.mode === 'dir') {
      writes.push(...enumerateDirKind(group, backboneRoot));
    } else {
      writes.push(...enumerateFileKind(group, backboneRoot));
    }
  }

  attachCanonHistory(writes, backboneRoot);
  return { writes, native };
}

function enumerateBase(group, backboneRoot) {
  const out = [];
  for (const fileName of group.names) {
    const sourcePath = posixJoin(group.sourceBase, fileName);
    const raw = readSource(backboneRoot, sourcePath);
    if (fileName === 'AGENTS.md') {
      // The managed block inner = canonical AGENTS.md with provenance.
      const inner = inject('AGENTS.md', raw);
      out.push({
        kind: 'base',
        name: fileName,
        sourcePath,
        targetPath: 'AGENTS.md',
        sourceSha256: hashText(raw),
        content: inner,
        type: 'agents-md',
      });
    } else {
      out.push(fileSpec('base', fileName, sourcePath, fileName, raw));
    }
  }
  return out;
}

function enumerateFileKind(group, backboneRoot) {
  const suffix = FILE_SUFFIX[group.kind] ?? '.md';
  return group.names.map((name) => {
    const fileName = `${name}${suffix}`;
    const sourcePath = posixJoin(group.sourceBase, fileName);
    const targetPath = posixJoin(group.targetBase, fileName);
    return fileSpec(group.kind, name, sourcePath, targetPath, readSource(backboneRoot, sourcePath));
  });
}

function enumerateDirKind(group, backboneRoot) {
  const out = [];
  for (const name of group.names) {
    const dirRel = posixJoin(group.sourceBase, name);
    const absDir = toNative(backboneRoot, dirRel);
    for (const rel of walkFiles(absDir)) {
      const sourcePath = posixJoin(dirRel, rel);
      const targetPath = posixJoin(group.targetBase, name, rel);
      out.push(
        fileSpec(group.kind, `${name}/${rel}`, sourcePath, targetPath, readSource(backboneRoot, sourcePath)),
      );
    }
  }
  return out;
}

function fileSpec(kind, name, sourcePath, targetPath, raw) {
  return {
    kind,
    name,
    sourcePath,
    targetPath,
    sourceSha256: hashText(raw),
    content: inject(targetPath, raw),
    type: 'file',
  };
}

/**
 * Record exact hashes of prior committed canon and its deterministic engine rendering.
 * The copier uses these only for unrecorded targets, where no lock baseline exists yet.
 */
function attachCanonHistory(writes, backboneRoot) {
  const files = writes.filter((spec) => spec.type === 'file');
  const versions = historicalFileVersions(
    backboneRoot,
    files.map((spec) => spec.sourcePath),
  );

  for (const spec of files) {
    const currentRenderedHash = hashText(spec.content);
    const historical = new Set();
    for (const raw of versions.get(spec.sourcePath) ?? []) {
      historical.add(hashText(raw));
      historical.add(hashText(inject(spec.targetPath, raw)));
    }
    historical.delete(spec.sourceSha256);
    historical.delete(currentRenderedHash);
    spec.historicalCanonSha256 = [...historical].sort();
  }
}

/**
 * Enumerate the vendored @jrm/tokens targets for a member from a studio checkout.
 * The whole `sourceBase` tree (studio's committed dist/) is mirrored under the member's
 * `targetBase`, each file stamped with a provenance note pointing at the external source repo.
 *
 * @param {{ sourceRepo, package, sourceBase, targetBase }} plan  from resolveTokens
 * @param {string} studioRoot  local checkout of the token source repo (clone or --studio-dir)
 * @returns {TargetSpec[]}
 */
export function enumerateTokenTargets(plan, studioRoot) {
  const note = `generated + synced from ${plan.sourceRepo} ${plan.package} — do not edit here`;
  const absBase = toNative(studioRoot, plan.sourceBase);
  if (!existsSync(absBase)) {
    throw new Error(
      `Token source not found: ${plan.sourceBase} is missing in ${plan.sourceRepo} checkout (${studioRoot}). ` +
        `Ensure ${plan.sourceRepo} commits its built ${plan.package} dist tree.`,
    );
  }
  const out = [];
  for (const rel of walkFiles(absBase)) {
    const sourcePath = posixJoin(plan.sourceBase, rel);
    const targetPath = posixJoin(plan.targetBase, rel);
    const raw = readSource(studioRoot, sourcePath);
    out.push({
      kind: 'tokens',
      name: rel,
      sourcePath,
      targetPath,
      sourceSha256: hashText(raw),
      content: inject(targetPath, raw, { note }),
      type: 'file',
    });
  }
  return out;
}

// --- path + fs helpers -----------------------------------------------------

function readSource(backboneRoot, posixRel) {
  return readFileSync(toNative(backboneRoot, posixRel), 'utf8');
}

function toNative(root, posixRel) {
  return join(root, ...posixRel.split('/').filter((s) => s && s !== '.'));
}

export function posixJoin(...parts) {
  return parts
    .filter((p) => p !== undefined && p !== null && p !== '' && p !== '.')
    .join('/')
    .replace(/\/+/g, '/');
}

/** Recursively list files under `absDir` as sorted POSIX-relative paths. */
function walkFiles(absDir, prefix = '') {
  const out = [];
  for (const entry of readdirSync(absDir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    const abs = join(absDir, entry.name);
    const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) out.push(...walkFiles(abs, rel));
    else if (entry.isFile() || (entry.isSymbolicLink() && safeIsFile(abs))) out.push(rel);
  }
  return out;
}

function safeIsFile(p) {
  try {
    return statSync(p).isFile();
  } catch {
    return false;
  }
}
