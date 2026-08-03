// Adoption lifecycle: the two guarantees adoption exists to provide.
//
// 1. An adopted baseline must still UPDATE when canon later changes. Without this,
//    adoption silently degrades into "recorded once, never updates again" and nothing fails.
// 2. A no-op run must not rewrite the lockfile. Without this, a content-neutral run bumps
//    `generatedAt`, producing a fresh no-op PR on every scheduled sync.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { apply } from '../lib/copier.mjs';
import { readLock, hashText, LOCK_FILENAME } from '../lib/lock.mjs';

const BACKBONE = 'jrmoulckers/.github';
const CONTENT = '# canon\n';
const CONTENT_V2 = '# canon\n\nA section added upstream after the member was baselined.\n';

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

test('an adopted baseline still updates when canon changes later', () => {
  withTmp((root) => {
    const target = spec().targetPath;
    seed(root, target, CONTENT);

    const adopted = apply(root, [spec()], readLock(root, BACKBONE), { write: true }).report;
    assert.equal(adopted.adopted.length, 1, 'precondition: the file is adopted, not added');

    // Canon moves upstream. The adopted baseline must classify this as an update,
    // NOT as drift — the member never touched the file.
    const { report } = apply(root, [spec(CONTENT_V2)], readLock(root, BACKBONE), { write: true });

    assert.equal(report.updated.length, 1, 'upstream change to an adopted file is an update');
    assert.equal(report.drift.length, 0, 'an untouched adopted file must never be mistaken for drift');
    assert.equal(report.changed, true);
    assert.equal(
      readFileSync(join(root, ...target.split('/')), 'utf8'),
      CONTENT_V2,
      'the member receives the new canon',
    );
  });
});

test('a no-op run leaves the lockfile byte-identical', () => {
  withTmp((root) => {
    const s = spec();
    apply(root, [s], readLock(root, BACKBONE), { write: true });

    const lockPath = join(root, LOCK_FILENAME);
    const before = readFileSync(lockPath, 'utf8');

    const { report } = apply(root, [s], readLock(root, BACKBONE), { write: true });
    assert.equal(report.changed, false, 'precondition: nothing changed');

    assert.equal(
      readFileSync(lockPath, 'utf8'),
      before,
      'a no-op run must not rewrite the lock — a bumped generatedAt opens an empty PR every sync',
    );
  });
});

test('a no-op run after adoption also leaves the lockfile byte-identical', () => {
  withTmp((root) => {
    const s = spec();
    seed(root, s.targetPath, CONTENT);

    apply(root, [s], readLock(root, BACKBONE), { write: true });
    const lockPath = join(root, LOCK_FILENAME);
    const before = readFileSync(lockPath, 'utf8');

    const { report } = apply(root, [s], readLock(root, BACKBONE), { write: true });
    assert.equal(report.changed, false, 'adoption must settle after exactly one run');
    assert.equal(readFileSync(lockPath, 'utf8'), before);
  });
});
