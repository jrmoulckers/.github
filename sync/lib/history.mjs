// Canon-history evidence for safe first-sync recovery.
//
// An unrecorded member target may be overwritten only when its exact bytes can be reconstructed
// from a committed version of that target's canonical source. This module reads the source blobs;
// assets.mjs applies the same deterministic renderer used for current canon.

import { execFileSync } from 'node:child_process';

const historyCache = new Map();

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
        blobs.push(git(repoRoot, ['cat-file', 'blob', object], false));
      }
      versions.set(path, blobs);
    }
  }

  return new Map(paths.map((path) => [path, versions.get(path)]));
}

function git(cwd, args, trim = true) {
  try {
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
