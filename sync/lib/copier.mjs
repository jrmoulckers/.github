// Copier + drift detector.
//
// Applies a resolved member's target list to a member checkout (`memberRoot`), using the
// lockfile to distinguish four outcomes per target:
//
//   add       — target absent          -> write, record in lock
//   update    — upstream canon changed  -> write, refresh lock
//   unchanged — identical to canon      -> no-op (idempotent)
//   drift     — locally modified        -> FLAG "⚠️ locally modified", skip (unless --force)
//
// A pre-existing file that is already identical to canon but has no lock entry is "adopted":
// its baseline hash is recorded so a later upstream change updates it rather than tripping
// drift. Adoption counts as a change (the lock must persist), but is content-neutral.
//
// Drift is decided from the lockfile: if the target's current hash differs from the
// `targetSha256` we last wrote, a human edited it. A pre-existing file with no lock entry
// that differs from canon is treated the same way (a conflict), so we never clobber
// member-authored content silently.
//
// The lockfile is only rewritten when entries actually change (a write or an adoption), so a
// re-run with no upstream change produces no diff (and therefore no PR).

import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { hashText, writeLock } from './lock.mjs';
import { extractBlock, buildFile, canonicalizeInner } from './basemerge.mjs';

const BUCKET = {
  add: 'added',
  update: 'updated',
  forced: 'forced',
};

/**
 * @param {string} memberRoot  checkout directory (may be missing targets)
 * @param {TargetSpec[]} writes
 * @param {object} lock  as returned by readLock
 * @param {{ force?: boolean, write?: boolean }} opts
 * @returns {{ report, lock }}
 */
export function apply(memberRoot, writes, lock, opts = {}) {
  const { force = false, write = false } = opts;
  const entries = { ...lock.entries };
  const report = { added: [], updated: [], unchanged: [], drift: [], forced: [], adopted: [] };

  for (const spec of writes) {
    const res =
      spec.type === 'agents-md'
        ? planAgentsMd(memberRoot, spec, entries, force)
        : planFile(memberRoot, spec, entries, force);
    const item = { targetPath: spec.targetPath, kind: spec.kind, name: spec.name };

    switch (res.action) {
      case 'add':
      case 'update':
      case 'forced':
        if (write) writeTarget(join(memberRoot, ...spec.targetPath.split('/')), res.newContent);
        entries[spec.targetPath] = res.newEntry;
        report[BUCKET[res.action]].push(item);
        break;
      case 'unchanged':
        if (!entries[spec.targetPath] && res.newEntry) {
          // Pre-existing file already identical to canon but never recorded: adopt a
          // baseline so a future upstream change updates it instead of being mistaken
          // for local drift. This counts as a change so the lock is persisted.
          entries[spec.targetPath] = res.newEntry;
          report.adopted.push(item);
        } else {
          report.unchanged.push(item);
        }
        break;
      default: // drift — leave the lock entry untouched so the reviewer can reconcile.
        report.drift.push(item);
    }
  }

  report.changed =
    report.added.length + report.updated.length + report.forced.length + report.adopted.length > 0;
  report.hasDrift = report.drift.length > 0;
  const newLock = { ...lock, entries };

  if (write && report.changed) writeLock(memberRoot, newLock);

  return { report, lock: newLock };
}

function planFile(memberRoot, spec, entries, force) {
  const abs = join(memberRoot, ...spec.targetPath.split('/'));
  const rendered = spec.content;
  const renderedHash = hashText(rendered);
  const newEntry = entry(spec.sourceSha256, renderedHash);

  if (!existsSync(abs)) return { action: 'add', newContent: rendered, newEntry };

  const currentHash = hashText(readFileSync(abs, 'utf8'));
  if (isLocallyModified(entries[spec.targetPath], currentHash, renderedHash)) {
    return force
      ? { action: 'forced', newContent: rendered, newEntry }
      : { action: 'drift' };
  }
  if (currentHash === renderedHash) return { action: 'unchanged', newEntry };
  return { action: 'update', newContent: rendered, newEntry };
}

function planAgentsMd(memberRoot, spec, entries, force) {
  const abs = join(memberRoot, 'AGENTS.md');
  const inner = canonicalizeInner(spec.content);
  const renderedHash = hashText(inner);
  const newEntry = entry(spec.sourceSha256, renderedHash);

  if (!existsSync(abs)) return { action: 'add', newContent: buildFile('', inner), newEntry };

  const existing = readFileSync(abs, 'utf8');
  const currentInner = extractBlock(existing);
  if (currentInner === null) {
    // No managed region yet: insert one, preserving all product-local content.
    return { action: 'add', newContent: buildFile(existing, inner), newEntry };
  }
  const currentHash = hashText(currentInner);
  if (isLocallyModified(entries[spec.targetPath], currentHash, renderedHash)) {
    return force
      ? { action: 'forced', newContent: buildFile(existing, inner), newEntry }
      : { action: 'drift' };
  }
  if (currentHash === renderedHash) return { action: 'unchanged', newEntry };
  return { action: 'update', newContent: buildFile(existing, inner), newEntry };
}

/**
 * Locally modified when a recorded target no longer matches what we last wrote, or when
 * an unrecorded, pre-existing target differs from canon (treated as a conflict).
 */
function isLocallyModified(lockEntry, currentHash, renderedHash) {
  return lockEntry ? currentHash !== lockEntry.targetSha256 : currentHash !== renderedHash;
}

function entry(sourceSha256, targetSha256) {
  return { sourceSha256, targetSha256, syncedAt: new Date().toISOString() };
}

function writeTarget(absPath, content) {
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, content, 'utf8');
}
