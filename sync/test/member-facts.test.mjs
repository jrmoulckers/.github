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
    framework: 'svelte',
    packageManager: 'npm',
    groups: [{ kind: 'workflows', names: ['reusable-ci-web', 'planned-workflow'] }],
    ...overrides,
  };
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
    uses: jrmoulckers/.github/.github/workflows/reusable-ci-web.yml@main
  local:
    uses: ./.github/workflows/reusable-ci-lint.yml
# uses: jrmoulckers/.github/.github/workflows/commented.yml@main
`,
      '.github/workflows/nested/release.yaml': `
jobs:
  deploy:
    uses: "jrmoulckers/.github/.github/workflows/reusable-deploy-preview.yaml@v2"
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

test('comparison permits planned workflows but rejects checkout calls missing from the registry', () => {
  const files = {
    'package.json': JSON.stringify({ devDependencies: { svelte: '5.0.0' } }),
    'package-lock.json': '{}\n',
    '.github/workflows/ci.yml': `
jobs:
  shared:
    uses: jrmoulckers/.github/.github/workflows/reusable-ci-web.yml@main
`,
  };
  withFixture(files, (root) => {
    assert.doesNotThrow(() => assertMemberFacts(root, member(), BACKBONE));
    assert.throws(
      () =>
        assertMemberFacts(
          root,
          member({ groups: [{ kind: 'workflows', names: ['planned-workflow'] }] }),
          BACKBONE,
        ),
      (error) => {
        assert.match(error.message, /owner\/member/);
        assert.match(error.message, /optIn\.workflows/);
        assert.match(error.message, /"reusable-ci-web"/);
        return true;
      },
    );
  });
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
