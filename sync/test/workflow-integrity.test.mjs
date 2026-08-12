import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inspectWorkflowSource,
  validateCallerPermissionLintContract,
  validateCiGateCoverage,
  validateNativeSmokeContract,
  validateWorkflowIntegrity,
} from '../lib/workflow-integrity.mjs';
import { loadManifest } from '../lib/manifest.mjs';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

test('canonical workflow roster and integrity contracts pass', () => {
  const manifest = loadManifest(REPO_ROOT);
  const result = validateWorkflowIntegrity(REPO_ROOT, manifest);
  assert.deepEqual(result.reusableFiles, [
    'reusable-caller-permissions.yml',
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

// Every check below this point reads a workflow's contents, which presupposes the workflow is
// there. Enumerating the real directory rather than a list written here is the whole point of the
// test: a hand-picked sample of seven files reported 7/7 detected and missed both live gaps,
// because a list of files to check is written by the same person who forgets to add one.
test('deleting any canonical workflow is reported and names the file', () => {
  const manifest = loadManifest(REPO_ROOT);
  const roster = readdirSync(join(REPO_ROOT, '.github', 'workflows')).filter((name) =>
    /\.ya?ml$/i.test(name),
  );
  assert.ok(roster.length >= 10, 'the roster must be read from disk, not assumed');

  for (const fileName of roster) {
    const root = mkdtempSync(join(tmpdir(), 'workflow-absence-'));
    try {
      cpSync(join(REPO_ROOT, '.github'), join(root, '.github'), { recursive: true });
      rmSync(join(root, '.github', 'workflows', fileName));
      let message = null;
      try {
        validateWorkflowIntegrity(root, manifest);
      } catch (error) {
        message = error.message;
      }
      assert.ok(message, `deleting ${fileName} must be reported, not silently tolerated`);
      // Matched without the extension because the canon.workflows roster names workflows in their
      // declared form. Requiring the full filename made a correctly-named error read as unnamed.
      const stem = fileName.replace(/\.ya?ml$/i, '');
      assert.ok(
        message.split('\n').some((line) => line.includes(stem)),
        `deleting ${fileName} must produce an error naming it, not an unrelated failure`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

const callerPermissionLintSources = () => ({
  reusable: readFileSync(
    join(REPO_ROOT, '.github', 'workflows', 'reusable-caller-permissions.yml'),
    'utf8',
  ).replace(/\r\n?/g, '\n'),
  harness: readFileSync(
    join(REPO_ROOT, '.github', 'workflows', 'caller-permissions-harness.yml'),
    'utf8',
  ).replace(/\r\n?/g, '\n'),
});

test('caller permission lint contract passes on canon and is not vacuous', () => {
  const { reusable, harness } = callerPermissionLintSources();
  assert.deepEqual(validateCallerPermissionLintContract(reusable, harness), []);
  assert.ok(
    validateCallerPermissionLintContract('', '').length > 0,
    'empty workflows cannot satisfy the contract',
  );
});

test('caller permission lint rejects a mutable scanner checkout', () => {
  const { reusable, harness } = callerPermissionLintSources();
  const mutated = reusable.replace(
    'ref: ${{ steps.backbone.outputs.sha }}',
    'ref: main',
  );
  const errors = validateCallerPermissionLintContract(mutated, harness);
  assert.ok(errors.some((error) => error.includes('recovered SHA')));
});

test('caller permission lint harness rejects pull-request path filters', () => {
  const { reusable, harness } = callerPermissionLintSources();
  const mutated = harness.replace('  pull_request:', '  pull_request:\n    paths:\n      - ".github/**"');
  const errors = validateCallerPermissionLintContract(reusable, mutated);
  assert.ok(errors.some((error) => error.includes('must not use path filters')));
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

// A green "Studio sync" in the run list meant nothing until this: a dry run writes nothing and a
// member-filtered run writes to one repo, yet both render exactly like a fleet run that wrote to
// every member. Two of the three most recent green entries had delivered nothing to the fleet, and
// that ambiguity was read -- by this repo's own maintainer session -- as evidence that a stalled
// dispatch had resumed. `run-name` is the only string GitHub renders in that list.
test('the sync run names its mode and scope in the run list, not just in the summary', () => {
  const source = readFileSync(
    join(dirname(fileURLToPath(import.meta.url)), '../../.github/workflows/studio-sync.yml'),
    'utf8',
  );
  const runName = source.match(/^run-name:[\s\S]*?(?=\n[a-z-]+:)/m)?.[0];
  assert.ok(runName, 'studio-sync.yml declares no run-name');

  // Both distinctions must be visible without opening the run: what it wrote to, and whether it
  // wrote at all. Naming one and not the other leaves the misread that motivated this available.
  assert.match(runName, /inputs\.dry_run/, 'run-name does not distinguish a dry run');
  assert.match(runName, /inputs\.members/, 'run-name does not state scope');
});

// The CI gate calls itself "Require every CI job" and enforces that by transcription: a `needs`
// array plus one `test "$X" = "success"` per job. Adding a job and forgetting either edit narrows
// what the gate covers while its name, its green tick, and every standing line citing it stay the
// same. Nothing turns red -- a claim about all of CI is just issued over less than all of CI.
//
// The mutants below construct that state rather than asserting the two jobs present today, so the
// contract holds for whatever jobs the workflow gains.
const ciSource = () => readFileSync(join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8').replace(/\r\n?/g, '\n');

const withExtraJob = (text) =>
  text.replace(
    '  ci-gate:',
    `  coverage-tests:
    name: Coverage tests
    runs-on: ubuntu-latest
    timeout-minutes: 5
    permissions:
      contents: read

    steps:
      - name: Run
        run: node --test "coverage/*.test.mjs"

  ci-gate:`,
  );

test('the real CI gate covers every job in its own workflow', () => {
  assert.deepEqual(validateCiGateCoverage(ciSource()), []);
  // Non-vacuity: an empty file must not read as a satisfied contract.
  assert.ok(validateCiGateCoverage('').length > 0, 'a missing ci.yml cannot satisfy the contract');
});

test('a CI job the gate never waits for is rejected', () => {
  const errors = validateCiGateCoverage(withExtraJob(ciSource()));
  assert.ok(
    errors.some((error) => error.includes('"coverage-tests" is not in the CI gate\'s needs')),
    `expected an unawaited-job error, got: ${JSON.stringify(errors)}`,
  );
});

test('a CI job the gate waits for and never asserts is rejected', () => {
  // The worse half: `needs` grows, the shell does not. The gate blocks on the job, reads nothing
  // from it, and reports success — an omission that looks more thorough than forgetting it twice.
  const errors = validateCiGateCoverage(
    withExtraJob(ciSource()).replace(
      '    needs: [principle-tests, sync-tests]',
      '    needs: [principle-tests, sync-tests, coverage-tests]',
    ),
  );
  assert.ok(
    errors.some((error) => error.includes('never asserts "coverage-tests" succeeded')),
    `expected an awaited-but-unasserted error, got: ${JSON.stringify(errors)}`,
  );
  assert.ok(
    !errors.some((error) => error.includes('is not in the CI gate\'s needs')),
    'the needs list was satisfied, so only the assertion half may be reported',
  );
});

test('a gate requiring the absence of failure rather than success is rejected', () => {
  // `cancelled` and `skipped` are neither success nor failure, so `!= "failure"` licenses a green
  // CI for a job that never ran -- the same gate measured at a coarser resolution than its claim.
  const errors = validateCiGateCoverage(
    ciSource().replace('test "$PRINCIPLE_RESULT" = "success"', 'test "$PRINCIPLE_RESULT" != "failure"'),
  );
  assert.ok(
    errors.some((error) => error.includes('must require success')),
    `expected a resolution error, got: ${JSON.stringify(errors)}`,
  );
});

test('a workflow with no gate at all is rejected', () => {
  const errors = validateCiGateCoverage(ciSource().replace('    name: CI gate', '    name: Something else'));
  assert.ok(errors.some((error) => error.includes('no job named "CI gate"')));
});
