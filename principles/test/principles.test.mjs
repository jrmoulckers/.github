import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validatePrincipleDocument,
  validatePrinciples,
  validatePublishedEvolution,
  verifyLegacySources,
} from '../validate.mjs';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const MANIFEST = JSON.parse(
  readFileSync(join(REPO_ROOT, 'principles', 'manifest.json'), 'utf8'),
);

test('the published principle corpus passes metadata and reference validation', () => {
  const result = validatePrinciples();

  assert.equal(result.fileCount, 5);
  assert.equal(result.principleCount, 43);
});

test('persistent negative fixtures fail closed with actionable diagnostics', () => {
  const fixtureRoot = join(REPO_ROOT, 'principles', 'test', 'fixtures', 'invalid');

  assert.throws(
    () =>
      validatePrinciples({
        repoRoot: fixtureRoot,
        manifestPath: join(fixtureRoot, 'manifest.json'),
      }),
    (error) => {
      assert.match(error.message, /published IDs must be \[GH-AIP-001, GH-AIP-002\]/);
      assert.match(error.message, /duplicate principle ID GH-AIP-002/);
      assert.match(error.message, /Status must be Draft/);
      assert.match(error.message, /missing Rationale/);
      assert.match(error.message, /Statement must start with an imperative verb/);
      assert.match(error.message, /Owner \/ ratification must use owner-only wording/);
      assert.match(error.message, /Cross-authority handoff must name a responsible authority/);
      assert.match(error.message, /unresolved legacy reference "ai-products\.md §999"/);
      assert.match(error.message, /malformed principle heading/);
      return true;
    },
  );
});

test('ID, legacy-reference, and ratification mutations are detected', () => {
  const relativePath = 'principles/ai/product-ai.md';
  const original = readFileSync(join(REPO_ROOT, relativePath), 'utf8');
  const validate = (text) =>
    validatePrincipleDocument({
      relativePath,
      text,
      expectedIds: MANIFEST.published[relativePath],
      legacySources: MANIFEST.legacySources,
    }).errors;

  assert.deepEqual(validate(original), []);
  assert.ok(
    validate(original.replace('GH-AIP-001', 'GH-AIP-099')).some((error) =>
      error.includes('published IDs must be'),
    ),
  );
  assert.ok(
    validate(original.replace('`ai-products.md §1`', '`ai-products.md §999`')).some((error) =>
      error.includes('unresolved legacy reference'),
    ),
  );
  assert.ok(
    validate(original.replace('owner ratifies it', 'agent ratifies it')).some((error) =>
      error.includes('owner-only wording'),
    ),
  );
  assert.ok(
    validate(`${original}\n## GH-AIP-009 - Bypassed principle\n`).some((error) =>
      error.includes('malformed principle heading'),
    ),
  );
});

test('joint document and manifest mutations cannot delete or renumber published IDs', () => {
  const deleted = structuredClone(MANIFEST);
  deleted.published['principles/ai/product-ai.md'].shift();
  assert.match(
    validatePublishedEvolution(deleted, MANIFEST).join('\n'),
    /published IDs are append-only/,
  );

  const renumbered = structuredClone(MANIFEST);
  renumbered.published['principles/ai/product-ai.md'][0] = 'GH-AIP-099';
  assert.match(
    validatePublishedEvolution(renumbered, MANIFEST).join('\n'),
    /published IDs are append-only/,
  );
});

test('legacy source catalogs require immutable nonzero content digests', () => {
  const mutated = structuredClone(MANIFEST);
  mutated.legacySources['ai-products.md'].blobSha = '0'.repeat(40);

  assert.throws(
    () => validatePrinciples({ baselineManifest: MANIFEST, readText: catalogReader(mutated) }),
    /legacy source blobSha must be a nonzero Git blob digest/,
  );
});

test('live legacy resolution checks blob identity and exact section headings', () => {
  const manifest = {
    legacySources: {
      'example.md': {
        repository: 'owner/repo',
        ref: '1'.repeat(40),
        path: 'principles/example.md',
        blobSha: '2'.repeat(40),
        sections: ['1', '1.1'],
      },
    },
  };
  const content = Buffer.from('### 1. First\n\n#### 1.1 Nested\n').toString('base64');

  assert.deepEqual(
    verifyLegacySources(manifest, () => ({ sha: '2'.repeat(40), content })),
    [],
  );
  assert.match(
    verifyLegacySources(manifest, () => ({
      sha: '3'.repeat(40),
      content: Buffer.from('### 1. First\n').toString('base64'),
    })).join('\n'),
    /blob mismatch.*no section 1\.1/s,
  );
});

function catalogReader(manifest) {
  return (path) =>
    path.endsWith('principles\\manifest.json') || path.endsWith('principles/manifest.json')
      ? JSON.stringify(manifest)
      : readFileSync(path, 'utf8');
}
