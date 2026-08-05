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
 * Identify the checkout in `workDir` against the member the plan is for.
 *
 * Compared by remote rather than by "how many targets are missing", because a genuine first sync
 * legitimately reports every target as added — libro's does — so a count-based heuristic would cry
 * wolf on the exact run it is meant to protect.
 *
 * Returns a verdict rather than logging or throwing, so every branch is testable without capturing
 * stdout:
 *
 * - `match`        — origin resolves to the member's slug.
 * - `mismatch`     — origin resolves to something else. A fork or mirror is a legitimate reason.
 * - `unverifiable` — no origin, or git could not be read. Nothing here identifies the repo.
 *
 * `unverifiable` is deliberately its own verdict and not folded into `match`. Treating "I could not
 * check" as "I checked and it was fine" is what made the worst variant of this silent: a local-only
 * `git init` repo has a `.git`, passes `assertMemberCheckout`, has no origin to compare, and was
 * therefore written into without a single line of output.
 */
export function memberIdentity(workDir, repo) {
  let origin;
  try {
    origin = git(['remote', 'get-url', 'origin'], workDir);
  } catch {
    // The observed path for a repo with no origin: `git remote get-url origin` exits non-zero.
    return { status: 'unverifiable', origin: null };
  }
  // Defensive, and not reachable via git's current behaviour — mutating this line alone breaks no
  // test, which is the honest description of it. Kept so a git that prints nothing and exits 0
  // cannot reintroduce the silent case; noted so it is not mistaken for covered code.
  if (!origin) return { status: 'unverifiable', origin: null };
  const slug = origin
    .replace(/\.git$/, '')
    .replace(/\/$/, '')
    .replace(/^.*[:/]([^/]+\/[^/]+)$/, '$1');
  return slug.toLowerCase() === repo.toLowerCase()
    ? { status: 'match', origin }
    : { status: 'mismatch', origin };
}

/**
 * Throw unless the checkout in `workDir` is provably the member the plan is for.
 *
 * This refuses rather than warns, and it refuses on `--dry-run` too. Both are deliberate.
 *
 * Refusing: a warning that is followed by the write is a warning that arrives after the decision.
 * The observed failure rewrote an unrelated repo's `AGENTS.md` from 3 lines to 145 and left a
 * lockfile behind — with the warning printed, exit code 0, and the report reading like an ordinary
 * first sync.
 *
 * Refusing on dry runs: the lasting damage is not only the bytes. A run against the wrong checkout
 * writes a lockfile that makes the *next* `--check` report "up to date", so the mistake certifies
 * itself, and a dry run's plan is read as evidence in exactly the same way. The reassuring output
 * is the defect; withholding the write does not withhold it.
 *
 * `--allow-unverified-work-dir` is the escape hatch for a genuine fork, mirror or local-only clone.
 * It is scoped to this one check rather than being a general "don't argue" flag, because an escape
 * hatch wider than the failure it clears is how a narrow guarantee gets traded away for one green
 * run.
 */
export function assertMemberIdentity(workDir, repo, { allowUnverified = false } = {}) {
  const { status, origin } = memberIdentity(workDir, repo);
  if (status === 'match') return { status, origin, overridden: false };
  if (allowUnverified) return { status, origin, overridden: true };

  const why =
    status === 'mismatch'
      ? `has origin ${origin}, but this plan is for ${repo}`
      : `has no origin remote, so it cannot be identified as ${repo}`;

  throw new Error(
    `--work-dir ${workDir} ${why}. Every target would look absent and be reported as added, ` +
      'and the lockfile left behind would make the next --check report "up to date". ' +
      'Point --work-dir at the member checkout, or pass --allow-unverified-work-dir if this is ' +
      'deliberately a fork, mirror or local-only clone.',
  );
}
