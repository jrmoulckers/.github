// Copier behavior: add / unchanged / drift / adoption, and the lockfile write rule.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { apply } from '../lib/copier.mjs';
import { readLock, hashText, LOCK_FILENAME } from '../lib/lock.mjs';
import { inject } from '../lib/provenance.mjs';

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

// Synchronous by construction: the `finally` deletes the scratch root the moment `fn` returns, so
// an async body would have its tree removed mid-await and see an empty directory on the next call.
// That fails as a confusing wrong-classification (`add` where `update` was expected) rather than as
// a cleanup error, so the thenable check turns it into a loud one.
function withTmp(fn) {
  const root = mkdtempSync(join(tmpdir(), 'copier-test-'));
  try {
    const result = fn(root);
    assertSync(result);
    return result;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function assertSync(result) {
  if (result && typeof result.then === 'function') {
    throw new Error('withTmp bodies must be synchronous — give an async test its own scratch root');
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

// A no-op run must not rewrite the lockfile. `serializeLock` stamps a fresh `generatedAt` on every
// write, so if a content-neutral run ever reported `changed`, the engine would open a PR whose only
// diff is a timestamp — on every scheduled sync. That is how automation gets switched off.
test('a no-op run leaves the lockfile byte-identical, including generatedAt', () => {
  withTmp((root) => {
    const s = spec();
    apply(root, [s], readLock(root, BACKBONE), { write: true });
    const before = readFileSync(join(root, LOCK_FILENAME), 'utf8');
    assert.match(before, /"generatedAt": "/);

    const { report } = apply(root, [s], readLock(root, BACKBONE), { write: true });
    assert.equal(report.changed, false);
    assert.equal(
      readFileSync(join(root, LOCK_FILENAME), 'utf8'),
      before,
      'a content-neutral run must not bump generatedAt or reorder entries',
    );
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

// The whole justification for the adoption path: an adopted baseline must still receive later canon
// changes. If it stopped, nothing would fail — every run would report `unchanged → up to date`
// while the member silently froze at the version it was adopted with.
//
// basemerge.test.mjs covers this for the AGENTS.md managed-block path; this is the plain-file path,
// which is the one every agent/skill/prompt/instruction file takes.
test('an adopted baseline still updates when canon changes later', () => {
  withTmp((root) => {
    const target = spec().targetPath;
    seed(root, target, CONTENT);

    const adopted = apply(root, [spec()], readLock(root, BACKBONE), { write: true }).report;
    assert.equal(adopted.adopted.length, 1, 'precondition: the file is adopted, not added');

    // Canon moves upstream. The member never touched the file, so this is an update, not drift.
    const { report } = apply(root, [spec(CONTENT_V2)], readLock(root, BACKBONE), { write: true });
    assert.equal(report.updated.length, 1, 'an upstream change to an adopted file is an update');
    assert.equal(report.drift.length, 0, 'an untouched adopted file is never mistaken for drift');
    assert.equal(
      readFileSync(join(root, ...target.split('/')), 'utf8'),
      CONTENT_V2,
      'the member receives the new canon',
    );

    const third = apply(root, [spec(CONTENT_V2)], readLock(root, BACKBONE), { write: true }).report;
    assert.equal(third.changed, false, 'and settles again afterwards');
  });
});

// The complement. Adoption writes its lock entry from a different branch than `add`, and nothing
// else asserts drift is detected off *that* entry — the existing drift tests all start from a file
// the engine wrote itself. Mutating `isLocallyModified` to `lockEntry ? false : …` fails this test
// and the three pre-existing drift tests while leaving the update test above green, which is the
// point: an update never consults drift, so update coverage cannot stand in for it.
test('adoption does not disable drift detection for that file', () => {
  withTmp((root) => {
    const s = spec();
    seed(root, s.targetPath, CONTENT);
    const adopt = apply(root, [s], readLock(root, BACKBONE), { write: true }).report;
    assert.equal(adopt.adopted.length, 1, 'precondition: the file was adopted, not added');

    const EDITED = '# canon\n\nlocal edit\n';
    seed(root, s.targetPath, EDITED);
    const after = apply(root, [s], readLock(root, BACKBONE), { write: true }).report;

    assert.equal(after.drift.length, 1, 'a hand edit after adoption is still drift');
    assert.equal(after.updated.length + after.forced.length, 0, 'and nothing is written');
    assert.equal(readFileSync(join(root, ...s.targetPath.split('/')), 'utf8'), EDITED);
  });
});

// --- unstamped canon -------------------------------------------------------
//
// A member seeded by hand with canon that never went through `inject()` has a file whose CONTENT
// is current but whose PROVENANCE HEADER is missing, so it never matches `rendered`. Classified as
// drift it is a permanent skip: every run flags it, no run fixes it, and `--check` fails forever.
// Found in `jrmoulckers/finance`, whose root `agency.toml` hashes to raw canon (281f6b5cf11d)
// against `inject()`'s c5dc520a8bd3 — reproduced offline before this branch existed.
//
// These use a spec whose raw and rendered forms genuinely differ, via the real `inject`, because
// the plain `spec()` helper above sets sourceSha256 = hashText(content) and so cannot express the
// distinction being tested.

const RAW = '# canon\n';
const rawSpec = () => ({
  ...spec(),
  targetPath: 'agency.toml',
  sourcePath: 'agency.toml',
  sourceSha256: hashText(RAW),
  content: inject('agency.toml', RAW),
});

test('a target hand-copied as raw canon is stamped, not flagged as drift', () => {
  withTmp((root) => {
    const s = rawSpec();
    seed(root, s.targetPath, RAW);

    const { report } = apply(root, [s], readLock(root, BACKBONE), { write: true });

    assert.equal(report.drift.length, 0, 'missing provenance is not a local edit');
    assert.equal(report.updated.length, 1);
    const onDisk = readFileSync(join(root, s.targetPath), 'utf8');
    assert.equal(onDisk, s.content, 'the file now carries the provenance header');
    assert.ok(onDisk.includes(RAW.trim()), 'and still contains the canon body');

    // The whole point is that it stops being reported. A fix that rewrites every run is the same
    // bug wearing a different label.
    const second = apply(root, [s], readLock(root, BACKBONE), { write: true }).report;
    assert.equal(second.changed, false, 'and the run converges');
    assert.equal(second.unchanged.length, 1);
  });
});

test('a recorded target stripped back to raw canon is drift, not a silent rewrite', () => {
  withTmp((root) => {
    const s = rawSpec();
    seed(root, s.targetPath, s.content);
    const first = apply(root, [s], readLock(root, BACKBONE), { write: true }).report;
    assert.equal(first.adopted.length, 1, 'precondition: recorded in the lockfile');

    // Once a lock entry exists, bytes equal to raw canon mean someone deliberately removed the
    // header. That is a local edit and must keep its drift signal, or the narrow fix above would
    // silently undo a deliberate change.
    seed(root, s.targetPath, RAW);
    const after = apply(root, [s], readLock(root, BACKBONE), { write: true }).report;

    assert.equal(after.drift.length, 1);
    assert.equal(after.updated.length, 0);
    assert.equal(readFileSync(join(root, s.targetPath), 'utf8'), RAW, 'left untouched');
  });
});

test('a pre-existing file that is neither canon nor rendered is still drift', () => {
  withTmp((root) => {
    // The regression guard for the fix above: it keys on equality with raw canon specifically, so
    // ordinary member-authored content must be unaffected.
    const s = rawSpec();
    seed(root, s.targetPath, '# member wrote this\n');

    const { report } = apply(root, [s], readLock(root, BACKBONE), { write: true });

    assert.equal(report.drift.length, 1);
    assert.equal(report.updated.length, 0);
    assert.equal(readFileSync(join(root, s.targetPath), 'utf8'), '# member wrote this\n');
  });
});
