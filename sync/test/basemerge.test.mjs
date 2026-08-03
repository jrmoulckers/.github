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
import { join } from 'node:path';
import {
  extractBlock,
  buildFile,
  canonicalizeInner,
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
    type: 'agents-md',
  };
}

function withTmp(fn) {
  const root = mkdtempSync(join(tmpdir(), 'basemerge-test-'));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test('a real managed block is still found and replaced', () => {
  const file = `# Product\n\nlocal text\n\n${START_MARKER}\nold canon\n${END_MARKER}\n`;
  assert.equal(extractBlock(file), 'old canon');

  const rebuilt = buildFile(file, 'new canon');
  assert.equal(extractBlock(rebuilt), 'new canon');
  assert.ok(rebuilt.includes('local text'), 'product-local text survives');
  assert.equal(rebuilt.match(/studio:base:start/g).length, 1, 'no duplicate block');
});

test('markers quoted inline in prose do not form a block', () => {
  const file = [
    '# Product',
    '',
    `Canon is injected between \`${START_MARKER}\` and \`${END_MARKER}\`; do not edit inside.`,
    '',
  ].join('\n');

  assert.equal(extractBlock(file), null, 'inline mentions must not open a managed region');

  const built = buildFile(file, CANON);
  assert.equal(canonicalizeInner(extractBlock(built)), canonicalizeInner(CANON));
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

  assert.equal(extractBlock(file), null, 'a documentation example must not open a region');

  const built = buildFile(file, CANON);
  assert.equal(canonicalizeInner(extractBlock(built)), canonicalizeInner(CANON));
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

  assert.equal(extractBlock(file), null, 'an indented example must not open a region');

  const built = buildFile(file, CANON);
  assert.equal(canonicalizeInner(extractBlock(built)), canonicalizeInner(CANON));
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
    writeFileSync(join(root, 'AGENTS.md'), buildFile(local, CANON), 'utf8');

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
    assert.equal(canonicalizeInner(extractBlock(written)), canonicalizeInner(NEXT));
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
