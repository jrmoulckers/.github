import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  formatCallerPermissionWarnings,
  inspectCallerPermissionSource,
  inspectCallerPermissionSources,
  observeCallerPermissions,
} from '../lib/caller-permissions.mjs';
import { reusableWorkflowsDeclaringPermission } from '../lib/workflow-integrity.mjs';

const BACKBONE = 'jrmoulckers/.github';
const SHA = '0123456789abcdef0123456789abcdef01234567';

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
