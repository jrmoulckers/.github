// Token-source resolver.
//
// Vendored @jrm/tokens come from an EXTERNAL repo (manifest.tokens.sourceRepo, e.g.
// jrmoulckers/studio), which is private and registry-free. To read its committed dist/ tree the
// engine needs a local checkout. This module resolves that checkout once per run and hands back a
// { root, cleanup } handle shared by every opted-in member:
//
//   - --studio-dir <path>  -> use a local checkout as-is (offline seam; mirrors --work-dir).
//   - otherwise            -> clone sourceRepo with STUDIO_SYNC_TOKEN into a temp dir.
//
// The clone carries FULL history, not `--depth 1`. Token canon lives in this repo, so its dist/
// history is the only evidence that a vendored member file is stale engine output rather than
// member-authored content (see assets.enumerateTokenTargets). A shallow clone would silently
// shrink that evidence set to one commit and turn recoverable files into permanent drift.
//
// Only invoked when at least one (post-filter) member has tokens enabled, so runs that don't
// touch tokens never clone anything.

import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cloneFull } from './git.mjs';

const NOOP = () => {};

/**
 * Resolve a local checkout of the token source repo.
 * @param {{ studioDir?: string|null }} opts
 * @param {object} manifest  loaded studio.config.json (needs manifest.tokens.sourceRepo)
 * @param {string} token     STUDIO_SYNC_TOKEN (only needed when cloning)
 * @param {{ allowClone?: boolean }} [flags]
 * @returns {null | { root: string, cleanup: () => void, cloned: boolean }}
 *   null when no source is available and cloning is disallowed (e.g. offline dry-run).
 */
export function resolveStudioRoot(opts, manifest, token, { allowClone = true } = {}) {
  if (opts.studioDir) {
    if (!existsSync(opts.studioDir)) {
      throw new Error(`--studio-dir path does not exist: ${opts.studioDir}`);
    }
    return { root: opts.studioDir, cleanup: NOOP, cloned: false };
  }

  if (!allowClone) return null;

  const sourceRepo = manifest.tokens?.sourceRepo;
  if (!sourceRepo) {
    throw new Error('tokens.sourceRepo is not configured but a member enables tokens.');
  }
  if (!token) {
    throw new Error(
      `STUDIO_SYNC_TOKEN is required to read the private token source ${sourceRepo} ` +
        '(or pass --studio-dir <local checkout>).',
    );
  }

  const tmp = mkdtempSync(join(tmpdir(), 'studio-tokens-'));
  try {
    cloneFull(sourceRepo, token, tmp);
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
  return { root: tmp, cleanup: () => rmSync(tmp, { recursive: true, force: true }), cloned: true };
}
