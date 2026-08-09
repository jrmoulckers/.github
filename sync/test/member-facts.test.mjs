// Checkout-derived registry verification. Fixtures model repository evidence rather than copying
// today's member values into a second expected-value table.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
  assertMemberFacts,
  deriveCalledWorkflows,
  deriveFramework,
  derivePackageManager,
} from '../lib/member-facts.mjs';
import { syncMemberRepo } from '../lib/pr.mjs';

const BACKBONE = 'jrmoulckers/.github';
const REVIEWED_SHA = '0123456789abcdef0123456789abcdef01234567';

function withFixture(files, fn) {
  const root = mkdtempSync(join(tmpdir(), 'studio-member-facts-'));
  try {
    for (const [path, contents] of Object.entries(files)) {
      const target = join(root, path);
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, contents, 'utf8');
    }
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function member(overrides = {}) {
  return {
    repo: 'owner/member',
    mode: 'application',
    framework: 'svelte',
    packageManager: 'npm',
    groups: [{ kind: 'workflows', names: ['reusable-ci-web', 'planned-workflow'] }],
    ...overrides,
  };
}

function infrastructure(overrides = {}) {
  return member({
    mode: 'infrastructure',
    framework: undefined,
    packageManager: undefined,
    groups: [{ kind: 'workflows', names: [] }],
    ...overrides,
  });
}

function preBootstrap(overrides = {}) {
  return member({
    mode: 'pre-bootstrap',
    framework: undefined,
    packageManager: undefined,
    groups: [{ kind: 'workflows', names: [] }],
    ...overrides,
  });
}

test('derives package manager from the root lockfile, not nested package locks', () => {
  withFixture(
    {
      'pnpm-lock.yaml': 'lockfileVersion: 9\n',
      'tools/package-lock.json': '{}\n',
    },
    (root) => {
      assert.deepEqual(derivePackageManager(root), {
        value: 'pnpm',
        evidence: 'pnpm-lock.yaml',
      });
    },
  );
});

test('rejects missing and conflicting package-manager evidence', () => {
  withFixture({}, (root) => {
    assert.throws(() => derivePackageManager(root), /no root package-lock\.json/);
  });
  withFixture({ 'package-lock.json': '{}', 'yarn.lock': '' }, (root) => {
    assert.throws(
      () => derivePackageManager(root),
      /conflicting root lockfiles package-lock\.json, yarn\.lock/,
    );
  });
});

test('derives supported frameworks from repository signatures rather than member names', () => {
  withFixture(
    { 'package.json': JSON.stringify({ dependencies: { next: '15.0.0' } }) },
    (root) => assert.equal(deriveFramework(root).value, 'nextjs'),
  );
  withFixture(
    { 'package.json': JSON.stringify({ devDependencies: { svelte: '5.0.0' } }) },
    (root) => assert.equal(deriveFramework(root).value, 'svelte'),
  );
  withFixture(
    {
      gradlew: '',
      'settings.gradle.kts': 'rootProject.name = "fixture"\n',
      'build.gradle.kts': 'alias(libs.plugins.kotlin.multiplatform) apply false\n',
      'apps/web/package.json': '{}\n',
    },
    (root) => assert.equal(deriveFramework(root).value, 'kmp-web'),
  );
});

test('reports ambiguous and unsupported framework evidence instead of guessing', () => {
  withFixture(
    {
      'package.json': JSON.stringify({ dependencies: { next: '15.0.0', svelte: '5.0.0' } }),
    },
    (root) => assert.throws(() => deriveFramework(root), /conflicting signatures/),
  );
  withFixture({ 'package.json': '{}' }, (root) => {
    assert.throws(() => deriveFramework(root), /no supported framework signature/);
  });
});

test('derives called backbone workflows from all workflow YAML and ignores lookalikes', () => {
  withFixture(
    {
      '.github/workflows/ci.yml': `
jobs:
  shared:
    uses: jrmoulckers/.github/.github/workflows/reusable-ci-web.yml@${REVIEWED_SHA}
  local:
    uses: ./.github/workflows/reusable-ci-lint.yml
# uses: jrmoulckers/.github/.github/workflows/commented.yml@main
`,
      '.github/workflows/nested/release.yaml': `
jobs:
  deploy:
    uses: "jrmoulckers/.github/.github/workflows/reusable-deploy-preview.yaml@${REVIEWED_SHA}"
  action:
    steps:
      - uses: jrmoulckers/.github/some-action@main
`,
    },
    (root) => {
      assert.deepEqual(deriveCalledWorkflows(root, BACKBONE).value, [
        'reusable-ci-web',
        'reusable-deploy-preview',
      ]);
    },
  );
});

test('derives anchored and flow-style workflow uses without trusting comments', () => {
  withFixture(
    {
      '.github/workflows/ci.yml': `
jobs:
  first:
    uses: &web jrmoulckers/.github/.github/workflows/reusable-ci-web.yml@${REVIEWED_SHA}
  second:
    uses: *web
  flow: { uses: jrmoulckers/.github/.github/workflows/reusable-ci-lint.yml@${REVIEWED_SHA} }
  quoted:
    "uses": !!str jrmoulckers/.github/.github/workflows/reusable-security-ci.yml@${REVIEWED_SHA}
  folded:
    uses: >-
      jrmoulckers/.github/.github/workflows/reusable-smoke-test.yml@${REVIEWED_SHA}
  shell:
    runs-on: ubuntu-latest
    steps:
      - run: |-
          echo "uses: jrmoulckers/.github/.github/workflows/not-a-call.yml@main"
  ignored: value #, uses: jrmoulckers/.github/.github/workflows/reusable-smoke-test.yml@main
`,
    },
    (root) => {
      assert.deepEqual(
        deriveCalledWorkflows(root, BACKBONE).uses.map((use) => ({
          name: use.name,
          ref: use.ref,
          line: use.line,
        })),
        [
          { name: 'reusable-ci-web', ref: REVIEWED_SHA, line: 4 },
          { name: 'reusable-ci-web', ref: REVIEWED_SHA, line: 6 },
          { name: 'reusable-ci-lint', ref: REVIEWED_SHA, line: 7 },
          { name: 'reusable-security-ci', ref: REVIEWED_SHA, line: 9 },
          { name: 'reusable-smoke-test', ref: REVIEWED_SHA, line: 11 },
        ],
      );
    },
  );
});

test('comparison reports unused availability and rejects checkout uses missing from the registry', () => {
  const files = {
    'package.json': JSON.stringify({ devDependencies: { svelte: '5.0.0' } }),
    'package-lock.json': '{}\n',
    '.github/workflows/ci.yml': `
jobs:
  shared:
    uses: jrmoulckers/.github/.github/workflows/reusable-ci-web.yml@${REVIEWED_SHA}
`,
  };
  withFixture(files, (root) => {
    const facts = assertMemberFacts(root, member(), BACKBONE);
    assert.deepEqual(facts.workflowAvailability.value, ['planned-workflow', 'reusable-ci-web']);
    assert.deepEqual(facts.workflowObservations.unusedDeclarations, ['planned-workflow']);
    assert.deepEqual(facts.workflowObservations.undeclaredUses, []);
    assert.throws(
      () =>
        assertMemberFacts(
          root,
          member({ groups: [{ kind: 'workflows', names: ['planned-workflow'] }] }),
          BACKBONE,
        ),
      (error) => {
        assert.match(error.message, /owner\/member/);
        assert.match(error.message, /workflow availability/);
        assert.match(error.message, /"reusable-ci-web"/);
        assert.match(error.message, /\.github\/workflows\/ci\.yml:4/);
        return true;
      },
    );
  });
});

test('workflow uses require full immutable commit SHAs and include deterministic evidence', () => {
  withFixture(
    {
      'package.json': JSON.stringify({ devDependencies: { svelte: '5.0.0' } }),
      'package-lock.json': '{}\n',
      '.github/workflows/z-release.yml': `
jobs:
  release:
    uses: jrmoulckers/.github/.github/workflows/reusable-ci-web.yml@v2
`,
      '.github/workflows/a-ci.yml': `
jobs:
  ci:
    uses: jrmoulckers/.github/.github/workflows/reusable-ci-web.yml@main
`,
    },
    (root) => {
      const derived = deriveCalledWorkflows(root, BACKBONE);
      assert.deepEqual(
        derived.uses.map((use) => `${use.path}:${use.line}@${use.ref}`),
        [
          '.github/workflows/a-ci.yml:4@main',
          '.github/workflows/z-release.yml:4@v2',
        ],
      );
      assert.throws(
        () => assertMemberFacts(root, member(), BACKBONE),
        (error) => {
          assert.match(error.message, /a-ci\.yml:4 pins "main"/);
          assert.match(error.message, /z-release\.yml:4 pins "v2"/);
          assert.match(error.message, /full 40-character commit SHA/);
          return true;
        },
      );
    },
  );
});

test('scalar mismatch diagnostics name the claim, derivation, and evidence', () => {
  withFixture(
    {
      'package.json': JSON.stringify({ devDependencies: { svelte: '5.0.0' } }),
      'package-lock.json': '{}\n',
    },
    (root) => {
      assert.throws(
        () =>
          assertMemberFacts(
            root,
            member({ framework: 'nextjs', packageManager: 'pnpm' }),
            BACKBONE,
          ),
        (error) => {
          assert.match(error.message, /framework claims "nextjs"/);
          assert.match(error.message, /derives "svelte" from package\.json Svelte dependency/);
          assert.match(error.message, /packageManager claims "pnpm"/);
          assert.match(error.message, /derives "npm" from package-lock\.json/);
          return true;
        },
      );
    },
  );
});

test('infrastructure mode verifies each applicable fact and accepts evidence-backed absence', () => {
  withFixture(
    {
      'pnpm-lock.yaml': 'lockfileVersion: 9\n',
      'tools/package-lock.json': '{}\n',
    },
    (root) => {
      assert.doesNotThrow(() =>
        assertMemberFacts(root, infrastructure({ packageManager: 'pnpm' }), BACKBONE),
      );
      assert.throws(
        () => assertMemberFacts(root, infrastructure(), BACKBONE),
        /packageManager is omitted in infrastructure mode but checkout derives "pnpm"/,
      );
    },
  );

  withFixture({ 'tools/package-lock.json': '{}\n' }, (root) => {
    assert.doesNotThrow(() => assertMemberFacts(root, infrastructure(), BACKBONE));
    assert.throws(
      () =>
        assertMemberFacts(
          root,
          infrastructure({ framework: 'svelte', packageManager: 'npm' }),
          BACKBONE,
        ),
      (error) => {
        assert.match(error.message, /framework claims "svelte" but checkout has no supported/);
        assert.match(error.message, /packageManager claims "npm" but checkout has no supported/);
        return true;
      },
    );
  });
});

test('pre-bootstrap mode rejects supported framework or package-manager transition evidence', () => {
  withFixture({ 'README.md': '# Empty product\n' }, (root) => {
    assert.doesNotThrow(() => assertMemberFacts(root, preBootstrap(), BACKBONE));
  });

  withFixture(
    {
      'package.json': JSON.stringify({ devDependencies: { svelte: '5.0.0' } }),
      'pnpm-lock.yaml': 'lockfileVersion: 9\n',
    },
    (root) => {
      assert.throws(
        () => assertMemberFacts(root, preBootstrap(), BACKBONE),
        (error) => {
          assert.match(error.message, /pre-bootstrap mode is no longer valid/);
          assert.match(error.message, /framework "svelte"/);
          assert.match(error.message, /packageManager "pnpm"/);
          assert.match(error.message, /upgrade mode and declared facts before syncing/);
          return true;
        },
      );
    },
  );
});

test('non-application modes still verify called reusable workflows', () => {
  const files = {
    '.github/workflows/ci.yml': `
jobs:
  shared:
    uses: jrmoulckers/.github/.github/workflows/reusable-ci-lint.yml@${REVIEWED_SHA}
`,
  };
  withFixture(files, (root) => {
    for (const candidate of [infrastructure(), preBootstrap()]) {
      assert.throws(
        () => assertMemberFacts(root, candidate, BACKBONE),
        /workflow availability does not declare checkout use "reusable-ci-lint"/,
      );
    }
  });
});

test('pre-bootstrap transition aborts the clone-owning sync before writes', () => {
  withFixture(
    {
      'package.json': JSON.stringify({ devDependencies: { svelte: '5.0.0' } }),
      'pnpm-lock.yaml': 'lockfileVersion: 9\n',
    },
    (root) => {
      let applied = false;
      assert.throws(
        () =>
          syncMemberRepo(
            {
              repo: 'owner/member',
              member: preBootstrap(),
              writes: [{ targetPath: 'AGENTS.md' }],
              token: 'test-token',
              date: '2026-08-07',
              force: false,
              backbone: BACKBONE,
            },
            (args) => {
              args.inspectCheckout(root);
              applied = true;
              return { status: 'unchanged', report: { drift: [] } };
            },
          ),
        /pre-bootstrap mode is no longer valid/,
      );
      assert.equal(applied, false);
    },
  );
});

test('real member sync wires checkout verification into the clone-owning operation', () => {
  withFixture(
    {
      'package.json': JSON.stringify({ devDependencies: { svelte: '5.0.0' } }),
      'package-lock.json': '{}\n',
    },
    (root) => {
      let inspected = false;
      const result = syncMemberRepo(
        {
          repo: 'owner/member',
          member: member(),
          writes: [],
          token: 'test-token',
          date: '2026-08-07',
          force: false,
          backbone: BACKBONE,
        },
        (args) => {
          assert.equal(typeof args.inspectCheckout, 'function');
          args.inspectCheckout(root);
          inspected = true;
          return { status: 'unchanged', report: { drift: [] } };
        },
      );

      assert.equal(inspected, true);
      assert.equal(result.status, 'unchanged');
    },
  );
});
