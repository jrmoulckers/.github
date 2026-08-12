// The expected on-disk value for a synced file is `inject(targetPath, canon)` — canon plus its
// provenance header, LF-normalized — not canon itself. `assets.mjs` applies that transform when it
// builds each spec, so `copier.mjs` only ever compares against rendered content.
//
// This matters beyond the engine. Anyone hand-auditing a member will reach for `diff` against the
// backbone's canon file, and that method reports the provenance header as a member-side addition on
// every correctly-synced file in every member. It is a per-file false positive, small and consistent
// enough to read as a real finding. It nearly produced a wrong call on cartridge's
// workflow.instructions.md, where a raw-canon diff said "68 lines missing, 1 line added" — the 68
// were a genuinely stale copy and the 1 was the engine's own stamp. Only the size gap kept the
// conclusion sound; a file stale by a single line would have been indistinguishable from the noise.
//
// These tests pin the transform so the documented audit procedure stays true.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest, MANAGED_MERGE_TARGETS } from '../lib/manifest.mjs';
import { resolveAll } from '../lib/resolve.mjs';
import { enumerateTargets } from '../lib/assets.mjs';
import { inject, toLF, PROVENANCE_NOTE, hasFrontmatter } from '../lib/provenance.mjs';
import { buildFile, canonicalizeInner, extractBlock, markersFor } from '../lib/basemerge.mjs';
import { commentSyntaxFor, CLASSIFIED_TYPES } from '../lib/comment-syntax.mjs';
import { hashText } from '../lib/lock.mjs';

const ROOT = fileURLToPath(new URL('../..', import.meta.url));
const manifest = loadManifest(ROOT);

function realWrites() {
  const [libro] = resolveAll(manifest, ['jrmoulckers/libro']);
  return enumerateTargets(libro, ROOT).writes;
}

test('every synced file is canon plus its provenance header, never canon verbatim', () => {
  const writes = realWrites().filter((w) => w.type === 'file');
  assert.ok(writes.length > 0, 'the manifest must produce real file writes to test against');

  for (const w of writes) {
    const raw = readFileSync(join(ROOT, ...w.sourcePath.split('/')), 'utf8');
    assert.equal(
      w.content,
      inject(w.targetPath, raw),
      `${w.targetPath}: written content must equal inject(targetPath, canon)`,
    );
    assert.notEqual(
      w.content,
      toLF(raw),
      `${w.targetPath}: writing canon verbatim would mean a hand audit against canon is valid — ` +
        'it is not, and the docs say so',
    );
    assert.ok(
      w.content.includes(PROVENANCE_NOTE),
      `${w.targetPath}: must carry the provenance note`,
    );
  }
});

// The audit check documented in sync/README.md is `inject(target, canon) === toLF(memberFile)`.
// `toLF` on the member side is load-bearing: a CRLF checkout differs from the rendered output byte
// for byte while being identical as far as the engine is concerned, since hashes are computed on
// LF-normalized content. Comparing raw bytes across a Windows checkout disagrees with the engine.
test('the documented audit check is line-ending agnostic on the member side', () => {
  const [w] = realWrites().filter((w) => w.type === 'file');
  const raw = readFileSync(join(ROOT, ...w.sourcePath.split('/')), 'utf8');
  const rendered = inject(w.targetPath, raw);
  const asCheckedOutOnWindows = rendered.replace(/\n/g, '\r\n');

  assert.notEqual(asCheckedOutOnWindows, rendered, 'the CRLF form really is different bytes');
  assert.equal(toLF(asCheckedOutOnWindows), rendered, 'toLF reconciles it — hence the docs');
});

// The provenance header's comment syntax is chosen by file type, and the fallback is HTML. That is
// correct for Markdown and silently catastrophic for anything with a real grammar: an unclassified
// source extension gets `<!-- … -->` prepended and stops compiling. Nothing in the engine would
// notice, because the file is still written, still hashed, and still drift-free — it just does not
// build in the member repo, which is where the failure surfaces.
//
// The concrete case: `@jrm/tokens` grew a native distribution (`native/compose/JrmTokens.kt`,
// `native/swift/JRMTokens.swift`) that is vendored into multi-platform members alongside the web
// artifacts. Neither extension was classified, so both were written as broken files. The `dist/`
// contract table in docs/sync.md described a web-only distribution, which is why the gap was not
// obvious from the docs either.
test('every vendored @jrm/tokens file type gets a header its own compiler accepts', () => {
  const cases = [
    ['native/compose/JrmTokens.kt', 'block'],
    ['native/swift/JRMTokens.swift', 'block'],
    ['css/default/tokens.css', 'block'],
    ['js/default/tokens.high-contrast-dark.js', 'block'],
    ['js/default/tokens.high-contrast-dark.d.ts', 'block'],
    ['tailwind/default.cjs', 'block'],
    ['js/default/tokens.js.map', 'none'],
    ['tokens.json', 'none'],
  ];

  for (const [path, expected] of cases) {
    const out = inject(path, 'CONTENT\n', { note: 'vendored' });
    assert.ok(!out.startsWith('<!--'), `${path}: an HTML comment here is not a comment`);

    if (expected === 'none') {
      assert.equal(out, 'CONTENT\n', `${path}: uncommentable types pass through unchanged`);
    } else {
      assert.equal(out, '/* vendored */\nCONTENT\n', `${path}: needs a block comment`);
    }
  }
});

// The hand-audit recipe above is a *whole-file* comparison, and the managed-merge targets are not
// whole-file copies. A member legitimately keeps content outside the markers, so `rendered ===
// member` is false for every correctly-synced managed target — the recipe reports drift on a healthy
// file, which is the exact false-positive class that section exists to prevent.
//
// This pins both halves of the documented fix: the whole-file form genuinely fails, and the region
// form genuinely succeeds, against a realistic member file carrying local content on both sides of
// the block. Asserting the failure matters as much as the success: if a future change made the
// whole-file comparison start passing, the doc's premise would be wrong and nothing else would say
// so.
test('the managed-target audit compares the region, not the whole file', () => {
  const managed = realWrites().filter((w) => w.type === 'managed');
  assert.ok(managed.length > 0, 'the manifest must produce managed writes to test against');

  for (const w of managed) {
    const markers = markersFor(w.targetPath);
    const canonInner = canonicalizeInner(w.content);

    const memberFile = buildFile(
      `LOCAL PREAMBLE for ${w.targetPath}\n`,
      canonInner,
      markers,
    );

    assert.notEqual(
      memberFile,
      w.content,
      `${w.targetPath}: a correctly-synced managed file is NOT equal to the rendered canon — ` +
        'the whole-file recipe would report drift here',
    );
    assert.equal(
      extractBlock(memberFile, markers),
      canonInner,
      `${w.targetPath}: the documented region comparison must succeed on a healthy file`,
    );
    assert.ok(
      memberFile.includes('LOCAL PREAMBLE'),
      `${w.targetPath}: member content outside the markers must survive`,
    );
    assert.ok(
      canonInner.includes(PROVENANCE_NOTE),
      `${w.targetPath}: the provenance note lives INSIDE the markers for managed targets, ` +
        'so a region rebuilt with the header outside it will not match',
    );
  }
});

// The managed-target recipe in sync/README.md deliberately omits the `toLF` the whole-file recipe
// requires, because `extractBlock` normalizes its own input. That asymmetry between two adjacent
// documented recipes looks like an oversight and invites someone to "fix" it in either direction —
// by adding a redundant toLF, or by dropping the normalization inside extractBlock. Pin it.
//
// Worth recording how this test came to exist: it was written to prove the opposite. The docstring
// on the *internal* findBlock says "already-LF-normalized text", and reading that as a constraint on
// the *exported* extractBlock is the wrong-unit error one level down — a property of the helper
// inferred onto its caller. The test failed, which is how the docs got the correct claim.
test('extractBlock is line-ending agnostic by construction, so the region recipe needs no toLF', () => {
  const [w] = realWrites().filter((w) => w.type === 'managed');
  const markers = markersFor(w.targetPath);
  const expected = canonicalizeInner(w.content);
  const memberFile = buildFile('LOCAL\n', expected, markers);
  const asCheckedOutOnWindows = memberFile.replace(/\n/g, '\r\n');

  assert.notEqual(asCheckedOutOnWindows, memberFile, 'the CRLF form really is different bytes');
  assert.equal(
    extractBlock(asCheckedOutOnWindows, markers),
    expected,
    'a CRLF checkout must compare equal without the caller normalizing first',
  );
});

// A hand-maintained list of managed targets beside a code path that already enumerates them is the
// same duplication problem the sync engine exists to remove. Canon's prose named two of these files
// for a while after a third was added, and nothing caught it, because no check keyed on the prose.
test('the documented managed-target list matches the engine', () => {
  assert.deepEqual(
    [...MANAGED_MERGE_TARGETS.values()].sort(),
    ['.gitattributes', '.github/copilot-instructions.md', 'AGENTS.md'],
    'update sync/README.md and docs/sync.md in the same PR as any change here',
  );
});


// `hasFrontmatter` gates the branch that splices the stamp, so the two must recognize a delimiter
// by the SAME predicate. They did not: the guard required `---` at column 0 while the splice loop
// used `.trim() === '---'`, which also accepts an indented one. A markdown horizontal rule inside a
// YAML block scalar is ordinary in a long `description:`, and it made the loop stop early and inject
// the stamp INSIDE the frontmatter -- still valid YAML, so nothing errored, and the stamp silently
// became part of a value instead of provenance.
test('an indented --- inside a block scalar is not the frontmatter delimiter', () => {
  const src = [
    '---',
    'description: |',
    '  A rule, then a horizontal rule:',
    '  ---',
    '  and more text after it.',
    'name: example',
    '---',
    '',
    '# Body',
  ].join('\n');

  assert.equal(hasFrontmatter(src), true);
  const lines = inject('agents/example.agent.md', src).split('\n');
  const stamp = lines.findIndex((l) => l.includes('<!--'));

  assert.equal(lines[3], '  ---', 'the indented rule stays inside the block scalar');
  assert.equal(lines[stamp - 1], '---', 'the stamp follows the real closing delimiter');
  assert.equal(stamp, 7, 'the stamp lands after the frontmatter, not inside it');
});

// The narrow fix -- strict `=== '---'` -- would have regressed this case into the fallback, which
// prepends the comment BEFORE line 1 and destroys the frontmatter entirely. The guard accepts a
// delimiter with trailing spaces or tabs, so the splice must accept exactly the same set.
test('a closing delimiter with trailing whitespace is still the delimiter', () => {
  const src = ['---', 'name: example', '---   ', '', '# Body'].join('\n');

  assert.equal(hasFrontmatter(src), true);
  const lines = inject('agents/example.agent.md', src).split('\n');

  assert.equal(lines[0], '---', 'frontmatter still opens at line 1');
  assert.equal(lines[3], '<!-- ' + PROVENANCE_NOTE + ' -->', 'the stamp follows the delimiter');
});

// The lock's rendered hash is taken over the engine's OWN output, so it detects a member drifting
// from what the engine produced and CANNOT detect the engine producing the wrong thing. That makes it
// a real residual assertion against tampering and an empty one against incorrectness -- the
// distinction that decides whether an exemption skipping some other check alongside it is inert or a
// trapdoor. Asserted structurally, against the source, because the property is an ordering between
// two functions rather than a value any single call returns: a behavioural test would have to compare
// a rendering against itself, which is a tautology that passes whatever the engine does.
test('the lock hash is derived from engine output, so it cannot witness an engine defect', () => {
  const assets = readFileSync(join(ROOT, 'sync', 'lib', 'assets.mjs'), 'utf8');
  const copier = readFileSync(join(ROOT, 'sync', 'lib', 'copier.mjs'), 'utf8');

  assert.match(
    assets,
    /content:\s*inject\(targetPath,\s*raw\)/,
    'assets.mjs must render target content through inject() for this property to hold',
  );
  assert.match(
    copier,
    /const\s+renderedHash\s*=\s*hashText\(rendered\)/,
    'copier.mjs must hash the rendered (post-inject) content into the lock entry',
  );
  assert.match(
    copier,
    /const\s+rendered\s*=\s*spec\.content/,
    'the hashed value must be the same rendering that is written to the member',
  );

  // If any of the three moves, the reasoning above is stale and the exemptions justified by
  // "the hash still asserts" need re-deriving rather than inheriting.
});

// A member-side checker that enumerates the files to verify FROM its own lockfile can only detect
// corruption of what the lock declares, never omission from it: a canon-managed path present in the
// tree but absent from the lock is never enumerated, so the check reports green on it forever. A
// `count > 0` guard does not help -- the population is non-empty, just not complete, and no count
// distinguishes those. Completeness requires enumerating from a source independent of the artifact
// under test. The engine gets this right by construction, and this pins that it keeps doing so.
test('the plan is enumerated from canon, so it does not inherit a lockfile omission', () => {
  const writes = realWrites();
  assert.ok(writes.length > 0, 'no planned writes discovered — this check would assert nothing');

  // enumerateTargets receives the resolved member and the backbone root. It is never handed the
  // member's lock, so no omission from a lock can shrink the planned population.
  const assets = readFileSync(join(ROOT, 'sync', 'lib', 'assets.mjs'), 'utf8');
  assert.doesNotMatch(
    assets,
    /\breadLock\b|\bLOCK_FILENAME\b|\.studio-sync\.lock\.json/,
    'assets.mjs must not consult the lockfile when building the population to sync',
  );

  // The lock is a baseline store, consulted per already-enumerated target, never an index of what
  // to look at. copier.mjs may read entries; it must do so keyed by a planned spec.
  const copier = readFileSync(join(ROOT, 'sync', 'lib', 'copier.mjs'), 'utf8');
  assert.match(
    copier,
    /entries\[spec\.targetPath\]/,
    'the lock must be indexed by planned target, not iterated as the population',
  );
});

// --- One classifier, two consumers (issue #377) -------------------------------------------

// A classified type is either a whole basename (`.gitattributes`) or a suffix (`.toml`). Build
// whichever path form actually resolves, so the test exercises the real lookup rather than
// silently skipping the basenames.
function pathFor(type) {
  for (const candidate of [`x/${type}`, `x/name${type}`]) {
    try {
      commentSyntaxFor(candidate);
      return candidate;
    } catch {
      /* try the other form */
    }
  }
  throw new Error(`${type} is exported as classified but resolves in neither path form`);
}

test('the marker syntax and the header syntax are the same classification, not two tables', () => {
  const paths = CLASSIFIED_TYPES.map(pathFor);
  const hashLike = paths.filter((p) => commentSyntaxFor(p) === 'hash');
  const htmlLike = paths.filter((p) => commentSyntaxFor(p) === 'html');
  assert.ok(hashLike.length > 0 && htmlLike.length > 0, 'no types classified: asserts nothing');

  // The defect: basemerge claimed hash markers for eight types provenance stamped with HTML.
  // Neither call may be allowed to answer for a family the other disagrees with.
  for (const path of hashLike) {
    assert.equal(markersFor(path).start.startsWith('#'), true, `${path}: marker syntax is not hash`);
    assert.equal(
      inject(path, 'body\n').startsWith('# '),
      true,
      `${path}: basemerge writes hash markers but the stamper does not write a hash comment`,
    );
  }
  for (const path of htmlLike) {
    assert.equal(
      markersFor(path).start.startsWith('<!--'),
      true,
      `${path}: marker syntax is not html`,
    );
    assert.equal(
      inject(path, 'body\n').includes('<!--'),
      true,
      `${path}: basemerge writes HTML markers but the stamper does not write an HTML comment`,
    );
  }
});

test('an unclassified type is refused by the stamper rather than given HTML', () => {
  // The fallback made this an open population: any extension nobody had classified was stamped
  // `<!-- … -->`, which is not a comment in a file with a real grammar. The obligation to
  // classify was stated in prose and bound a different repo than the one that could check it.
  for (const path of ['native/app.gradle', 'ios/Tokens.xcconfig', 'pkg/Tokens.podspec']) {
    assert.throws(
      () => inject(path, 'body\n'),
      /unknown comment syntax/,
      `${path}: stamped instead of refused`,
    );
  }
  // A file that cannot carry any comment is classified, not unknown: it ships unstamped.
  assert.equal(inject('dist/map.json', '{}\n'), '{}\n');
});

test('every file the engine plans to write is classified, so the throw is unreachable today', () => {
  const members = resolveAll(loadManifest(ROOT));
  let checked = 0;
  for (const member of members) {
    for (const spec of enumerateTargets(member, ROOT).writes) {
      if (spec.type !== 'file') continue;
      assert.doesNotThrow(
        () => commentSyntaxFor(spec.targetPath),
        `${spec.targetPath} is planned for write but has no comment syntax`,
      );
      checked += 1;
    }
  }
  assert.ok(checked > 0, 'no planned writes inspected: this test would assert nothing');
});

test('the stamp is invertible per family, which is the only audit a token member can run', () => {
  // `sourceSha256` hashes pre-render bytes. The documented recipe renders canon forward and
  // compares -- unavailable for vendored @jrm/tokens, whose source repo is private, so a member
  // holding only the delivered file must strip the stamp and hash. That inverse is a contract:
  // reordering the blank line after an HTML stamp, or stamping the `none` family, breaks every
  // member-side audit of `sourceSha256` while the forward tests stay green.
  const raw = 'first body line\nsecond body line\n';

  // Strip counts are literals; the family comes from the engine. Deriving both from
  // `commentSyntaxFor` would check the table against itself.
  for (const [path, family, drop] of [
    ['vendor/@jrm/tokens/css/default/tokens.css', 'block', 1],
    ['agency.toml', 'hash', 1],
    ['.gitattributes', 'hash', 1],
    ['docs/guide.md', 'html', 2],
    ['vendor/@jrm/tokens/js/index.js.map', 'none', 0],
  ]) {
    assert.equal(commentSyntaxFor(path), family, `${path}: family moved`);
    const rendered = inject(path, raw);
    const stripped = rendered.split('\n').slice(drop).join('\n');
    assert.equal(stripped, toLF(raw), `${path}: inverse of ${drop} line(s) does not recover raw`);
    assert.equal(hashText(stripped), hashText(raw), `${path}: recovered bytes do not rehash`);
  }

  // Frontmatter is the exception, and it is an exception *within* the html family rather than a
  // rule of its own: the stamp splices in after the closing delimiter, so no leading strip
  // recovers the source. A member inferring "frontmatter decides" from samples gets this backwards.
  const fm = '---\ntitle: t\n---\nbody\n';
  assert.ok(hasFrontmatter(fm));
  const renderedFm = inject('docs/guide.md', fm);
  for (const drop of [0, 1, 2]) {
    assert.notEqual(renderedFm.split('\n').slice(drop).join('\n'), toLF(fm));
  }
});
