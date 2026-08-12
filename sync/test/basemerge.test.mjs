// Managed-block detection in AGENTS.md.
//
// The regression these tests exist for: a product AGENTS.md that *documents* the sync
// convention quotes both marker strings, which under a naive regex formed a phantom
// managed block. extractBlock then returned that prose instead of null, the append path
// was never taken, the phantom content hashed as unrecognized drift, and AGENTS.md was
// silently skipped — the member received every other file but not the base guide.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
import {
  extractBlock,
  buildFile,
  canonicalizeInner,
  orphanedRegions,
  MARKERS,
  START_MARKER,
  END_MARKER,
} from '../lib/basemerge.mjs';
import { apply } from '../lib/copier.mjs';
import { hashText } from '../lib/lock.mjs';

const CANON = '# JRM Studio base guide\n\nGolden rules go here.\n';

function agentsSpec(content = CANON) {
  return {
    kind: 'base',
    name: 'AGENTS.md',
    sourcePath: 'AGENTS.md',
    targetPath: 'AGENTS.md',
    sourceSha256: hashText(content),
    content,
    type: 'managed',
  };
}

// Synchronous by construction — see the note on copier.test.mjs's withTmp. An async body would be
// cleaned up mid-await and misclassify on the next call rather than failing outright.
function withTmp(fn) {
  const root = mkdtempSync(join(tmpdir(), 'basemerge-test-'));
  try {
    const result = fn(root);
    if (result && typeof result.then === 'function') {
      throw new Error('withTmp bodies must be synchronous — give an async test its own scratch root');
    }
    return result;
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('a real managed block is still found and replaced', () => {
  const file = `# Product\n\nlocal text\n\n${START_MARKER}\nold canon\n${END_MARKER}\n`;
  assert.equal(extractBlock(file, MARKERS.html), 'old canon');

  const rebuilt = buildFile(file, 'new canon', MARKERS.html);
  assert.equal(extractBlock(rebuilt, MARKERS.html), 'new canon');
  assert.ok(rebuilt.includes('local text'), 'product-local text survives');
  assert.equal(rebuilt.match(/studio:base:start/g).length, 1, 'no duplicate block');
});

test('a second managed region is located rather than silently maintained away', () => {
  // A duplicate is a merge artifact: the match is lazy, so pair one absorbs every operation and
  // pair two becomes invisible. It then holds whatever canon said when it appeared, inside markers
  // asserting it IS canon, in a file the member is told not to edit inside. Nothing else in the
  // engine can see it, and the region hash agrees with canon, so it never reports drift.
  const file = [
    '# Product',
    '',
    START_MARKER,
    'old canon',
    END_MARKER,
    '',
    'member content between the pairs',
    '',
    START_MARKER,
    'old canon',
    END_MARKER,
    '',
  ].join('\n');

  assert.deepEqual(orphanedRegions(file, MARKERS.html), [9], 'the extra region is at line 9');

  const rebuilt = buildFile(file, 'new canon', MARKERS.html);
  assert.equal(extractBlock(rebuilt, MARKERS.html), 'new canon', 'the first region is updated');
  assert.ok(rebuilt.includes('old canon'), 'and the orphan is deliberately left in place');
  assert.ok(rebuilt.includes('member content between the pairs'), 'member text survives');
  assert.deepEqual(
    orphanedRegions(rebuilt, MARKERS.html),
    [9],
    'still reported after the write, since the engine reports rather than repairs',
  );
});

test('a single region, and a documented example, are not reported as duplicates', () => {
  const single = `# Product\n\nlocal text\n\n${START_MARKER}\nold canon\n${END_MARKER}\n`;
  assert.deepEqual(orphanedRegions(single, MARKERS.html), [], 'one pair is not a duplicate');

  // The control that matters: canon invites members to document the sync in their own guide, so a
  // fenced example is expected content. It must not read as a second region — the same masking
  // extractBlock relies on, asserted here so the two cannot drift apart.
  const documented = [
    '# Product',
    '',
    START_MARKER,
    'old canon',
    END_MARKER,
    '',
    'Our guide explains the mechanism:',
    '',
    '```markdown',
    START_MARKER,
    'canon lands here',
    END_MARKER,
    '```',
    '',
  ].join('\n');
  assert.deepEqual(orphanedRegions(documented, MARKERS.html), [], 'a fenced example is not a region');
});

test('a duplicated region reaches the operator through the report', () => {
  withTmp((root) => {
    writeFileSync(
      join(root, 'AGENTS.md'),
      [
        '# Product',
        '',
        START_MARKER,
        canonicalizeInner(CANON),
        END_MARKER,
        '',
        'member note',
        '',
        START_MARKER,
        'canon as it stood at the bad merge',
        END_MARKER,
        '',
      ].join('\n'),
      'utf8',
    );

    const { report } = apply(root, [agentsSpec()], { entries: {} }, { write: true });

    assert.equal(report.orphaned.length, 1, 'the duplicate must be named, not absorbed');
    assert.equal(report.orphaned[0].targetPath, 'AGENTS.md');
    assert.deepEqual(report.orphaned[0].lines, [11], 'CANON is three lines, so the orphan starts at 11');

    const written = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    assert.equal(canonicalizeInner(extractBlock(written, MARKERS.html)), canonicalizeInner(CANON));
    assert.ok(
      written.includes('canon as it stood at the bad merge'),
      'reporting must not quietly delete member-visible content',
    );
    assert.ok(written.includes('member note'));
  });
});

test('a single managed region reports nothing', () => {
  withTmp((root) => {
    writeFileSync(
      join(root, 'AGENTS.md'),
      `# Product\n\n${START_MARKER}\nstale\n${END_MARKER}\n\nmember note\n`,
      'utf8',
    );
    const { report } = apply(root, [agentsSpec()], { entries: {} }, { write: true });
    assert.deepEqual(report.orphaned, [], 'the ordinary case must stay quiet');
  });
});

test('markers quoted inline in prose do not form a block', () => {
  const file = [
    '# Product',
    '',
    `Canon is injected between \`${START_MARKER}\` and \`${END_MARKER}\`; do not edit inside.`,
    '',
  ].join('\n');

  assert.equal(extractBlock(file, MARKERS.html), null, 'inline mentions must not open a managed region');

  const built = buildFile(file, CANON, MARKERS.html);
  assert.equal(canonicalizeInner(extractBlock(built, MARKERS.html)), canonicalizeInner(CANON));
  assert.ok(built.includes('do not edit inside.'), 'the prose is preserved');
});

test('markers shown inside a fenced example do not form a block', () => {
  const file = [
    '# Product',
    '',
    'The sync engine writes:',
    '',
    '```markdown',
    START_MARKER,
    '…canonical AGENTS.md…',
    END_MARKER,
    '```',
    '',
    'Everything outside is ours.',
    '',
  ].join('\n');

  assert.equal(extractBlock(file, MARKERS.html), null, 'a documentation example must not open a region');

  const built = buildFile(file, CANON, MARKERS.html);
  assert.equal(canonicalizeInner(extractBlock(built, MARKERS.html)), canonicalizeInner(CANON));
  assert.ok(built.includes('```markdown'), 'the example fence is untouched');
  assert.ok(built.includes('Everything outside is ours.'));
});

test('markers in a 4-space indented code block do not form a block', () => {
  // maskFences only understands ``` / ~~~ fences, so this case is closed by requiring the
  // markers at column 0 — an indented code block always carries at least four leading spaces.
  const file = [
    '# Product',
    '',
    'The sync engine writes:',
    '',
    `    ${START_MARKER}`,
    '    …canonical AGENTS.md…',
    `    ${END_MARKER}`,
    '',
    'Everything outside is ours.',
    '',
  ].join('\n');

  assert.equal(extractBlock(file, MARKERS.html), null, 'an indented example must not open a region');

  const built = buildFile(file, CANON, MARKERS.html);
  assert.equal(canonicalizeInner(extractBlock(built, MARKERS.html)), canonicalizeInner(CANON));
  assert.ok(built.includes(`    ${START_MARKER}`), 'the indented example is untouched');
  assert.equal(
    built.match(/^<!-- studio:base:start -->$/gm).length,
    1,
    'exactly one real block, at column 0',
  );
});

test('an AGENTS.md documenting the convention is written, not skipped as drift', () => {
  withTmp((root) => {
    // Exactly the shape that produced "⚠️ locally modified (skipped): AGENTS.md".
    writeFileSync(
      join(root, 'AGENTS.md'),
      `# libro\n\nStudio canon lands between \`${START_MARKER}\` / \`${END_MARKER}\`.\n`,
      'utf8',
    );

    const { report } = apply(root, [agentsSpec()], { entries: {} }, { write: true });

    assert.deepEqual(report.drift, [], 'must not be reported as locally modified');
    assert.deepEqual(
      report.added.map((i) => i.targetPath),
      ['AGENTS.md'],
    );

    const written = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    assert.ok(written.includes('Golden rules go here.'), 'canon landed');
    assert.ok(written.includes('# libro'), 'product content preserved');
  });
});

// The whole justification for the adoption path: once a member is baselined, a later canon change
// must actually reach it. If adoption silently degraded into "recorded, never updated again",
// nothing would fail — the run would just report success forever while the member froze.
test('after adoption, a canon change updates the managed block in place', () => {
  withTmp((root) => {
    const local = '# libro\n\nProduct-local rules we must never lose.\n';
    // Genuine adoption: the file already carries the exact canonical block, but no lock entry.
    writeFileSync(join(root, 'AGENTS.md'), buildFile(local, CANON, MARKERS.html), 'utf8');

    const first = apply(root, [agentsSpec()], { entries: {} }, { write: true });
    assert.equal(first.report.adopted.length, 1, 'baselined on the first run, no content change');
    assert.equal(first.report.added.length + first.report.updated.length, 0);

    const NEXT = '# JRM Studio base guide\n\nGolden rules go here.\n\nAnd a new rule.\n';
    const { report } = apply(root, [agentsSpec(NEXT)], first.lock, { write: true });

    assert.deepEqual(
      report.updated.map((i) => i.targetPath),
      ['AGENTS.md'],
      'an upstream change after adoption must update, not drift',
    );

    const written = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    assert.equal(canonicalizeInner(extractBlock(written, MARKERS.html)), canonicalizeInner(NEXT));
    assert.ok(written.includes('Product-local rules we must never lose.'));
    assert.equal(written.match(/^<!-- studio:base:start -->$/gm).length, 1, 'still one start marker');
    assert.equal(written.match(/^<!-- studio:base:end -->$/gm).length, 1, 'still one end marker');
  });
});

test('a genuinely edited managed block is still drift, with a note when implausible', () => {
  withTmp((root) => {
    const inner = canonicalizeInner(CANON);
    writeFileSync(
      join(root, 'AGENTS.md'),
      `${START_MARKER}\nhand-edited\n${END_MARKER}\n`,
      'utf8',
    );

    const lock = { entries: { 'AGENTS.md': { renderedSha256: hashText(inner) } } };
    const { report } = apply(root, [agentsSpec()], lock, { write: true });

    assert.deepEqual(
      report.drift.map((i) => i.targetPath),
      ['AGENTS.md'],
    );
    assert.match(report.drift[0].note, /stray studio:base markers/);
  });
});

// #457 established that `--force` must not delete content canon has never delivered, because the
// bytes are member-authored and canon holds no copy to put back. #460 implemented that on the
// plain-file path only, and these pin the managed path, where the same rule applies for the same
// reason: the refusal is about provenance, not about scope. Both directions are pinned, because a
// gate with no test is silent whether it is present or absent — the state below was forced for
// several releases with a full green suite.
test('member-wide --force refuses a managed region canon never delivered', () => {
  withTmp((root) => {
    const local = '# member\n\nSurrounding content.\n';
    const handAuthored = 'Rules that exist nowhere else.\n';
    const before = buildFile(local, handAuthored, MARKERS.html);
    writeFileSync(join(root, 'AGENTS.md'), before, 'utf8');

    // No lock entry: the engine has never delivered canon to this path.
    const { report } = apply(root, [agentsSpec()], { entries: {} }, { force: true, write: true });

    assert.deepEqual(report.forced, [], 'a never-delivered region must not be overwritten');
    assert.deepEqual(
      report.drift.map((i) => i.targetPath),
      ['AGENTS.md'],
    );
    assert.match(report.drift[0].note, /--force-paths/, 'the refusal must name its own remedy');
    assert.equal(readFileSync(join(root, 'AGENTS.md'), 'utf8'), before, 'byte-for-byte untouched');
  });
});

test('--force-paths authorizes a managed region the member-wide force refused', () => {
  withTmp((root) => {
    const local = '# member\n\nSurrounding content.\n';
    writeFileSync(
      join(root, 'AGENTS.md'),
      buildFile(local, 'Rules that exist nowhere else.\n', MARKERS.html),
      'utf8',
    );

    const { report } = apply(root, [agentsSpec()], { entries: {} }, {
      force: true,
      forcePaths: ['AGENTS.md'],
      write: true,
    });

    assert.deepEqual(
      report.forced.map((i) => i.targetPath),
      ['AGENTS.md'],
      'naming the path must be a working route, not merely an accepted flag',
    );
    const written = readFileSync(join(root, 'AGENTS.md'), 'utf8');
    assert.equal(canonicalizeInner(extractBlock(written, MARKERS.html)), canonicalizeInner(CANON));
    assert.ok(written.includes('Surrounding content.'), 'the member half is still never ours');
  });
});

// The control: without this, a gate that refused *every* managed force would pass both tests above
// while breaking ordinary recovery. A recorded target has received canon before, so it is
// recoverable and member-wide force still applies.
test('a recorded managed region is still forced without naming a path', () => {
  withTmp((root) => {
    writeFileSync(
      join(root, 'AGENTS.md'),
      buildFile('# member\n', 'drifted\n', MARKERS.html),
      'utf8',
    );

    const lock = { entries: { 'AGENTS.md': { renderedSha256: hashText(canonicalizeInner(CANON)) } } };
    const { report } = apply(root, [agentsSpec()], lock, { force: true, write: true });

    assert.deepEqual(
      report.forced.map((i) => i.targetPath),
      ['AGENTS.md'],
      'the refusal must not spread to targets canon has delivered before',
    );
  });
});

// The real canon body, not a synthetic one. The synthetic cases above prove the reader
// rejects a phantom block; only the shipped file proves it is pointed at the right thing.
// canon's own prose quotes the bare marker names, so a check counting NAMES sees two
// "pairs" on every member in the fleet while the delimiter occurs once. That reads as
// corruption, and its obvious remedy is to delete canon's prose out of the managed region.
test('canon quotes the marker names in prose, and only the delimiter form is counted', () => {
  const canon = readFileSync(join(REPO_ROOT, 'copilot-instructions.md'), 'utf8');
  const file = buildFile('', canon, MARKERS.html);
  const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  // Guard the premise: if canon stops documenting the convention this test proves nothing.
  assert.match(canon, /studio:base:start/, 'canon must quote the marker name for this to mean anything');

  assert.equal((file.match(/studio:base:start/g) ?? []).length, 2, 'bare name appears twice');
  assert.equal(
    (file.match(new RegExp('^' + esc(START_MARKER) + '[ \\t]*$', 'gm')) ?? []).length,
    1,
    'exactly one delimiter-anchored start marker',
  );
  assert.notEqual(extractBlock(file, MARKERS.html), null, 'the region still resolves');
});

// The managed path has the same ordering defect and the same repair. Pinned separately because the
// two paths have diverged before: the never-delivered force refusal (#558) was implemented on the
// plain-file path only and the suite stayed green because nothing exercised the managed twin.
test('a managed region identical to canon is restamped, not drifted, when the entry is stale', () => {
  withTmp((root) => {
    const local = '# member\n\nProduct-local content.\n';
    writeFileSync(join(root, 'AGENTS.md'), buildFile(local, CANON, MARKERS.html), 'utf8');

    const lock = {
      entries: {
        'AGENTS.md': {
          sourceSha256: hashText('older source'),
          targetSha256: hashText(canonicalizeInner('# older\n\nAn older revision.\n')),
          syncedAt: '2026-08-09T00:00:00.000Z',
        },
      },
    };

    const { report, lock: next } = apply(root, [agentsSpec()], lock, { write: true });

    assert.deepEqual(report.drift, [], 'a region equal to canon is never drift');
    assert.deepEqual(
      report.updated.map((i) => i.targetPath),
      ['AGENTS.md'],
    );
    assert.equal(
      next.entries['AGENTS.md'].targetSha256,
      hashText(canonicalizeInner(CANON)),
      'the stale entry must be restamped',
    );
    assert.ok(
      readFileSync(join(root, 'AGENTS.md'), 'utf8').includes('Product-local content.'),
      'the member half is still never ours',
    );
  });
});
