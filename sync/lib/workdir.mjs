// Guards for `--work-dir`, the engine's only offline mode.
//
// Because it needs no token and no network, `--work-dir` is what anyone reaches for to check a
// claim — and it is the mode whose misuse is hardest to notice. Pointed at a parent directory, a
// typo, or an empty dir, every target is simply absent, so the run reports them all as `added` and
// exits 0. That output is indistinguishable from a legitimate first-sync plan.
//
// The reason this matters more than an ordinary bad-input case: drift is the condition the engine
// exists to surface, and it is reported by the *absence* of a warning. A run that sees no files at
// all therefore emits the most reassuring output the tool is capable of producing — a false
// negative on exactly the signal being checked for.

import { existsSync, statSync } from 'node:fs';
import { join } from 'node:path';

import { git } from './git.mjs';

/** Throw unless `workDir` is a git checkout. Cheap, and catches the parent-directory mistake. */
export function assertMemberCheckout(workDir) {
  if (!existsSync(workDir)) {
    throw new Error(`--work-dir ${workDir} does not exist.`);
  }
  if (!statSync(workDir).isDirectory()) {
    throw new Error(`--work-dir ${workDir} is not a directory.`);
  }
  // A worktree's `.git` is a file rather than a directory, so test only for presence.
  if (!existsSync(join(workDir, '.git'))) {
    throw new Error(
      `--work-dir ${workDir} is not a git checkout (no .git). ` +
        'Point it at the member checkout itself, not at a directory containing it.',
    );
  }
}

/**
 * Warn when `workDir` is a real checkout of the *wrong* repo — the case `assertMemberCheckout`
 * cannot see.
 *
 * Compared by remote rather than by "how many targets are missing", because a genuine first sync
 * legitimately reports every target as added — libro's does — so a count-based heuristic would cry
 * wolf on the exact run it is meant to protect.
 *
 * Returns the warning string rather than logging, so the check is testable without capturing
 * stdout. A missing or unreadable remote returns null: local-only clones are how the test suite
 * drives this path, and a fork or mirror is a legitimate reason for the slug to differ, so this
 * warns and never throws.
 */
export function repoMismatchWarning(workDir, repo) {
  let origin;
  try {
    origin = git(['remote', 'get-url', 'origin'], workDir);
  } catch {
    return null;
  }
  if (!origin) return null;
  const slug = origin
    .replace(/\.git$/, '')
    .replace(/\/$/, '')
    .replace(/^.*[:/]([^/]+\/[^/]+)$/, '$1');
  if (slug.toLowerCase() === repo.toLowerCase()) return null;
  return (
    `--work-dir ${workDir} has origin ${origin}, but this plan is for ${repo}. ` +
    'Every target will look absent and be reported as added.'
  );
}
