// Lock reconciliation when a member's target base moves.
//
// Regression cover for the finance @jrm/tokens case: the vendored tree was relocated from
// `apps/web/vendor/@jrm/tokens` to `vendor/@jrm/tokens`, the lockfile kept every entry under the
// abandoned base, and the relocated files — having no baseline at the new key — were classified
// as local modifications and skipped on every run. They could never converge.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { apply } from '../lib/copier.mjs';
import { hashText } from '../lib/lock.mjs';
import { reconcileLockKeys } from '../lib/rekey.mjs';
import { buildFile, canonicalizeInner, markersFor } from '../lib/basemerge.mjs';
import { inject } from '../lib/provenance.mjs';

const NOTE = 'generated + synced from jrmoulckers/studio @jrm/tokens — do not edit here';
const OLD_BASE = 'apps/web/vendor/@jrm/tokens';
const NEW_BASE = 'vendor/@jrm/tokens';

// Files that existed before the base moved (their bytes are the OLD dist), plus one that is
// genuinely new in this run. Mirrors the 16-old / 5-new split observed in finance.
const RELOCATED = ['tokens.css', 'css/default/index.css', 'js/index.js', 'tailwind/default.cjs'];
const BRAND_NEW = ['css/default/tokens-high-contrast-dark.css'];

const oldDist = (rel) => `/* old dist */\n.${rel.replace(/\W/g, '-')} { color: red }\n`;
const newDist = (rel) => `/* new dist */\n.${rel.replace(/\W/g, '-')} { color: blue }\n`;

function tokenSpec(rel, base = NEW_BASE) {
  const targetPath = `${base}/${rel}`;
  const raw = newDist(rel);
  return {
    kind: 'tokens',
    name: rel,
    sourcePath: `packages/tokens/dist/${rel}`,
    targetPath,
    targetBase: base,
    sourceSha256: hashText(raw),
    content: inject(targetPath, raw, { note: NOTE }),
    type: 'file',
  };
}

function write(root, relPath, content) {
  const abs = join(root, ...relPath.split('/'));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, content, 'utf8');
}

function withTmp(fn) {
  const root = mkdtempSync(join(tmpdir(), 'rekey-test-'));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * The state finance was actually in: files present only at the NEW base carrying the OLD dist
 * bytes, and lock entries present only under the OLD base recording those same bytes.
 */
function relocatedMember(root) {
  const entries = {};
  for (const rel of RELOCATED) {
    const written = inject(`${OLD_BASE}/${rel}`, oldDist(rel), { note: NOTE });
    write(root, `${NEW_BASE}/${rel}`, written);
    entries[`${OLD_BASE}/${rel}`] = {
      sourceSha256: hashText(oldDist(rel)),
      targetSha256: hashText(written),
      syncedAt: '2026-01-01T00:00:00.000Z',
    };
  }
  const writes = [...RELOCATED, ...BRAND_NEW].map((rel) => tokenSpec(rel));
  return { lock: { backbone: 'jrmoulckers/.github', entries }, writes };
}

test('a baseline only moves onto a file it provably describes', () => {
  withTmp((root) => {
    const { lock, writes } = relocatedMember(root);
    // This file is neither the recorded bytes nor current canon — an older dist, or a hand-edit.
    // The orphaned entry says nothing about it, so it must not inherit the baseline.
    write(root, `${NEW_BASE}/tokens.css`, '/* some other version */\n');

    const res = reconcileLockKeys(root, writes, lock.entries);

    assert.ok(
      !res.rekeyed.some((r) => r.targetPath === `${NEW_BASE}/tokens.css`),
      'an unproven file must not be recorded by rekey',
    );
    assert.ok(
      !res.entries[`${NEW_BASE}/tokens.css`],
      'leaving it unrecorded is what keeps historical-canon recovery available to it',
    );
    // The files that do match still move.
    assert.equal(res.rekeyed.length, RELOCATED.length - 1);
  });
});

test('a base move leaves every planned target tracked and no entry dangling', () => {
  withTmp((root) => {
    const { lock, writes } = relocatedMember(root);

    // Guard against a vacuous assertion: the fixture must actually start out broken.
    assert.equal(
      writes.filter((s) => lock.entries[s.targetPath]).length,
      0,
      'fixture precondition: no planned target should start with a lock entry',
    );
    assert.equal(
      Object.keys(lock.entries).filter((k) => existsSync(join(root, ...k.split('/')))).length,
      0,
      'fixture precondition: every starting entry should point at a nonexistent path',
    );

    const { report, lock: next } = apply(root, writes, lock, { write: true });

    // Every real file is tracked.
    for (const spec of writes) {
      assert.ok(next.entries[spec.targetPath], `${spec.targetPath} must have a lock entry`);
    }
    // No entry points at a path that does not exist.
    for (const key of Object.keys(next.entries)) {
      assert.ok(existsSync(join(root, ...key.split('/'))), `${key} must exist on disk`);
    }
    assert.equal(Object.keys(next.entries).length, writes.length);

    // The relocated files converge instead of being frozen as drift.
    assert.deepEqual(report.drift, []);
    assert.deepEqual(
      report.updated.map((i) => i.targetPath).sort(),
      RELOCATED.map((rel) => `${NEW_BASE}/${rel}`).sort(),
    );
    assert.deepEqual(
      report.added.map((i) => i.targetPath),
      BRAND_NEW.map((rel) => `${NEW_BASE}/${rel}`),
    );
    assert.equal(report.rekeyed.length, RELOCATED.length);
    assert.equal(report.pruned.length, 0, 'rekeyed entries must be moved, not dropped');
    assert.ok(report.changed);
  });
});

test('rekeying preserves the recorded baseline, so real drift is still caught', () => {
  withTmp((root) => {
    const { lock, writes } = relocatedMember(root);
    // Hand-edit one relocated file so it matches neither the old baseline nor new canon.
    write(root, `${NEW_BASE}/tokens.css`, '/* hand-patched under deadline */\n');

    const { report } = apply(root, writes, lock, { write: true });

    assert.deepEqual(
      report.drift.map((i) => i.targetPath),
      [`${NEW_BASE}/tokens.css`],
      'a genuinely edited file must still be reported as drift after rekeying',
    );
  });
});

test('a stale entry is pruned only when nothing exists at its path', () => {
  withTmp((root) => {
    const kept = 'docs/local-note.md';
    write(root, kept, 'member-owned\n');
    const entries = {
      [kept]: { sourceSha256: 'a', targetSha256: hashText('member-owned\n'), syncedAt: 'x' },
      'gone/removed.md': { sourceSha256: 'b', targetSha256: 'c', syncedAt: 'x' },
    };

    const res = reconcileLockKeys(root, [], entries);

    assert.deepEqual(res.pruned.map((p) => p.targetPath), ['gone/removed.md']);
    assert.ok(res.entries[kept], 'an unplanned entry whose file still exists keeps its baseline');
  });
});

test('an ambiguous relocation is left alone rather than guessed at', () => {
  withTmp((root) => {
    // Two abandoned bases both hold `tokens.css`; nothing says which one the file came from.
    write(root, `${NEW_BASE}/tokens.css`, 'x\n');
    const entries = {
      [`${OLD_BASE}/tokens.css`]: { sourceSha256: 'a', targetSha256: 'a', syncedAt: 'x' },
      [`legacy/vendor/@jrm/tokens/tokens.css`]: {
        sourceSha256: 'b',
        targetSha256: 'b',
        syncedAt: 'x',
      },
    };

    const res = reconcileLockKeys(root, [tokenSpec('tokens.css')], entries);

    assert.deepEqual(res.rekeyed, []);
    assert.equal(res.pruned.length, 2, 'ambiguous entries are still pruned as dangling');
    assert.equal(Object.keys(res.entries).length, 0);

    // Declining to decide is a decision, and it must be visible. Without this the prune above is
    // indistinguishable from an ordinary stale prune, so the human the choice was deferred to is
    // never told there was a choice.
    assert.deepEqual(
      res.ambiguous,
      [
        {
          targetPath: `${NEW_BASE}/tokens.css`,
          candidates: [`${OLD_BASE}/tokens.css`, `legacy/vendor/@jrm/tokens/tokens.css`],
        },
      ],
      'an ambiguous relocation is reported, not merely skipped',
    );
  });
});

test('an unambiguous run reports no ambiguity, so the signal means something', () => {
  withTmp((root) => {
    write(root, `${NEW_BASE}/tokens.css`, 'x\n');
    const entries = {
      [`${OLD_BASE}/tokens.css`]: {
        sourceSha256: 'a',
        targetSha256: hashText('x\n'), // the baseline must describe the file for the entry to move
        syncedAt: 'x',
      },
    };

    const res = reconcileLockKeys(root, [tokenSpec('tokens.css')], entries);

    assert.equal(res.rekeyed.length, 1);
    assert.deepEqual(res.ambiguous, [], 'a bijective match is never reported as ambiguous');
  });
});

test('a root-level managed target is never rekeyed onto some other path', () => {
  withTmp((root) => {
    write(root, 'AGENTS.md', 'x\n');
    const managed = {
      kind: 'base',
      name: 'AGENTS.md',
      sourcePath: 'AGENTS.md',
      targetPath: 'AGENTS.md',
      targetBase: '.',
      sourceSha256: 'a',
      content: 'x',
      type: 'managed',
    };
    const entries = {
      'apps/web/AGENTS.md': { sourceSha256: 'a', targetSha256: 'a', syncedAt: 'x' },
    };

    const res = reconcileLockKeys(root, [managed], entries);

    assert.deepEqual(res.rekeyed, []);
  });
});

// A managed target that is NOT at the repo root, so it survives `planRelative` and reaches
// `baselineFits` — the case the root-level test above cannot reach. Its lock entry records the
// hash of the canonicalized region, so judging it on whole-file bytes could only ever decline,
// and the entry would be stranded exactly as in #418.
test('a managed baseline is judged on its region, not the whole file', () => {
  withTmp((root) => {
    const targetPath = '.github/copilot-instructions.md';
    const inner = canonicalizeInner('Canon guidance for the member.\n');
    const file = buildFile('# local preamble\n', inner, markersFor(targetPath));
    write(root, targetPath, file);

    const spec = {
      kind: 'copilot',
      name: 'copilot-instructions.md',
      sourcePath: 'copilot-instructions.md',
      targetPath,
      targetBase: '.github',
      sourceSha256: 'a',
      content: 'Canon guidance for the member.\n',
      type: 'managed',
    };
    const orphan = 'legacy/copilot-instructions.md';
    const entry = (targetSha256) => ({ [orphan]: { sourceSha256: 'a', targetSha256, syncedAt: 'x' } });

    write(root, orphan, file); // present, so prune cannot mask the result

    const onRegion = reconcileLockKeys(root, [spec], entry(hashText(inner)));
    assert.deepEqual(
      onRegion.rekeyed,
      [{ from: orphan, targetPath }],
      'the baseline the engine actually records must be accepted',
    );

    const onWholeFile = reconcileLockKeys(root, [spec], entry(hashText(file)));
    assert.deepEqual(
      onWholeFile.rekeyed,
      [],
      'a whole-file hash does not describe a managed region and must not be adopted',
    );
  });
});

// The control for the test above: an ordinary target is still judged on its whole bytes, so the
// managed branch cannot be a blanket loosening that accepts anything.
test('a plain baseline is still judged on the whole file', () => {
  withTmp((root) => {
    const spec = tokenSpec('tokens.css');
    const bytes = spec.content;
    write(root, spec.targetPath, bytes);
    const orphan = `${OLD_BASE}/tokens.css`;
    write(root, orphan, bytes);

    const fits = reconcileLockKeys(root, [spec], {
      [orphan]: { sourceSha256: 'a', targetSha256: hashText(bytes), syncedAt: 'x' },
    });
    assert.deepEqual(fits.rekeyed, [{ from: orphan, targetPath: spec.targetPath }]);

    const doesNot = reconcileLockKeys(root, [spec], {
      [orphan]: { sourceSha256: 'a', targetSha256: hashText('something else\n'), syncedAt: 'x' },
    });
    assert.deepEqual(doesNot.rekeyed, [], 'bytes that disagree are still refused');
  });
});

test('rekeying is unaffected by whether the abandoned files were already deleted', () => {
  // Cleanup-before-rekey. A member may delete the old tree by hand before the sync that moves
  // its lock entries — finance did exactly this. If matching consulted the filesystem, deleting
  // the evidence first would strand every entry at the abandoned base with no later run able to
  // recover them, because a rekey is the only thing that carries a baseline across a base move.
  //
  // Note what this test is for, because it inverts the usual case. It does not protect existing
  // behaviour against accidental breakage; it exists to **reject a specific, plausible-looking
  // patch** — an `existsSync` guard added to the rekey loop, which reads as a defensive
  // improvement and is the one change that would silently strand entries. A reviewer proposing it
  // would be reasoning correctly from `prune`'s neighbouring guard. So if this test ever fails,
  // the fix is not to relax it: the invariant is that reporting may look at the disk and deciding
  // may not.
  //
  // Verified non-vacuous by mutation: adding that guard makes this fail, and reverting restores
  // it. A cleanup-after-rekey ordering would pass while proving nothing, which is why both
  // orderings are asserted against each other rather than only the hazardous one.
  const reconcile = (populateOldBase) =>
    withTmp((root) => {
      const { lock, writes } = relocatedMember(root);
      if (populateOldBase) {
        for (const rel of RELOCATED) {
          write(root, `${OLD_BASE}/${rel}`, inject(`${OLD_BASE}/${rel}`, oldDist(rel), { note: NOTE }));
        }
      }
      const { entries, rekeyed, pruned } = reconcileLockKeys(root, writes, lock.entries);
      return {
        keys: Object.keys(entries).sort(),
        rekeyed: rekeyed.map((r) => `${r.from} -> ${r.targetPath}`).sort(),
        pruned: pruned.map((p) => p.targetPath).sort(),
      };
    });

  const deletedFirst = reconcile(false);
  const stillPresent = reconcile(true);

  assert.deepEqual(
    deletedFirst,
    stillPresent,
    'reconciliation must key on the lock and the plan, never on what survives on disk',
  );
  assert.equal(deletedFirst.rekeyed.length, RELOCATED.length, 'every relocated entry rekeys');
  assert.deepEqual(deletedFirst.pruned, [], 'a rekeyed entry is moved, never pruned');
  for (const rel of RELOCATED) {
    assert.ok(
      deletedFirst.keys.includes(`${NEW_BASE}/${rel}`),
      `${rel} must end up keyed at the new base`,
    );
  }
});

test('a steady-state run rekeys nothing and prunes nothing', () => {
  withTmp((root) => {
    const writes = RELOCATED.map((rel) => tokenSpec(rel));
    const entries = {};
    for (const spec of writes) {
      write(root, spec.targetPath, spec.content);
      entries[spec.targetPath] = {
        sourceSha256: spec.sourceSha256,
        targetSha256: hashText(spec.content),
        syncedAt: 'x',
      };
    }

    const { report } = apply(root, writes, { backbone: 'b', entries }, { write: true });

    assert.deepEqual(report.rekeyed, []);
    assert.deepEqual(report.pruned, []);
    assert.equal(report.changed, false, 'an idempotent re-run must still produce no diff');
  });
});
