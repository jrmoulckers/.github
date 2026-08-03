// Copier behavior: add / unchanged / drift / adoption, and the lockfile write rule.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { apply } from '../lib/copier.mjs';
import { readLock, hashText, LOCK_FILENAME } from '../lib/lock.mjs';

const BACKBONE = 'jrmoulckers/.github';
const CONTENT = '# canon\n';

function spec(content = CONTENT) {
  return {
    kind: 'agents',
    name: 'architect',
    sourcePath: 'agents/architect.agent.md',
    targetPath: '.github/agents/architect.agent.md',
    sourceSha256: hashText(content),
    content,
    type: 'file',
  };
}

function withTmp(fn) {
  const root = mkdtempSync(join(tmpdir(), 'copier-test-'));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function seed(root, targetPath, content) {
  const abs = join(root, ...targetPath.split('/'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

test('a missing target is added and recorded in the lockfile', () => {
  withTmp((root) => {
    const s = spec();
    const { report } = apply(root, [s], readLock(root, BACKBONE), { write: true });
    assert.equal(report.added.length, 1);
    assert.equal(report.changed, true);
    assert.equal(readFileSync(join(root, ...s.targetPath.split('/')), 'utf8'), CONTENT);
    assert.ok(existsSync(join(root, LOCK_FILENAME)));
  });
});

test('re-running with no upstream change writes nothing and reports no change', () => {
  withTmp((root) => {
    const s = spec();
    apply(root, [s], readLock(root, BACKBONE), { write: true });
    const { report } = apply(root, [s], readLock(root, BACKBONE), { write: true });
    assert.equal(report.unchanged.length, 1);
    assert.equal(report.changed, false, 'second run must be a no-op (idempotency guarantee)');
    assert.equal(report.adopted.length, 0);
  });
});

test('a locally modified target is flagged as drift and left untouched', () => {
  withTmp((root) => {
    const s = spec();
    apply(root, [s], readLock(root, BACKBONE), { write: true });
    seed(root, s.targetPath, '# hand-edited\n');

    const { report } = apply(root, [s], readLock(root, BACKBONE), { write: true });
    assert.equal(report.drift.length, 1);
    assert.equal(report.hasDrift, true);
    assert.equal(report.changed, false);
    assert.equal(readFileSync(join(root, ...s.targetPath.split('/')), 'utf8'), '# hand-edited\n');
  });
});

test('--force overwrites drift', () => {
  withTmp((root) => {
    const s = spec();
    apply(root, [s], readLock(root, BACKBONE), { write: true });
    seed(root, s.targetPath, '# hand-edited\n');

    const { report } = apply(root, [s], readLock(root, BACKBONE), { write: true, force: true });
    assert.equal(report.forced.length, 1);
    assert.equal(readFileSync(join(root, ...s.targetPath.split('/')), 'utf8'), CONTENT);
  });
});

// The other half of adoption, and the case that does not self-heal: a hand-seeded file that
// differs from canon has no lock entry, so the engine cannot tell a stale copy from a deliberate
// local edit and refuses to clobber it. Correct, but permanent — hence the docs' instruction to
// reconcile pre-seeded files before a member's first sync.
test('adoption: a pre-existing file that differs from canon is drift, on every run', () => {
  withTmp((root) => {
    const s = spec();
    seed(root, s.targetPath, '# stale hand-copy of older canon\n');

    for (const pass of ['first', 'second']) {
      const { report } = apply(root, [s], readLock(root, BACKBONE), { write: true });
      assert.equal(report.adopted.length, 0, `${pass}: must not be adopted`);
      assert.deepEqual(
        report.drift.map((i) => i.targetPath),
        [s.targetPath],
        `${pass}: flagged as drift`,
      );
      assert.equal(
        readFileSync(join(root, s.targetPath), 'utf8'),
        '# stale hand-copy of older canon\n',
        `${pass}: left untouched`,
      );
    }
  });
});

test('adoption: a pre-existing file matching canon is baselined and counts as a change', () => {
  withTmp((root) => {
    const s = spec();
    seed(root, s.targetPath, CONTENT);

    const first = apply(root, [s], readLock(root, BACKBONE), { write: true }).report;
    assert.equal(first.adopted.length, 1, 'unrecorded file identical to canon is adopted');
    assert.equal(
      first.changed,
      true,
      'adoption counts as a change — the first run can open a lock-only PR',
    );
    assert.equal(first.added.length + first.updated.length, 0, 'no file content changes');

    const second = apply(root, [s], readLock(root, BACKBONE), { write: true }).report;
    assert.equal(second.changed, false, 'once baselined, later runs go quiet');
  });
});
