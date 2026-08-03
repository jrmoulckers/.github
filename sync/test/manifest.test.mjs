// The real studio.config.json must validate, and the registry must contain every member.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { loadManifest, KINDS, validateManifest } from '../lib/manifest.mjs';
import { resolveAll } from '../lib/resolve.mjs';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const manifest = loadManifest(REPO_ROOT);

test('studio.config.json validates', () => {
  assert.doesNotThrow(() => validateManifest(manifest));
});

test('every studio member is registered', () => {
  const repos = manifest.members.map((m) => m.repo);
  assert.deepEqual(repos, [
    'jrmoulckers/jrm-recipes',
    'jrmoulckers/score-king',
    'jrmoulckers/finance',
    'jrmoulckers/libro',
    'jrmoulckers/cartridge',
  ]);
});

test('libro and cartridge use the root-default vendored tokens path', () => {
  for (const repo of ['jrmoulckers/libro', 'jrmoulckers/cartridge']) {
    const [resolved] = resolveAll(manifest, [repo]);
    assert.equal(resolved.tokens?.enabled, true, `${repo} opts into tokens`);
    assert.equal(resolved.tokens.targetBase, manifest.tokens.targetPath, `${repo} uses the default path`);
  }
});

test('finance keeps its custom tokens path and AI-layer opt-outs', () => {
  const [finance] = resolveAll(manifest, ['jrmoulckers/finance']);
  assert.equal(finance.tokens.targetBase, 'apps/web/vendor/@jrm/tokens');
  const kinds = finance.groups.map((g) => g.kind);
  for (const kind of ['agents', 'skills', 'prompts', 'instructions']) {
    assert.ok(!kinds.includes(kind), `finance must stay opted out of ${kind}`);
  }
});

test('tokens and profile are not optIn kinds', () => {
  assert.ok(!KINDS.includes('tokens'));
  assert.ok(!KINDS.includes('profile'));
  assert.throws(
    () =>
      validateManifest({
        ...manifest,
        members: [{ repo: 'a/b', optIn: { profile: true } }],
      }),
    /optIn\.profile is not a known kind/,
  );
});
