// The PR body is the only part of a sync run a human reads. These tests pin the one place where
// an honest heading is still misleading.
//
// A first sync against a repo that was hand-seeded with canon can be entirely adoption: every
// target already exists and is byte-identical to what the engine would write, so `apply()` writes
// no file contents but still sets `report.changed` to record the lock baseline. The PR that opens
// therefore lists N paths under "Baselined in lockfile (N)" above a diff containing exactly one
// file. Confirmed on disk by a `--work-dir` rehearsal against a real member clone: 68 paths, 1
// changed file. Nothing in the body said so, and a reviewer's first move is to look for the other
// 67.
//
// These assert the explanation is present when the run is lockfile-only, and absent when it is
// not — a note that always fires is one a reader learns to skip.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { buildPrBody } from '../lib/pr.mjs';

const paths = (...names) => names.map((targetPath) => ({ targetPath }));

const report = (over = {}) => ({
  added: [],
  updated: [],
  forced: [],
  adopted: [],
  drift: [],
  changed: true,
  ...over,
});

test('an adoption-only run says its whole diff is the lockfile', () => {
  const body = buildPrBody(report({ adopted: paths('agents/architect.agent.md', 'AGENTS.md') }), {
    date: '2026-08-04',
  });

  assert.match(body, /\*\*No file contents changed\.\*\*/);
  assert.match(body, /entire\s+diff of this PR is that one file/);
  assert.match(body, /### Baselined in lockfile \(2\)/);
  assert.match(body, /- `agents\/architect\.agent\.md`/);
});

test('the baselined section explains itself even when the run also wrote files', () => {
  const body = buildPrBody(
    report({ added: paths('skills/a/SKILL.md'), adopted: paths('AGENTS.md') }),
    { date: '2026-08-04' },
  );

  // The per-section note still applies — those paths were not written either way.
  assert.match(body, /Nothing was written to them/);
  // ...but the whole-PR claim would be false here, so it must not appear.
  assert.doesNotMatch(body, /\*\*No file contents changed\.\*\*/);
});

test('a run that only writes files carries no adoption wording at all', () => {
  const body = buildPrBody(report({ added: paths('AGENTS.md'), updated: paths('a.md') }), {
    date: '2026-08-04',
  });

  assert.doesNotMatch(body, /Baselined in lockfile/);
  assert.doesNotMatch(body, /No file contents changed/);
});

test('a force-only run is not mistaken for an adoption-only run', () => {
  // `forced` is the third way a run can write bytes, and it lives outside `added`/`updated`.
  const body = buildPrBody(report({ forced: paths('AGENTS.md'), adopted: paths('a.md') }), {
    date: '2026-08-04',
  });

  assert.doesNotMatch(body, /\*\*No file contents changed\.\*\*/);
});

// --- the drift note's remedy ---
//
// `--force` is parsed once per invocation and threaded into every member, so it rewrites every
// drifted file in every repo the run touches. The drift note is the only text that reaches a
// reviewer before they reach for the flag, and it appears inside one member's PR directly above
// that member's drift list — a context that makes any remedy look scoped to those paths.
//
// These pin the scope statement into the body so the sentence cannot quietly lose it, and pin the
// per-file remedy ahead of it so the safe option is the one offered first.

test('the drift note states that --force is run-wide, not per file', () => {
  const body = buildPrBody(report({ drift: paths('AGENTS.md', 'skills/a/SKILL.md') }), {
    date: '2026-08-04',
  });

  assert.match(body, /### ⚠️ Locally modified — not overwritten \(2\)/);
  assert.match(body, /`--force` is not a per-file fix/);
  assert.match(body, /every.{0,40}member that run touches/s);
});

test('the drift note offers the per-file remedy before mentioning --force', () => {
  const body = buildPrBody(report({ drift: paths('AGENTS.md') }), { date: '2026-08-04' });

  // Reconciling by hand is the correct fix for one stale file; `--force` never is. If the flag
  // were named first a reader would stop there, which is how the original wording read.
  assert.ok(
    body.indexOf('reconcile it by hand') < body.indexOf('--force'),
    'the by-hand remedy must precede any mention of --force',
  );
});

test('no drift means no --force wording anywhere in the body', () => {
  // A warning that fires on every run is one a reader learns to skip past.
  const body = buildPrBody(report({ added: paths('AGENTS.md') }), { date: '2026-08-04' });

  assert.doesNotMatch(body, /--force/);
  assert.doesNotMatch(body, /Locally modified/);
});
