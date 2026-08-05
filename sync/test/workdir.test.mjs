// `--work-dir` guards. See lib/workdir.mjs for why this mode's misuse is worth failing on:
// every target is absent, so the run reports them all as `added` and exits 0, which is
// indistinguishable from a legitimate first-sync plan — a false negative on drift, which is the
// signal the mode is usually being used to check.
//
// Uses local git repos only — no network, no gh, no token.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assertMemberCheckout, repoMismatchWarning } from '../lib/workdir.mjs';

const git = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

/** Synchronous by design — an async body would outlive the `finally` that deletes the root. */
function withTmp(fn) {
  const root = mkdtempSync(join(tmpdir(), 'studio-workdir-'));
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

function repo(root, name, origin) {
  const dir = join(root, name);
  mkdirSync(dir, { recursive: true });
  git(['init', '-q'], dir);
  if (origin) git(['remote', 'add', 'origin', origin], dir);
  return dir;
}

test('a directory that is not a git checkout is rejected', () => {
  withTmp((root) => {
    const parent = join(root, 'parent');
    mkdirSync(parent, { recursive: true });
    repo(root, 'parent/member');

    // The exact mistake from the field report: pointing at the directory *containing* the clone.
    assert.throws(() => assertMemberCheckout(parent), /is not a git checkout/);
    assert.doesNotThrow(() => assertMemberCheckout(join(parent, 'member')));
  });
});

test('a missing path and a file are rejected with distinguishable messages', () => {
  withTmp((root) => {
    const file = join(root, 'a-file');
    writeFileSync(file, 'x', 'utf8');

    assert.throws(() => assertMemberCheckout(join(root, 'nope')), /does not exist/);
    assert.throws(() => assertMemberCheckout(file), /is not a directory/);
  });
});

test('a git worktree is accepted even though its .git is a file', () => {
  withTmp((root) => {
    const main = repo(root, 'main');
    writeFileSync(join(main, 'f.txt'), 'x', 'utf8');
    git(['add', '.'], main);
    git(['-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '-qm', 'init'], main);
    const wt = join(root, 'wt');
    git(['worktree', 'add', '-q', wt, '-b', 'side'], main);

    // A worktree's `.git` is a file pointing at the real gitdir, so an isDirectory() check here
    // would reject a perfectly valid checkout — which is how this repo itself is checked out.
    assert.doesNotThrow(() => assertMemberCheckout(wt));
  });
});

test('a checkout of the wrong repo warns', () => {
  withTmp((root) => {
    const dir = repo(root, 'finance', 'https://github.com/jrmoulckers/finance.git');

    const warning = repoMismatchWarning(dir, 'jrmoulckers/libro');
    assert.match(warning, /jrmoulckers\/libro/);
    assert.match(warning, /reported as added/);
  });
});

test('the matching repo does not warn, across URL spellings', () => {
  withTmp((root) => {
    for (const [i, origin] of [
      'https://github.com/jrmoulckers/finance.git',
      'https://github.com/jrmoulckers/finance',
      'git@github.com:jrmoulckers/finance.git',
      'https://github.com/JRMoulckers/Finance.git',
    ].entries()) {
      const dir = repo(root, `m${i}`, origin);
      assert.equal(repoMismatchWarning(dir, 'jrmoulckers/finance'), null, origin);
    }
  });
});

test('a checkout with no remote does not warn', () => {
  withTmp((root) => {
    // Local-only clones are how the rest of the suite drives this path, and a fork or mirror is a
    // legitimate reason to have no matching origin. Silence beats a warning nobody can act on.
    const dir = repo(root, 'local-only');
    assert.equal(repoMismatchWarning(dir, 'jrmoulckers/finance'), null);
  });
});
