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
  selectOtherOpenSyncPrs,
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

// The real `jrmoulckers/homelab` pairing that motivated the report, as `gh pr list --json` returned
// it: #25 pure canon on the current wave, #20 mixed and two days older. A synthetic fixture here
// would only contain the shapes I already expected — this one is the population as it actually is,
// including the `unrelated` PR that has to be ignored.
const HOMELAB_OPEN_PRS = [
  {
    number: 29,
    url: 'https://github.com/jrmoulckers/homelab/pull/29',
    headRefName: 'jrmoulckers-automatic-spoon',
    createdAt: '2026-08-10T00:00:00Z',
    commits: [{ authors: [{ name: 'Jeffrey Moulckers' }], messageHeadline: 'feat: unrelated' }],
  },
  {
    number: 25,
    url: 'https://github.com/jrmoulckers/homelab/pull/25',
    headRefName: 'studio-sync/2026-08-11',
    createdAt: '2026-08-11T04:27:54Z',
    commits: [
      { authors: [{ name: 'jrm-studio-sync' }], messageHeadline: 'chore(sync): update studio canon (2026-08-11)' },
    ],
  },
  {
    number: 20,
    url: 'https://github.com/jrmoulckers/homelab/pull/20',
    headRefName: 'studio-sync/2026-08-09',
    createdAt: '2026-08-09T22:23:46Z',
    commits: [
      { authors: [{ name: 'jrm-studio-sync' }], messageHeadline: 'chore(sync): update studio canon (2026-08-09)' },
      { authors: [{ name: 'Jeffrey Moulckers' }], messageHeadline: 'fix(ci): teach the asset checker managed regions' },
      { authors: [{ name: 'Jeffrey Moulckers' }], messageHeadline: 'docs(copilot): trim repo-local policy' },
      { authors: [{ name: 'Jeffrey Moulckers' }], messageHeadline: 'fix(ci): select managed-region markers per target' },
    ],
  },
];

test('an older open wave is reported, and its own wave is not', () => {
  const waves = selectOtherOpenSyncPrs(HOMELAB_OPEN_PRS, 'studio-sync/2026-08-11');
  assert.deepEqual(
    waves.map((wave) => wave.number),
    [20],
    'only the 2026-08-09 wave is other; the current wave and the unrelated PR are excluded',
  );
});

test('mixed-vs-pure is decided by authorship, not by commit count', () => {
  const [older] = selectOtherOpenSyncPrs(HOMELAB_OPEN_PRS, 'studio-sync/2026-08-11');
  assert.equal(older.total, 4);
  assert.deepEqual(older.authored, [
    'fix(ci): teach the asset checker managed regions',
    'docs(copilot): trim repo-local policy',
    'fix(ci): select managed-region markers per target',
  ]);

  // Same lookup from the older wave's side: the newer one is pure, so `authored` must be empty
  // rather than merely short. A classifier that counted commits would call a 1-commit branch
  // "small"; only authorship says it is replaceable.
  const [newer] = selectOtherOpenSyncPrs(HOMELAB_OPEN_PRS, 'studio-sync/2026-08-09');
  assert.equal(newer.number, 25);
  assert.equal(newer.total, 1);
  assert.deepEqual(newer.authored, []);
});

test('a rerun branch is the same wave as the dated branch it reruns', () => {
  // `studio-sync/<date>-rerun-2` is this run's own branch after a retained branch was bypassed.
  // Comparing raw branch names would report the run's own wave back to it as though it were older.
  const waves = selectOtherOpenSyncPrs(
    [
      ...HOMELAB_OPEN_PRS,
      {
        number: 26,
        url: 'https://github.com/jrmoulckers/homelab/pull/26',
        headRefName: 'studio-sync/2026-08-11-rerun-2',
        createdAt: '2026-08-11T05:00:00Z',
        commits: [{ authors: [{ name: 'jrm-studio-sync' }], messageHeadline: 'chore(sync): rerun' }],
      },
    ],
    'studio-sync/2026-08-11-rerun-2',
  );
  assert.deepEqual(waves.map((wave) => wave.branch), ['studio-sync/2026-08-09']);
});

test('an unattributed commit counts as authored — the report errs toward looking', () => {
  const waves = selectOtherOpenSyncPrs(
    [
      {
        number: 7,
        url: 'https://example.invalid/7',
        headRefName: 'studio-sync/2026-08-01',
        createdAt: '2026-08-01T00:00:00Z',
        commits: [{ authors: [], messageHeadline: 'commit from a deleted account' }],
      },
    ],
    'studio-sync/2026-08-11',
  );
  assert.deepEqual(waves[0].authored, ['commit from a deleted account']);
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

// The wave lookup degrades to "no other waves" on any error, which makes a malformed query
// indistinguishable from a clean repo — permanently and silently. This is not hypothetical:
// requesting `commits` alongside a PR *list* is rejected by GitHub outright ("requests up to
// 505,050 possible nodes which exceeds the maximum limit of 500,000" at `--limit 50`), and the
// catch swallowed it. Commits must be fetched per PR, where the node count cannot multiply out.
test('the wave lookup never requests commits from a PR list query', () => {
  const source = readFileSync(new URL('../lib/git.mjs', import.meta.url), 'utf8');
  const listCalls = [...source.matchAll(/\['pr', 'list',[^\]]*\]/g)].map((match) => match[0]);

  assert.ok(listCalls.length > 0, 'expected to find at least one `gh pr list` invocation to check');
  for (const call of listCalls) {
    assert.doesNotMatch(
      call,
      /commits/,
      `a PR list query asks for commits and will be rejected by the node budget: ${call}`,
    );
  }
});