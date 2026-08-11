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
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest, validateManifest, MANAGED_MERGE_TARGETS, BOOLEAN_KINDS, KINDS } from '../lib/manifest.mjs';
import { resolveAll } from '../lib/resolve.mjs';
import { enumerateTargets } from '../lib/assets.mjs';
import { inject, PROVENANCE_NOTE } from '../lib/provenance.mjs';
import { markersFor, MARKERS, END_MARKER, extractBlock, buildFile, canonicalizeInner } from '../lib/basemerge.mjs';
import { apply } from '../lib/copier.mjs';
import { hashText, readLock } from '../lib/lock.mjs';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), 'fixtures');
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

test('omitting the marker set throws instead of silently assuming HTML', () => {
  // A default of MARKERS.html is correct for every target except `.gitattributes`, so the one
  // caller it is wrong for would receive an empty region rather than an error.
  const hashFile = '# studio:base:start\n* text=auto eol=lf\n# studio:base:end\n';

  assert.throws(() => extractBlock(hashFile), /explicit marker set/);
  assert.throws(() => buildFile('', 'x'), /explicit marker set/);
  assert.throws(() => markersFor(), /non-empty target path/);

  // The failure the removed default produced: right shape, wrong syntax, no error.
  assert.equal(extractBlock(hashFile, MARKERS.html), null);
  assert.equal(extractBlock(hashFile, markersFor('.gitattributes')), '* text=auto eol=lf');
});

test('comment syntax is derived from the file type and unknown types throw', () => {
  // Every managed-merge target must resolve, or a sync run breaks for the whole fleet.
  for (const [, targetPath] of MANAGED_MERGE_TARGETS) {
    assert.ok(markersFor(targetPath).start, `${targetPath} must resolve to a marker set`);
  }

  // Derivation, not enumeration: a hash-syntax file the engine has never targeted still resolves.
  for (const p of ['.gitignore', '.editorconfig', 'agency.toml', 'ci/config.yml']) {
    assert.deepEqual(markersFor(p), MARKERS.hash, `${p} cannot carry an HTML comment`);
  }
  for (const p of ['AGENTS.md', 'profile/README.md', 'docs/x.markdown']) {
    assert.deepEqual(markersFor(p), MARKERS.html);
  }

  // The hazard this replaces: an unrecognised type used to receive HTML markers silently, which
  // the writer would then emit into a file where they are content rather than a comment.
  assert.throws(() => markersFor('config.unknownext'), /unknown comment syntax/);
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

test('position is a proxy for precedence, and a lossy one — audit with check-attr', () => {
  // A fleet audit keyed to "the region must be the first non-empty line" returned two hits and both
  // were false positives, which is why the documented audit uses git's resolver instead. Comments
  // above the region carry no precedence, and a member rule byte-identical to canon is overridden to
  // the same value it already had. Both files look wrong positionally and are perfectly safe.
  const spec = attributesSpec();
  const region = buildFile('', canonicalizeInner(spec.content), markersFor(spec.targetPath)).trimEnd();

  // Both shapes are observed on member default branches. Neither is engine output — the engine
  // prepends — they arise from hand-seeding and from member edits made above an existing region.
  const commentsAbove = `# Member notes.\n# Exceptions must stay below the region.\n\n${region}\n`;
  const duplicateAbove = `* text=auto eol=lf\n\n${region}\n`;

  for (const [name, content] of [['commentsAbove', commentsAbove], ['duplicateAbove', duplicateAbove]]) {
    const firstLine = content.split('\n').find((line) => line.trim() !== '');
    assert.notEqual(firstLine, '# studio:base:start', `${name} fails a positional check`);
  }

  withTmp((root) => {
    const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    git(['init', '-q', '.']);

    // The real regression, stated in the terms the damage occurs in: a member `binary` rule that
    // canon's wildcard outranks. Neither false positive exhibits it.
    for (const content of [commentsAbove, duplicateAbove]) {
      writeFileSync(join(root, '.gitattributes'), `${content.trimEnd()}\n*.glb binary\n`, 'utf8');
      assert.match(
        git(['check-attr', 'text', '--', 'model.glb']),
        /text: unset/,
        'precedence is intact despite the region not being first',
      );
    }
  });
});

test('placement varies per target, so the marker table is not just comment syntax', () => {
  // The prose once said only the comment syntax varied between managed targets. Placement varies
  // too, and semantically: cosmetic in Markdown, precedence-deciding in .gitattributes. Pinned so a
  // fourth target cannot be added by copying a marker entry and thinking only about comments.
  const placements = new Map(Object.entries(MARKERS).map(([name, m]) => [name, m.placement]));

  assert.equal(placements.get('html'), 'append');
  assert.equal(placements.get('hash'), 'prepend');
  assert.equal(
    new Set(placements.values()).size > 1,
    true,
    'targets do not share a single placement, so the difference must stay documented',
  );

  for (const [name, placement] of placements) {
    assert.ok(placement, `marker set ${name} must declare a placement, not inherit one`);
  }
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

test('a stale-branch region merged at the bottom is permanent, not self-healing', () => {
  // The counterpart of the guarantee above, and the reason an old sync branch must be regenerated
  // rather than merged. Branches generated before the prepend fix (#124/#125) appended the region to
  // a member file that already carried canon's stanza unmarked. Merging one leaves the stanza in the
  // file twice and the member's more specific rule ABOVE canon's `*` — and because the engine
  // replaces a region where it already is, no later sync ever repairs either problem.
  const staleBranchResult = [
    '* text=auto eol=lf',
    '',
    'packages/tokens/dist/** text eol=lf',
    '',
    '# studio:base:start',
    '* text=auto eol=lf',
    '# studio:base:end',
    '',
  ].join('\n');

  let merged = staleBranchResult;
  for (let sync = 0; sync < 3; sync += 1) {
    merged = buildFile(merged, '* text=auto eol=lf', MARKERS.hash);
  }

  const memberRule = merged.indexOf('packages/tokens/dist/**');
  const canonStart = merged.indexOf('# studio:base:start');
  assert.ok(
    memberRule < canonStart,
    'repeated syncs never lift the member rule below canon: the damage is permanent',
  );
  assert.equal(
    merged.split('\n').filter((line) => line.trim() === '* text=auto eol=lf').length,
    2,
    'the duplicated unmarked stanza also survives, because the engine only owns the region',
  );
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
test('every tracked file is committed as LF, so eol=lf actually reaches all of them', () => {
  // A stray CR is not cosmetic. Git's binary heuristic is not only about NUL bytes: a file whose
  // CR count differs at all from its CRLF count (`cr != crlf`) is classified `-text`, and a
  // `-text` file is exempt from the very `eol=lf` normalization this kind exists to apply. All
  // thirteen of this repo's community-health files carried doubled `\r\r\n` terminators and were
  // classified binary, so canon's own rule was inert for exactly the files GitHub serves org-wide.
  //
  // The failure is self-shielding, which is why it survived: `git add --renormalize .` — the
  // standard remedy — skips binary files, so the corruption blocks its own repair. Asserted
  // through `git ls-files --eol` because the claim is about git's classification of the committed
  // blob, not about bytes we happen to see in a working tree.
  //
  // #258: this asserts `i/lf`, not merely "not `i/-text`". The two are equivalent for every state
  // reachable today — I filed #258 believing there was a recoverable `i/mixed` band beneath the
  // binary heuristic, and measurement says there is not: one lone CR flips it outright, and an
  // `i/crlf` index entry is not reachable under this repo's settings. The stronger form is kept
  // because it states the property directly ("is it LF") instead of by exclusion, and because the
  // exemption below keeps it correct if the repo ever gains a real binary. Its extra coverage is
  // theoretical, not demonstrated — see the lone-CR test for what is actually pinned.  // #268: kept honest about what it does NOT prove. The assertion no longer relies on this repo
  // tracking zero binaries — an asset added tomorrow is exempted by its NUL bytes, with no rule
  // to write and no invariant to rewrite.
  const rows = execFileSync('git', ['ls-files', '--eol'], { cwd: REPO_ROOT, encoding: 'utf8' })
    .split('\n')
    .filter(Boolean);
  assert.ok(rows.length > 0, 'the repo must have tracked files for this to mean anything');

  // #268: the exemption is NUL presence, not `git check-attr`. Asking git whether a file is
  // *declared* binary feels like the ADR-0011 move ("only git resolves attributes"), but it is the
  // right instinct on the wrong predicate: under canon's `* text=auto`, an undeclared asset
  // resolves to `text: auto` — the SAME answer a doubled-CR text file gets — so `check-attr`
  // cannot separate the two cases at all. Classification here is empirical, not declared:
  // a genuine binary is `-text` BECAUSE it contains NUL; corruption is `-text` despite containing
  // none. Pinned by the test below, which asserts the two are indistinguishable by `check-attr`.
  //
  // The previous form also failed on any legitimate undeclared asset. Studio ran the documented
  // audit against jrm-recipes and got 60 such rows — 34 png, 21 webp, 4 woff2, 1 ico — every one
  // with NUL > 0.
  const notLf = rows.filter((row) => !/^i\/lf/.test(row)).map((row) => row.split('\t')[1]);
  const corrupt = notLf.filter((path) => {
    const blob = execFileSync('git', ['show', `:${path}`], {
      cwd: REPO_ROOT,
      encoding: 'buffer',
      maxBuffer: 64 * 1024 * 1024,
    });
    return !blob.includes(0);
  });

  assert.deepEqual(
    corrupt,
    [],
    'these are text files git did not store as LF, so canon eol=lf is not reaching them',
  );
});

test('check-attr cannot tell a real asset from a corrupted text file — only NUL can', () => {
  // #268 pins the exemption above against regressing to the declared-binary form, which reads as
  // more principled and answers a question whose answer does not vary between the two cases.
  withTmp((root) => {
    const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    git(['init', '-q', '.']);
    writeFileSync(join(root, '.gitattributes'), '* text=auto eol=lf\n', 'utf8');
    // A real asset, undeclared — exactly how jrm-recipes tracks its images (it has no
    // .gitattributes at all, and canon's `*` rule would not exempt them if it did).
    writeFileSync(join(root, 'a.png'), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52]));
    writeFileSync(join(root, 'b.md'), 'x\r\r\n'.repeat(40), 'utf8');
    git(['add', '-A']);

    const rows = git(['ls-files', '--eol']);
    assert.match(rows, /i\/-text.*a\.png/, 'both are classified binary');
    assert.match(rows, /i\/-text.*b\.md/);

    const attrs = git(['check-attr', 'text', '--', 'a.png', 'b.md']);
    assert.match(attrs, /a\.png: text: auto/, 'canon resolves an undeclared asset to auto, not unset');
    assert.match(attrs, /b\.md: text: auto/, 'and gives corruption the identical answer');

    const nul = (p) =>
      execFileSync('git', ['show', `:${p}`], { cwd: root, encoding: 'buffer' }).includes(0);
    assert.equal(nul('a.png'), true, 'the asset is binary because it contains NUL');
    assert.equal(nul('b.md'), false, 'the corrupted file contains none — this is the discriminator');
  });
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

test('one lone CR is enough — the heuristic is cr != crlf, not a majority', () => {
  // #258 was filed believing a file could carry stray CRs and stay text until they outnumbered
  // the CRLF pairs, giving a recoverable window. That is wrong, and the comment in #155 that said
  // so was wrong with it. Git's rule is `stats->cr != stats->crlf`: ONE carriage return outside a
  // CRLF pair classifies the file binary, whatever the ratio. Measured, not read off the source.
  //
  // The correction matters in the direction that hurts. "CR count exceeds CRLF pairs" invites a
  // reader to conclude a couple of stray CRs are survivable; there is no such margin, and the
  // moment it tips, `renormalize` stops working and the corruption shields its own repair.
  withTmp((root) => {
    const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    git(['init', '-q', '.']);
    writeFileSync(join(root, '.gitattributes'), '* text=auto eol=lf\n', 'utf8');

    // Twenty proper CRLF terminators and exactly one lone CR, so cr = 21, crlf = 20.
    writeFileSync(join(root, 'oneStray.md'), `a\rb\r\n${'x\r\n'.repeat(19)}`, 'utf8');
    writeFileSync(join(root, 'allCrlf.md'), 'x\r\n'.repeat(20), 'utf8');
    git(['add', '-A']);

    const rows = git(['ls-files', '--eol']);
    assert.match(rows, /i\/-text\s+w\/-text\s+.*oneStray\.md/, 'a single lone CR is already binary');
    assert.match(rows, /i\/lf\s+.*allCrlf\.md/, 'while pure CRLF normalizes cleanly — cr == crlf');
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
// ---------------------------------------------------------------------------------------------
// A region that has ended up BELOW member rules. `buildFile` prepends, so the engine never
// creates this - but a hand-placed region, or one written by a sync predating the placement fix,
// is permanent, because an existing region is replaced in place and never relocated. Found live:
// jrmoulckers/homelab's `studio-sync/2026-08-10` branch carries exactly this, and `git check-attr`
// on its bytes reports `house.glb: text: auto` where the member's own file gives `text: unset`.
// ---------------------------------------------------------------------------------------------

function regionBelow(spec, local) {
  const inner = canonicalizeInner(spec.content);
  const markers = markersFor('.gitattributes');
  return `${local}\n${markers.start}\n${inner}\n${markers.end}\n`;
}

test('a member rule the region outranks is reported, and matches what git resolves', () => {
  withTmp((root) => {
    const spec = attributesSpec();
    const local = '# Binary assets - never apply text detection.\n*.glb   binary\n*.png   binary\n';
    writeFileSync(join(root, '.gitattributes'), regionBelow(spec, local), 'utf8');

    const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    git(['init', '-q', '.']);
    // Assert the harm through git, not through our own parsing: `binary` is `-text`, and canon's
    // `*` placed after it flips that to `auto`, which is what hands the asset to EOL conversion.
    assert.match(git(['check-attr', 'text', '--', 'house.glb']), /text: auto/, 'precondition: git agrees this is broken');

    const { report } = apply(root, [spec], readLock(root, 'jrmoulckers/.github'), { write: false });
    const [file] = report.outranked;
    assert.ok(file, 'the engine must say so rather than leave a silent, permanent downgrade');
    assert.deepEqual(
      file.rules.map((rule) => rule.pattern).sort(),
      ['*.glb', '*.png'],
    );
    assert.deepEqual(file.rules[0].attributes, ['text']);
  });
});

test('comments above the region are not rules, so they are not reported', () => {
  withTmp((root) => {
    // One of two false positives a position check produces on the real fleet: `finance` has a
    // comment block above its region. Comments carry no precedence at all.
    const spec = attributesSpec();
    writeFileSync(join(root, '.gitattributes'), regionBelow(spec, '# why this tree is committed\n\n'), 'utf8');
    const { report } = apply(root, [spec], readLock(root, 'jrmoulckers/.github'), { write: false });
    assert.deepEqual(report.outranked, []);
  });
});

test('a rule canon resets to the value it already had loses nothing', () => {
  withTmp((root) => {
    // The other false positive: `docket`'s rule above the region is byte-identical to canon, so
    // the override is to the same value. Position says violation; precedence says no-op.
    const spec = attributesSpec();
    writeFileSync(join(root, '.gitattributes'), regionBelow(spec, '* text=auto eol=lf\n'), 'utf8');
    const { report } = apply(root, [spec], readLock(root, 'jrmoulckers/.github'), { write: false });
    assert.deepEqual(report.outranked, [], 'overriding a value to itself is not a loss');
  });
});

test('the branch that motivated the detector, byte for byte', () => {
  withTmp((root) => {
    // #254. The three tests above are hand-written shapes, and #216 is the case where a
    // mutation-proven suite still missed the member its own PR body named. This one is not a
    // shape: it is jrmoulckers/homelab's `.gitattributes` at `studio-sync/2026-08-10`, the ref
    // that motivated #202, committed verbatim.
    const real = readFileSync(join(FIXTURES, 'homelab-2026-08-10.gitattributes.txt'), 'utf8');

    // A fixture copied from a real artifact is only evidence while it is still that artifact.
    // Git's blob id is content-addressed, so this is checkable against the branch by anyone:
    //   gh api repos/jrmoulckers/homelab/contents/.gitattributes?ref=studio-sync/2026-08-10 --jq .sha
    const blob = createHash('sha1').update(`blob ${Buffer.byteLength(real)}\0`).update(real).digest('hex');
    assert.equal(blob, '2f2e28c7b3b93a0955ba5c1521358a17aa1f1dcb', 'fixture must still be homelab-s blob');

    writeFileSync(join(root, '.gitattributes'), real, 'utf8');
    const git = (args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' });
    git(['init', '-q', '.']);

    // Precondition, through git rather than our own parser: the model whose header looks
    // text-like is handed to EOL conversion, which is the corruption the member's rule prevents.
    assert.match(git(['check-attr', 'text', '--', 'house.glb']), /text: auto/);

    const { report } = apply(root, [attributesSpec()], readLock(root, 'jrmoulckers/.github'), { write: false });
    assert.equal(report.outranked.length, 1);
    const [file] = report.outranked;

    // Recall: every rule the region outranks, both kinds. `binary` is text UNSET and the six
    // explicit rules are text SET; canon's `*` flips both to `auto`, so both are real losses.
    assert.deepEqual(
      file.rules.map((rule) => rule.pattern),
      [
        '*.yml', '*.yaml', '*.conf', '*.xml', '*.sh', '*.md',
        '*.glb', '*.png', '*.jpg', '*.jpeg', '*.gif', '*.webp', '*.ico', '*.pdf',
        '*.zip', '*.gz', '*.tgz', '*.woff', '*.woff2', '*.ttf', '*.otf',
      ],
    );

    // Precision, and the reason this file beats three synthetic ones: homelab's own first rule is
    // `* text=auto eol=lf`, byte-identical to canon. The docket false positive is present INLINE,
    // alongside 21 genuine losses, so the fixture proves the detector separates them in one pass.
    assert.equal(
      file.rules.some((rule) => rule.pattern === '*'),
      false,
      "the member's own `* text=auto eol=lf` is overridden to the value it already had",
    );
  });
});

test('the prepended position the engine actually writes reports nothing', () => {
  withTmp((root) => {
    const spec = attributesSpec();
    writeFileSync(join(root, '.gitattributes'), '*.glb binary\n', 'utf8');
    const first = apply(root, [spec], readLock(root, 'jrmoulckers/.github'), { write: true });
    assert.deepEqual(first.report.outranked, [], 'canon is prepended, so nothing is outranked');

    const second = apply(root, [spec], readLock(root, 'jrmoulckers/.github'), { write: true });
    assert.deepEqual(second.report.outranked, [], 'and it stays quiet on re-run');
  });
});

test('canon Markdown carries no universal attribute rule, which is why append stays silent', () => {
  // AGENTS.md appends by design: position is cosmetic in Markdown and nothing resolves by it.
  // A Markdown target reports nothing today for a second reason too — canon's Markdown carries no
  // line that parses as a universal (`*`) attribute rule, so there is nothing to outrank with.
  // That makes the placement guard redundant *right now*, which is exactly why the invariant is
  // asserted rather than assumed: a canon line like `* text=auto eol=lf` in prose or a code block
  // would make the guard the only thing standing between a member's preamble and a false report.
  const [resolved] = resolveAll(manifest, ['jrmoulckers/jrm-recipes']);
  const { writes } = enumerateTargets(resolved, REPO_ROOT);

  for (const write of writes.filter((w) => w.type === 'managed')) {
    const markers = markersFor(write.targetPath);
    if (markers.placement !== 'append') continue;
    const universal = canonicalizeInner(write.content)
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.startsWith('* ') && /\s\S+=\S+/.test(line));
    assert.deepEqual(universal, [], `${write.targetPath} carries a line that parses as an attribute rule`);
  }

  withTmp((root) => {
    const base = writes.find((write) => write.kind === 'base');
    assert.ok(base, 'precondition: a managed Markdown target exists');
    writeFileSync(join(root, 'AGENTS.md'), '# Product preamble\n\n* text=auto eol=lf\n', 'utf8');
    const { report } = apply(root, [base], readLock(root, 'jrmoulckers/.github'), { write: true });
    assert.deepEqual(report.outranked, [], 'an appended target is never reported, whatever sits above it');
  });
});