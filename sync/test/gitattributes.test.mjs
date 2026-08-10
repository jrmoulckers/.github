// Canonical LF normalization (.gitattributes) — the `attributes` managed-merge kind.
//
// Seven member repos had no `.gitattributes` at all, and jrm-recipes reported `pnpm
// format:check` failing on ~964 untouched files in a fresh Windows checkout purely from CRLF
// materialization. Noise at that volume masks real failures, so the generic LF stanza became
// canon instead of being hand-added to seven repos where it would drift.
//
// Two things make this kind different from the Markdown managed targets, and both are the
// reason these tests exist:
//
//   1. `.gitattributes` has no HTML comment form. An `<!-- studio:base:start -->` line there is
//      not ignored — git reads it as a *pattern rule*. The markers and the provenance header
//      must therefore be `#` lines, or the sync silently corrupts every member's attributes.
//   2. Members legitimately need their own rules (binary patterns, LFS, linguist). A whole-file
//      copy would either destroy those or report drift forever, so the region merge is load
//      bearing rather than a stylistic choice.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest, validateManifest, MANAGED_MERGE_TARGETS, BOOLEAN_KINDS, KINDS } from '../lib/manifest.mjs';
import { resolveAll } from '../lib/resolve.mjs';
import { enumerateTargets } from '../lib/assets.mjs';
import { inject } from '../lib/provenance.mjs';
import { markersFor, MARKERS, extractBlock, buildFile, canonicalizeInner } from '../lib/basemerge.mjs';
import { apply } from '../lib/copier.mjs';
import { hashText } from '../lib/lock.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = loadManifest(REPO_ROOT);

function attributesSpec() {
  const [resolved] = resolveAll(manifest, ['jrmoulckers/jrm-recipes']);
  const { writes } = enumerateTargets(resolved, REPO_ROOT);
  const spec = writes.find((write) => write.kind === 'attributes');
  assert.ok(spec, 'the manifest must produce an attributes target to test against');
  return spec;
}

// Synchronous by construction — see the note on copier.test.mjs's withTmp.
function withTmp(fn) {
  const root = mkdtempSync(join(tmpdir(), 'gitattributes-test-'));
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

test('attributes is a boolean managed-merge kind targeting the repo root', () => {
  assert.ok(KINDS.includes('attributes'));
  assert.ok(BOOLEAN_KINDS.has('attributes'), 'there is nothing to select within a single file');
  assert.equal(MANAGED_MERGE_TARGETS.get('attributes'), '.gitattributes');
  assert.deepEqual(manifest.canon.attributes, ['.gitattributes']);
  assert.equal(manifest.targetPaths.attributes, '.', 'git only reads root .gitattributes globally');
  assert.ok(manifest.optInSyntax.kinds.includes('attributes'));
  assert.doesNotThrow(() => validateManifest(manifest));
});

test('canon carries the generic LF stanza and nothing repo-specific', () => {
  const canon = readFileSync(join(REPO_ROOT, '.gitattributes'), 'utf8');
  assert.match(canon, /^\* text=auto eol=lf$/m, 'the whole point of the kind');
  assert.ok(
    !canon.includes('packages/tokens/dist'),
    'the tokens dist rule is Studio-specific and must not be forced onto members',
  );
  for (const line of canon.split('\n')) {
    if (line.trim() === '' || line.startsWith('#')) continue;
    assert.match(line, /^\S+ /, `canon rule must be "<pattern> <attrs>": ${line}`);
  }
});

test('the backbone applies its own canon — it was one of the repos missing the file', () => {
  // Distributing a rule the source repo does not follow is how the canon and the fleet drift
  // apart. The backbone's .gitattributes IS the canon source, so this is self-enforcing.
  const canon = readFileSync(join(REPO_ROOT, '.gitattributes'), 'utf8');
  assert.match(canon, /text=auto eol=lf/);
});

test('.gitattributes provenance and markers use # comments, never HTML', () => {
  // An '<!-- … -->' line in .gitattributes is a pattern rule, not a comment: git would try to
  // apply attributes to paths matching '<!--'. This is the failure mode the kind must not have.
  const header = inject('.gitattributes', '* text=auto eol=lf\n');
  assert.match(header, /^# synced from jrmoulckers\/\.github/);
  assert.ok(!header.includes('<!--'));

  assert.deepEqual(markersFor('.gitattributes'), MARKERS.hash);
  assert.deepEqual(markersFor('AGENTS.md'), MARKERS.html);
  assert.deepEqual(markersFor('.github/copilot-instructions.md'), MARKERS.html);
  for (const marker of [MARKERS.hash.start, MARKERS.hash.end]) {
    assert.match(marker, /^# /, 'a hash marker must be a git comment line');
  }
});

test('every line the engine writes into .gitattributes is a comment or a real rule', () => {
  const spec = attributesSpec();
  const rendered = buildFile('', canonicalizeInner(spec.content), markersFor(spec.targetPath));
  for (const line of rendered.split('\n')) {
    if (line.trim() === '' || line.startsWith('#')) continue;
    assert.match(line, /^\* text=auto eol=lf$/, `unexpected pattern line in output: ${line}`);
  }
});

test('member-local attribute rules survive the merge and a later upstream change', () => {
  withTmp((root) => {
    const local = '# product rules\n*.psd binary\nassets/** filter=lfs diff=lfs merge=lfs -text\n';
    writeFileSync(join(root, '.gitattributes'), local, 'utf8');

    const spec = attributesSpec();
    const first = apply(root, [spec], { entries: {} }, { write: true });
    assert.deepEqual(
      first.report.added.map((item) => item.targetPath),
      ['.gitattributes'],
      'a member with its own rules gains the managed region rather than drifting',
    );

    let written = readFileSync(join(root, '.gitattributes'), 'utf8');
    assert.ok(written.includes('*.psd binary'), 'product-local rules survive');
    assert.ok(written.includes('filter=lfs'), 'LFS configuration survives');
    assert.match(written, /^\* text=auto eol=lf$/m);
    assert.equal(written.match(/^# studio:base:start$/gm).length, 1, 'exactly one managed region');

    // Idempotent: a second run with the same canon writes nothing new.
    const second = apply(root, [spec], first.lock, { write: true });
    assert.deepEqual(second.report.unchanged.map((item) => item.targetPath), ['.gitattributes']);

    // An upstream change replaces the region in place, still preserving local rules.
    const next = { ...spec, content: `${spec.content}*.md text eol=lf\n` };
    next.sourceSha256 = hashText(next.content);
    const third = apply(root, [next], second.lock, { write: true });
    assert.deepEqual(third.report.updated.map((item) => item.targetPath), ['.gitattributes']);

    written = readFileSync(join(root, '.gitattributes'), 'utf8');
    assert.ok(written.includes('*.psd binary'), 'local rules survive an upstream change too');
    assert.ok(written.includes('*.md text eol=lf'));
    assert.equal(written.match(/^# studio:base:start$/gm).length, 1, 'no duplicate region');
  });
});

test('a member with no .gitattributes gets one containing only the managed region', () => {
  withTmp((root) => {
    const spec = attributesSpec();
    const { report } = apply(root, [spec], { entries: {} }, { write: true });
    assert.deepEqual(report.added.map((item) => item.targetPath), ['.gitattributes']);

    const written = readFileSync(join(root, '.gitattributes'), 'utf8');
    assert.ok(written.startsWith('# studio:base:start\n'));
    assert.ok(written.endsWith('# studio:base:end\n'));
    assert.equal(
      extractBlock(written, MARKERS.hash),
      canonicalizeInner(spec.content),
      'the region round-trips through the hash markers',
    );
  });
});

test('marker syntaxes do not cross-detect between file types', () => {
  // HTML markers sitting in a .gitattributes are member content, not our region: reading them as
  // ours would splice canon into the middle of somebody else's pattern rules.
  const htmlInAttributes = '<!-- studio:base:start -->\nnot ours\n<!-- studio:base:end -->\n';
  assert.equal(extractBlock(htmlInAttributes, MARKERS.hash), null);

  const merged = buildFile(htmlInAttributes, '* text=auto eol=lf', MARKERS.hash);
  assert.ok(merged.includes('not ours'), 'foreign markers are preserved as plain content');
  assert.equal(extractBlock(merged, MARKERS.hash), '* text=auto eol=lf');

  // And a '#' marker in Markdown is a heading, not our region.
  assert.equal(extractBlock('# studio:base:start\nx\n# studio:base:end\n', MARKERS.html), null);
});

test('declining attributes removes the group without failing validation', () => {
  const off = structuredClone(manifest);
  off.members[0].optIn.attributes = false;
  assert.doesNotThrow(() => validateManifest(off));

  const [resolved] = resolveAll(off, [off.members[0].repo]);
  assert.ok(!resolved.groups.some((group) => group.kind === 'attributes'));
});
