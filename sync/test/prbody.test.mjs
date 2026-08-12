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
  const byHand = body.indexOf('reconcile it by hand');
  const flag = body.indexOf('--force');

  // Assert presence before order. `indexOf` returns -1 for a missing string, and -1 sorts first,
  // so an ordering check alone passes when the by-hand remedy is deleted entirely — the failure
  // this test exists to catch. Caught by mutating the note back to its original single sentence,
  // which killed the scope test above and left this one green.
  assert.notEqual(byHand, -1, 'the by-hand remedy must be present');
  assert.notEqual(flag, -1, 'the --force caveat must be present');
  assert.ok(byHand < flag, 'the by-hand remedy must precede any mention of --force');
});

test('the drift note names the never-delivered exception and the flag that authorizes it', () => {
  // The scope sentence above tells a reader --force is broader than they think. That alone would
  // read as "so be careful", which is what the requester who called it "low-risk on one known
  // file" already believed. The exception has to be stated positively: the unrecoverable class is
  // refused outright, and the only way past it is naming the path — a step no one takes by
  // accident. Pinned because the sentence is the sole member-facing description of the refusal.
  const body = buildPrBody(report({ drift: paths('AGENTS.md') }), { date: '2026-08-04' });

  assert.match(body, /canon has never delivered/);
  assert.match(body, /--force-paths/);
});

test('no drift means no --force wording anywhere in the body', () => {  // A warning that fires on every run is one a reader learns to skip past.
  const body = buildPrBody(report({ added: paths('AGENTS.md') }), { date: '2026-08-04' });

  assert.doesNotMatch(body, /--force/);
  assert.doesNotMatch(body, /Locally modified/);
});

test('an older mixed wave is named in the body with the commits that make it mixed', () => {
  const body = buildPrBody(report({ added: paths('AGENTS.md') }), {
    date: '2026-08-11',
    waveLookup: { status: 'ok', waves: [
      {
        number: 20,
        url: 'https://github.com/jrmoulckers/homelab/pull/20',
        branch: 'studio-sync/2026-08-09',
        total: 4,
        authored: ['fix(ci): teach the asset checker managed regions'],
      },
    ] },
  });

  assert.match(body, /An older sync wave is still open \(1\)/);
  assert.match(body, /pull\/20/);
  assert.match(body, /\*\*mixed\*\* — 1 of 4 commit\(s\) not authored by the engine/);
  assert.match(body, /fix\(ci\): teach the asset checker managed regions/);
  // The disposition for a mixed branch is reduction, never rebase-and-merge.
  assert.match(body, /must not be rebased and merged/);
});

test('a pure older wave is reported as closable, not as salvage', () => {
  const body = buildPrBody(report({ added: paths('AGENTS.md') }), {
    date: '2026-08-11',
    waveLookup: { status: 'ok', waves: [
      {
        number: 25,
        url: 'https://example.invalid/25',
        branch: 'studio-sync/2026-08-09',
        total: 1,
        authored: [],
      },
    ] },
  });

  assert.match(body, /\*\*pure canon\*\* — all 1 commit\(s\) authored by the engine/);
  assert.match(body, /can simply be closed/);
});

test('a run with no older wave carries none of the wording', () => {
  const body = buildPrBody(report({ added: paths('AGENTS.md') }), { date: '2026-08-11' });
  assert.doesNotMatch(body, /older sync wave/);
});
test('a failed wave lookup says so in the body instead of implying none exists', () => {
  const body = buildPrBody(report({ added: paths('AGENTS.md') }), {
    date: '2026-08-11',
    waveLookup: { status: 'unavailable', waves: [] },
  });

  assert.match(body, /Could not check for an older open sync wave/);
  assert.match(body, /carries no claim either way/);
  // The reader must not be able to read silence as a clean result.
  assert.match(body, /not evidence that none exists/);
  // ...and it must not render the "an older wave IS open" section off an empty list.
  assert.doesNotMatch(body, /An older sync wave is still open/);
});

test('a successful lookup finding nothing carries no uncertainty wording', () => {
  const body = buildPrBody(report({ added: paths('AGENTS.md') }), {
    date: '2026-08-11',
    waveLookup: { status: 'ok', waves: [] },
  });

  assert.doesNotMatch(body, /Could not check/);
  assert.doesNotMatch(body, /An older sync wave is still open/);
});
// docs/sync.md carries the marker-counting rule, and docs/ is in no canon kind — it reaches none of
// the eleven members. The party told to resolve a sync PR is a member-side reader who has never been
// delivered the document that explains how to verify the resolution. Two members have now reported a
// correct count as a defect, and neither was reading the rule when they did.
//
// So the rule travels with the finding, in the sync PR body, which is the artifact the member does
// receive. Whether the count it warns about is real is pinned separately in basemerge.test.mjs.
test('the duplicate-region warning carries its own verification and forbids the bare name', () => {
  const body = buildPrBody(
    report({ orphaned: [{ targetPath: 'AGENTS.md', lines: [148] }] }),
    { date: '2026-08-12' },
  );

  assert.match(body, /more than one managed region/);
  assert.match(body, /`AGENTS\.md` — extra region\(s\) beginning at line 148/);

  // The delimiter-anchored command, for both marker forms.
  assert.match(body, /grep -c '\^<!-- studio:base:start -->\$'/);
  assert.match(body, /grep -c '\^# studio:base:start\$'/);

  // The expected value, and the matcher that cannot produce it.
  assert.match(body, /Expect `1`/);
  assert.match(body, /Do not verify with `grep -c studio:base:start`/);
  assert.match(body, /reports `2` under the bare name/);
});

test('a run with no duplicated region carries none of the marker-counting wording', () => {
  const body = buildPrBody(report({ added: paths('AGENTS.md') }), { date: '2026-08-12' });

  assert.doesNotMatch(body, /more than one managed region/);
  assert.doesNotMatch(body, /Expect `1`/);
});
