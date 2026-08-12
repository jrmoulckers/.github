// Per-member lockfile helpers and content hashing.
//
// The lockfile (`.studio-sync.lock.json`) lives at the member repo root and records,
// for every synced target, the hash of the canonical source and the hash of what the
// tool last wrote:
//
//   {
//     "version": 1,
//     "backbone": "jrmoulckers/.github",
//     "generatedAt": "<iso>",
//     "entries": {
//       ".github/agents/architect.agent.md": {
//         "sourceSha256": "…",  // detects upstream (canon) changes
//         "targetSha256": "…",  // detects local edits (drift) in the member repo
//         "syncedAt": "<iso>"
//       }
//     }
//   }
//
// `targetSha256` hashes the whole file for an ordinary target and the canonicalized *managed
// region* for a managed one (`AGENTS.md`, `.github/copilot-instructions.md`, `.gitattributes`),
// because only that region is canon's to own — see `planManaged` in copier.mjs and
// `canonicalizeInner` in basemerge.mjs. Every entry has the same shape either way, so the field
// name alone does not say which rule produced it. Hashing the whole file of a managed target
// matches under no member state at all, not even one the engine just wrote, because the markers
// sit outside the region.
//
// Which rule an entry used is derivable, so no path list is needed and none can go stale:
//
//   1. Establish the file exists. The derivation reads the tree, so it is total over files that
//      are present and *undefined* over an entry whose file is absent — a real state, since a
//      member may have deleted a target pending repopulation. Classifying first reads "cannot
//      tell" as "not managed", compares whole-file bytes, and reports a mismatch no repository
//      state can clear. Absence is its own report, not a hashing rule.
//   2. Then classify: managed exactly when `extractBlock(bytes, markersFor(targetPath)) !== null`.
//
// Use that call, not the approximation "has the marker at column 0". The two disagree: markers
// shown inside a fenced example, quoted inline, or in an indented code block do not open a region,
// and `sync/README.md` explicitly invites a member to document this convention in its own
// `AGENTS.md`. Under the looser rule such a file classifies as managed and reports drift on a
// region the engine never wrote. See the fenced/inline/indented tests in test/basemerge.test.mjs.

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { toLF } from './provenance.mjs';

export const LOCK_FILENAME = '.studio-sync.lock.json';
const LOCK_VERSION = 1;

/** SHA-256 (hex) of a string or Buffer. Strings are hashed as UTF-8. */
export function sha256(input) {
  return createHash('sha256').update(input).digest('hex');
}

/** Hash of text after LF normalization, so hashes are line-ending agnostic. */
export function hashText(text) {
  return sha256(toLF(text));
}

export function lockPath(memberRoot) {
  return join(memberRoot, LOCK_FILENAME);
}

/** Read a member's lockfile, returning a normalized object (empty when absent). */
export function readLock(memberRoot, backbone) {
  const p = lockPath(memberRoot);
  if (!existsSync(p)) {
    return { version: LOCK_VERSION, backbone, generatedAt: null, entries: {} };
  }
  try {
    const parsed = JSON.parse(readFileSync(p, 'utf8'));
    return {
      version: parsed.version ?? LOCK_VERSION,
      backbone: parsed.backbone ?? backbone,
      generatedAt: parsed.generatedAt ?? null,
      entries: parsed.entries && typeof parsed.entries === 'object' ? parsed.entries : {},
    };
  } catch (err) {
    throw new Error(`Corrupt lockfile at ${p}: ${err.message}`);
  }
}

export function serializeLock(lock) {
  const ordered = {
    version: LOCK_VERSION,
    backbone: lock.backbone,
    generatedAt: new Date().toISOString(),
    entries: sortEntries(lock.entries),
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

export function writeLock(memberRoot, lock) {
  writeFileSync(lockPath(memberRoot), serializeLock(lock), 'utf8');
}

/**
 * Fold entries from the member's *current* default branch back into this run's lock.
 *
 * The lock is read once from a clone taken at run start and written wholesale at commit, so a run
 * whose lifetime overlaps another's writes a lock built from a base that never contained the other
 * run's entries. Entries this run did not touch are then silently reverted — a lost update on a
 * whole-file artifact (#418). The observed instance moved `jrmoulckers/finance`'s `tokens.css`
 * entry backwards by two days, and because a lock entry that disagrees with disk reads as member
 * drift, the path was refused on every later run until someone hand-edited a generated file.
 *
 * Two deliberate narrowings, because the general problem has a question in it that should not be
 * answered in passing:
 *
 *   - `touched` is excluded outright. Those entries describe bytes this run just wrote into its own
 *     branch, so they are authoritative *for that branch* whatever another run did. The undecided
 *     question in #418 — what "newer" should mean when two runs legitimately write the same path —
 *     only arises for paths both runs write, and this declines to arbitrate them.
 *   - Among the rest, the base wins only when it is strictly newer by `syncedAt`. A plain
 *     "base wins" rule looks simpler and is wrong: on the branch-reuse path our lock comes from the
 *     sync branch, which legitimately holds entries newer than the default branch, and taking the
 *     base unconditionally would revert the previous run's work on our own branch.
 *
 * Never deletes. A key the base lacks may be one an overlapping run pruned, but it may equally be
 * one an earlier commit on a reused branch added, and those are indistinguishable from here.
 * Restoring too little leaves a stale entry that the next run corrects; deleting too much discards
 * a baseline whose file is still on disk, which is the failure this function exists to prevent.
 *
 * @param {object} ours    entries this run produced
 * @param {object} base    entries on the member's default branch, read immediately before commit
 * @param {Set<string>} touched  lock keys this run deliberately authored or removed
 */
export function mergeNewerBaseEntries(ours, base, touched = new Set()) {
  const entries = { ...ours };
  const restored = [];

  for (const [key, baseEntry] of Object.entries(base ?? {})) {
    if (touched.has(key)) continue;
    if (!baseEntry || typeof baseEntry !== 'object') continue;

    const mine = entries[key];
    if (!outranks(baseEntry, mine)) continue;
    if (mine && sameBaseline(mine, baseEntry)) continue;

    entries[key] = baseEntry;
    restored.push({
      targetPath: key,
      from: mine ? (mine.syncedAt ?? null) : null,
      to: baseEntry.syncedAt ?? null,
    });
  }

  return { entries, restored };
}

/**
 * Whether the default branch's entry should displace ours.
 *
 * A missing timestamp never outranks a present one in either direction: absence is not evidence of
 * age, and letting it win would let an entry with no provenance overwrite one that has some.
 */
function outranks(baseEntry, mine) {
  if (!mine) return true;
  const theirs = timestamp(baseEntry);
  const ours = timestamp(mine);
  if (theirs === null) return false;
  if (ours === null) return true;
  return theirs > ours;
}

function timestamp(entry) {
  const parsed = Date.parse(entry?.syncedAt ?? '');
  return Number.isNaN(parsed) ? null : parsed;
}

function sameBaseline(a, b) {
  return a.sourceSha256 === b.sourceSha256 && a.targetSha256 === b.targetSha256;
}

function sortEntries(entries) {
  const out = {};
  for (const key of Object.keys(entries).sort()) out[key] = entries[key];
  return out;
}
