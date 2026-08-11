// Historical-canon evidence for vendored @jrm/tokens.
//
// Token canon lives in an external repo, so the evidence that a vendored member file is stale
// engine output rather than member-authored content comes from *that* repo's dist/ history. Two
// ways this goes silently inert and is therefore pinned here: rendering the historical blob without
// the token provenance note (producing a hash set that matches nothing), and reading history from a
// shallow checkout (producing an empty one).

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { enumerateTokenTargets } from '../lib/assets.mjs';
import { historicalFileVersions } from '../lib/history.mjs';
import { apply } from '../lib/copier.mjs';
import { hashText } from '../lib/lock.mjs';
import { inject } from '../lib/provenance.mjs';

const PLAN = {
  sourceRepo: 'jrmoulckers/studio',
  package: '@jrm/tokens',
  sourceBase: 'packages/tokens/dist',
  targetBase: 'vendor/@jrm/tokens',
};
const NOTE = `generated + synced from ${PLAN.sourceRepo} ${PLAN.package} — do not edit here`;
const REL = 'css/default/tokens.css';
const SOURCE = `${PLAN.sourceBase}/${REL}`;
const TARGET = `${PLAN.targetBase}/${REL}`;

const V1 = ':root { --color-a: red }\n';
const V2 = ':root { --color-a: red; --color-b: blue }\n';

function git(cwd, args) {
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function writeFile(root, relPath, content) {
  const abs = join(root, ...relPath.split('/'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

/** A studio-like repo whose committed dist/ has two versions of one token file. */
function studioRepo(root) {
  git(root, ['init', '-q', '-b', 'main']);
  git(root, ['config', 'user.email', 'test@example.com']);
  git(root, ['config', 'user.name', 'Test']);
  for (const version of [V1, V2]) {
    writeFile(root, SOURCE, version);
    git(root, ['add', '-A']);
    git(root, ['commit', '-q', '-m', 'dist']);
  }
}

function withRepos(fn) {
  const root = mkdtempSync(join(tmpdir(), 'tokens-history-'));
  const studio = join(root, 'studio');
  const member = join(root, 'member');
  mkdirSync(studio, { recursive: true });
  mkdirSync(member, { recursive: true });
  try {
    studioRepo(studio);
    return fn({ studio, member, root });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('token targets carry a non-empty historical set rendered with the token note', () => {
  withRepos(({ studio }) => {
    const [spec] = enumerateTokenTargets(PLAN, studio).filter((s) => s.targetPath === TARGET);

    // Non-vacuous: an empty set would disable recovery without failing anything.
    assert.ok(spec.historicalCanonSha256.length > 0, 'historical evidence must not be empty');

    // The prior version must be present in BOTH forms: the raw blob and the engine rendering of
    // it. The rendering is the one that actually occurs in members, and it only matches when the
    // token provenance note is used — the backbone default note would produce a different hash.
    assert.ok(spec.historicalCanonSha256.includes(hashText(V1)), 'raw prior blob');
    assert.ok(
      spec.historicalCanonSha256.includes(hashText(inject(TARGET, V1, { note: NOTE }))),
      'prior blob rendered with the token note',
    );
    assert.ok(
      !spec.historicalCanonSha256.includes(hashText(inject(TARGET, V1))),
      'the backbone default note is not what members carry',
    );

    // Current canon is excluded: that is `unchanged`/`update`, not recovery evidence.
    assert.ok(!spec.historicalCanonSha256.includes(hashText(spec.content)));
  });
});

test('a vendored file frozen on an older release is updated, not reported as drift forever', () => {
  withRepos(({ studio, member }) => {
    // Exactly finance's tokens.css: an unrecorded vendored file whose bytes are the engine's own
    // rendering of an older dist. Before this evidence existed it was skipped on every run.
    writeFile(member, TARGET, inject(TARGET, V1, { note: NOTE }));
    const writes = enumerateTokenTargets(PLAN, studio);

    const { report, lock } = apply(member, writes, { backbone: 'b', entries: {} }, { write: true });

    assert.deepEqual(report.drift, [], 'provable stale engine output must not be drift');
    assert.ok(report.updated.some((i) => i.targetPath === TARGET));
    assert.equal(lock.entries[TARGET].targetSha256, hashText(inject(TARGET, V2, { note: NOTE })));
  });
});

test('a member-authored vendored file is still refused', () => {
  withRepos(({ studio, member }) => {
    writeFile(member, TARGET, ':root { --color-a: green } /* ours */\n');
    const writes = enumerateTokenTargets(PLAN, studio);

    const { report } = apply(member, writes, { backbone: 'b', entries: {} }, { write: true });

    assert.deepEqual(
      report.drift.map((i) => i.targetPath),
      [TARGET],
      'bytes that match no committed canon version are never overwritten',
    );
  });
});

test('history from a shallow token checkout fails closed rather than returning nothing', () => {
  withRepos(({ studio, root }) => {
    const shallow = join(root, 'shallow');
    execFileSync('git', ['clone', '-q', '--depth', '1', `file://${studio.replace(/\\/g, '/')}`, shallow], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    // An empty evidence set is indistinguishable from "nothing is recoverable", so a shallow
    // checkout must raise rather than quietly degrade into today's permanent-drift behaviour.
    assert.throws(() => historicalFileVersions(shallow, [SOURCE]), /full backbone history/);
  });
});
