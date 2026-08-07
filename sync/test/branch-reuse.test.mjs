// Sync-branch lifecycle regressions. Uses local file-path remotes only — no network or token.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import {
  prepareSyncBranch,
  commitAll,
  push,
  remoteSyncBranches,
  selectOpenPr,
} from '../lib/git.mjs';

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

function commit(dir, file, content, message, author = 'Reviewer') {
  writeFileSync(join(dir, file), content, 'utf8');
  git(['add', '-A'], dir);
  git(
    [
      '-c',
      `user.name=${author}`,
      '-c',
      `user.email=${author.toLowerCase().replaceAll(' ', '-')}@example.com`,
      'commit',
      '-m',
      message,
    ],
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

/** Bare origin with `main` plus an active-style sync branch carrying a reviewer commit. */
function makeOrigin(root) {
  const origin = newRepo(root, 'origin.git', { bare: true });
  const seed = newRepo(root, 'seed');
  commit(seed, 'README.md', '# member\n', 'chore: init');
  git(['remote', 'add', 'origin', origin], seed);
  git(['push', '-u', 'origin', 'main'], seed);

  git(['checkout', '-b', BRANCH], seed);
  commit(
    seed,
    'agency.toml',
    '# synced\n',
    'chore(sync): update studio canon (2026-08-03)',
    'jrm-studio-sync',
  );
  commit(seed, 'REVIEWER.md', 'reviewer fixup\n', 'fix: reviewer tweak on the sync branch');
  git(['push', '-u', 'origin', BRANCH], seed);
  return { origin, seed };
}

test('an active open PR reuses its branch and reports only ahead-of-default reviewer commits', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-branch-test-'));
  try {
    const { origin, seed } = makeOrigin(root);
    git(['checkout', 'main'], seed);
    commit(seed, 'MAIN.md', 'default moved\n', 'feat: unrelated default-branch work');
    git(['push', 'origin', 'main'], seed);
    const work = clone(root, origin, 'work', ['--depth', '1']);

    const base = prepareSyncBranch(work, BRANCH, { reuse: true });

    assert.equal(base.reused, true, 'existing remote sync branch must be reused as the base');
    assert.equal(base.branch, BRANCH);
    assert.equal(base.foreign.length, 1, JSON.stringify(base.foreign));
    assert.match(base.foreign[0], /reviewer tweak/);
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
    assert.equal(base.branch, BRANCH);
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

test('a retained squash-merged branch is bypassed for a later same-day canon write', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-branch-squash-'));
  try {
    const { origin, seed } = makeOrigin(root);
    git(['checkout', 'main'], seed);
    commit(seed, 'agency.toml', '# synced\n', 'chore(sync): update studio canon (2026-08-03) (#1)');
    git(['push', 'origin', 'main'], seed);

    const work = clone(root, origin, 'work', ['--depth', '1']);
    const base = prepareSyncBranch(work, BRANCH, { reuse: false });

    assert.equal(base.reused, false);
    assert.equal(base.branch, `${BRANCH}-rerun-2`);
    assert.equal(git(['rev-parse', 'HEAD'], work), git(['rev-parse', 'main'], work));
    assert.equal(git(['status', '--porcelain'], work), '');
    assert.equal(git(['ls-files', 'REVIEWER.md'], work), '', 'stale branch files must not be stacked');

    writeFileSync(join(work, 'agency.toml'), '# synced v2\n', 'utf8');
    commitAll(work, 'chore(sync): update studio canon (2026-08-03)');
    push(work, base.branch);

    assert.equal(inOrigin(origin, ['rev-list', '--count', `main..${base.branch}`]), '1');
    assert.equal(inOrigin(origin, ['show', `${base.branch}:agency.toml`]), '# synced v2');
    assert.equal(inOrigin(origin, ['ls-tree', '-r', '--name-only', base.branch, 'REVIEWER.md']), '');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a retained closed-unmerged branch is bypassed without changing it', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-branch-closed-'));
  try {
    const { origin } = makeOrigin(root);
    const staleTip = inOrigin(origin, ['rev-parse', BRANCH]);
    const work = clone(root, origin, 'work', ['--depth', '1']);

    const base = prepareSyncBranch(work, BRANCH, { reuse: false });

    assert.equal(base.branch, `${BRANCH}-rerun-2`);
    assert.equal(git(['rev-parse', 'HEAD'], work), git(['rev-parse', 'main'], work));
    assert.equal(inOrigin(origin, ['rev-parse', BRANCH]), staleTip);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the latest open dated or rerun PR owns the reusable branch', () => {
  assert.deepEqual(
    selectOpenPr(
      [
        { number: 10, headRefName: BRANCH, url: 'https://example/pr/10' },
        { number: 12, headRefName: `${BRANCH}-rerun-2`, url: 'https://example/pr/12' },
        { number: 13, headRefName: `${BRANCH}-other`, url: 'https://example/pr/13' },
      ],
      BRANCH,
    ),
    { branch: `${BRANCH}-rerun-2`, url: 'https://example/pr/12' },
  );
  assert.equal(selectOpenPr([], BRANCH), null, 'merged and closed PRs are absent from the open list');
});

test('open PR lookup candidates include every retained dated and rerun remote branch', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-branch-candidates-'));
  try {
    const { origin, seed } = makeOrigin(root);
    git(['checkout', 'main'], seed);
    git(['checkout', '-b', `${BRANCH}-rerun-2`], seed);
    commit(seed, 'RERUN.md', 'rerun\n', 'chore(sync): rerun');
    git(['push', 'origin', `${BRANCH}-rerun-2`], seed);
    git(['checkout', 'main'], seed);
    git(['checkout', '-b', 'unrelated'], seed);
    commit(seed, 'OTHER.md', 'other\n', 'test: unrelated');
    git(['push', 'origin', 'unrelated'], seed);

    const work = clone(root, origin, 'work', ['--depth', '1']);
    assert.deepEqual(remoteSyncBranches(work, BRANCH).sort(), [BRANCH, `${BRANCH}-rerun-2`]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('push never force-pushes: a diverged active branch is rejected, not overwritten', () => {
  const root = mkdtempSync(join(tmpdir(), 'sync-branch-reject-'));
  try {
    const { origin } = makeOrigin(root);
    const work = clone(root, origin, 'work', ['--depth', '1']);
    prepareSyncBranch(work, BRANCH, { reuse: true });

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
