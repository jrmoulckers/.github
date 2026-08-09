import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateInstructionIntegrity } from '../lib/instruction-integrity.mjs';
import { loadManifest } from '../lib/manifest.mjs';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

test('canonical instruction scopes, ownership, precedence, and member profiles pass', () => {
  const manifest = loadManifest(REPO_ROOT);
  const records = validateInstructionIntegrity(REPO_ROOT, manifest);

  assert.deepEqual(
    records.map((record) => record.name),
    [...manifest.canon.instructions].sort(),
  );
  assert.equal(
    records.find((record) => record.name === 'docs').applyTo,
    'docs/**,*.md,**/README.md',
  );
  assert.equal(
    records.find((record) => record.name === 'skills').applyTo,
    'skills/**,.github/skills/**',
  );
});

test('workflow and documentation surfaces use immutable reusable workflow examples', () => {
  for (const relativePath of [
    'README.md',
    'principles/github/actions-and-delivery.md',
    'docs/sync.md',
    'sync/README.md',
    'sync/lib/pr.mjs',
    'instructions/workflow.instructions.md',
  ]) {
    const text = readFileSync(join(REPO_ROOT, ...relativePath.split('/')), 'utf8');
    assert.doesNotMatch(
      text,
      /uses:\s*jrmoulckers\/\.github\/\.github\/workflows\/[^\s`'"]+@(?!<reviewed-commit-sha>|[0-9a-f]{40}(?:\s|$))/i,
      relativePath,
    );
  }
  for (const fileName of readdirSync(join(REPO_ROOT, '.github', 'workflows')).filter((name) =>
    /^reusable-.*\.yml$/.test(name),
  )) {
    const relativePath = `.github/workflows/${fileName}`;
    const text = readFileSync(join(REPO_ROOT, '.github', 'workflows', fileName), 'utf8');
    assert.doesNotMatch(
      text,
      /uses:\s*jrmoulckers\/\.github\/\.github\/workflows\/[^\s`'"]+@(?!<reviewed-commit-sha>|[0-9a-f]{40}(?:\s|$))/i,
      relativePath,
    );
  }
});

test('all declared local agents remain disjoint from selected canon', () => {
  const manifest = loadManifest(REPO_ROOT);
  for (const member of manifest.members) {
    const selected =
      member.optIn.agents === '*' ? manifest.canon.agents : Array.isArray(member.optIn.agents) ? member.optIn.agents : [];
    for (const localName of member.localAgents ?? []) {
      assert.ok(!selected.includes(localName), `${member.repo}: ${localName} collides with canon`);
    }
  }
});
