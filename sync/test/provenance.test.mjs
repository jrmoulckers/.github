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
import { loadManifest } from '../lib/manifest.mjs';
import { resolveAll } from '../lib/resolve.mjs';
import { enumerateTargets } from '../lib/assets.mjs';
import { inject, toLF, PROVENANCE_NOTE } from '../lib/provenance.mjs';

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
