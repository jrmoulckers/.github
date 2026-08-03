// The real studio.config.json must validate, and the registry must contain every member.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readdirSync, existsSync } from 'node:fs';
import { loadManifest, KINDS, NATIVE_KINDS, validateManifest } from '../lib/manifest.mjs';
import { resolveAll } from '../lib/resolve.mjs';
import { enumerateTargets } from '../lib/assets.mjs';

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

test('native kinds are reported but never produce a write', () => {
  assert.deepEqual([...NATIVE_KINDS].sort(), ['health', 'workflows']);

  for (const resolved of resolveAll(manifest)) {
    const { writes, native } = enumerateTargets(resolved, REPO_ROOT);

    // Opting in to health/workflows must never install a file in the member: a local copy
    // overrides the inherited health file (freezing it) or forks a reusable workflow.
    for (const spec of writes) {
      assert.ok(
        !NATIVE_KINDS.has(spec.kind),
        `${resolved.repo}: native kind ${spec.kind} must not be written (${spec.targetPath})`,
      );
      assert.ok(
        !/^\.github\/workflows\//.test(spec.targetPath),
        `${resolved.repo}: nothing may be written under .github/workflows/ (${spec.targetPath})`,
      );
    }

    // …but they are still resolved and reported, so the plan reflects the opt-in.
    const optedIn = resolved.groups.filter((g) => NATIVE_KINDS.has(g.kind)).map((g) => g.kind);
    assert.deepEqual(native.map((n) => n.kind).sort(), optedIn.sort());
  }
});

// Nothing in the engine validates `framework` or `packageManager`, so a wrong value never fails a
// run — it just misleads every agent that reads the registry. Pinning them here is the only
// enforcement available: changing a member's stack without updating this test fails CI.
//
// Asserting against the member's real lockfile would be stronger, but the suite is deliberately
// offline (CI runs it with no token and no network), and these repos are private. Verify by hand
// against the member's DEFAULT BRANCH — not an onboarding PR — and update this table.
test('every member records its real framework and package manager', () => {
  const actual = Object.fromEntries(
    manifest.members.map((m) => [m.repo, [m.framework, m.packageManager]]),
  );
  assert.deepEqual(actual, {
    'jrmoulckers/jrm-recipes': ['nextjs', 'pnpm'],
    'jrmoulckers/score-king': ['svelte', 'npm'],
    'jrmoulckers/finance': ['kmp-web', 'npm'],
    'jrmoulckers/libro': ['svelte', 'pnpm'],
    // cartridge: verified against main (Svelte 5 + Vite, package-lock.json). Its Next.js/pnpm
    // onboarding PR #1 was closed without merging — that is where the wrong values came from.
    'jrmoulckers/cartridge': ['svelte', 'npm'],
  });
});

// A curated member must list its AI layer explicitly. `resolveSelection` expands "*" to the whole
// canon list, so "*" on a member that deliberately omits files would re-add them on every run and
// silently overwrite the curation — with no diff to review beyond an `added:` block.
test('cartridge curates its AI layer explicitly rather than with "*"', () => {
  const cartridge = manifest.members.find((m) => m.repo === 'jrmoulckers/cartridge');
  for (const kind of ['agents', 'skills', 'prompts']) {
    assert.ok(
      Array.isArray(cartridge.optIn[kind]),
      `cartridge.optIn.${kind} must stay an explicit list — "*" would undo the curation`,
    );
  }

  // Verified against jrmoulckers/cartridge@main: 11 agents, 11 skill dirs, 5 prompts. The omitted
  // roles are every business/backend/data/i18n one, which do not fit an offline game catalogue
  // with no server tier and no revenue model.
  const [resolved] = resolveAll(manifest, ['jrmoulckers/cartridge']);
  const names = (kind) => resolved.groups.find((g) => g.kind === kind).names;
  assert.equal(names('agents').length, 11);
  assert.equal(names('skills').length, 11);
  assert.equal(names('prompts').length, 5);
  assert.deepEqual(
    manifest.canon.agents.filter((n) => !names('agents').includes(n)),
    [
      'ai-ops-engineer',
      'backend-engineer',
      'business-analyst',
      'compliance-specialist',
      'data-engineer',
      'experimentation-engineer',
      'localization-engineer',
      'marketing-strategist',
    ],
  );
  assert.deepEqual(
    manifest.canon.skills.filter((n) => !names('skills').includes(n)),
    ['go-to-market', 'i18n-localization', 'mcp-agent-tooling', 'monetization'],
  );
  assert.deepEqual(
    manifest.canon.prompts.filter((n) => !names('prompts').includes(n)),
    ['rebase-all', 'team'],
  );
});

// `resolveSelection` filters unknown names out silently, so a typo in an explicit list would mean
// the member just never receives that file. That is safe only because validation rejects the name
// first — this pins the guardrail the filter relies on.
test('an unknown name in an explicit optIn list fails validation', () => {
  const bad = structuredClone(manifest);
  bad.members.find((m) => m.repo === 'jrmoulckers/cartridge').optIn.agents = ['backend-enginer'];
  assert.throws(() => validateManifest(bad), /unknown agents "backend-enginer"/);
});

// canon is hand-maintained. A name with no file resolves to a missing source; a file with no name
// is never synced to anyone. Neither fails a run, so assert both directions here.
test('every canon name has a file on disk, and every file is declared', () => {
  const declared = {
    agents: manifest.canon.agents.map((n) => `${n}.agent.md`),
    prompts: manifest.canon.prompts.map((n) => `${n}.prompt.md`),
    instructions: manifest.canon.instructions.map((n) => `${n}.instructions.md`),
    skills: manifest.canon.skills,
  };
  for (const [kind, expected] of Object.entries(declared)) {
    const dir = join(REPO_ROOT, manifest.sourcePaths[kind]);
    const onDisk = readdirSync(dir).filter((n) => !n.startsWith('.'));
    assert.deepEqual([...onDisk].sort(), [...expected].sort(), `canon.${kind} must match ${dir}`);
  }

  for (const name of manifest.canon.workflows) {
    const p = join(REPO_ROOT, manifest.sourcePaths.workflows, `${name}.yml`);
    assert.ok(existsSync(p), `canon.workflows declares ${name} but ${p} is missing`);
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
