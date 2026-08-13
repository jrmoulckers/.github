// Copier behavior: add / unchanged / drift / adoption, and the lockfile write rule.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { apply } from '../lib/copier.mjs';
import { formatDriftWarning } from '../lib/runner.mjs';
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
// alongside the other drift tests, while leaving the update test above green — which is the point:
// an update never consults drift, so update coverage cannot stand in for it. Deliberately no count
// of co-failing tests here; an earlier revision said "the three pre-existing drift tests" and went
// stale the moment #58 added a fourth. The claim that survives is which test stays green.
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

// --- historical canon recovery ---------------------------------------------

test('an unrecorded historical engine rendering is safely updated to current canon', () => {
  withTmp((root) => {
    const previousRaw = '# previous canon\n';
    const previousRendered = inject('agency.toml', previousRaw);
    const s = {
      ...rawSpec(),
      historicalCanonSha256: [hashText(previousRendered)],
    };
    seed(root, s.targetPath, previousRendered);

    const { report } = apply(root, [s], readLock(root, BACKBONE), { write: true });

    assert.deepEqual(report.updated.map((item) => item.targetPath), [s.targetPath]);
    assert.equal(report.drift.length, 0);
    assert.equal(readFileSync(join(root, s.targetPath), 'utf8'), s.content);
  });
});

test('historical recovery is vacuous without repository-backed hash evidence', () => {
  withTmp((root) => {
    const previousRendered = inject('agency.toml', '# previous canon\n');
    const s = { ...rawSpec(), historicalCanonSha256: [] };
    seed(root, s.targetPath, previousRendered);

    const { report } = apply(root, [s], readLock(root, BACKBONE), { write: true });

    assert.deepEqual(report.drift.map((item) => item.targetPath), [s.targetPath]);
    assert.equal(report.updated.length, 0);
    assert.equal(readFileSync(join(root, s.targetPath), 'utf8'), previousRendered);
  });
});

test('a one-byte mutation of proven historical output remains genuine drift', () => {
  withTmp((root) => {
    const previousRendered = inject('agency.toml', '# previous canon\n');
    const mutated = previousRendered.replace('previous', 'previous!');
    const s = {
      ...rawSpec(),
      historicalCanonSha256: [hashText(previousRendered)],
    };
    seed(root, s.targetPath, mutated);

    const { report } = apply(root, [s], readLock(root, BACKBONE), { write: true });

    assert.equal(report.drift.length, 1);
    assert.equal(report.updated.length, 0);
    assert.equal(readFileSync(join(root, s.targetPath), 'utf8'), mutated);
  });
});

test('raw canon on a recorded target is a stripped header, and stays drift', () => {
  withTmp((root) => {
    const previousRendered = inject('agency.toml', '# previous canon\n');
    const s = {
      ...rawSpec(),
      historicalCanonSha256: [hashText(previousRendered)],
      historicalRenderedSha256: [hashText(previousRendered)],
    };
    seed(root, s.targetPath, s.content);
    const adopted = apply(root, [s], readLock(root, BACKBONE), { write: true }).report;
    assert.equal(adopted.adopted.length, 1, 'precondition: current rendering is recorded');

    // Raw canon is reachable by editing — delete the header and you have it. On a recorded target
    // that is a deliberate local act and must keep its drift signal, which is why the rendered set
    // is kept separate from the raw one rather than the gate simply being dropped.
    seed(root, s.targetPath, RAW);
    const { report } = apply(root, [s], readLock(root, BACKBONE), { write: true });

    assert.equal(report.drift.length, 1);
    assert.equal(report.updated.length, 0);
    assert.equal(readFileSync(join(root, s.targetPath), 'utf8'), RAW, 'left untouched');
  });
});

test('a superseded rendering on a recorded target is recovered, not refused', () => {
  withTmp((root) => {
    const previousRendered = inject('agency.toml', '# previous canon\n');
    const s = {
      ...rawSpec(),
      historicalRenderedSha256: [hashText(previousRendered)],
    };
    seed(root, s.targetPath, s.content);
    const adopted = apply(root, [s], readLock(root, BACKBONE), { write: true }).report;
    assert.equal(adopted.adopted.length, 1, 'precondition: recorded in the lockfile');

    // The finance shape: the lock entry says one thing, the file is a *past engine rendering* of
    // canon. Editing cannot produce those bytes — header, note and body all match a published
    // revision — so the difference is a bad lock entry, not member work.
    seed(root, s.targetPath, previousRendered);
    const { report } = apply(root, [s], readLock(root, BACKBONE), { write: true });

    assert.deepEqual(report.updated.map((item) => item.targetPath), [s.targetPath]);
    assert.equal(report.drift.length, 0, 'a regressed lock entry must not freeze the path');
    assert.equal(readFileSync(join(root, s.targetPath), 'utf8'), s.content);

    const second = apply(root, [s], readLock(root, BACKBONE), { write: true }).report;
    assert.equal(second.changed, false, 'and the run converges rather than rewriting every time');
  });
});

test('recovery on a recorded target needs rendered evidence, not merely historical', () => {
  withTmp((root) => {
    const previousRendered = inject('agency.toml', '# previous canon\n');
    // historicalCanonSha256 alone must not authorize it: that set also contains raw blobs, and
    // widening the recorded case to it would re-admit the stripped-header edit above.
    const s = {
      ...rawSpec(),
      historicalCanonSha256: [hashText(previousRendered)],
      historicalRenderedSha256: [],
    };
    seed(root, s.targetPath, s.content);
    apply(root, [s], readLock(root, BACKBONE), { write: true });

    seed(root, s.targetPath, previousRendered);
    const { report } = apply(root, [s], readLock(root, BACKBONE), { write: true });

    assert.equal(report.drift.length, 1);
    assert.equal(report.updated.length, 0);
    assert.equal(readFileSync(join(root, s.targetPath), 'utf8'), previousRendered);
  });
});

test('member-authored bytes are never recovered, recorded or not', () => {
  withTmp((root) => {
    const previousRendered = inject('agency.toml', '# previous canon\n');
    const s = {
      ...rawSpec(),
      historicalRenderedSha256: [hashText(previousRendered)],
    };
    seed(root, s.targetPath, s.content);
    apply(root, [s], readLock(root, BACKBONE), { write: true });

    seed(root, s.targetPath, previousRendered.replace('previous', 'previous!'));
    const { report } = apply(root, [s], readLock(root, BACKBONE), { write: true });

    assert.equal(report.drift.length, 1, 'one byte off proven output is still member work');
    assert.equal(report.updated.length, 0);
  });
});


// ---------------------------------------------------------------------------------------------
// Abandoned files: what the engine leaves on disk after a base moves.
//
// rekey.mjs reconciles lock ENTRIES against the plan. These cover what happens to the FILES,
// which it deliberately does not touch. jrmoulckers/finance is the live case: it repointed
// tokens.targetPath to the repo root, then a sync resolving older canon wrote the native files
// to the old base. They sit there today with the pre-#121 comment syntax that cannot compile,
// and finance is the only kmp-web member.
// ---------------------------------------------------------------------------------------------

test('a file whose lock entry was rekeyed to a new base is reported as abandoned', () => {
  withTmp((root) => {
    // Sync under the old base, so both the file and its entry exist there.
    const old = { ...spec(), targetPath: 'apps/web/vendor/@jrm/tokens/native/x.kt', targetBase: 'apps/web/vendor/@jrm/tokens' };
    apply(root, [old], readLock(root, BACKBONE), { write: true });

    // Retarget to the repo root. rekey moves the ENTRY; the old FILE stays put.
    const moved = { ...old, targetPath: 'vendor/@jrm/tokens/native/x.kt', targetBase: 'vendor/@jrm/tokens' };
    const { report, lock } = apply(root, [moved], readLock(root, BACKBONE), { write: true });

    assert.deepEqual(
      report.rekeyed.map((item) => item.from),
      [old.targetPath],
      'precondition: the entry follows the base',
    );
    assert.ok(!lock.entries[old.targetPath], 'so the old path is no longer recorded anywhere');
    assert.ok(existsSync(join(root, ...old.targetPath.split('/'))), 'but the file is still on disk');

    // Which is exactly why it must be reported: reconciliation made it LESS visible, not more.
    assert.deepEqual(
      report.abandoned.map((item) => item.targetPath),
      [old.targetPath],
    );
    assert.equal(report.abandoned[0].tracked, false, 'no entry left to hash-verify a deletion against');
    assert.equal(report.hasDrift, false, 'an abandoned file is not a local modification');
  });
});

// The sweep that finds the file above is driven by rekey PAIRS, not by their count: `abandonedBases`
// recovers the vacated directory by stripping from `from` the plan-relative tail it shares with
// `targetPath`. At a single relocated file a mispairing cannot be represented, so the case above
// cannot exercise that derivation. With two, a rotation of the `from` fields keeps the lockfile and
// the rekey count correct and empties this report entirely — measured under #1053.
test('a base move of several files still identifies the vacated base and sweeps what is stranded', () => {
  withTmp((root) => {
    const OLD = 'apps/web/vendor/@jrm/tokens';
    const NEW = 'vendor/@jrm/tokens';
    const RELS = ['native/compose/JrmTokens.kt', 'native/swift/JRMTokens.swift'];
    assert.ok(RELS.length >= 2, 'precondition: one pair cannot be mispaired, so the sweep needs two');

    const at = (base) =>
      RELS.map((rel) => ({
        ...spec(`/* ${rel} */\n`),
        name: rel,
        targetPath: `${base}/${rel}`,
        targetBase: base,
      }));

    apply(root, at(OLD), readLock(root, BACKBONE), { write: true });

    // Never written by the plan and never recorded in the lock, sitting in the base being vacated.
    // Nothing points at it, so only the base sweep can name it — and the sweep exists only because
    // a correctly paired rekey identifies the base.
    const stranded = `${OLD}/native/compose/Legacy.kt`;
    mkdirSync(join(root, ...dirname(stranded).split('/')), { recursive: true });
    writeFileSync(join(root, ...stranded.split('/')), '/* stranded */\n', 'utf8');

    const { report } = apply(root, at(NEW), readLock(root, BACKBONE), { write: true });

    assert.equal(report.rekeyed.length, RELS.length, 'precondition: every entry follows the base');

    const found = report.abandoned.find((item) => item.targetPath === stranded);
    assert.ok(found, 'the vacated base must be identified, so the file stranded in it is named');
    assert.equal(found.tracked, false, 'and named untracked: no entry survives to verify a deletion');
  });
});

test('an orphan that could not be rekeyed is reported while its file remains', () => {
  withTmp((root) => {
    const s = spec();
    apply(root, [s], readLock(root, BACKBONE), { write: true });

    // No targetBase, so rekey cannot match it; the file exists, so it is not pruned either.
    const other = { ...s, name: 'other.md', targetPath: 'docs/other.md' };
    const { report } = apply(root, [other], readLock(root, BACKBONE), { write: true });

    assert.deepEqual(report.abandoned.map((item) => item.targetPath), [s.targetPath]);
    assert.equal(report.abandoned[0].tracked, true, 'the lock still holds the hash to verify against');
  });
});

test('an entry pruned because its file is already gone is not reported as abandoned', () => {
  withTmp((root) => {
    const s = spec();
    apply(root, [s], readLock(root, BACKBONE), { write: true });
    rmSync(join(root, ...s.targetPath.split('/')));

    const other = { ...s, name: 'other.md', targetPath: 'docs/other.md' };
    const { report } = apply(root, [other], readLock(root, BACKBONE), { write: true });

    // rekey.mjs already drops it, and there is no file to clean up. Reporting it would be noise,
    // and a report that cries wolf is the one nobody reads.
    assert.deepEqual(report.pruned.map((item) => item.targetPath), [s.targetPath]);
    assert.deepEqual(report.abandoned, []);
  });
});

test('a plan that still targets everything reports nothing abandoned', () => {
  withTmp((root) => {
    const s = spec();
    apply(root, [s], readLock(root, BACKBONE), { write: true });
    const { report } = apply(root, [s], readLock(root, BACKBONE), { write: true });
    assert.deepEqual(report.abandoned, [], 'steady state must stay quiet or the signal is worthless');
  });
});
test('reconciliation is what guarantees an unplanned entry still has a file', () => {
  withTmp((root) => {
    const s = spec();
    apply(root, [s], readLock(root, BACKBONE), { write: true });
    rmSync(join(root, ...s.targetPath.split('/')));

    const other = { ...s, name: 'other.md', targetPath: 'docs/other.md' };
    const { lock } = apply(root, [other], readLock(root, BACKBONE), { write: true });

    // findAbandoned reports on entries the plan no longer names. That is only safe while every
    // such entry has a real file behind it. Reconciliation is the thing that makes it true; if
    // this ever fails, findAbandoned's on-disk filter stops being redundant and starts being
    // the only thing preventing it from naming files that do not exist.
    for (const key of Object.keys(lock.entries)) {
      if (key === other.targetPath) continue;
      assert.ok(existsSync(join(root, ...key.split('/'))), `unplanned entry ${key} has no file`);
    }
  });
});
// A file stranded under an abandoned base with no lock entry and no rekey of its own. This is
// finance's live state and the case #187 missed: an earlier sync minted the entry at the NEW base
// while the file stayed at the old one, so nothing in the lockfile points at it.
function tokenSpec(rel, base) {
  const content = `/* ${rel} */\n`;
  return {
    kind: 'tokens',
    name: rel,
    sourcePath: `packages/tokens/dist/${rel}`,
    targetPath: `${base}/${rel}`,
    targetBase: base,
    sourceSha256: hashText(content),
    content,
    type: 'file',
  };
}

test('a file stranded under an abandoned base is found even with no entry and no rekey of its own', () => {
  withTmp((root) => {
    const OLD = 'apps/web/vendor/@jrm/tokens';
    const NEW = 'vendor/@jrm/tokens';

    // One file synced under the old base, so its entry exists there and can be rekeyed later.
    apply(root, [tokenSpec('css/tokens.css', OLD)], readLock(root, BACKBONE), { write: true });

    // A second file that a later run wrote to the old base while recording it at the new one.
    seed(root, `${OLD}/native/compose/JrmTokens.kt`, '<!-- pre-#121 header Kotlin cannot parse -->\n');

    // Retarget. The first file's entry rekeys; the stranded .kt matches no entry and no rekey.
    const writes = [tokenSpec('css/tokens.css', NEW), tokenSpec('native/compose/JrmTokens.kt', NEW)];
    const { report, lock } = apply(root, writes, readLock(root, BACKBONE), { write: true });

    assert.equal(report.rekeyed.length, 1, 'precondition: one entry relocates, which identifies the old base');
    assert.ok(!lock.entries[`${OLD}/native/compose/JrmTokens.kt`], 'precondition: the .kt was never recorded there');
    assert.ok(!report.rekeyed.some((item) => item.from.endsWith('JrmTokens.kt')), 'precondition: nor was it rekeyed');

    assert.ok(
      report.abandoned.some((item) => item.targetPath === `${OLD}/native/compose/JrmTokens.kt`),
      'the stranded file is the whole point of the report and must be named',
    );
    assert.equal(report.hasDrift, false);
  });
});

test('the sweep stays inside bases the lockfile proves were abandoned', () => {
  withTmp((root) => {
    const OLD = 'apps/web/vendor/@jrm/tokens';
    const NEW = 'vendor/@jrm/tokens';
    apply(root, [tokenSpec('css/tokens.css', OLD)], readLock(root, BACKBONE), { write: true });

    // Ordinary member files. Nothing in the lockfile says the engine ever wrote these, so reading
    // them as abandoned would be the engine claiming authority over content it never touched.
    seed(root, 'apps/web/src/main.ts', 'export const x = 1;\n');
    seed(root, 'README.md', '# finance\n');

    const { report } = apply(root, [tokenSpec('css/tokens.css', NEW)], readLock(root, BACKBONE), { write: true });

    // The old tokens.css genuinely is abandoned — its entry moved, the file did not — so the sweep
    // is expected to name it. What must not appear is anything outside the abandoned base.
    assert.deepEqual(
      report.abandoned.map((item) => item.targetPath),
      [`${OLD}/css/tokens.css`],
    );
  });
});

// The sweep walks a vacated base wholesale, so it can reach a file the current plan writes:
// `abandonedBases` declines only the new base of the same rekey pair, and nothing excludes a base
// another kind still targets. Without the `!planned.has(found)` filter, that file is offered to a
// human for deletion on the very run that writes it — and as untracked, so the documented cleanup
// carries no hash to verify the deletion against. The filter shipped untested: deleting it left the
// whole suite green (#1056).
test('a planned target under a vacated base is written, not offered for deletion', () => {
  withTmp((root) => {
    const OLD = 'apps/web/vendor/@jrm/tokens';
    const NEW = 'vendor/@jrm/tokens';

    // A second kind writing under the base that tokens is about to vacate. It carries no targetBase,
    // so reconciliation never relocates it: the same path stays planned across both runs.
    const keep = { ...spec('# still canon\n'), kind: 'agents', name: 'keep', targetPath: `${OLD}/keep.md` };

    apply(root, [tokenSpec('css/tokens.css', OLD), keep], readLock(root, BACKBONE), { write: true });
    seed(root, `${OLD}/native/JrmTokens.kt`, '/* stranded */\n');

    const { report } = apply(root, [tokenSpec('css/tokens.css', NEW), keep], readLock(root, BACKBONE), {
      write: true,
    });

    const abandoned = report.abandoned.map((item) => item.targetPath);
    // Without this the absence below would also hold for a sweep that had stopped working entirely.
    assert.ok(
      abandoned.includes(`${OLD}/native/JrmTokens.kt`),
      'precondition: the vacated base is still swept, so the absence below means something',
    );
    assert.ok(!abandoned.includes(keep.targetPath), 'a file this very run writes is not abandoned');
    assert.ok(
      existsSync(join(root, ...keep.targetPath.split('/'))),
      'and it is on disk, so the report would have been pointing a human at live canon',
    );
  });
});

test('no rekey means no identified base, and the limit is reported honestly as silence', () => {
  withTmp((root) => {
    const OLD = 'apps/web/vendor/@jrm/tokens';
    const NEW = 'vendor/@jrm/tokens';

    // Every entry already re-minted at the new base, so reconciliation has nothing to relocate.
    apply(root, [tokenSpec('css/tokens.css', NEW)], readLock(root, BACKBONE), { write: true });
    seed(root, `${OLD}/native/compose/JrmTokens.kt`, '<!-- stranded -->\n');

    const { report } = apply(root, [tokenSpec('css/tokens.css', NEW)], readLock(root, BACKBONE), { write: true });

    // Documented limit, not an oversight: no record points at the old base, so nothing can. The
    // alternative is scanning the member at large, which is the licence this deliberately declines.
    assert.equal(report.rekeyed.length, 0);
    assert.deepEqual(report.abandoned, []);
  });
});
test('the current target base is never swept, so member-owned files under it are left alone', () => {
  withTmp((root) => {
    const OLD = 'apps/web/vendor/@jrm/tokens';
    const NEW = 'vendor/@jrm/tokens';
    apply(root, [tokenSpec('css/tokens.css', OLD)], readLock(root, BACKBONE), { write: true });

    // A member's own file inside the vendor directory - a .gitignore, a README explaining why the
    // tree is committed. The plan does not write it, but it is not abandoned either: the base is
    // live. Sweeping the destination as well as the source would report it as deletable, which is
    // the engine telling a human to remove a file the engine never wrote.
    seed(root, `${NEW}/.gitignore`, '# committed deliberately\n');

    const { report } = apply(root, [tokenSpec('css/tokens.css', NEW)], readLock(root, BACKBONE), { write: true });

    assert.deepEqual(
      report.abandoned.map((item) => item.targetPath),
      [`${OLD}/css/tokens.css`],
      'only the abandoned base is swept',
    );
  });
});
// ---------------------------------------------------------------------------
// A correct refusal that never stops is indistinguishable, in the output, from a deliberate
// customisation. See withholdingState() in lib/copier.mjs.
// ---------------------------------------------------------------------------

test('a refusal is marked withheld only when canon has moved since the member baseline', () => {
  withTmp((root) => {
    const v1 = spec();
    apply(root, [v1], readLock(root, BACKBONE), { write: true });
    seed(root, v1.targetPath, '# canon\n\nlocal edit\n');

    const { report } = apply(root, [v1], readLock(root, BACKBONE), { write: true });
    assert.equal(report.drift.length, 1, 'precondition: the edit is refused');
    assert.equal(
      report.drift[0].withheld,
      false,
      'canon is unchanged, so the member is missing nothing - customisation, not staleness',
    );
    assert.ok(report.drift[0].lastWrittenAt, 'the baseline date is still reported');
  });
});

test('the same refusal becomes withheld the moment canon moves', () => {
  withTmp((root) => {
    const v1 = spec();
    apply(root, [v1], readLock(root, BACKBONE), { write: true });
    seed(root, v1.targetPath, '# canon\n\nlocal edit\n');

    const { report } = apply(root, [spec(CONTENT_V2)], readLock(root, BACKBONE), { write: true });
    assert.equal(report.drift.length, 1);
    assert.equal(report.drift[0].withheld, true);
    assert.ok(report.drift[0].lastWrittenAt, 'names when canon was last received');
  });
});

test('an unrecorded conflicting target is withheld with no baseline date', () => {
  withTmp((root) => {
    seed(root, spec().targetPath, '# not canon, never recorded\n');
    const { report } = apply(root, [spec()], readLock(root, BACKBONE), { write: true });
    assert.equal(report.drift.length, 1);
    assert.equal(report.drift[0].withheld, true, 'never received canon at all');
    assert.equal(report.drift[0].lastWrittenAt, null);
  });
});

test("finance's measured state is reported as withheld, not as customisation", () => {
  // Reconstructed from jrmoulckers/finance rather than imagined, per #216/#225: its vendored
  // vendor/@jrm/tokens/css/default/tokens.css held 20,889 characters against canon's 45,465, with
  // a lock baseline sourceSha256 of 343e10b1... while studio's canon had already moved to
  // f7e03275... The engine refused correctly on every run and the file stopped advancing.
  withTmp((root) => {
    const targetPath = 'vendor/@jrm/tokens/css/default/tokens.css';
    const baselined = {
      ...spec(':root{--a:1}\n'),
      kind: 'tokens',
      name: 'tokens.css',
      targetPath,
    };

    apply(root, [baselined], readLock(root, BACKBONE), { write: true });
    seed(root, targetPath, ':root{--a:1;--local:9}\n');

    const newCanon = ':root{--a:1;--b:2}\n';
    const advanced = { ...baselined, sourceSha256: hashText(newCanon), content: newCanon };
    const { report } = apply(root, [advanced], readLock(root, BACKBONE), { write: true });

    assert.equal(report.drift.length, 1);
    assert.equal(report.drift[0].targetPath, targetPath);
    assert.equal(report.drift[0].withheld, true);

    const warning = formatDriftWarning('jrmoulckers/finance', report.drift);
    assert.match(warning, /withholding a canon update/);
    assert.match(warning, /1 of 1/);
  });
});

test('the warning says nothing about withholding when nothing is withheld', () => {
  // The escalation must be absent in the benign case or it is noise, and noise is what put the
  // original warning into a log nobody read.
  withTmp((root) => {
    const v1 = spec();
    apply(root, [v1], readLock(root, BACKBONE), { write: true });
    seed(root, v1.targetPath, '# canon\n\nlocal edit\n');
    const { report } = apply(root, [v1], readLock(root, BACKBONE), { write: true });

    const warning = formatDriftWarning('o/a', report.drift);
    assert.match(warning, /locally-modified file\(s\) left untouched/);
    assert.doesNotMatch(warning, /withholding/);
  });
});
// `--force` is scoped by member, but the request it answers is almost always about one file.
// A member-wide override of every drifted target is how "force this one known file" becomes a
// silent delete of member-authored documentation that canon holds no copy of. Measured on a real
// finance checkout: a plain `--force --members finance` reported 3 force-updated where the
// requester expected 1, the extra two being member-elaborated SKILL.md files with 13 and 45
// headings that exist nowhere upstream.
test('member-wide --force refuses a target that never received canon', () => {
  withTmp((root) => {
    const s = spec(CONTENT_V2);
    seed(root, s.targetPath, '# member-authored, never synced\n');
    const { report } = apply(root, [s], readLock(root, BACKBONE), { force: true, write: true });

    assert.equal(report.forced.length, 0, 'must not overwrite content canon never delivered');
    assert.equal(report.drift.length, 1);
    assert.match(report.drift[0].note, /force refused/);
    assert.equal(
      readFileSync(join(root, ...s.targetPath.split('/')), 'utf8'),
      '# member-authored, never synced\n',
      'the member bytes must survive',
    );
  });
});

test('--force-paths overwrites only the named never-received target', () => {
  withTmp((root) => {
    const named = spec(CONTENT_V2);
    const other = {
      ...spec(CONTENT_V2),
      name: 'qa-tester',
      sourcePath: 'agents/qa-tester.agent.md',
      targetPath: '.github/agents/qa-tester.agent.md',
    };
    seed(root, named.targetPath, '# member A\n');
    seed(root, other.targetPath, '# member B\n');

    const { report } = apply(root, [named, other], readLock(root, BACKBONE), {
      force: true,
      forcePaths: [named.targetPath],
      write: true,
    });

    assert.deepEqual(
      report.forced.map((f) => f.targetPath),
      [named.targetPath],
      'naming one path must not authorize the others',
    );
    assert.equal(report.drift.length, 1);
    assert.equal(report.drift[0].targetPath, other.targetPath);
    assert.equal(readFileSync(join(root, ...other.targetPath.split('/')), 'utf8'), '# member B\n');
  });
});

test('--force still overwrites a target that has received canon before', () => {
  withTmp((root) => {
    const s = spec();
    apply(root, [s], readLock(root, BACKBONE), { write: true });
    seed(root, s.targetPath, '# locally edited after baseline\n');

    const v2 = spec(CONTENT_V2);
    const { report } = apply(root, [v2], readLock(root, BACKBONE), { force: true, write: true });

    assert.equal(report.forced.length, 1, 'a recoverable target is still forceable member-wide');
    assert.equal(readFileSync(join(root, ...v2.targetPath.split('/')), 'utf8'), CONTENT_V2);
  });
});
// --- which lock keys a run claims authorship of ---
//
// Consumed by the pre-commit fold that reconciles against the member's default branch. A key named
// here is excluded from that fold, so over-reporting silently re-opens the lost-update race (#418)
// for the paths named, while under-reporting lets a concurrent run overwrite bytes this run just
// placed. Both are invisible in a single run's output.

test('touchedKeys names an added target and excludes a withheld one', () => {
  withTmp((root) => {
    const added = spec();
    const drifted = { ...spec(), targetPath: '.github/agents/other.agent.md' };
    seed(root, drifted.targetPath, 'member wrote this');

    const lock = { entries: { [drifted.targetPath]: { sourceSha256: 'x', targetSha256: 'y', syncedAt: '2026-08-07T00:00:00.000Z' } } };
    const { report, touchedKeys } = apply(root, [added, drifted], lock, { write: true });

    assert.equal(report.added.length, 1);
    assert.equal(report.drift.length, 1);
    assert.ok(touchedKeys.has(added.targetPath), 'a target this run wrote must be claimed');

    // The load-bearing half. `apply` leaves a drifted target's entry untouched, which is exactly
    // the entry an overlapping run can have regressed — and the finance instance was precisely a
    // drifted token file. Claiming it here would exclude it from the fold and make the fix inert
    // on the only case that motivated it.
    assert.ok(
      !touchedKeys.has(drifted.targetPath),
      'a withheld target must stay foldable — it is the class the fold exists to correct',
    );
  });
});

// The lockfile is a full snapshot, not a diff, so it is an overlapping path between any two sync
// PRs. Merging an older sync PR after a newer one reverts it wholesale while leaving files the
// newer PR alone touched at their newer content -- current bytes, stale entry, no engine race
// required. homelab #20 (08-09, 9 files) and #25 (08-11, 6 files) overlap on exactly that shape.
//
// This must not be drift, and the reason it is easy to get wrong is that `isLocallyModified`
// compares against the *recorded* hash and never against the current rendering. Drift then
// deliberately leaves the entry untouched, so the verdict repeats forever and `--check` fails on a
// file that is already correct -- the permanent-skip failure `isUnstampedCanon` exists to prevent,
// reached by a different route and caught by none of the three recovery predicates, which all
// compare the bytes against *historical* renderings rather than the current one.
test('a file identical to the current rendering is restamped, not drifted, when the entry is stale', () => {
  withTmp((root) => {
    const s = spec();
    const targetPath = s.targetPath;

    // Exactly what the engine would write right now.
    seed(root, targetPath, s.content);

    // The entry regressed to an older canon revision.
    const older = spec('# canon\n\nAn older revision.\n');
    const lock = {
      entries: {
        [targetPath]: {
          sourceSha256: older.sourceSha256,
          targetSha256: hashText(older.content),
          syncedAt: '2026-08-09T00:00:00.000Z',
        },
      },
    };

    const { report, lock: next } = apply(root, [s], lock, { write: true });

    assert.deepEqual(report.drift, [], 'bytes equal to the rendering are never drift');
    assert.deepEqual(
      report.updated.map((i) => i.targetPath),
      [targetPath],
    );
    assert.equal(
      next.entries[targetPath].targetSha256,
      hashText(s.content),
      'the stale entry must be restamped, or the same verdict returns on every later run',
    );
  });
});

// The test above regresses *both* fields, which is what an overlapping run produces. A hand-repair
// produces a different shape and the difference is load-bearing: `targetSha256` is corrected to
// match disk while `sourceSha256` is left describing an older canon revision. Every field is
// individually corroborated by some real delivery; the combination was delivered to no one.
//
// That state is what `lock.mjs` tells a member to leave alone -- "a sync that re-renders this target
// corrects all three fields for free" -- and that advice is the reason a member does not hand-edit a
// lockfile a second time. The whole promise rests on `sameBaseline` consulting `sourceSha256`, and
// the test above cannot tell whether it does: a `sameBaseline` comparing `targetSha256` alone leaves
// the entire suite green while freezing every hand-repaired entry as `unchanged` forever.
//
// So this pins the recovery on the shape the advice is actually about, and asserts the source field
// specifically -- asserting the target would restate the precondition.
test('a hand-repaired entry — target current, source stale — is corrected, not read as clean', () => {
  withTmp((root) => {
    const s = spec();
    const targetPath = s.targetPath;

    seed(root, targetPath, s.content);

    const older = spec('# canon\n\nAn older revision.\n');
    const lock = {
      entries: {
        [targetPath]: {
          // The hand-repair: the target hash was corrected to the delivered bytes, and the source
          // hash was left behind. This entry agrees with its own file and describes stale canon.
          sourceSha256: older.sourceSha256,
          targetSha256: hashText(s.content),
          syncedAt: '2026-08-07T15:35:03.616Z',
        },
      },
    };

    const { report, lock: next } = apply(root, [s], lock, { write: true });

    assert.deepEqual(report.unchanged, [], 'an entry describing stale canon is not clean');
    assert.deepEqual(
      report.updated.map((i) => i.targetPath),
      [targetPath],
      'the entry must be re-rendered, or the hand-repair is permanent',
    );
    assert.equal(
      next.entries[targetPath].sourceSha256,
      s.sourceSha256,
      'the stale source must be corrected — this is the promise that stands in for hand-editing',
    );
    assert.notEqual(
      next.entries[targetPath].syncedAt,
      lock.entries[targetPath].syncedAt,
      'a corrected entry records when it was corrected',
    );
  });
});

// The mirror of the test above, and the half it could not see. `sameBaseline` is a conjunction, and
// the comment above pins the `sourceSha256` operand by naming the failure a `targetSha256`-only
// comparison would cause. It does not pin the other direction: a `sameBaseline` comparing
// `sourceSha256` alone left the entire suite green, verified by mutant.
//
// The state it protects is the opposite hand-repair, and it arises on its own without anyone editing
// anything. When the engine's own rendering changes while canon source does not -- a provenance
// stamp reworded, a marker adjusted -- the delivered bytes move and the recorded `targetSha256`
// describes output no engine now produces. A member whose file already holds the current rendering
// then has a current source hash beside a stale target hash.
//
// Left unpinned, such an entry reads as clean forever: the lock keeps a target hash matching neither
// the file beside it nor anything canon renders, and every later integrity comparison inherits it.
test('an entry recording a superseded rendering — source current, target stale — is restamped', () => {
  withTmp((root) => {
    const s = spec();
    const targetPath = s.targetPath;

    seed(root, targetPath, s.content);

    const lock = {
      entries: {
        [targetPath]: {
          // Current canon, beside the hash of bytes an earlier rendering produced from it.
          sourceSha256: s.sourceSha256,
          targetSha256: hashText('# architect\n\nWhat an older rendering emitted.\n'),
          syncedAt: '2026-08-07T15:35:03.616Z',
        },
      },
    };

    const { report, lock: next } = apply(root, [s], lock, { write: true });

    assert.deepEqual(report.unchanged, [], 'an entry describing a superseded rendering is not clean');
    assert.deepEqual(
      report.updated.map((i) => i.targetPath),
      [targetPath],
      'the entry must be restamped, or it describes bytes no delivery ever produced',
    );
    assert.equal(
      next.entries[targetPath].targetSha256,
      hashText(s.content),
      'the stale target must be corrected — asserting the source here would restate the precondition',
    );
  });
});
test('a file identical to the current rendering with a matching entry stays unchanged', () => {
  withTmp((root) => {
    const s = spec();
    seed(root, s.targetPath, s.content);

    const first = apply(root, [s], readLock(root, BACKBONE), { write: true });
    assert.equal(first.report.adopted.length, 1, 'precondition: baselined, not written');

    const { report } = apply(root, [s], first.lock, { write: true });
    assert.deepEqual(report.updated, [], 'a matching entry must not be rewritten');
    assert.deepEqual(
      report.unchanged.map((i) => i.targetPath),
      [s.targetPath],
    );
  });
});
