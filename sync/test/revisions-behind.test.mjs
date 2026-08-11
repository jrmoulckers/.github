// The staleness signal: how far behind a withheld file is, counted in published canon revisions.
//
// A drift warning that repeats identically every run stops being read. Time does not fix that —
// an age grows whether or not canon moved, so a deliberately customised file looks worse each
// week while saying nothing. A revision count only grows when the member actually misses
// something, which is the distinction the log has to carry.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { canonRevisions } from '../lib/history.mjs';
import { enumerateTokenTargets } from '../lib/assets.mjs';
import { apply, formatBehind } from '../lib/copier.mjs';
import { formatDriftWarning } from '../lib/runner.mjs';
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

// Four publishes, one of which reverts to earlier content: distinct *versions* is the unit, so a
// revert must not inflate the count of what a member is missing.
const V1 = ':root { --a: 1 }\n';
const V2 = ':root { --a: 2 }\n';
const V3 = ':root { --a: 1 }\n'; // identical to V1
const V4 = ':root { --a: 4 }\n';

function git(cwd, args) {
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
}

function writeFile(root, relPath, content) {
  const abs = join(root, ...relPath.split('/'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

function withStudio(versions, fn) {
  const root = mkdtempSync(join(tmpdir(), 'behind-'));
  const studio = join(root, 'studio');
  const member = join(root, 'member');
  mkdirSync(studio, { recursive: true });
  mkdirSync(member, { recursive: true });
  try {
    git(studio, ['init', '-q', '-b', 'main']);
    git(studio, ['config', 'user.email', 't@example.com']);
    git(studio, ['config', 'user.name', 'T']);
    for (const version of versions) {
      writeFile(studio, SOURCE, version);
      git(studio, ['add', '-A']);
      git(studio, ['commit', '-q', '-m', 'publish']);
    }
    return fn({ studio, member });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function lockEntryFor(raw, syncedAt = '2026-01-01T00:00:00.000Z') {
  return {
    sourceSha256: hashText(raw),
    targetSha256: hashText(inject(TARGET, raw, { note: NOTE })),
    syncedAt,
  };
}

test('revisions are ordered newest-first and a revert does not count twice', () => {
  withStudio([V1, V2, V3, V4], ({ studio }) => {
    const revisions = canonRevisions(studio, [SOURCE]).get(SOURCE);

    // V3 republished V1's bytes, so three distinct versions exist, not four.
    assert.deepEqual(revisions, [hashText(V4), hashText(V1), hashText(V2)]);
  });
});

test('a withheld file reports how many versions it has missed', () => {
  withStudio([V1, V2, V4], ({ studio, member }) => {
    // Member received V1, then edited it. Two versions have shipped since.
    writeFile(member, TARGET, 'member wrote this\n');
    const entries = { [TARGET]: lockEntryFor(V1) };

    const { report } = apply(member, enumerateTokenTargets(PLAN, studio), {
      backbone: 'b',
      entries,
    });

    const [item] = report.drift;
    assert.equal(item.targetPath, TARGET);
    assert.equal(item.withheld, true);
    assert.equal(item.revisionsBehind, 2);
  });
});

test('a customised file that is otherwise current is not withheld and has no count', () => {
  withStudio([V1, V2, V4], ({ studio, member }) => {
    // The member edited the *current* version. They are missing nothing, and a count that grew
    // here would make deliberate customisation look like decay.
    writeFile(member, TARGET, 'member wrote this\n');
    const entries = { [TARGET]: lockEntryFor(V4) };

    const { report } = apply(member, enumerateTokenTargets(PLAN, studio), {
      backbone: 'b',
      entries,
    });

    const [item] = report.drift;
    assert.equal(item.withheld, false);
    assert.equal(item.revisionsBehind, 0);
    assert.equal(formatBehind(item.revisionsBehind), '', 'zero is silence, not "0 behind"');
  });
});

test('a baseline matching no published version is unanswerable, not up to date', () => {
  withStudio([V1, V4], ({ studio, member }) => {
    writeFile(member, TARGET, 'member wrote this\n');
    const entries = { [TARGET]: lockEntryFor('content that was never published\n') };

    const { report } = apply(member, enumerateTokenTargets(PLAN, studio), {
      backbone: 'b',
      entries,
    });

    const [item] = report.drift;
    assert.equal(item.withheld, true, 'still behind: canon differs from the baseline');
    assert.equal(item.revisionsBehind, null, 'unknown must be null, never 0');
  });
});

test('the warning line carries the count, and pluralizes', () => {
  const line = formatDriftWarning('jrmoulckers/finance', [
    { targetPath: 'a.css', withheld: true, lastWrittenAt: '2026-07-13T00:00:00.000Z', revisionsBehind: 4 },
    { targetPath: 'b.css', withheld: true, lastWrittenAt: null, revisionsBehind: 1 },
    { targetPath: 'c.css', withheld: false, lastWrittenAt: '2026-08-01T00:00:00.000Z', revisionsBehind: 0 },
  ]);

  assert.match(line, /a\.css last synced 2026-07-13T00:00:00\.000Z, 4 canon revisions behind/);
  assert.match(line, /b\.css last synced never, 1 canon revision behind/);
  assert.ok(!line.includes('c.css last synced'), 'a merely-customised file is not listed as behind');
  assert.match(line, /2 of 3 withholding a canon update/);
});
