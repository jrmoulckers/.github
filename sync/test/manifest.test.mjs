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

// The onboarding PR these facts originally came from (jrmoulckers/cartridge#1) was closed
// without merging; the values below were re-verified against jrmoulckers/cartridge@main.
test('cartridge is a Svelte/npm repo that does not call reusable-ci-lint', () => {
  const [cartridge] = resolveAll(manifest, ['jrmoulckers/cartridge']);
  assert.equal(cartridge.framework, 'svelte');
  assert.equal(cartridge.packageManager, 'npm');

  const workflows = cartridge.groups.find((g) => g.kind === 'workflows');
  assert.ok(
    !workflows.names.includes('reusable-ci-lint'),
    'cartridge has no ESLint/Prettier and deliberately skips reusable-ci-lint',
  );
  assert.deepEqual(workflows.names, [
    'reusable-ci-web',
    'reusable-deploy-preview',
    'reusable-perf-budget',
  ]);
});

test('libro is a Svelte/pnpm repo that does call reusable-ci-lint', () => {
  const [libro] = resolveAll(manifest, ['jrmoulckers/libro']);
  assert.equal(libro.framework, 'svelte');
  assert.equal(libro.packageManager, 'pnpm');
  const workflows = libro.groups.find((g) => g.kind === 'workflows');
  assert.ok(workflows.names.includes('reusable-ci-lint'), 'libro has eslint + prettier');
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
