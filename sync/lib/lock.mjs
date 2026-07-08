// Per-member lockfile helpers and content hashing.
//
// The lockfile (`.studio-sync.lock.json`) lives at the member repo root and records,
// for every synced target, the hash of the canonical source and the hash of the exact
// bytes the tool last wrote:
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

function sortEntries(entries) {
  const out = {};
  for (const key of Object.keys(entries).sort()) out[key] = entries[key];
  return out;
}
