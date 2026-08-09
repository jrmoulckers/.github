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
      spec.type === 'managed-md'
        ? planManagedMd(memberRoot, spec, entries, force)
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
        report.drift.push(res.note ? { ...item, note: res.note } : item);
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
    if (
      isUnstampedCanon(entries[spec.targetPath], currentHash, spec) ||
      isHistoricalCanonOutput(entries[spec.targetPath], currentHash, spec)
    ) {
      return { action: 'update', newContent: rendered, newEntry };
    }
    return force
      ? { action: 'forced', newContent: rendered, newEntry }
      : { action: 'drift' };
  }
  if (currentHash === renderedHash) return { action: 'unchanged', newEntry };
  return { action: 'update', newContent: rendered, newEntry };
}

/**
 * Plan a managed-region target (AGENTS.md, .github/copilot-instructions.md): only the block
 * between the studio markers is ours, so drift is judged on the block inner rather than the
 * whole file and the member's surrounding content is always preserved.
 */
function planManagedMd(memberRoot, spec, entries, force) {
  const abs = join(memberRoot, ...spec.targetPath.split('/'));
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
      : { action: 'drift', note: suspectBlockNote(spec.targetPath, currentInner, inner) };
  }
  if (currentHash === renderedHash) return { action: 'unchanged', newEntry };
  return { action: 'update', newContent: buildFile(existing, inner), newEntry };
}

/**
 * A managed block a small fraction of canon's size is far more likely to be a stray pair
 * of marker strings in prose than a deliberate edit. Say so, because the alternative is a
 * generic drift line for the most important files the sync delivers.
 */
function suspectBlockNote(targetPath, currentInner, canonInner) {
  if (currentInner.length >= Math.min(512, canonInner.length / 4)) return undefined;
  return (
    `managed block is only ${currentInner.length} char(s) vs ${canonInner.length} in canon — ` +
    `check ${targetPath} for stray studio:base markers`
  );
}

/**
 * Locally modified when a recorded target no longer matches what we last wrote, or when
 * an unrecorded, pre-existing target differs from canon (treated as a conflict).
 */
function isLocallyModified(lockEntry, currentHash, renderedHash) {
  return lockEntry ? currentHash !== lockEntry.targetSha256 : currentHash !== renderedHash;
}

/**
 * An unrecorded target whose bytes are *raw canon* — canon hand-copied into the member without
 * going through `inject()`, so it differs from what the engine would write by exactly the
 * provenance header.
 *
 * This has to be distinguished from drift because otherwise it is a permanent skip: the file
 * never matches `rendered`, so every run flags it and no run ever fixes it, and `--check` fails
 * forever. It is also the hardest kind of staleness to notice by eye, since the *content* is
 * current — only the provenance is missing.
 *
 * Rewriting is safe in a way ordinary drift is not: bytes equal to canon are provably not
 * member-authored, so the write discards no human work and changes nothing but the header. That
 * is why this returns `update` rather than requiring `--force`, which would suppress the drift
 * signal for every other target in the same run.
 *
 * `spec.sourceSha256` is already the hash of raw canon, and `hashText` normalizes line endings,
 * so the comparison needs no new plumbing and is CRLF-safe.
 *
 * Restricted to targets with **no lock entry**. Once a file is recorded, bytes equal to raw canon
 * mean someone deliberately stripped the header, which is a local edit and stays drift.
 */
function isUnstampedCanon(lockEntry, currentHash, spec) {
  return !lockEntry && currentHash === spec.sourceSha256;
}

/**
 * Recover an unrecorded target only when its exact bytes match committed historical canon or the
 * engine rendering reconstructed from it. Headers, similarity, and file history in the member repo
 * are not evidence: only a hash derived from backbone canon authorizes the overwrite.
 */
function isHistoricalCanonOutput(lockEntry, currentHash, spec) {
  return !lockEntry && (spec.historicalCanonSha256 ?? []).includes(currentHash);
}

function entry(sourceSha256, targetSha256) {
  return { sourceSha256, targetSha256, syncedAt: new Date().toISOString() };
}

function writeTarget(absPath, content) {
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, content, 'utf8');
}
