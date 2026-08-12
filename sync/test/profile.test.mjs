// The profile mirror answers a question about a *remote* repo, so its failure modes are the ones a
// test cannot stage without a network or a token. The suite therefore pins them structurally, which
// is the same call `branch-reuse.test.mjs` makes for the reporting lookups in `lib/git.mjs`.
//
// The defect being pinned: `repoExists` returned a bare boolean, so a token with no grant, a rate
// limit and a dropped network all read as "this repo is not there" — and the only caller answers
// that by telling an operator to *create a repository*. Wrong, and unsafe when the repo exists and
// the token merely cannot see it.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const GIT = readFileSync(new URL('../lib/git.mjs', import.meta.url), 'utf8');
const PROFILE = readFileSync(new URL('../lib/profile.mjs', import.meta.url), 'utf8');
const INDEX = readFileSync(new URL('../index.mjs', import.meta.url), 'utf8');

/** The body of a top-level export, from its declaration to the next one. */
function exportBody(source, name) {
  const start = source.indexOf(`export function ${name}(`);
  assert.notEqual(start, -1, `expected to find ${name} to check`);
  const next = source.indexOf('\nexport ', start + 1);
  return source.slice(start, next === -1 ? source.length : next);
}

test('the repo-presence lookup answers three states, never a bare boolean', () => {
  const body = exportBody(GIT, 'repoPresence');

  for (const state of ['present', 'absent', 'unavailable']) {
    assert.match(body, new RegExp(`status: '${state}'`), `no \`${state}\` state in repoPresence`);
  }
  assert.doesNotMatch(
    body,
    /return (true|false);/,
    'repoPresence returns a bare boolean, which cannot distinguish "not there" from "could not tell"',
  );
});

test('"not there" is claimed only on the not-found signal, never on any other failure', () => {
  const body = exportBody(GIT, 'repoPresence');
  const [, guard] = body.match(/return (\/[^/]+\/i)\.test\(detail\)/) ?? [];

  assert.ok(guard, 'expected the absent branch to be gated on a test of the failure detail');
  // The classifier must key on GitHub's own not-found wording. Anything looser — matching the
  // whole catch, or keying on a substring an auth error also carries — reinstates the conflation.
  assert.match(guard, /could not resolve to a repository/i);

  const absentIndex = body.indexOf("status: 'absent'");
  const testIndex = body.indexOf('.test(detail)');
  assert.ok(
    testIndex !== -1 && testIndex < absentIndex,
    'the absent state is reachable without consulting the failure detail',
  );
});

test('the mirror prescribes creating the repo only when it knows the repo is absent', () => {
  const start = PROFILE.indexOf("presence.status === 'absent'");
  const unknownStart = PROFILE.indexOf("presence.status === 'unavailable'");
  assert.notEqual(start, -1, 'expected an absent branch in mirrorProfile');
  assert.notEqual(unknownStart, -1, 'expected an unavailable branch in mirrorProfile');
  assert.ok(start < unknownStart, 'precondition: branches found in source order');

  const absentBranch = PROFILE.slice(start, unknownStart);
  const unknownBranch = PROFILE.slice(unknownStart, PROFILE.indexOf('const result =', unknownStart));

  assert.match(absentBranch, /Create it/, 'the absent branch no longer tells the operator to create');
  assert.doesNotMatch(
    unknownBranch,
    /Create it \(/,
    'the unknown branch prescribes creating a repository that may already exist',
  );
  assert.match(
    unknownBranch,
    /do not create/i,
    'the unknown branch does not warn against acting on an unknown answer',
  );
  assert.match(unknownBranch, /status: 'unknown'/, 'the unknown branch is reported as missing');
});

test('the profile outcome reports what the mirror did, not that it was attempted', () => {
  const start = INDEX.indexOf('mirrorProfile({');
  assert.notEqual(start, -1, 'expected the mirrorProfile call site');
  const region = INDEX.slice(start, INDEX.indexOf('} catch', start));

  assert.doesNotMatch(
    region,
    /status: 'mirrored'[,\s}]/,
    'the outcome asserts `mirrored` regardless of whether anything was written',
  );
  assert.match(region, /mirror\.status/, 'the outcome ignores the value mirrorProfile returned');
});
