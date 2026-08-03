// Per-member failure isolation.
//
// The engine talks to a separate repo per member. Before this, one member's non-zero git
// exit threw straight out of the loop: every later member was skipped and the profile
// mirror never ran, so a single transient push failure looked like a total outage.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { syncMembers } from '../lib/runner.mjs';

const plan = (repo) => ({ resolved: { repo }, targets: { writes: [] } });
const ctx = { token: 'x', date: '2026-08-03', backbone: 'jrmoulckers/.github' };

test('a failing member does not stop the members after it', () => {
  const seen = [];
  const failures = syncMembers([plan('o/a'), plan('o/b'), plan('o/c')], ctx, ({ repo }) => {
    seen.push(repo);
    if (repo === 'o/b') throw new Error('failed to push some refs');
    return { status: 'pr', prUrl: `https://example/${repo}`, report: { drift: [] } };
  });

  assert.deepEqual(seen, ['o/a', 'o/b', 'o/c'], 'every member is attempted');
  assert.deepEqual(failures, [{ repo: 'o/b', message: 'failed to push some refs' }]);
});

test('an all-clear run reports no failures', () => {
  const failures = syncMembers([plan('o/a'), plan('o/b')], ctx, () => ({
    status: 'unchanged',
    report: { drift: [] },
  }));
  assert.deepEqual(failures, []);
});

test('every member failing is reported, not thrown', () => {
  assert.doesNotThrow(() => {
    const failures = syncMembers([plan('o/a'), plan('o/b')], ctx, () => {
      throw new Error('boom');
    });
    assert.equal(failures.length, 2);
  });
});

test('the member context is passed through to each sync', () => {
  const calls = [];
  syncMembers([plan('o/a')], { ...ctx, force: true }, (args) => {
    calls.push(args);
    return { status: 'unchanged', report: { drift: [] } };
  });
  assert.equal(calls[0].repo, 'o/a');
  assert.equal(calls[0].date, '2026-08-03');
  assert.equal(calls[0].force, true);
  assert.equal(calls[0].backbone, 'jrmoulckers/.github');
});
