// Regression test for the sync-branch data-loss bug.
//
// Before the fix, a same-day re-run recreated `studio-sync/<date>` from the member's default
// branch and force-pushed it, silently discarding any commit a reviewer had pushed to the sync
// branch. `prepareSyncBranch` now reuses the existing remote branch as the base, so the run is
// stacked on top and pushed as a fast-forward.
//
// Uses local file-path remotes only — no network, no gh, no token.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { prepareSyncBranch, commitAll, push } from '../lib/git.mjs';

const BRANCH = 'studio-sync/2026-08-03';

function git(args, cwd) {
  return execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'safe.bareRepository=all', ...args], {
    cwd,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  }).trim();
}

/** Inspect a bare origin without depending on the caller's `safe.bareRepository` setting. */
function inOrigin(origin, args) {
  return git(['--git-dir', origin, ...args], dirname(origin));
}

function newRepo(root, name, { bare = false } = {}) {
  const dir = join(root, name);
  git(['init', ...(bare ? ['--bare'] : []), '--initial-branch=main', dir], root);
  if (!bare) git(['config', 'core.autocrlf', 'false'], dir);
  return dir;
}

function commit(dir, file, content, message) {
  writeFileSync(join(dir, file), content, 'utf8');
  git(['add', '-A'], dir);
  git(
    ['-c', 'user.name=Reviewer', '-c', 'user.email=reviewer@example.com', 'commit', '-m', message],
    dir,
  );
}

function clone(root, origin, name, extra = []) {
  const dir = join(root, name);
  git(['clone', ...extra, origin, dir], root);
  git(['config', 'core.autocrlf', 'false'], dir);
  git(['checkout', '--', '.'], dir);
  return dir;
}

/** Bare origin with `main` plus a sync branch carrying a reviewer commit. */
function makeOrigin(root) {
  const origin = newRepo(root, 'origin.git', { bare: true });
  const seed = newRepo(root, 'seed');
  commit(seed, 'README.md', '# member\n', 'chore: init');
  git(['remote', 'add', 'origin', origin], seed);
  git(['push', '-u', 'origin', 'main'], seed);

  git(['checkout', '-b', BRANCH], seed);
  commit(seed, 'agency.toml', '# synced\n', 'chore(sync): update studio canon (2026-08-03)');
  commit(seed, 'REVIEWER.md', 'reviewer fixup\n', 'fix: reviewer tweak on the sync branch');
  git(['push', '-u', 'origin', BRANCH], seed);
  return origin;
}

test('a re-run preserves reviewer commits already on the sync branch', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-branch-test-'));
  try {
    const origin = makeOrigin(root);
    const work = clone(root, origin, 'work', ['--depth', '1']);

    const base = prepareSyncBranch(work, BRANCH);

    assert.equal(base.reused, true, 'existing remote sync branch must be reused as the base');
    assert.ok(
      base.foreign.some((line) => line.includes('reviewer tweak')),
      `reviewer commit should be reported as foreign, got: ${JSON.stringify(base.foreign)}`,
    );
    assert.equal(
      readFileSync(join(work, 'REVIEWER.md'), 'utf8').trim(),
      'reviewer fixup',
      'reviewer file must be present in the working tree',
    );

    writeFileSync(join(work, 'agency.toml'), '# synced v2\n', 'utf8');
    assert.equal(commitAll(work, 'chore(sync): update studio canon (2026-08-03)'), true);
    push(work, BRANCH);

    const log = inOrigin(origin, ['log', '--format=%s', BRANCH]);
    assert.ok(
      log.includes('fix: reviewer tweak on the sync branch'),
      'reviewer commit must survive the push',
    );
    assert.equal(
      inOrigin(origin, ['show', `${BRANCH}:agency.toml`]),
      '# synced v2',
      'sync content must be updated',
    );
    assert.equal(inOrigin(origin, ['show', `${BRANCH}:REVIEWER.md`]), 'reviewer fixup');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a first run creates the sync branch off the default branch', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-branch-new-'));
  try {
    const origin = newRepo(root, 'origin.git', { bare: true });
    const seed = newRepo(root, 'seed');
    commit(seed, 'README.md', '# member\n', 'chore: init');
    git(['remote', 'add', 'origin', origin], seed);
    git(['push', '-u', 'origin', 'main'], seed);

    const work = clone(root, origin, 'work', ['--depth', '1']);

    const base = prepareSyncBranch(work, BRANCH);
    assert.equal(base.reused, false);
    assert.deepEqual(base.foreign, []);
    assert.equal(git(['rev-parse', '--abbrev-ref', 'HEAD'], work), BRANCH);

    writeFileSync(join(work, 'agency.toml'), '# synced\n', 'utf8');
    assert.equal(commitAll(work, 'chore(sync): update studio canon (2026-08-03)'), true);
    push(work, BRANCH);
    assert.ok(inOrigin(origin, ['log', '--format=%s', BRANCH]).includes('chore(sync)'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('push never force-pushes: a diverged remote is rejected, not overwritten', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-branch-reject-'));
  try {
    const origin = makeOrigin(root);
    const work = clone(root, origin, 'work', ['--depth', '1']);
    prepareSyncBranch(work, BRANCH);

    // Someone else pushes to the sync branch after we based our work on it.
    const other = clone(root, origin, 'other');
    git(['checkout', BRANCH], other);
    commit(other, 'LATER.md', 'later\n', 'fix: landed after the run started');
    git(['push', 'origin', BRANCH], other);

    writeFileSync(join(work, 'agency.toml'), '# synced v2\n', 'utf8');
    commitAll(work, 'chore(sync): update studio canon (2026-08-03)');

    assert.throws(() => push(work, BRANCH), /failed/, 'a non-fast-forward push must fail loudly');
    assert.ok(
      inOrigin(origin, ['log', '--format=%s', BRANCH]).includes('fix: landed after the run started'),
      'the competing commit must still be on the remote',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
