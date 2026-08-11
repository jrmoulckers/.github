// Canon-history evidence for safe first-sync recovery.
//
// An unrecorded member target may be overwritten only when its exact bytes can be reconstructed
// from a committed version of that target's canonical source. This module reads the source blobs;
// assets.mjs applies the same deterministic renderer used for current canon.

import { execFileSync } from 'node:child_process';
import { hashText } from './lock.mjs';

const historyCache = new Map();
const revisionCache = new Map();
const blobCache = new Map();

/**
 * Return every committed blob for each requested source path.
 *
 * Full history is required. A shallow checkout could omit the one blob that proves a member file
 * is engine output, turning recovery into a misleading partial feature.
 *
 * @param {string} repoRoot
 * @param {string[]} sourcePaths POSIX paths relative to repoRoot
 * @returns {Map<string, string[]>}
 */
export function historicalFileVersions(repoRoot, sourcePaths) {
  const paths = [...new Set(sourcePaths)].sort();
  if (!paths.length) return new Map();

  let versions = historyCache.get(repoRoot);
  if (!versions) {
    const shallow = git(repoRoot, ['rev-parse', '--is-shallow-repository']).trim();
    if (shallow !== 'false') {
      throw new Error(
        'Studio sync requires full backbone history to verify historical canon output; ' +
          'fetch with `git fetch --unshallow` (GitHub Actions: `fetch-depth: 0`).',
      );
    }
    versions = new Map();
    historyCache.set(repoRoot, versions);
  }

  const missing = paths.filter((path) => !versions.has(path));
  if (missing.length) {
    const objects = git(repoRoot, ['rev-list', '--objects', '--all', '--', ...missing]);
    const wanted = new Set(missing);
    const blobsByPath = new Map(missing.map((path) => [path, new Set()]));

    for (const line of objects.split('\n')) {
      const separator = line.indexOf(' ');
      if (separator < 0) continue;
      const object = line.slice(0, separator);
      const path = line.slice(separator + 1);
      if (wanted.has(path)) blobsByPath.get(path).add(object);
    }

    for (const path of missing) {
      const blobs = [];
      for (const object of blobsByPath.get(path)) {
        blobs.push(readBlob(repoRoot, object));
      }
      versions.set(path, blobs);
    }
  }

  return new Map(paths.map((path) => [path, versions.get(path)]));
}

/**
 * Ordered canon revisions per source path: the sha256 of every distinct committed version,
 * newest first, along the current branch.
 *
 * This is the *magnitude* half of the staleness signal. `historicalFileVersions` answers "is
 * this content ours" and deliberately scans all refs, where order is meaningless. Answering "how
 * far behind is this member" needs the opposite: one linear sequence, so a recorded baseline can
 * be located in it and the revisions published since it can be counted.
 *
 * A count is reported rather than an age because age measures how long the engine has been
 * running, not how much the member is missing. Five weeks of no releases is not staleness; two
 * releases in a day is. The count only grows when canon actually moves.
 *
 * `--raw` yields each commit's post-image blob id inline, so the ordering costs a single `git log`
 * and one `cat-file` per distinct blob.
 *
 * @param {string} repoRoot
 * @param {string[]} sourcePaths POSIX paths relative to repoRoot
 * @returns {Map<string, string[]>} path -> sha256 of each distinct version, newest first
 */
export function canonRevisions(repoRoot, sourcePaths) {
  const paths = [...new Set(sourcePaths)].sort();
  if (!paths.length) return new Map();

  let cached = revisionCache.get(repoRoot);
  if (!cached) {
    cached = new Map();
    revisionCache.set(repoRoot, cached);
  }

  const missing = paths.filter((path) => !cached.has(path));
  if (missing.length) {
    const log = git(repoRoot, ['log', '--format=', '--raw', '--no-renames', '--', ...missing], false);
    const wanted = new Set(missing);
    const blobsByPath = new Map(missing.map((path) => [path, []]));

    for (const line of log.split('\n')) {
      if (!line.startsWith(':')) continue;
      const [meta, path] = line.split('\t');
      if (!wanted.has(path)) continue;
      const blob = meta.split(/\s+/)[3];
      // A deletion has an all-zero post-image and is not a version of the file.
      if (/^0+$/.test(blob)) continue;
      blobsByPath.get(path).push(blob);
    }

    const hashes = new Map(); // blob id -> sha256, deduped across paths
    for (const path of missing) {
      const seen = new Set();
      const ordered = [];
      for (const blob of blobsByPath.get(path)) {
        if (!hashes.has(blob)) hashes.set(blob, hashText(readBlob(repoRoot, blob)));
        const sha256 = hashes.get(blob);
        if (seen.has(sha256)) continue; // a revert re-publishes content that already counted
        seen.add(sha256);
        ordered.push(sha256);
      }
      cached.set(path, ordered);
    }
  }

  return new Map(paths.map((path) => [path, cached.get(path)]));
}

/**
 * Read one blob, memoized per repo.
 *
 * Both walks above want the same blobs — recovery evidence scans every ref, the revision count
 * walks the current branch, and the current branch is a subset. A blob is immutable, so one
 * `cat-file` per id serves both and the count adds only a single `git log` to a run.
 */
function readBlob(repoRoot, object) {
  let blobs = blobCache.get(repoRoot);
  if (!blobs) {
    blobs = new Map();
    blobCache.set(repoRoot, blobs);
  }
  if (!blobs.has(object)) blobs.set(object, git(repoRoot, ['cat-file', 'blob', object], false));
  return blobs.get(object);
}

function git(cwd, args, trim = true) {  try {
    const output = execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return trim ? output.trim() : output;
  } catch (err) {
    const detail = String(err.stderr || err.stdout || err.message).trim();
    throw new Error(`Unable to read backbone history with \`git ${args.join(' ')}\`: ${detail}`);
  }
}
