// Per-member failure isolation.
//
// The engine talks to a separate repo per member. Before this, one member's non-zero git
// exit threw straight out of the loop: every later member was skipped and the profile
// mirror never ran, so a single transient push failure looked like a total outage.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { formatDriftWarning, partitionFailures, renderRunSummary, summarizeCheck, syncMembers } from '../lib/runner.mjs';

const plan = (repo) => ({ resolved: { repo }, targets: { writes: [] } });
const ctx = { token: 'x', date: '2026-08-03', backbone: 'jrmoulckers/.github' };

test('a failing member does not stop the members after it', () => {
  const seen = [];
  const { failures } = syncMembers([plan('o/a'), plan('o/b'), plan('o/c')], ctx, ({ repo }) => {
    seen.push(repo);
    if (repo === 'o/b') throw new Error('failed to push some refs');
    return { status: 'pr', prUrl: `https://example/${repo}`, report: { drift: [] } };
  });

  assert.deepEqual(seen, ['o/a', 'o/b', 'o/c'], 'every member is attempted');
  assert.deepEqual(failures, [{ repo: 'o/b', message: 'failed to push some refs' }]);
});

test('an all-clear run reports no failures', () => {
  const { failures } = syncMembers([plan('o/a'), plan('o/b')], ctx, () => ({
    status: 'unchanged',
    report: { drift: [] },
  }));
  assert.deepEqual(failures, []);
});

test('every member failing is reported, not thrown', () => {
  assert.doesNotThrow(() => {
    const { failures } = syncMembers([plan('o/a'), plan('o/b')], ctx, () => {
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
  assert.equal(calls[0].member.repo, 'o/a');
});

test('a partial failure records what survived, not only what broke', () => {
  const { outcomes, failures } = syncMembers(
    [plan('o/a'), plan('o/b'), plan('o/c')],
    ctx,
    ({ repo }) => {
      if (repo === 'o/b') throw new Error('403 forbidden');
      return { status: 'pr', prUrl: `https://example/${repo}`, report: { drift: [] } };
    },
  );

  // Isolation already kept o/c running. The point here is that the run can afterwards say so:
  // failures alone cannot distinguish one dead member from a dead fleet.
  assert.equal(failures.length, 1);
  assert.deepEqual(
    outcomes.map((o) => [o.repo, o.status]),
    [
      ['o/a', 'opened'],
      ['o/b', 'failed'],
      ['o/c', 'opened'],
    ],
  );
});

test('every success branch reaches the outcome record', () => {
  // A first pass covered only the pr/opened branch, and deleting the no-changes push left the
  // suite green — the unchanged member is the most common outcome in a steady fleet, so a
  // summary blind to it would have under-reported exactly the runs that are working.
  const { outcomes } = syncMembers([plan('o/a'), plan('o/b'), plan('o/c')], ctx, ({ repo }) => {
    if (repo === 'o/a') return { status: 'unchanged', report: { drift: [] } };
    return {
      status: 'pr',
      reused: repo === 'o/b',
      prUrl: `https://example/${repo}`,
      report: { drift: [] },
    };
  });

  assert.deepEqual(
    outcomes.map((o) => [o.repo, o.status]),
    [
      ['o/a', 'no changes'],
      ['o/b', 'updated'],
      ['o/c', 'opened'],
    ],
  );
  assert.equal(outcomes[2].detail, 'https://example/o/c');
});

test('the summary distinguishes one failed member from a failed fleet', () => {
  const partial = renderRunSummary([
    { repo: 'o/a', status: 'opened', detail: 'https://example/a' },
    { repo: 'o/windows', status: 'failed', detail: '403 forbidden' },
    { repo: 'o/c', status: 'no changes' },
  ]);
  const total = renderRunSummary([
    { repo: 'o/a', status: 'failed', detail: '403 forbidden' },
    { repo: 'o/windows', status: 'failed', detail: '403 forbidden' },
    { repo: 'o/c', status: 'failed', detail: '403 forbidden' },
  ]);

  // Both runs exit non-zero and both render red. The whole value of the summary is that these
  // two no longer read the same — five weeks of red went unread because they used to.
  assert.match(partial, /2 of 3 target\(s\) succeeded/);
  assert.match(total, /0 of 3 target\(s\) succeeded/);
  assert.notEqual(partial, total);

  // The failing member is named, since "one member failed" without saying which is not actionable.
  assert.match(partial, /o\/windows/);
  assert.match(partial, /403 forbidden/);
  // And the survivors are named, which is the half that was being discarded.
  assert.match(partial, /\| `o\/a` \| opened \|/);
  assert.match(partial, /\| `o\/c` \| no changes \|/);
});

test('an all-clear summary claims no failures', () => {
  const summary = renderRunSummary([
    { repo: 'o/a', status: 'opened', detail: 'https://example/a' },
    { repo: 'o/b', status: 'no changes' },
  ]);
  assert.match(summary, /2 of 2 target\(s\) succeeded/);
  assert.doesNotMatch(summary, /#### Failed/);
});

test('the summary is actually wired to the CI surface', () => {
  // renderRunSummary is pure and well covered, which proves nothing about whether anything calls
  // it. This is the defect one layer down: a report that is computed and never published reads,
  // from CI, exactly like the silence it was written to end. index.mjs exports nothing, so the
  // wiring is asserted at the source.
  const source = readFileSync(new URL('../index.mjs', import.meta.url), 'utf8');
  assert.match(source, /renderRunSummary/, 'index.mjs must render the summary');
  assert.match(source, /GITHUB_STEP_SUMMARY/, 'index.mjs must write it where Actions surfaces it');
  assert.match(source, /publishRunSummary\(outcomes, opts, manifest, 'sync'\)/, 'runSync must publish before returning');
});

test('a dry run says so, so a green badge cannot read as delivery', () => {
  // The observed failure: a dispatched `--dry-run --members studio` produced a green check on a
  // workflow named "Studio sync", and a careful reader concluded from the run list that the
  // transport was healthy. It had written nothing and contacted no repository. The green bit is
  // more dangerous than the red one precisely because it is trusted.
  const summary = renderRunSummary([{ repo: 'o/studio', status: '59 file(s) would be written' }], {
    mode: 'dry-run',
    members: ['o/studio'],
    fleetSize: 11,
  });

  assert.match(summary, /DRY RUN/);
  assert.match(summary, /Nothing was written/);
  assert.match(summary, /no pull request was opened/);
  // Scope must be stated in the same breath: "1 of 1 succeeded" is true and useless.
  assert.match(summary, /1 of 11 member\(s\): o\/studio/);
});

test('a filtered run cannot pass for a complete one', () => {
  const filtered = renderRunSummary([{ repo: 'o/a', status: 'opened' }], {
    mode: 'sync',
    members: ['o/a'],
    fleetSize: 11,
  });
  const full = renderRunSummary([{ repo: 'o/a', status: 'opened' }], {
    mode: 'sync',
    fleetSize: 1,
  });

  assert.match(filtered, /1 of 11 member\(s\)/);
  assert.match(full, /all 1 member\(s\)/);
  assert.notEqual(filtered, full);
  // A real sync carries no caveat; only the modes that wrote nothing do.
  assert.doesNotMatch(full, /Nothing was written/);
});

test('every mode publishes a summary, not only the writing one', () => {
  // runDryRun and runWorkDir previously returned without publishing anything, which is how the
  // no-op run came to have no durable record of being a no-op.
  const source = readFileSync(new URL('../index.mjs', import.meta.url), 'utf8');
  for (const mode of ['sync', 'dry-run', 'work-dir']) {
    assert.match(
      source,
      new RegExp(`publishRunSummary\\([\\s\\S]{0,400}'${mode}'`),
      `the ${mode} path must publish a summary`,
    );
  }
});

test('drift warnings name every exact skipped file', () => {
  assert.equal(
    formatDriftWarning('o/a', [
      { targetPath: '.github/prompts/backlog.prompt.md' },
      { targetPath: '.github/prompts/review.prompt.md' },
    ]),
    'o/a: locally-modified file(s) left untouched: ' +
      '.github/prompts/backlog.prompt.md, .github/prompts/review.prompt.md',
  );
});

test('caller permission findings remain warnings rather than sync failures', () => {
  const { failures } = syncMembers([plan('o/a')], ctx, () => ({
    status: 'unchanged',
    report: { drift: [] },
    inspection: {
      workflowObservations: {
        callerPermissions: {
          refs: [
            {
              label: 'PR #7 (feature)',
              findings: [
                {
                  path: '.github/workflows/ci.yml',
                  line: 12,
                  job: 'web',
                  workflow: 'reusable-ci-web',
                  state: 'unsafe',
                  source: 'workflow',
                },
              ],
              unknown: [],
            },
          ],
          unknown: [],
        },
      },
    },
  }));
  assert.deepEqual(failures, []);
});

// An accepted failure must narrow the alarm without blunting it. Each test below is one way the
// exemption could quietly become a blanket downgrade -- the defect it exists to avoid.
const WINDOWS = {
  repo: 'jrmoulckers/windows',
  signature: 'The requested URL returned error: 403',
  issue: 'https://github.com/jrmoulckers/.github/issues/739',
};
const clone403 = {
  repo: 'jrmoulckers/windows',
  message: "`git clone` failed: remote: Write access to repository not granted.\nfatal: unable to access 'https://github.com/jrmoulckers/windows.git/': The requested URL returned error: 403",
};

test('a recorded failure is accepted, reported, and does not fail the run', () => {
  const { expected, unexpected, stale } = partitionFailures([clone403], [WINDOWS], [
    'jrmoulckers/windows',
    'jrmoulckers/finance',
  ]);

  assert.equal(unexpected.length, 0);
  assert.equal(stale.length, 0);
  assert.equal(expected.length, 1);
  // It carries its own closing condition, so the accepted failure cannot read as an abandoned one.
  assert.equal(expected[0].issue, WINDOWS.issue);
});

test('the exemption is pinned to the fault, not to the repository', () => {
  const different = {
    repo: 'jrmoulckers/windows',
    message: '`git push` failed: fatal: could not read Username: No such device or address',
  };
  const { expected, unexpected } = partitionFailures([different], [WINDOWS], [
    'jrmoulckers/windows',
  ]);

  // Same repo, different fault. A repo-keyed exemption would swallow this one silently, which is
  // the whole failure mode: the accepted fault outlives its cause and absorbs the next real one.
  assert.equal(expected.length, 0);
  assert.deepEqual(unexpected, [different]);
});

test('an unrelated member failing is never absorbed by another member exemption', () => {
  const other = { repo: 'jrmoulckers/finance', message: 'The requested URL returned error: 403' };
  const { expected, unexpected } = partitionFailures([other], [WINDOWS], [
    'jrmoulckers/windows',
    'jrmoulckers/finance',
  ]);

  // Identical signature, different repository: the pair must match, not either half.
  assert.equal(expected.length, 0);
  assert.deepEqual(unexpected, [other]);
});

test('a recorded failure that stopped failing is itself an error, so the record cannot outlive it', () => {
  const { expected, unexpected, stale } = partitionFailures([], [WINDOWS], [
    'jrmoulckers/windows',
    'jrmoulckers/finance',
  ]);

  assert.equal(expected.length, 0);
  assert.equal(unexpected.length, 0);
  // The green run is the one that must go red: nothing else would ever notice the grant landed.
  assert.deepEqual(
    stale.map((s) => s.repo),
    ['jrmoulckers/windows'],
  );
});

test('a repository the run never contacted cannot make its record stale', () => {
  // A member filter or a dry run says nothing about whether the fault is fixed. Concluding
  // "recovered" from a repository nobody called is absence read as evidence.
  const { stale } = partitionFailures([], [WINDOWS], ['jrmoulckers/finance']);
  assert.deepEqual(stale, []);
});

test("the manifest's own expectedFailures entries are honoured by the partition", () => {
  const manifest = JSON.parse(readFileSync(new URL('../../studio.config.json', import.meta.url)));
  const entries = manifest.expectedFailures ?? [];

  // Without this the test passes vacuously the day the record is deleted -- and deleting it is the
  // expected outcome, so a vacuous pass here is guaranteed rather than hypothetical.
  if (!entries.length) return;

  for (const entry of entries) {
    const { expected } = partitionFailures(
      [{ repo: entry.repo, message: `boom ${entry.signature} boom` }],
      entries,
      [entry.repo],
    );
    assert.equal(expected.length, 1, `${entry.repo}: signature does not match its own failure`);
    assert.ok(entry.issue, `${entry.repo}: no issue recorded`);
  }
});

// `--check` gates CI on three words. Each test below is one way those words could be produced by a
// run that compared nothing, which is the failure mode they exist to make unreachable.
test('a clean verdict states the population it compared', () => {
  const v = summarizeCheck([
    { repo: 'a/b', compared: 61, stale: false },
    { repo: 'a/c', compared: 23, stale: false },
  ]);

  assert.equal(v.ok, true);
  assert.equal(v.lines.length, 1);
  // Zero drifted and zero compared print the same three words without this number.
  assert.match(v.lines[0], /84 target\(s\) compared/);
  assert.match(v.lines[0], /All 2 member\(s\) up to date/);
});

test('a population that could not be compared is unresolved, never clean', () => {
  const v = summarizeCheck([
    { repo: 'a/b', compared: 61, stale: false, unmeasured: ['vendored @jrm/tokens'] },
  ]);

  // Not drifted, not failed -- and still not ok. A check that could not look is not a check that
  // found nothing, so it must not sum into the reassuring answer.
  assert.equal(v.ok, false);
  assert.equal(v.outOfDate, 0);
  assert.equal(v.failed, 0);
  assert.equal(v.unresolved, 1);
  assert.match(v.lines.join('\n'), /was not compared, so "up to date" does not cover it/);
  assert.doesNotMatch(v.lines.join('\n'), /All \d+ member\(s\) up to date/);
});

test('the clean line is never emitted alongside an unresolved population', () => {
  const v = summarizeCheck([
    { repo: 'a/b', compared: 61, stale: false },
    { repo: 'a/c', compared: 61, stale: false, unmeasured: ['vendored @jrm/tokens'] },
  ]);

  // The dangerous rendering is the mixed one: a true clean line for one member sitting above an
  // omission for another reads as an overall pass.
  assert.equal(v.ok, false);
  assert.doesNotMatch(v.lines.join('\n'), /All \d+ member\(s\) up to date/);
});

test('drift and verification failure stay distinct from an unmeasured population', () => {
  const v = summarizeCheck([
    { repo: 'a/b', compared: 61, stale: true },
    { repo: 'a/c', compared: 0, failed: true },
    { repo: 'a/d', compared: 61, unmeasured: ['vendored @jrm/tokens'] },
  ]);

  // Three different states that a single boolean would have collapsed: drifted, unreadable, and
  // never looked at. Only the first two were ever counted.
  assert.equal(v.outOfDate, 1);
  assert.equal(v.failed, 1);
  assert.equal(v.unresolved, 1);
  assert.equal(v.ok, false);
});

test('a failed member does not also count as unresolved or out of date', () => {
  // A member that threw was not compared either, but it already has a louder verdict; counting it
  // twice would inflate the unresolved tally and make the fix look like it found more than it did.
  const v = summarizeCheck([
    { repo: 'a/b', compared: 0, failed: true, stale: true, unmeasured: ['vendored @jrm/tokens'] },
  ]);
  assert.equal(v.failed, 1);
  assert.equal(v.outOfDate, 0);
  assert.equal(v.unresolved, 0);
});
