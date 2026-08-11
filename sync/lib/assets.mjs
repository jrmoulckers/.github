// Asset enumeration + rendering.
//
// Given a resolved member, walk the backbone source tree and produce the concrete list
// of target files to write. Handles file-assets (agents/prompts/instructions), directory-assets
// (skills = a folder of SKILL.md + checklists), literal root files (agency.toml), and the
// managed-region targets (AGENTS.md, .github/copilot-instructions.md, .gitattributes).
//
// Each write carries the rendered content (source normalized to LF + provenance) and the
// canonical source hash, so the copier can perform drift detection without re-reading
// the backbone.

import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { inject } from './provenance.mjs';
import { hashText } from './lock.mjs';
import { historicalFileVersions, canonRevisions } from './history.mjs';

const FILE_SUFFIX = {
  agents: '.agent.md',
  prompts: '.prompt.md',
  instructions: '.instructions.md',
};

/**
 * @returns {{ writes: TargetSpec[], native: Array<{kind, names}> }}
 * TargetSpec = { kind, name, sourcePath, targetPath, targetBase, sourceSha256, content, type }
 *   type: 'file' | 'managed'
 *   targetBase: the group's target root, carried so the lock reconciler can recover the
 *   plan-relative path and follow entries when a member's base moves (see rekey.mjs).
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
    if (group.mode === 'managed' || group.mode === 'literal') {
      writes.push(...enumerateLiteralKind(group, backboneRoot));
    } else if (group.mode === 'dir') {
      writes.push(...enumerateDirKind(group, backboneRoot));
    } else {
      writes.push(...enumerateFileKind(group, backboneRoot));
    }
  }

  attachCanonHistory(writes, backboneRoot);
  return { writes, native };
}

/**
 * Kinds whose canon entries are literal file names (`AGENTS.md`, `agency.toml`,
 * `copilot-instructions.md`, `.gitattributes`) rather than bare asset names.
 *
 * A `managed` group additionally materializes through the marker merge in basemerge.mjs: the
 * spec carries only the block *inner*, and the copier splices it into whatever the member
 * already has. A `literal` group is an ordinary whole-file copy.
 */
function enumerateLiteralKind(group, backboneRoot) {
  const managed = group.mode === 'managed';
  return group.names.map((fileName) => {
    const sourcePath = posixJoin(group.sourceBase, fileName);
    const targetPath = posixJoin(group.targetBase, fileName);
    const raw = readSource(backboneRoot, sourcePath);
    if (!managed) return fileSpec(group.kind, fileName, sourcePath, targetPath, raw, group.targetBase);
    return {
      kind: group.kind,
      name: fileName,
      sourcePath,
      targetPath,
      targetBase: group.targetBase,
      sourceSha256: hashText(raw),
      content: inject(targetPath, raw),
      type: 'managed',
    };
  });
}

function enumerateFileKind(group, backboneRoot) {
  const suffix = FILE_SUFFIX[group.kind] ?? '.md';
  return group.names.map((name) => {
    const fileName = `${name}${suffix}`;
    const sourcePath = posixJoin(group.sourceBase, fileName);
    const targetPath = posixJoin(group.targetBase, fileName);
    return fileSpec(
      group.kind,
      name,
      sourcePath,
      targetPath,
      readSource(backboneRoot, sourcePath),
      group.targetBase,
    );
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
        fileSpec(
          group.kind,
          `${name}/${rel}`,
          sourcePath,
          targetPath,
          readSource(backboneRoot, sourcePath),
          group.targetBase,
        ),
      );
    }
  }
  return out;
}

function fileSpec(kind, name, sourcePath, targetPath, raw, targetBase) {
  return {
    kind,
    name,
    sourcePath,
    targetPath,
    targetBase,
    sourceSha256: hashText(raw),
    content: inject(targetPath, raw),
    type: 'file',
  };
}

/**
 * Record exact hashes of prior committed canon and its deterministic engine rendering.
 * The copier uses these only for unrecorded targets, where no lock baseline exists yet.
 *
 * `sourceRoot` is the repo the canon came from — the backbone for its own kinds, the token
 * source repo for vendored `@jrm/tokens`. Rendering uses each spec's own provenance note, so a
 * vendored file is reconstructed with the note that was actually written into it; hashing the
 * raw blob alone would produce a set that matches nothing and disable recovery with no error.
 *
 * The same walk also yields `canonRevisionSha256` — the ordered sequence of published versions,
 * newest first — which is what lets a withheld file report *how far* behind it is rather than
 * merely that it is.
 */
function attachCanonHistory(writes, sourceRoot) {
  const files = writes.filter((spec) => spec.type === 'file');
  if (!files.length) return;
  const sourcePaths = files.map((spec) => spec.sourcePath);
  const versions = historicalFileVersions(sourceRoot, sourcePaths);

  for (const spec of files) {
    const currentRenderedHash = hashText(spec.content);
    const historical = new Set();
    const rendered = new Set();
    for (const raw of versions.get(spec.sourcePath) ?? []) {
      historical.add(hashText(raw));
      const renderedHash = hashText(inject(spec.targetPath, raw, { note: spec.provenanceNote }));
      historical.add(renderedHash);
      rendered.add(renderedHash);
    }
    for (const set of [historical, rendered]) {
      set.delete(spec.sourceSha256);
      set.delete(currentRenderedHash);
    }
    spec.historicalCanonSha256 = [...historical].sort();
    // Renderings only, kept apart from the raw blobs because the two authorize different things:
    // raw bytes in a *recorded* file mean a stripped header (a local act), a past rendering cannot
    // be produced by editing at all. See isSupersededEngineOutput in copier.mjs.
    spec.historicalRenderedSha256 = [...rendered].sort();
    // Lazy: the count is only ever read for a drifted file, and walking every path's history
    // eagerly more than doubled a real run. Non-enumerable so spreading a spec doesn't force it.
    Object.defineProperty(spec, 'canonRevisionSha256', {
      get: () => canonRevisions(sourceRoot, [spec.sourcePath]).get(spec.sourcePath) ?? [],
      enumerable: false,
      configurable: true,
    });
  }
}

/**
 * Enumerate the vendored @jrm/tokens targets for a member from a studio checkout.
 * The whole `sourceBase` tree (studio's committed dist/) is mirrored under the member's
 * `targetBase`, each file stamped with a provenance note pointing at the external source repo.
 *
 * Token canon lives in the source repo, so its dist/ history — not the backbone's — supplies the
 * evidence that lets an unrecorded member file be recognized as stale engine output and updated
 * rather than reported as drift forever. `studioRoot` must therefore carry full history; the
 * engine clones it unshallowed and `historicalFileVersions` fails closed on a shallow checkout.
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
      targetBase: plan.targetBase,
      sourceSha256: hashText(raw),
      content: inject(targetPath, raw, { note }),
      provenanceNote: note,
      type: 'file',
    });
  }
  attachCanonHistory(out, studioRoot);
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
