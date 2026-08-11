// Canonical LF normalization (.gitattributes) — the `attributes` managed-merge kind.
//
// Five member repos had no `.gitattributes` at all, one (`game-library`) had a weaker rule, and
// jrm-recipes reported `pnpm format:check` failing on ~964 untouched files in a fresh Windows
// checkout purely from CRLF materialization. Noise at that volume masks real failures, so the
// generic LF stanza became canon instead of being hand-added to repos where it would drift.
//
// Three things make this kind different from the Markdown managed targets, and each is the
// reason for one of the tests below:
//
//   1. `.gitattributes` has no HTML comment form. An `<!-- studio:base:start -->` line there is
//      not ignored — git reads it as a *pattern rule*. The markers and the provenance header
//      must therefore be `#` lines, or the sync silently corrupts every member's attributes.
//   2. Members legitimately need their own rules (binary patterns, LFS, linguist). A whole-file
//      copy would either destroy those or report drift forever, so the region merge is load
//      bearing rather than a stylistic choice.
//   3. "Has a .gitattributes" is not "is correct". game-library carries `* text=auto` WITHOUT
//      `eol=lf`, which normalizes the index but leaves the working tree platform-dependent. The
//      merge must STRENGTHEN that in place while its Go-specific rules survive.
//
// Placement is the fourth difference, and it is the subtle one. Git resolves attributes by LAST
// matching pattern, and canon's `*` matches every path, so an appended region silently reorders
// every more-specific member rule beneath itself — LFS entries, `linguist-generated`, `binary`,
// `-diff` on generated files. Canon is a *baseline*, so for `.gitattributes` the region is
// PREPENDED and the member's own rules keep the last word. Markdown targets still append, where
// there is no precedence order and product-local preamble belongs on top. See ADR-0011.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest, validateManifest, MANAGED_MERGE_TARGETS, BOOLEAN_KINDS, KINDS } from '../lib/manifest.mjs';
import { resolveAll } from '../lib/resolve.mjs';
import { enumerateTargets } from '../lib/assets.mjs';
import { inject, PROVENANCE_NOTE } from '../lib/provenance.mjs';
import { markersFor, MARKERS, END_MARKER, extractBlock, buildFile, canonicalizeInner } from '../lib/basemerge.mjs';
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

test('a weaker existing rule is strengthened in place, keeping its sibling rules', () => {
  // game-library's real file. `* text=auto` WITHOUT `eol=lf` normalizes the index but leaves the
  // working tree platform-dependent, so Windows still materializes CRLF for everything that is not
  // Go. "Has a .gitattributes" is not "is correct", and an append-only-if-absent transport would
  // skip this repo forever while a whole-file overwrite would delete its Go rules.
  //
  // Asserted through real `git check-attr` rather than string matching, because the property that
  // matters is git's resolution (last matching pattern wins), not the bytes we happen to write.
  //
  // Strengthening survives the switch from append to prepend, which is not obvious and is the
  // reason this assertion is made against git rather than against text. Canon now sits FIRST, so
  // game-library's weaker `* text=auto` matches afterwards — but that line says nothing about
  // `eol`, and resolution is per-attribute, so canon's `eol=lf` still stands. Had `eol` been
  // resolved per-line, prepending would have silently undone this repo's fix.
  const weaker = '* text=auto\n*.go text eol=lf\ngo.mod text eol=lf\ngo.sum text eol=lf\n';
  const spec = attributesSpec();
  const merged = buildFile(weaker, canonicalizeInner(spec.content), markersFor(spec.targetPath));

  assert.ok(merged.includes('*.go text eol=lf'), 'Go-specific rules survive');
  assert.ok(merged.includes('go.sum text eol=lf'), 'sibling rules survive');

  withTmp((root) => {
    const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    git(['init', '-q', '.']);

    writeFileSync(join(root, '.gitattributes'), weaker, 'utf8');
    const before = git(['check-attr', 'eol', '--', 'README.md', 'main.go']);
    assert.match(before, /README\.md: eol: unspecified/, 'the bug: CRLF on Windows for non-Go files');
    assert.match(before, /main\.go: eol: lf/);

    writeFileSync(join(root, '.gitattributes'), merged, 'utf8');
    const after = git(['check-attr', 'eol', '--', 'README.md', 'main.go', 'Makefile']);
    assert.match(after, /README\.md: eol: lf/, 'canon strengthens the weaker rule');
    assert.match(after, /Makefile: eol: lf/);
    assert.match(after, /main\.go: eol: lf/, 'and does not weaken what was already right');
  });
});

test('a member that already has the canonical rule keeps its own copy untouched', () => {
  // Seven members already carry `* text=auto eol=lf`. They end up with it twice — once local, once
  // managed. That is harmless (identical value, last match wins) and deliberately not deduplicated:
  // removing the local line would mean editing outside the markers, which is the member's content.
  withTmp((root) => {
    const local = '* text=auto eol=lf\n';
    writeFileSync(join(root, '.gitattributes'), local, 'utf8');

    const spec = attributesSpec();
    apply(root, [spec], { entries: {} }, { write: true });

    const written = readFileSync(join(root, '.gitattributes'), 'utf8');
    const marker = '# studio:base:end\n';
    const outsideBlock = written.slice(written.indexOf(marker) + marker.length);
    assert.equal(outsideBlock.trim(), local.trim(), 'member content is returned verbatim');
  });
});

test('canon is prepended so a more specific member rule keeps the last word', () => {
  // Git resolves attributes by last matching pattern and canon's `*` matches everything, so an
  // appended region outranks every member rule beneath it. jrmoulckers/studio is the real case:
  // `packages/tokens/dist/** text eol=lf` exists precisely to be deterministic REGARDLESS of git's
  // text detection. Appending canon downgraded that path's `text` from `set` to `auto` — still
  // LF, so not a live bug, but an explicit guarantee quietly turned into a conditional one.
  //
  // The same shape applies to any member rule more specific than `*`: LFS entries,
  // `linguist-generated`, `binary`, `-diff` on generated files. Asserted via `git check-attr`
  // because the claim is about git's resolution, not about our byte order.
  const local = '* text=auto eol=lf\npackages/tokens/dist/** text eol=lf\n*.png binary\n';
  const spec = attributesSpec();
  const merged = buildFile(local, canonicalizeInner(spec.content), markersFor(spec.targetPath));

  assert.ok(merged.startsWith('# studio:base:start\n'), 'the managed region comes first');
  assert.ok(
    merged.indexOf('packages/tokens/dist/**') > merged.indexOf('# studio:base:end'),
    'member rules follow the region, so they win',
  );

  withTmp((root) => {
    const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    git(['init', '-q', '.']);
    writeFileSync(join(root, '.gitattributes'), merged, 'utf8');

    const out = git(['check-attr', 'text', 'eol', '--', 'packages/tokens/dist/js/index.js']);
    assert.match(out, /text: set/, 'the member rule stays an explicit guarantee, not `auto`');
    assert.match(out, /eol: lf/);

    const png = git(['check-attr', 'text', '--', 'logo.png']);
    assert.match(png, /text: unset/, 'a member `binary` rule is not overridden by canon');
  });
});

test('an existing managed region is replaced in place, never relocated', () => {
  // A member whose region predates the placement rule keeps it where it is. Silently moving lines
  // around in a file the member owns is the failure this placement logic exists to prevent, so the
  // engine will not do it unasked — repositioning is a human's call.
  const existing = '* text=auto eol=lf\n\n# studio:base:start\nold\n# studio:base:end\n';
  const merged = buildFile(existing, '* text=auto eol=lf', MARKERS.hash);

  assert.ok(!merged.startsWith('# studio:base:start'), 'the region is not moved to the top');
  assert.ok(merged.startsWith('* text=auto eol=lf'), 'member content keeps its position');
  assert.equal(extractBlock(merged, MARKERS.hash), '* text=auto eol=lf', 'content still updates');
});

test('Markdown targets still append, so product preamble stays on top', () => {
  // Placement is a property of the format, not a global switch: flipping it for Markdown would
  // bury every member's own AGENTS.md preamble beneath canon.
  const merged = buildFile('# Product notes\n\nLocal preamble.\n', 'CANON', MARKERS.html);

  assert.ok(merged.startsWith('# Product notes'), 'member preamble stays first');
  assert.ok(merged.trimEnd().endsWith(END_MARKER), 'canon is appended');
  assert.equal(MARKERS.html.placement, 'append');
  assert.equal(MARKERS.hash.placement, 'prepend');
});

test('declining attributes removes the group without failing validation', () => {
  const off = structuredClone(manifest);
  off.members[0].optIn.attributes = false;
  assert.doesNotThrow(() => validateManifest(off));

  const [resolved] = resolveAll(off, [off.members[0].repo]);
  assert.ok(!resolved.groups.some((group) => group.kind === 'attributes'));
});

test('binary rules survive the merge, so assets are never handed to git text detection', () => {
  // homelab's real shape. `binary` is shorthand for `-text -diff`: never inspect this file. It is
  // the sharpest case for placement, because appending canon does not merely soften a guarantee
  // (as it did for Studio's `text: set`) — it inverts the meaning, moving assets from "never
  // inspect" to "let the heuristic decide". That is the difference between a cosmetic downgrade
  // and putting binary data under EOL conversion.
  //
  // Asserted through `git check-attr` because `text: unset` vs `text: auto` is a resolution
  // outcome; the emitted bytes look equally plausible either way.
  const member = [
    '* text=auto eol=lf',
    '*.yml text eol=lf',
    '*.glb binary',
    '*.png binary',
    '',
  ].join('\n');
  const spec = attributesSpec();
  const merged = buildFile(member, canonicalizeInner(spec.content), markersFor(spec.targetPath));

  withTmp((root) => {
    const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    git(['init', '-q', '.']);

    writeFileSync(join(root, '.gitattributes'), member, 'utf8');
    const before = git(['check-attr', 'text', '--', 'a.glb', 'a.png', 'a.yml']);
    assert.match(before, /a\.glb: text: unset/, 'binary means -text before the merge');

    writeFileSync(join(root, '.gitattributes'), merged, 'utf8');
    const after = git(['check-attr', 'text', '--', 'a.glb', 'a.png', 'a.yml']);
    assert.match(after, /a\.glb: text: unset/, 'binary assets stay excluded from text detection');
    assert.match(after, /a\.png: text: unset/);
    assert.match(after, /a\.yml: text: set/, 'and explicit text rules keep their explicit form');
  });
});
test('no tracked file is classified binary, so eol=lf actually reaches every file', () => {
  // A stray CR is not cosmetic. Git's binary heuristic is not only about NUL bytes: a file whose
  // CR count exceeds its CRLF pairs is classified `-text`, and a `-text` file is exempt from the
  // very `eol=lf` normalization this kind exists to apply. All thirteen of this repo's
  // community-health files carried doubled `\r\r\n` terminators and were classified binary, so
  // canon's own rule was inert for exactly the files GitHub serves org-wide.
  //
  // The failure is self-shielding, which is why it survived: `git add --renormalize .` — the
  // standard remedy — skips binary files, so the corruption blocks its own repair. Asserted
  // through `git ls-files --eol` because the claim is about git's classification of the committed
  // blob, not about bytes we happen to see in a working tree.
  const rows = execFileSync('git', ['ls-files', '--eol'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  assert.ok(rows.length > 0, 'the repo must have tracked files for this to mean anything');

  const binary = rows.filter((row) => /^i\/-text/.test(row)).map((row) => row.split('\t')[1]);
  assert.deepEqual(
    binary,
    [],
    'these are text files git treats as binary, so eol=lf does not apply to them',
  );
});

test('a doubled CR terminator is what makes git call a text file binary', () => {
  // Pins the mechanism behind the test above, so a future reader does not have to take the
  // NUL-free binary classification on faith.
  withTmp((root) => {
    const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    git(['init', '-q', '.']);
    writeFileSync(join(root, '.gitattributes'), '* text=auto eol=lf\n', 'utf8');
    writeFileSync(join(root, 'clean.md'), 'a\nb\n', 'utf8');
    writeFileSync(join(root, 'doubled.md'), 'a\r\r\nb\r\r\n', 'utf8');
    git(['add', '-A']);

    const rows = git(['ls-files', '--eol']);
    assert.match(rows, /i\/lf\s+w\/lf\s+.*clean\.md/, 'a clean file normalizes to LF');
    assert.match(rows, /i\/-text\s+w\/-text\s+.*doubled\.md/, 'a doubled CR reads as binary');
  });
});

test('the documented hand-audit compares the region, because whole-file comparison reads as drift', () => {
  const spec = attributesSpec();
  const markers = markersFor(spec.targetPath);
  const expected = canonicalizeInner(spec.content);

  // A correctly-synced member: exactly what the engine writes, plus local content it owns.
  const local = 'packages/tokens/dist/** text eol=lf\n';
  const member = `${buildFile('', expected, markers).replace(/\n+$/, '\n')}\n${local}`;

  // The whole-file recipe documented for ordinary copies calls this healthy file drift.
  assert.notEqual(member, spec.content, 'whole-file comparison must not be the documented check');

  // The region comparison is the one that is right.
  assert.equal(extractBlock(member, markers), expected);

  // Both hand-reconstruction traps the README names must actually fail this check.
  const headerOutside = `# synced from jrmoulckers/.github\n${buildFile('', '* text=auto eol=lf', markers)}`;
  assert.notEqual(extractBlock(headerOutside, markers), expected, 'provenance outside the markers');

  const withoutComments = buildFile(
    '',
    expected.split('\n').filter((line) => !line.startsWith('# Normalize') && !line.startsWith("# Git's")).join('\n'),
    markers,
  );
  assert.notEqual(extractBlock(withoutComments, markers), expected, "canon's comments are part of the region");
});

test('the provenance line is engine-injected, so hand-seeding cannot reproduce the region', () => {
  // Two members pre-seeded this region from canon and both omitted the provenance line
  // (jrmoulckers/studio, jrmoulckers/jrm-recipes). That is not carelessness twice: inject() adds
  // the line when the spec is built, so it is absent from the file a person copies from, and
  // copying faithfully still yields a region the engine will rewrite. See #180.
  const spec = attributesSpec();
  const markers = markersFor(spec.targetPath);
  const source = readFileSync(join(REPO_ROOT, '.gitattributes'), 'utf8');

  // The construction: absent from the source, present exactly once in what the engine writes.
  assert.ok(
    !source.includes(PROVENANCE_NOTE),
    'the canonical source must not carry the provenance line - inject() prepends unconditionally, ' +
      'so putting it here emits it twice, and "do not edit here" is false of the one file that is edited here',
  );
  assert.equal(
    spec.content.split('\n').filter((line) => line.includes(PROVENANCE_NOTE)).length,
    1,
    'the rendered spec carries the provenance line exactly once',
  );

  // Therefore a faithful hand-seed differs from canon, and differs ONLY by that line.
  const handSeeded = buildFile('', canonicalizeInner(source), markers);
  const expected = canonicalizeInner(spec.content);
  assert.notEqual(
    extractBlock(handSeeded, markers),
    expected,
    'if these ever match, the omission is no longer by construction and this guard is obsolete',
  );
  assert.deepEqual(
    expected.split('\n').filter((line) => !extractBlock(handSeeded, markers).split('\n').includes(line)),
    [`# ${PROVENANCE_NOTE}`],
    'the provenance line is the whole of the difference',
  );

  // And it is harmless: findBlock keys on markers, so the region is still located and replaced.
  assert.equal(
    extractBlock(buildFile(handSeeded, expected, markers), markers),
    expected,
    'a pre-seeded region must be corrected in place by the first sync, not duplicated',
  );
});