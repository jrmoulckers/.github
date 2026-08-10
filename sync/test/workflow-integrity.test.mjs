import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inspectWorkflowSource,
  validateNativeSmokeContract,
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
    'reusable-native-smoke-test.yml',
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

test('reusable workflow_call secrets are limited to the registry read token', () => {
  const source = (secretName) => `name: Reusable - Sample
on:
  workflow_call:
    inputs:
      node-version:
        description: Numeric Node.js version to use.
        required: false
        type: string
        default: '22'
    secrets:
      ${secretName}:
        description: A secret.
        required: false

permissions: {}

jobs:
  sample:
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: read
    steps:
      - name: Noop
        run: 'true'
`;

  const allowed = inspectWorkflowSource('.github/workflows/reusable-sample.yml', source('NODE_AUTH_TOKEN'), {
    reusable: true,
  });
  assert.equal(
    allowed.filter((error) => error.includes('workflow_call secret')).length,
    0,
  );

  const rejected = inspectWorkflowSource('.github/workflows/reusable-sample.yml', source('DEPLOY_TOKEN'), {
    reusable: true,
  });
  assert.ok(rejected.some((error) => error.includes('workflow_call secret "DEPLOY_TOKEN"')));
});

const nativeSmokeSource = () =>
  readFileSync(
    join(REPO_ROOT, '.github', 'workflows', 'reusable-native-smoke-test.yml'),
    'utf8',
  ).replace(/\r\n?/g, '\n');

test('the native smoke contract passes on canon and is not vacuous', () => {
  assert.deepEqual(validateNativeSmokeContract(nativeSmokeSource()), []);
  assert.ok(validateNativeSmokeContract('').length > 0, 'an empty workflow cannot satisfy the contract');
});

test('a platform gated on a substring of the raw input is rejected', () => {
  // contains(inputs.platforms, 'ios') is a substring test, so a malformed platforms value would
  // silently skip a platform the caller believed was covered.
  const mutated = nativeSmokeSource().replace(
    "    if: contains(fromJSON(needs.validate.outputs.selected), 'ios')",
    "    if: contains(inputs.platforms, 'ios')",
  );
  const errors = validateNativeSmokeContract(mutated);
  assert.ok(errors.some((error) => error.includes('job "ios" must select on the validated list')));
});

test('an unselected platform counting as a failure is rejected', () => {
  const mutated = nativeSmokeSource().replace('&& "$outcome" != "skipped"', '');
  assert.ok(
    validateNativeSmokeContract(mutated).some((error) => error.includes('count as skipped')),
  );
});

test('a summary that cannot fail the run is rejected', () => {
  const mutated = nativeSmokeSource().replace(
    '    needs: [validate, android, ios, web, windows]',
    '    needs: [validate]',
  );
  assert.ok(
    validateNativeSmokeContract(mutated).some((error) => error.includes('must observe every job')),
  );
});

test('a writable Gradle cache in release smoke builds is rejected', () => {
  const mutated = nativeSmokeSource().replaceAll('cache-read-only: true', 'cache-read-only: false');
  assert.ok(
    validateNativeSmokeContract(mutated).some((error) => error.includes('read-only')),
  );
});

test('a reusable-workflow caller job is exempt from timeout-minutes but not from permissions', () => {
  // GitHub rejects timeout-minutes on a job that uses another workflow, so the bound lives in the
  // called workflow. Permissions still apply: a caller job caps what the called jobs may request.
  const source = (permissions) => `name: Harness
on:
  workflow_dispatch:

permissions: {}

jobs:
  smoke:
    uses: ./.github/workflows/reusable-native-smoke-test.yml
${permissions}    with:
      version: harness
`;

  const withPermissions = inspectWorkflowSource(
    '.github/workflows/native-smoke-harness.yml',
    source('    permissions:\n      contents: read\n      packages: read\n'),
  );
  assert.deepEqual(withPermissions, []);

  const withoutPermissions = inspectWorkflowSource(
    '.github/workflows/native-smoke-harness.yml',
    source(''),
  );
  assert.ok(withoutPermissions.some((error) => error.includes('requires explicit permissions')));
  assert.equal(
    withoutPermissions.filter((error) => error.includes('timeout-minutes')).length,
    0,
    'the exemption must not be conditional on the job being otherwise valid',
  );
});

test('the harness asserts on the reusable workflow result rather than merely calling it', () => {
  const text = readFileSync(
    join(REPO_ROOT, '.github', 'workflows', 'native-smoke-harness.yml'),
    'utf8',
  );
  // A caller that ignores the output would go green even if summary reported a failure, which is
  // the one thing the harness exists to observe.
  assert.match(text, /SMOKE_RESULT:\s*\${{\s*needs\.smoke\.outputs\.result\s*}}/);
  assert.match(text, /"\$SMOKE_RESULT" != "pass"/);
});
