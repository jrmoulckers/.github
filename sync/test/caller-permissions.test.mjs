import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  callerPermissionLintReport,
  formatCallerPermissionWarnings,
  inspectCallerPermissionSource,
  inspectCallerPermissionSources,
  observeCallerPermissions,
} from '../lib/caller-permissions.mjs';
import { reusableWorkflowsDeclaringPermission } from '../lib/workflow-integrity.mjs';

const BACKBONE = 'jrmoulckers/.github';
const SHA = '0123456789abcdef0123456789abcdef01234567';
const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

function workflow({ workflowPermission, jobPermission, target = 'reusable-ci-web' } = {}) {
  const top = workflowPermission ? `permissions:\n${workflowPermission}\n\n` : '';
  const job = jobPermission ? `    permissions:\n${jobPermission}\n` : '';
  return `${top}jobs:
  web:
    uses: ${BACKBONE}/.github/workflows/${target}.yml@${SHA}
${job}`;
}

test('package-reading callers are derived from canonical permission ceilings', () => {
  assert.deepEqual(reusableWorkflowsDeclaringPermission('packages'), [
    'reusable-ci-lint',
    'reusable-ci-web',
    'reusable-deploy-pages',
    'reusable-deploy-preview',
    'reusable-native-smoke-test',
    'reusable-perf-budget',
    'reusable-smoke-test',
  ]);
});

test('explicit workflow permission ceilings without packages read are unsafe', () => {
  const result = inspectCallerPermissionSource(
    '.github/workflows/ci.yml',
    workflow({ workflowPermission: '  contents: read' }),
    BACKBONE,
  );

  assert.deepEqual(result.unknown, []);
  assert.deepEqual(result.findings, [
    {
      path: '.github/workflows/ci.yml',
      line: 6,
      job: 'web',
      affectedJobs: ['web'],
      workflow: 'reusable-ci-web',
      state: 'unsafe',
      source: 'workflow',
      detail: 'packages omitted',
    },
  ]);
});

test('job permissions override workflow permissions in both directions', () => {
  const safe = inspectCallerPermissionSource(
    'safe.yml',
    workflow({
      workflowPermission: '  contents: read',
      jobPermission: '      contents: read\n      packages: read',
    }),
    BACKBONE,
  );
  assert.equal(safe.findings[0].state, 'safe');
  assert.equal(safe.findings[0].source, 'job');

  const unsafe = inspectCallerPermissionSource(
    'unsafe.yml',
    workflow({
      workflowPermission: '  contents: read\n  packages: read',
      jobPermission: '      contents: read',
    }),
    BACKBONE,
  );
  assert.equal(unsafe.findings[0].state, 'unsafe');
  assert.equal(unsafe.findings[0].source, 'job');
});

test('omitted permissions inherit repository defaults without a false warning', () => {
  const result = inspectCallerPermissionSource('ci.yml', workflow(), BACKBONE);
  assert.equal(result.findings[0].state, 'inherited');
  assert.deepEqual(
    formatCallerPermissionWarnings('owner/repo', {
      refs: [{ label: 'default branch', ...result }],
      unknown: [],
    }),
    [],
  );
});

test('read-all and flow mappings that grant packages are safe', () => {
  const readAll = inspectCallerPermissionSource(
    'read-all.yml',
    `permissions: read-all\n${workflow()}`,
    BACKBONE,
  );
  assert.equal(readAll.findings[0].state, 'safe');

  const flow = inspectCallerPermissionSource(
    'flow.yml',
    `permissions: { contents: read, packages: read }\n${workflow()}`,
    BACKBONE,
  );
  assert.equal(flow.findings[0].state, 'safe');
});

test('workflow permissions apply regardless of top-level key order', () => {
  const result = inspectCallerPermissionSource(
    'reordered.yml',
    `${workflow()}
permissions:
  contents: read
  packages: read
`,
    BACKBONE,
  );
  assert.equal(result.findings[0].state, 'safe');
  assert.equal(result.findings[0].source, 'workflow');
});

test('valid nonstandard YAML indentation preserves caller and permission resolution', () => {
  const result = inspectCallerPermissionSource(
    'wide-indent.yml',
    `jobs:
    web:
        permissions:
            contents: read
            packages: read
        uses: ${BACKBONE}/.github/workflows/reusable-ci-web.yml@${SHA}
`,
    BACKBONE,
  );

  assert.deepEqual(
    result.findings.map(({ job, state, affectedJobs }) => ({ job, state, affectedJobs })),
    [{ job: 'web', state: 'safe', affectedJobs: ['web'] }],
  );
  assert.deepEqual(result.unknown, []);
});

test('workflow-call aliases retain their caller job and permission ceiling', () => {
  const result = inspectCallerPermissionSource(
    'aliases.yml',
    `permissions:
  contents: read
jobs:
  definition:
    uses: &shared ${BACKBONE}/.github/workflows/reusable-ci-web.yml@${SHA}
  repeated:
    uses: *shared
`,
    BACKBONE,
  );
  assert.deepEqual(
    result.findings.map(({ job, state }) => ({ job, state })),
    [
      { job: 'definition', state: 'unsafe' },
      { job: 'repeated', state: 'unsafe' },
    ],
  );
});

test('non-installing reusable workflows are ignored', () => {
  const result = inspectCallerPermissionSource(
    'security.yml',
    workflow({
      workflowPermission: '  contents: read',
      target: 'reusable-security-ci',
    }),
    BACKBONE,
  );
  assert.deepEqual(result, { findings: [], unknown: [] });
});

test('unsupported permission expressions warn instead of being certified safe', () => {
  const result = inspectCallerPermissionSource(
    'dynamic.yml',
    `permissions: \${{ fromJSON(inputs.permissions) }}\n${workflow()}`,
    BACKBONE,
  );
  assert.equal(result.findings[0].state, 'unknown');
  assert.match(
    formatCallerPermissionWarnings('owner/repo', {
      refs: [{ label: 'PR #1 (feature)', ...result }],
      unknown: [],
    })[0],
    /effective permissions are unknown/,
  );
});

test('observations include default and open pull-request heads', () => {
  const seen = [];
  const result = observeCallerPermissions(
    {
      root: 'checkout',
      repo: 'owner/repo',
      backbone: BACKBONE,
      token: 'token',
      includePullRequests: true,
    },
    {
      inspectRoot() {
        return { findings: [{ state: 'inherited' }], unknown: [] };
      },
      listPullRequests() {
        return {
          pullRequests: [
            { number: 7, headRefName: 'safe', headRefOid: 'a'.repeat(40) },
            { number: 8, headRefName: 'unsafe', headRefOid: 'b'.repeat(40) },
          ],
          truncated: false,
        };
      },
      readPullRequestSources(root, pullRequest) {
        seen.push([root, pullRequest.number, pullRequest.headRefOid]);
        return [
          {
            path: '.github/workflows/ci.yml',
            text: workflow({ workflowPermission: '  contents: read' }),
          },
        ];
      },
    },
  );

  assert.deepEqual(seen, [
    ['checkout', 7, 'a'.repeat(40)],
    ['checkout', 8, 'b'.repeat(40)],
  ]);
  assert.deepEqual(
    result.refs.map((ref) => ref.label),
    ['default branch', 'PR #7 (safe)', 'PR #8 (unsafe)'],
  );
  assert.equal(result.refs[1].findings[0].state, 'unsafe');
});

test('inaccessible pull-request state is non-fatal and reported unknown', () => {
  const listingFailure = observeCallerPermissions(
    {
      root: 'checkout',
      repo: 'owner/repo',
      backbone: BACKBONE,
      token: 'token',
      includePullRequests: true,
    },
    {
      inspectRoot: () => ({ findings: [], unknown: [] }),
      listPullRequests: () => {
        throw new Error('API unavailable');
      },
    },
  );
  assert.deepEqual(listingFailure.unknown, [
    { label: 'open pull requests', message: 'API unavailable' },
  ]);

  const refFailure = observeCallerPermissions(
    {
      root: 'checkout',
      repo: 'owner/repo',
      backbone: BACKBONE,
      token: 'token',
      includePullRequests: true,
    },
    {
      inspectRoot: () => ({ findings: [], unknown: [] }),
      listPullRequests: () => ({
        pullRequests: [{ number: 9, headRefName: 'moving', headRefOid: 'c'.repeat(40) }],
        truncated: false,
      }),
      readPullRequestSources: () => {
        throw new Error('head moved during inspection');
      },
    },
  );
  assert.deepEqual(refFailure.unknown, [
    { label: 'PR #9 (moving)', message: 'head moved during inspection' },
  ]);
  assert.match(formatCallerPermissionWarnings('owner/repo', refFailure)[0], /scan unavailable/);
});

test('one unreadable workflow source does not discard sibling findings', () => {
  const sources = [
    {
      path: '.github/workflows/a.yml',
      get text() {
        throw new Error('unreadable fixture');
      },
    },
    {
      path: '.github/workflows/b.yml',
      text: workflow({ workflowPermission: '  contents: read' }),
    },
  ];
  const result = inspectCallerPermissionSources(sources, BACKBONE);
  assert.equal(result.findings[0].state, 'unsafe');
  assert.deepEqual(result.unknown, [
    {
      path: '.github/workflows/a.yml',
      line: 1,
      message: 'could not inspect workflow file: unreadable fixture',
    },
  ]);
});

test('workflow-looking text in shell does not produce a caller warning', () => {
  const result = inspectCallerPermissionSource(
    'shell.yml',
    `jobs:
  script:
    runs-on: ubuntu-latest
    steps:
      - run: echo "${BACKBONE}/.github/workflows/reusable-ci-web.yml@${SHA}"
`,
    BACKBONE,
  );
  assert.deepEqual(result, { findings: [], unknown: [] });
});

test('lint report names the unsafe job and every collateral job in its file', () => {
  const result = inspectCallerPermissionSource(
    '.github/workflows/ci.yml',
    `permissions:
  contents: read
jobs:
  _lint:
    runs-on: ubuntu-latest
  web:
    uses: ${BACKBONE}/.github/workflows/reusable-ci-web.yml@${SHA}
  "deploy":
    runs-on: ubuntu-latest
`,
    BACKBONE,
  );
  const report = callerPermissionLintReport(result);

  assert.equal(report.ok, false);
  assert.equal(report.annotations.length, 1);
  assert.match(report.annotations[0].title, /job web/);
  assert.match(report.annotations[0].message, /_lint, deploy/);
  assert.match(report.summary, /\| `\.github\/workflows\/ci\.yml` \| `web` \|/);
  assert.match(report.summary, /3 total job\(s\); 2 other job\(s\) also die: `_lint`, `deploy`/);
});

test('an unresolved local permission shape fails instead of certifying a clean lint', () => {
  const result = inspectCallerPermissionSource(
    '.github/workflows/ci.yml',
    `permissions: \${{ fromJSON(inputs.permissions) }}\n${workflow()}`,
    BACKBONE,
  );
  const report = callerPermissionLintReport(result);

  assert.equal(report.ok, false);
  assert.equal(report.unsafe.length, 0);
  assert.equal(report.unresolved.length, 1);
  assert.match(report.summary, /Could not verify/);
});

test('an unsupported jobs mapping with a package workflow call is unresolved, not clean', () => {
  const result = inspectCallerPermissionSource(
    '.github/workflows/ci.yml',
    `jobs: { web: { uses: ${BACKBONE}/.github/workflows/reusable-ci-web.yml@${SHA} } }\n`,
    BACKBONE,
  );
  const report = callerPermissionLintReport(result);

  assert.equal(report.ok, false);
  assert.equal(report.unresolved.length, 1);
  assert.match(report.unresolved[0].message, /could not resolve the jobs mapping/);
});

test('a passing lint states the bounded positive evidence it supplies', () => {
  const result = inspectCallerPermissionSource(
    '.github/workflows/ci.yml',
    workflow({ workflowPermission: '  contents: read\n  packages: read' }),
    BACKBONE,
  );
  const report = callerPermissionLintReport(result);

  assert.equal(report.ok, true);
  assert.deepEqual(report.annotations, []);
  assert.match(report.summary, /passing check is the positive evidence for this commit/);
  assert.match(report.summary, /future reusable-workflow re-pin/);
});

test('the workflow resolver recovers the exact remote pin and rejects a mutable call', (context) => {
  const immutable = runWorkflowResolver(
    `jobs:
  lint:
    uses: ${BACKBONE}/.github/workflows/reusable-caller-permissions.yml@${SHA}
`,
    context,
  );
  assert.equal(immutable.status, 0, immutable.stderr);
  assert.equal(immutable.sha, SHA);

  const mutable = runWorkflowResolver(
    `# uses: ${BACKBONE}/.github/workflows/reusable-caller-permissions.yml@${SHA}
jobs:
  lint:
    uses: ${BACKBONE}/.github/workflows/reusable-caller-permissions.yml@main
`,
    context,
  );
  assert.notEqual(mutable.status, 0);
  assert.match(mutable.stderr, /must contain one immutable caller-permission workflow ref/);
});

test('the workflow resolver binds the local backbone harness to the caller commit', (context) => {
  const result = runWorkflowResolver(
    `jobs:
  lint:
    uses: ./.github/workflows/reusable-caller-permissions.yml
`,
    context,
    {
      repository: BACKBONE,
      workflowSha: SHA,
    },
  );

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.sha, SHA);
});

function runWorkflowResolver(source, context, options = {}) {
  const root = mkdtempSync(join(tmpdir(), 'caller-permission-ref-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  const workflowPath = '.github/workflows/caller-permissions.yml';
  const output = join(root, 'output.txt');
  mkdirSync(join(root, 'caller', '.github', 'workflows'), { recursive: true });
  writeFileSync(join(root, 'caller', ...workflowPath.split('/')), source);

  const run = spawnSync(process.execPath, ['-'], {
    cwd: root,
    input: resolverScript(),
    encoding: 'utf8',
    env: {
      ...process.env,
      CALLER_REPOSITORY: options.repository ?? 'jrmoulckers/example',
      CALLER_WORKFLOW_REF: `${options.repository ?? 'jrmoulckers/example'}/${workflowPath}@refs/heads/topic`,
      CALLER_WORKFLOW_SHA: options.workflowSha ?? 'fedcba9876543210fedcba9876543210fedcba98',
      GITHUB_OUTPUT: output,
    },
  });
  const sha =
    run.status === 0
      ? readFileSync(output, 'utf8').match(/^sha=([0-9a-f]{40})$/m)?.[1]
      : undefined;
  return { ...run, sha };
}

function resolverScript() {
  const workflow = readFileSync(
    join(REPO_ROOT, '.github', 'workflows', 'reusable-caller-permissions.yml'),
    'utf8',
  ).replace(/\r\n?/g, '\n');
  const match = workflow.match(/node <<'NODE'\n([\s\S]*?)\n {10}NODE/);
  assert.ok(match, 'resolver script must remain extractable from the canonical workflow');
  return match[1]
    .split('\n')
    .map((line) => (line.startsWith('          ') ? line.slice(10) : line))
    .join('\n');
}
