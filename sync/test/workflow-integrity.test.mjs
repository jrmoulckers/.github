import { test } from 'node:test';
import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  inspectWorkflowSource,
  validateCallerPermissionLintContract,
  validateCiGateCoverage,
  validateNativeSmokeContract,
  validateTriggerCoverage,
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

// The harness's own trigger is correct today, so these assert the check is not vacuous by
// constructing the stale filter rather than by trusting the passing case.
test('a pull_request paths filter must cover what the workflow reads', () => {
  const harness = readFileSync(
    join(REPO_ROOT, '.github', 'workflows', 'native-smoke-harness.yml'),
    'utf8',
  ).replace(/\r\n?/g, '\n');
  assert.deepEqual(
    validateTriggerCoverage('native-smoke-harness.yml', harness),
    [],
    'canon must satisfy the trigger coverage it declares',
  );

  const droppedCall = harness.replace(
    '      - .github/workflows/reusable-native-smoke-test.yml\n',
    '',
  );
  assert.notEqual(droppedCall, harness, 'the mutation must apply before its result is read');
  assert.ok(
    validateTriggerCoverage('native-smoke-harness.yml', droppedCall).some((error) =>
      error.includes('reusable-native-smoke-test.yml'),
    ),
    'a filter that omits the workflow it calls must be rejected',
  );

  const droppedFixture = harness.replace('      - .github/native-smoke-fixture/**\n', '');
  assert.notEqual(droppedFixture, harness, 'the mutation must apply before its result is read');
  assert.ok(
    validateTriggerCoverage('native-smoke-harness.yml', droppedFixture).some((error) =>
      error.includes('native-smoke-fixture'),
    ),
    'a filter that omits the directory its jobs run in must be rejected',
  );

  const droppedSelf = harness.replace('      - .github/workflows/native-smoke-harness.yml\n', '');
  assert.notEqual(droppedSelf, harness, 'the mutation must apply before its result is read');
  assert.ok(
    validateTriggerCoverage('native-smoke-harness.yml', droppedSelf).some((error) =>
      error.includes('native-smoke-harness.yml'),
    ),
    'a filter that cannot be triggered by editing the workflow itself must be rejected',
  );
});

test('an unreadable paths filter is an error, never an empty set of globs', () => {
  // An empty glob list makes every coverage question answer false, which reads as "nothing is
  // excluded" -- the inverse of what an unparseable filter actually means.
  const empty = ['name: x', '', 'on:', '  pull_request:', '    paths:', '', 'jobs: {}'].join('\n');
  assert.ok(
    validateTriggerCoverage('x.yml', empty).some((error) => error.includes('lists no paths')),
    'a paths filter with no entries must be reported, not treated as unrestricted',
  );

  // A workflow with no filter at all is unrestricted and has nothing to check.
  const noFilter = ['name: x', '', 'on:', '  pull_request:', '', 'jobs: {}'].join('\n');
  assert.deepEqual(validateTriggerCoverage('x.yml', noFilter), []);
});

test('trigger globs cover a subtree only through the separator', () => {
  const source = [
    'name: x',
    '',
    'on:',
    '  pull_request:',
    '    paths:',
    '      - .github/workflows/x.yml',
    '      - .github/fixture/**',
    '',
    'jobs:',
    '  a:',
    '    working-directory: .github/fixture-extra',
  ].join('\n');
  assert.ok(
    validateTriggerCoverage('x.yml', source).some((error) => error.includes('fixture-extra')),
    'a sibling directory sharing a prefix must not be read as covered',
  );
});

// MUT E survived without this: every assertion above calls the validator directly, so unwiring it
// from validateWorkflowIntegrity killed nothing. Content and reachability are separate properties.
test('the integrity run reports a stale trigger, not just the validator in isolation', () => {
  const manifest = loadManifest(REPO_ROOT);
  const root = mkdtempSync(join(tmpdir(), 'workflow-trigger-'));
  try {
    cpSync(join(REPO_ROOT, '.github'), join(root, '.github'), { recursive: true });
    const harnessPath = join(root, '.github', 'workflows', 'native-smoke-harness.yml');
    const original = readFileSync(harnessPath, 'utf8').replace(/\r\n?/g, '\n');
    const stale = original.replace('      - .github/native-smoke-fixture/**\n', '');
    assert.notEqual(stale, original, 'the mutation must apply before its result is read');
    writeFileSync(harnessPath, stale);

    let message = null;
    try {
      validateWorkflowIntegrity(root, manifest);
    } catch (error) {
      message = error.message;
    }
    assert.ok(message, 'a stale trigger must fail the integrity run');
    assert.ok(
      message.includes('native-smoke-fixture'),
      'the integrity run must name the dependency the trigger stopped covering',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
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

// `--check` is the only comparison in this repository with canon on the left-hand side: it
// enumerates from `studio.config.json` and reports what a member lacks. `--dry-run` reads no member
// state at all, so substituting it produces a green audit that compared nothing — the same shape as
// the caller-permission scan that read zero files. And a scheduled trigger does not fail when it
// rots, it disappears, taking the alarm with it and leaving a workflow that is still correct on
// every axis a reader would think to check.
//
// One predicate, run over the real file and over mutants, so the contract cannot pass by describing
// today's file back to itself.
const auditContractErrors = (text) => {
  const errors = [];
  if (!/^\s+- cron: '[^']+'\s*$/m.test(text)) errors.push('no schedule cron');
  // Anchored to the start of a line so it reads the command that runs, not a mention of it. The
  // first version matched anywhere, and the step's own `echo "Running: ..."` satisfied it — a
  // mutant that swapped the executed flag left the predicate green off the echo alone.
  if (!/^\s*node sync\/index\.mjs --check\b/m.test(text)) errors.push('does not run --check');
  if (/--dry-run/.test(text)) errors.push('a dry run reads no member state, so it audits nothing');
  if (!/STUDIO_SYNC_TOKEN: \$\{\{ secrets\.STUDIO_SYNC_TOKEN \}\}/.test(text)) {
    errors.push('the audit step cannot reach member state without the cross-repo token');
  }
  return errors;
};

test('the canon delivery audit runs --check against member state on a schedule', () => {
  const source = readFileSync(
    join(REPO_ROOT, '.github', 'workflows', 'canon-delivery-audit.yml'),
    'utf8',
  ).replace(/\r\n?/g, '\n');

  assert.deepEqual(auditContractErrors(source), []);

  // Each mutant fails for the reason claimed, not merely somewhere.
  assert.deepEqual(auditContractErrors(source.replace(/^\s+- cron: '[^']+'\s*$/m, '')), [
    'no schedule cron',
  ]);
  assert.deepEqual(
    auditContractErrors(source.replace(/^(\s*)node sync\/index\.mjs --check/m, '$1node sync/index.mjs --dry-run')),
    ['does not run --check', 'a dry run reads no member state, so it audits nothing'],
  );
  assert.ok(auditContractErrors('').length > 0, 'an empty file cannot satisfy the contract');
});

// A release tag is the only thing a member's `uses:` pin can be updated *to*, so what this workflow
// publishes is what the whole fleet moves onto. Two properties have to hold, and neither announces
// itself when it stops: the version shape (a moving alias would reintroduce the mutable reference
// GH-ACT-003 forbids, and it would look like an ordinary tag while doing it), and dispatch-only
// triggering (an unattended publish decides for eleven repositories without anyone choosing a
// commit).
const releaseContractErrors = (text) => {
  const errors = [];
  if (!/^\s+workflow_dispatch:/m.test(text)) errors.push('not dispatchable');
  if (/^\s+(?:schedule|push|pull_request):/m.test(text)) errors.push('publishes unattended');
  if (!/\^v\[0-9\]\+\\\.\[0-9\]\+\\\.\[0-9\]\+\$/.test(text)) {
    errors.push('does not validate the version shape');
  }
  if (!/rev-parse -q --verify "refs\/tags\/\$VERSION"/.test(text)) {
    errors.push('does not refuse an existing tag');
  }
  return errors;
};

test('the release workflow publishes an immutable SemVer tag and only when dispatched', () => {
  const source = readFileSync(join(REPO_ROOT, '.github', 'workflows', 'release.yml'), 'utf8').replace(
    /\r\n?/g,
    '\n',
  );

  assert.deepEqual(releaseContractErrors(source), []);

  assert.deepEqual(
    releaseContractErrors(source.replace("'^v[0-9]+\\.[0-9]+\\.[0-9]+$'", "'^v[0-9]+$'")),
    ['does not validate the version shape'],
  );
  assert.deepEqual(
    releaseContractErrors(source.replace('  workflow_dispatch:', "  schedule:\n    - cron: '0 7 * * 1'\n  workflow_dispatch:")),
    ['publishes unattended'],
  );
  assert.ok(releaseContractErrors('').length > 0, 'an empty file cannot satisfy the contract');
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

// Each contract validator is invoked from validateWorkflowIntegrity's dispatch and from nowhere
// else in production. Every test above calls the exported validator directly, which pins its logic
// precisely and says nothing about whether production reaches it: deleting a call site leaves the
// validator defined, exported and green. Six of the seven dispatch calls survived exactly that
// mutation before this test existed, and the seventh died only because it already had a test that
// drove the entry point rather than the function. Wiring and behaviour are separate properties.
//
// Each row corrupts the real workflow inside a throwaway root and drives it through the production
// entry point, so the assertion fails when a validator stops being reached, not only when its logic
// breaks. The needles are strings only the named validator emits.
//
// The corruption marker goes in the middle of the anchor, not on the end. Several of these patterns
// are unanchored substring tests, so appending to the anchor leaves the original as a prefix and the
// pattern still matches -- a mutation that applies to the file, changes nothing the validator sees,
// and reports as "validator not reached". Two rows were written that way and this test caught them.
const CONTRACT_DISPATCH = [
  {
    validator: 'validateArtifactContracts',
    file: 'reusable-ci-web.yml',
    from: 'artifact-retention-days:',
    to: 'artifact-retention-daysZZ:',
    needle: 'incomplete build-artifact producer contract',
  },
  {
    validator: 'validatePagesAuthority',
    file: 'reusable-deploy-pages.yml',
    from: 'upload-pages-artifact@',
    to: 'upload-pages-artifactZZ@',
    needle: 'build job must hand off the fixed Pages artifact',
  },
  {
    validator: 'validateSecurityContract',
    file: 'reusable-security-ci.yml',
    from: '--fail-on-scan-errors',
    to: '--fail-on-scanZZ-errors',
    needle: 'incomplete secret, dependency, or package audit contract',
  },
  {
    validator: 'validateChangeDetectionContract',
    file: 'reusable-change-detection.yml',
    from: 'matched no path group',
    to: 'matched noZZ path group',
    needle: 'unclassified changed files must be reported',
  },
  {
    validator: 'validateCallerPermissionLintContract',
    file: 'caller-permissions-harness.yml',
    from: 'uses: ./.github/workflows/reusable-caller-permissions.yml',
    to: 'uses: ./.github/workflows/reusable-caller-permissionsZZ.yml',
    needle: 'must call the local reusable lint workflow',
  },
  {
    validator: 'validateNativeSmokeContract',
    file: 'reusable-native-smoke-test.yml',
    from: 'cache-read-only: true',
    to: 'cache-read-only: false',
    needle: 'Gradle caching must stay read-only',
  },
  {
    validator: 'validateCiGateCoverage',
    file: 'ci.yml',
    from: '    name: CI gate',
    to: '    name: Something else',
    needle: 'no job named "CI gate"',
  },
];

test('every workflow contract validator is reached from the integrity entry point', () => {
  const manifest = loadManifest(REPO_ROOT);
  for (const row of CONTRACT_DISPATCH) {
    const root = mkdtempSync(join(tmpdir(), 'workflow-dispatch-'));
    try {
      cpSync(join(REPO_ROOT, '.github'), join(root, '.github'), { recursive: true });
      const target = join(root, '.github', 'workflows', row.file);
      const original = readFileSync(target, 'utf8').replace(/\r\n?/g, '\n');
      // An anchor that no longer matches produces a mutant that was never applied, which reports as
      // a covered defect rather than as a skip. Assert the corruption landed before reading a verdict.
      assert.ok(
        original.includes(row.from),
        `${row.file}: anchor ${JSON.stringify(row.from)} is absent, so the ${row.validator} probe would not apply`,
      );
      const mutated = original.split(row.from).join(row.to);
      assert.notEqual(mutated, original, `${row.file}: corruption for ${row.validator} changed nothing`);
      writeFileSync(target, mutated);

      let message = null;
      try {
        validateWorkflowIntegrity(root, manifest);
      } catch (error) {
        message = error.message;
      }
      assert.ok(message, `corrupting ${row.file} must be reported by the integrity run`);
      assert.ok(
        message.includes(row.needle),
        `${row.validator} must be reached from validateWorkflowIntegrity: corrupting ${row.file} produced no ${JSON.stringify(row.needle)}`,
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

// The table above is a list of validators to check, maintained by hand, in the same repository as
// the dispatch it mirrors -- which is the shape the test exists to catch, one level up. Deriving
// the population from the entry point's own source means a validator added to the dispatch without
// a row here fails rather than passing unnoticed.
test('the contract dispatch table covers every validator the entry point calls', () => {
  const source = readFileSync(join(REPO_ROOT, 'sync', 'lib', 'workflow-integrity.mjs'), 'utf8');
  const start = source.indexOf('export function validateWorkflowIntegrity');
  const end = source.indexOf('export function inspectWorkflowSource');
  assert.ok(start >= 0 && end > start, 'the entry point must be locatable in its own source');
  const called = [...source.slice(start, end).matchAll(/^\s*(validate[A-Za-z]+)\(/gm)].map(
    (match) => match[1],
  );
  const dispatched = [...new Set(called)].sort();
  assert.ok(dispatched.length >= 7, `expected the dispatch to call several validators, saw ${dispatched.length}`);

  // validateTriggerCoverage is reached through the per-file loop and already has a production-path
  // test above, so it is covered without a corruption row of its own.
  const covered = new Set([...CONTRACT_DISPATCH.map((row) => row.validator), 'validateTriggerCoverage']);
  assert.deepEqual(
    dispatched.filter((name) => !covered.has(name)),
    [],
    'a validator is dispatched but no production-path probe proves it is reached',
  );
});