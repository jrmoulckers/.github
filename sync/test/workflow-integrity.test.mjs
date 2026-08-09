import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inspectWorkflowSource,
  validateWorkflowIntegrity,
} from '../lib/workflow-integrity.mjs';
import { loadManifest } from '../lib/manifest.mjs';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

test('canonical workflow roster and integrity contracts pass', () => {
  const manifest = loadManifest(REPO_ROOT);
  const result = validateWorkflowIntegrity(REPO_ROOT, manifest);
  assert.deepEqual(result.reusableFiles, [
    'reusable-change-detection.yml',
    'reusable-ci-lint.yml',
    'reusable-ci-web.yml',
    'reusable-deploy-pages.yml',
    'reusable-deploy-preview.yml',
    'reusable-perf-budget.yml',
    'reusable-security-ci.yml',
    'reusable-smoke-test.yml',
  ]);
});

test('workflow source inspection rejects mutable refs, unsafe triggers, shell interpolation, and missing bounds', () => {
  const errors = inspectWorkflowSource(
    '.github/workflows/unsafe.yml',
    `name: Unsafe
on:
  pull_request_target:
permissions: {}
jobs:
  unsafe:
    runs-on: ubuntu-latest
    permissions:
      contents: read
    steps:
      - uses: actions/checkout@v7
      - { "uses": owner/flow-action@main }
      - name: Broken
        runs-on: [
      - run: |-
          echo "\${{ inputs.command }}"
      - uses: owner/action@0123456789012345678901234567890123456789
`,
  );
  assert.ok(errors.some((error) => error.includes('pull_request_target')));
  assert.ok(errors.some((error) => error.includes('full commit SHA')));
  assert.ok(errors.filter((error) => error.includes('full commit SHA')).length >= 2);
  assert.ok(errors.some((error) => error.includes('version update comment')));
  assert.ok(errors.some((error) => error.includes('persist-credentials')));
  assert.ok(errors.some((error) => error.includes('through env')));
  assert.ok(errors.some((error) => error.includes('timeout-minutes')));
  assert.ok(errors.some((error) => error.includes('flow collections')));
});
