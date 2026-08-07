// The `--work-dir` guards, exercised through the CLI rather than through `lib/workdir.mjs`.
//
// This file exists because of how the identity bug survived its own fix. #57 added the checkout
// guard and six unit tests, all passing, and the engine still wrote 142 lines into an unrelated
// repo and exited 0 — because the guard that mattered was wired in as a *warning*, and no test
// crossed the boundary between the library and `index.mjs`. A unit test cannot see a guard that is
// called but not obeyed.
//
// So these assert the two things unit tests structurally cannot: that the CLI calls the guard at
// all, and that every mode is behind it — including `--check` and `--dry-run`, which read as
// harmless and are the ones most likely to be pointed at an arbitrary directory.
//
// Offline: local `git init` repos, no token, no network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const CLI = join(dirname(fileURLToPath(import.meta.url)), '..', 'index.mjs');

const git = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Synchronous by design — an async body would outlive the `finally` that deletes the root. */
function withTmp(fn) {
  const root = mkdtempSync(join(tmpdir(), 'studio-cli-'));
  try {
    const out = fn(root);
    if (out && typeof out.then === 'function') {
      throw new Error('withTmp body must be synchronous; an async body races the cleanup below.');
    }
    return out;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function seededRepo(root, name, origin) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  git(['init', '-q'], dir);
  if (origin) git(['remote', 'add', 'origin', origin], dir);
  writeFileSync(join(dir, 'AGENTS.md'), 'one\ntwo\nthree\n', 'utf8');
  git(['add', '-A'], dir);
  git(['-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '-qm', 'seed'], dir);
  return dir;
}

/** Run the CLI with the token deliberately absent, so nothing can reach the network. */
function run(args) {
  const env = { ...process.env };
  delete env.STUDIO_SYNC_TOKEN;
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

const MEMBER = 'jrmoulckers/finance';

test('every --work-dir mode refuses a checkout with the wrong origin', () => {
  withTmp((root) => {
    const dir = seededRepo(root, 'wrong', 'https://github.com/someoneelse/unrelated.git');

    for (const extra of [[], ['--check'], ['--dry-run']]) {
      const { code, out } = run([...extra, '--work-dir', dir, '--members', MEMBER]);
      const label = extra[0] ?? '(apply)';
      assert.equal(code, 1, `${label} should exit 1\n${out}`);
      assert.match(out, /someoneelse\/unrelated/, label);
    }
  });
});

test('every --work-dir mode refuses a checkout with no origin at all', () => {
  withTmp((root) => {
    // The variant that was completely silent: a plain `git init` repo passes the checkout guard,
    // and "no origin to compare" used to read the same as "origin matched".
    const dir = seededRepo(root, 'local-only');

    for (const extra of [[], ['--check'], ['--dry-run']]) {
      const { code, out } = run([...extra, '--work-dir', dir, '--members', MEMBER]);
      const label = extra[0] ?? '(apply)';
      assert.equal(code, 1, `${label} should exit 1\n${out}`);
      assert.match(out, /no origin remote/, label);
    }
  });
});

test('a refused run writes nothing — no files, and above all no lockfile', () => {
  withTmp((root) => {
    const dir = seededRepo(root, 'local-only');

    const { code } = run(['--work-dir', dir, '--members', MEMBER]);
    assert.equal(code, 1);

    // The lockfile is the part that persists past a `git checkout`: written into the wrong
    // directory, it makes the next `--check` there report "up to date". Exiting 1 while still
    // leaving one behind would fix the symptom and keep the failure.
    const entries = readdirSync(dir).filter((n) => n !== '.git');
    assert.deepEqual(entries.sort(), ['AGENTS.md'], 'only the seeded file should remain');
    assert.equal(git(['status', '--porcelain'], dir), '', 'the working tree must be untouched');
  });
});

test('--allow-unverified-work-dir lets a run through, and says what it suppressed', () => {
  withTmp((root) => {
    const dir = seededRepo(root, 'local-only');

    const { code, out } = run([
      '--dry-run',
      '--work-dir',
      dir,
      '--members',
      MEMBER,
      '--allow-unverified-work-dir',
    ]);

    assert.equal(code, 0, out);
    assert.match(out, /identity check overridden/);
    assert.match(out, /no origin remote/);
  });
});

test('a checkout whose origin is the member is not blocked', () => {
  withTmp((root) => {
    // Guards are only worth having if the correct call still goes through. Origin is set by hand
    // rather than cloned, so this stays offline.
    const dir = seededRepo(root, 'finance', `https://github.com/${MEMBER}.git`);

    const { code, out } = run(['--dry-run', '--work-dir', dir, '--members', MEMBER]);

    assert.equal(code, 0, out);
    assert.doesNotMatch(out, /identity check overridden/);
    assert.match(out, new RegExp(MEMBER.replace('/', '\\/')));
  });
});

test('--check derives registry facts before reading or applying the member lock', () => {
  withTmp((root) => {
    const member = 'jrmoulckers/cartridge';
    const dir = seededRepo(root, 'cartridge', `https://github.com/${member}.git`);
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify({ devDependencies: { svelte: '5.0.0' } }),
      'utf8',
    );
    writeFileSync(join(dir, 'pnpm-lock.yaml'), 'lockfileVersion: 9\n', 'utf8');
    writeFileSync(join(dir, '.studio-sync.lock.json'), 'not json', 'utf8');

    const { code, out } = run(['--check', '--work-dir', dir, '--members', member]);

    assert.equal(code, 1);
    assert.match(out, /packageManager claims "npm" but checkout derives "pnpm"/);
    assert.doesNotMatch(out, /Corrupt lockfile/);
  });
});
