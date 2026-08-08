import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  validatePrincipleDocument,
  validateLegacyEvolution,
  validatePrinciples,
  validatePublishedEvolution,
  selectBaselineCommit,
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

  const ids = Object.values(MANIFEST.published).flat();
  assert.equal(ids.filter((id) => id.startsWith('GH-AIP-')).length, 8);
  assert.equal(ids.filter((id) => id.startsWith('GH-AIOPS-')).length, 15);
  assert.equal(ids.filter((id) => id.startsWith('GH-AIEVAL-')).length, 6);
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
      assert.match(error.message, /Status must appear exactly once/);
      assert.match(error.message, /missing Rationale/);
      assert.match(error.message, /Statement must start with an imperative verb/);
      assert.match(error.message, /Owner \/ ratification must use owner-only wording/);
      assert.match(error.message, /Cross-authority handoff must name a responsible authority/);
      assert.match(error.message, /unresolved legacy reference "ai-products\.md §999"/);
      assert.match(error.message, /malformed principle heading/);
      assert.match(error.message, /unpublished\.md: principle file is not pinned/);
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
    validate(
      original.replace(
        '- **Status:** Draft',
        '- **Status:** Draft\n - **Status:** Ratified',
      ),
    ).some((error) => error.includes('Status must appear exactly once')),
  );
  assert.ok(
    validate(`${original}\n## GH-AIP-009 - Bypassed principle\n`).some((error) =>
      error.includes('malformed principle heading'),
    ),
  );
  assert.ok(
    validate(`${original}\n ## GH-AIP-009 — Indented bypass\n`).some((error) =>
      error.includes('malformed principle heading'),
    ),
  );
  assert.ok(
    validate(
      original.replace(
        '- **Legacy inputs:** `ai-products.md §1`, `ai-products.md §1.1`',
        '- **Legacy inputs:** `ai-products.md §1` plus undocumented prose',
      ),
    ).some((error) => error.includes('must be exact backticked references or none')),
  );
  assert.ok(
    validate(
      original.replace(
        '`ai-products.md §1`',
        '`ai-products section one`',
      ),
    ).some((error) => error.includes('malformed legacy reference')),
  );
});

test('published IDs cannot be deleted, renumbered, or removed from the manifest', () => {
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

  const removedFile = structuredClone(MANIFEST);
  delete removedFile.published['principles/ai/product-ai.md'];
  assert.match(
    validatePublishedEvolution(removedFile, MANIFEST).join('\n'),
    /published principle file cannot be removed/,
  );
});

test('joint document and manifest mutations fail against the fixed bootstrap baseline', () => {
  const relativePath = 'principles/ai/product-ai.md';
  const mutated = structuredClone(MANIFEST);
  mutated.published[relativePath].shift();
  const document = readFileSync(join(REPO_ROOT, relativePath), 'utf8').replace(
    /\n## GH-AIP-001 —[\s\S]*?(?=\n## GH-AIP-002 —)/,
    '',
  );

  assert.throws(
    () =>
      validatePrinciples({
        baselineManifest: null,
        readText: corpusReader(mutated, { [relativePath]: document }),
      }),
    /published IDs are append-only/,
  );
});

test('push and pull-request baselines never select the current push revision', () => {
  const eventBase = 'a'.repeat(40);
  const head = 'b'.repeat(40);
  const previous = 'c'.repeat(40);

  assert.equal(
    selectBaselineCommit({
      explicit: eventBase,
      mergeBase: head,
      head,
      previous,
    }),
    eventBase,
  );
  assert.equal(
    selectBaselineCommit({
      mergeBase: head,
      head,
      previous,
    }),
    previous,
  );
  assert.throws(
    () =>
      selectBaselineCommit({
        explicit: 'main',
        mergeBase: head,
        head,
        previous,
      }),
    /PRINCIPLES_BASE_SHA must be a nonzero commit SHA/,
  );

  const workflow = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');
  assert.match(workflow, /github\.event\.pull_request\.base\.sha \|\| github\.event\.before/);
});

test('manifest schema rejection paths fail with specific diagnostics', () => {
  const cases = [
    [
      'schema version',
      (manifest) => {
        manifest.schemaVersion = 2;
      },
      /schemaVersion must be 1/,
    ],
    [
      'bootstrap base',
      (manifest) => {
        manifest.history.bootstrapBaseCommit = 'main';
      },
      /history\.bootstrapBaseCommit must remain 7f5214741cb4b26a8df92c7a3e4abb10308dc94f/,
    ],
    [
      'empty published set',
      (manifest) => {
        manifest.published = {};
      },
      /published must pin at least one principle file/,
    ],
    [
      'missing source field',
      (manifest) => {
        delete manifest.legacySources['ai-products.md'].blobSha;
      },
      /legacy source must define repository, ref, path, blobSha, and sections/,
    ],
    [
      'duplicate source section',
      (manifest) => {
        manifest.legacySources['ai-products.md'].sections.push('1');
      },
      /legacy source sections must be unique/,
    ],
    [
      'invalid source ref',
      (manifest) => {
        manifest.legacySources['ai-products.md'].ref = 'main';
      },
      /legacy source ref must be a nonzero 40-character commit SHA/,
    ],
    [
      'zero source digest',
      (manifest) => {
        manifest.legacySources['ai-products.md'].blobSha = '0'.repeat(40);
      },
      /legacy source blobSha must be a nonzero Git blob digest/,
    ],
    [
      'non-array migrations',
      (manifest) => {
        manifest.legacyMigrations = {};
      },
      /legacyMigrations must be an array/,
    ],
    [
      'incomplete migration evidence',
      (manifest) => {
        manifest.legacyMigrations = [{ source: 'ai-products.md' }];
      },
      /must define source, exact from\/to, reason, and \.github reviewEvidence/,
    ],
  ];

  for (const [name, mutate, expected] of cases) {
    const manifest = structuredClone(MANIFEST);
    mutate(manifest);
    assert.throws(
      () =>
        validatePrinciples({
          baselineManifest: MANIFEST,
          readText: corpusReader(manifest),
        }),
      expected,
      name,
    );
  }
});

test('published documents must remain readable', () => {
  const reader = corpusReader(MANIFEST);
  assert.throws(
    () =>
      validatePrinciples({
        baselineManifest: MANIFEST,
        readText: (path) => {
          if (path.endsWith(join('principles', 'ai', 'product-ai.md'))) {
            throw new Error('fixture read failure');
          }
          return reader(path);
        },
      }),
    /cannot read published principle file \(fixture read failure\)/,
  );
});

test('legacy pin changes require exact, reviewable migration evidence', () => {
  const current = structuredClone(MANIFEST);
  const before = structuredClone(MANIFEST.legacySources['ai-products.md']);
  const after = {
    ...before,
    ref: 'a'.repeat(40),
    blobSha: 'b'.repeat(40),
  };
  current.legacySources['ai-products.md'] = after;

  assert.match(
    validateLegacyEvolution(current, MANIFEST).join('\n'),
    /require a connected legacyMigrations chain with review evidence/,
  );

  current.legacyMigrations.push({
    source: 'ai-products.md',
    from: before,
    to: after,
    reason: 'Move the accepted legacy snapshot through a reviewed migration.',
    reviewEvidence: 'https://github.com/jrmoulckers/.github/issues/90',
  });
  assert.deepEqual(validateLegacyEvolution(current, MANIFEST), []);

  const baselineWithMigration = structuredClone(current);
  const historyRemoved = structuredClone(current);
  historyRemoved.legacyMigrations = [];
  assert.match(
    validateLegacyEvolution(historyRemoved, baselineWithMigration).join('\n'),
    /legacyMigrations history is append-only/,
  );

  const migrationBack = {
    source: 'ai-products.md',
    from: after,
    to: before,
    reason: 'Restore the earlier reviewed source.',
    reviewEvidence: 'https://github.com/jrmoulckers/.github/issues/90',
  };
  const cycledBaseline = structuredClone(MANIFEST);
  cycledBaseline.legacySources['ai-products.md'] = before;
  cycledBaseline.legacyMigrations = [
    ...current.legacyMigrations,
    migrationBack,
  ];
  const repeatedTransition = structuredClone(cycledBaseline);
  repeatedTransition.legacySources['ai-products.md'] = after;
  assert.match(
    validateLegacyEvolution(repeatedTransition, cycledBaseline).join('\n'),
    /require a connected legacyMigrations chain with review evidence/,
  );

  const fabricated = structuredClone(MANIFEST);
  fabricated.legacyMigrations.push({
    source: 'ai-products.md',
    from: null,
    to: null,
    reason: 'This record is intentionally disconnected.',
    reviewEvidence: 'https://github.com/jrmoulckers/.github/issues/90',
  });
  assert.match(
    validateLegacyEvolution(fabricated, MANIFEST).join('\n'),
    /appended migration does not change the legacy source/,
  );
});

test('bootstrap legacy pins cannot change with the manifest alone', () => {
  const mutated = structuredClone(MANIFEST);
  mutated.legacySources['ai-products.md'] = {
    ...mutated.legacySources['ai-products.md'],
    ref: 'a'.repeat(40),
    blobSha: 'b'.repeat(40),
  };

  assert.throws(
    () =>
      validatePrinciples({
        baselineManifest: null,
        readText: corpusReader(mutated),
      }),
    /legacy source changes require a connected legacyMigrations chain with review evidence/,
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
  assert.match(
    verifyLegacySources(manifest, () => {
      throw new Error('source unavailable');
    }).join('\n'),
    /cannot resolve pinned legacy source \(source unavailable\)/,
  );
});

function corpusReader(manifest, overrides = {}) {
  return (path) => {
    if (path.endsWith(join('principles', 'manifest.json'))) {
      return JSON.stringify(manifest);
    }
    const relativePath = path.slice(REPO_ROOT.length + 1).replaceAll('\\', '/');
    return overrides[relativePath] ?? readFileSync(path, 'utf8');
  };
}
