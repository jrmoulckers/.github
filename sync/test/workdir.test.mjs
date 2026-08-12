// `--work-dir` guards. See lib/workdir.mjs for why this mode's misuse is worth failing on:
// every target is absent, so the run reports them all as `added` and exits 0, which is
// indistinguishable from a legitimate first-sync plan — a false negative on drift, which is the
// signal the mode is usually being used to check.
//
// Uses local git repos only — no network, no gh, no token.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { assertMemberCheckout, assertMemberIdentity, memberIdentity } from '../lib/workdir.mjs';
import { apply } from '../lib/copier.mjs';
import { readLock, hashText } from '../lib/lock.mjs';

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

// --- identity ---------------------------------------------------------------
//
// `assertMemberCheckout` only proves the target is *a* checkout. These cover the case it cannot
// see: a real checkout of the wrong repo. The three verdicts must stay distinct — an earlier
// version of this file folded "no origin, cannot check" into "checked, fine", and a local-only
// `git init` repo was then written into with no output at all.

test('a checkout of the wrong repo is refused, and names both repos', () => {
  withTmp((root) => {
    const dir = repo(root, 'finance', 'https://github.com/jrmoulckers/finance.git');

    assert.equal(memberIdentity(dir, 'jrmoulckers/libro').status, 'mismatch');
    assert.throws(() => assertMemberIdentity(dir, 'jrmoulckers/libro'), (err) => {
      assert.match(err.message, /jrmoulckers\/libro/);
      assert.match(err.message, /jrmoulckers\/finance/);
      return true;
    });
  });
});

test('the matching repo is accepted, across URL spellings', () => {
  withTmp((root) => {
    for (const [i, origin] of [
      'https://github.com/jrmoulckers/finance.git',
      'https://github.com/jrmoulckers/finance',
      'git@github.com:jrmoulckers/finance.git',
      'https://github.com/JRMoulckers/Finance.git',
    ].entries()) {
      const dir = repo(root, `m${i}`, origin);
      assert.equal(memberIdentity(dir, 'jrmoulckers/finance').status, 'match', origin);
      assert.doesNotThrow(() => assertMemberIdentity(dir, 'jrmoulckers/finance'), origin);
    }
  });
});

test('a checkout with no remote is refused, not silently accepted', () => {
  withTmp((root) => {
    // The reported failure, and the worst variant: a plain `git init` repo has a `.git`, so it
    // passes assertMemberCheckout, and has no origin to compare against, so the previous
    // warn-on-mismatch check returned null. It rewrote an unrelated AGENTS.md from 3 lines to 145
    // and exited 0. "Could not verify" is not "verified".
    const dir = repo(root, 'local-only');

    assert.equal(memberIdentity(dir, 'jrmoulckers/finance').status, 'unverifiable');
    assert.throws(
      () => assertMemberIdentity(dir, 'jrmoulckers/finance'),
      /no origin remote/,
    );
  });
});

test('the refusal explains the self-certifying lockfile, not just the bad path', () => {
  withTmp((root) => {
    // The bytes are recoverable with `git checkout`. The lockfile is the part that persists: it
    // makes the next `--check` against the same directory report "up to date", so the mistake
    // stops being visible. Someone reading this error needs to know to delete it.
    const dir = repo(root, 'local-only');

    assert.throws(() => assertMemberIdentity(dir, 'jrmoulckers/finance'), /--check/);
  });
});

test('--allow-unverified-work-dir overrides both failing verdicts, and says which', () => {
  withTmp((root) => {
    const wrong = repo(root, 'wrong', 'https://github.com/someoneelse/unrelated.git');
    const none = repo(root, 'none');

    const a = assertMemberIdentity(wrong, 'jrmoulckers/finance', { allowUnverified: true });
    assert.equal(a.status, 'mismatch');
    assert.equal(a.overridden, true);
    assert.match(a.origin, /someoneelse\/unrelated/);

    const b = assertMemberIdentity(none, 'jrmoulckers/finance', { allowUnverified: true });
    assert.equal(b.status, 'unverifiable');
    assert.equal(b.overridden, true);
    assert.equal(b.origin, null);
  });
});

test('a matching checkout is never reported as overridden', () => {
  withTmp((root) => {
    // The override flag must not change the verdict for a checkout that was fine anyway, or the
    // warning it drives would fire on correct runs and be tuned out.
    const dir = repo(root, 'finance', 'https://github.com/jrmoulckers/finance.git');

    const v = assertMemberIdentity(dir, 'jrmoulckers/finance', { allowUnverified: true });
    assert.equal(v.status, 'match');
    assert.equal(v.overridden, false);
  });
});

// --- line endings -----------------------------------------------------------
//
// `--work-dir` is the only mode that reads member bytes off a disk it did not write. The remote
// path fetches blob bytes, which git has already normalized, so nothing there can observe a
// checkout's line endings. A local checkout can, and on Windows it usually does.
//
// What makes that survivable is `hashText` normalizing before it hashes. Drift is then a question
// about content rather than about the platform that materialized it. Both properties below held at
// the time they were written and neither was pinned: deleting the `toLF` in `hashText` passed the
// whole suite (336/336). The failure it lets through is silent in the direction that matters —
// `git status` calls a CRLF-materialized file clean, so the member side shows nothing.

test('hashText is line-ending agnostic', () => {
  // The mechanism. A CRLF checkout and an LF checkout of identical content must hash alike, or
  // every comparison downstream inherits the platform that produced the working tree.
  assert.equal(hashText('a\r\nb\r\n'), hashText('a\nb\n'));
  assert.equal(hashText('trailing\r\n'), hashText('trailing\n'));

  // Guard the trivially-passing reading: it must be normalization, not hashing everything alike.
  assert.notEqual(hashText('a\nb\n'), hashText('a\nc\n'));
});

test('a member file materialized with CRLF is unchanged, not drift', () => {
  // The consequence, through the real planner. Without normalization `currentHash` never matches
  // the rendering, `isLocallyModified` is true, and the target reports as drift — on every text
  // file in the repo, on every run, from a checkout nobody edited. Under `--force` that same
  // verdict overwrites instead of reporting.
  withTmp((root) => {
    const content = '# canon\n\nA line.\n';
    const spec = {
      kind: 'agents',
      name: 'architect',
      sourcePath: 'agents/architect.agent.md',
      targetPath: '.github/agents/architect.agent.md',
      sourceSha256: hashText(content),
      content,
      type: 'file',
    };

    const first = apply(root, [spec], readLock(root, 'jrmoulckers/.github'), { write: true });
    assert.equal(first.report.added.length, 1, 'precondition: the target is delivered and locked');

    // Re-materialize exactly as a Windows checkout would: same content, CRLF on disk.
    const abs = join(root, '.github', 'agents', 'architect.agent.md');
    const asCheckedOutOnWindows = readFileSync(abs, 'utf8').replace(/\n/g, '\r\n');
    assert.match(asCheckedOutOnWindows, /\r\n/, 'precondition: the fixture really is CRLF');
    writeFileSync(abs, asCheckedOutOnWindows, 'utf8');

    const second = apply(root, [spec], readLock(root, 'jrmoulckers/.github'), { write: false });
    assert.deepEqual(second.report.drift, [], 'a CRLF checkout is not a member edit');
    assert.equal(second.report.unchanged.length, 1);
  });
});
