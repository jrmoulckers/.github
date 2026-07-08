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

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { inject } from './provenance.mjs';
import { hashText } from './lock.mjs';

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
    if (group.native) {
      native.push({ kind: group.kind, names: group.names });
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
