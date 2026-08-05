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

// The onboarding PR these facts originally came from (jrmoulckers/cartridge#1) was closed without
// merging. Re-verified against jrmoulckers/cartridge@2536220 (2026-08-03) by reading package.json
// and the lockfile; re-check when cartridge changes either. An undated "verified against main"
// stops being a fact the moment main moves, and reads as a certificate discouraging a re-check.
test('cartridge is a Svelte/npm repo', () => {
  const [cartridge] = resolveAll(manifest, ['jrmoulckers/cartridge']);
  assert.equal(cartridge.framework, 'svelte');
  assert.equal(cartridge.packageManager, 'npm');
});

// Verified by reading each member's .github/workflows/ on its default branch and extracting every
// `uses: jrmoulckers/.github/.github/workflows/<name>.yml` reference (2026-08-03). The suite is
// offline, so the sweep is pinned here rather than re-fetched; re-run it when a member changes CI.
const CALLED_WORKFLOWS = {
  'jrmoulckers/jrm-recipes': [],
  'jrmoulckers/score-king': [],
  'jrmoulckers/finance': [],
  'jrmoulckers/libro': [
    'reusable-ci-lint',
    'reusable-ci-web',
    'reusable-deploy-preview',
    'reusable-perf-budget',
  ],
  // cartridge adopted reusable-ci-lint in its PR #9 once the empty-command guard existed; before
  // that it inlined its own semantic-PR-title job, and optIn.workflows omitted the entry.
  'jrmoulckers/cartridge': [
    'reusable-ci-lint',
    'reusable-ci-web',
    'reusable-deploy-preview',
    'reusable-perf-budget',
  ],
};

// One-directional on purpose. Listing a workflow a member does not call yet is legitimate — the
// kind is native, nothing is written, and the opt-in records intent. Calling one that is NOT
// listed is the error: the registry then misdescribes the member, and nothing else can catch it.
//
// KNOWN BLIND SPOT — a member can define its OWN workflow with a canon filename.
// The sweep above reads `uses: jrmoulckers/.github/.github/workflows/<name>.yml`, so a local
// definition called via `uses: ./.github/workflows/<name>.yml` is invisible to it by construction.
// `jrmoulckers/finance` is the live instance: it calls zero backbone workflows (hence `[]` above,
// which is correct), while carrying its own `.github/workflows/reusable-smoke-test.yml` — 276
// lines against canon's 155, not a superset — and its registry entry lists `reusable-smoke-test`.
//
// Two different files wear one name, and neither side can see it: the registry sees a member that
// calls nothing shared, finance sees a workflow it calls every run. It arms a specific future
// failure — if finance ever switches that call to `uses: jrmoulckers/.github/...@main`, it swaps a
// 276-line definition for a 155-line one with no diff anywhere and no error.
//
// Deliberately NOT asserted here. Detecting it needs the member's full workflow directory, which
// this offline suite does not have, and pinning finance's local filenames would be a fact-test of
// exactly the kind that went stale within the hour last time — it would certify a wrong value
// rather than merely fail to help. Recorded as a caveat instead; see sync/README.md.
test('every reusable workflow a member calls is listed in its optIn.workflows', () => {
  for (const [repo, called] of Object.entries(CALLED_WORKFLOWS)) {
    const [resolved] = resolveAll(manifest, [repo]);
    const listed = resolved.groups.find((g) => g.kind === 'workflows')?.names ?? [];
    for (const name of called) {
      assert.ok(
        listed.includes(name),
        `${repo} calls ${name} but optIn.workflows does not list it`,
      );
      assert.ok(
        manifest.canon.workflows.includes(name),
        `${repo} calls ${name}, which is not in canon.workflows`,
      );
    }
  }
});

test('finance keeps its custom tokens path and AI-layer opt-outs', () => {
  const [finance] = resolveAll(manifest, ['jrmoulckers/finance']);
  assert.equal(finance.tokens.targetBase, 'apps/web/vendor/@jrm/tokens');
  const kinds = finance.groups.map((g) => g.kind);
  for (const kind of ['agents', 'skills', 'prompts', 'instructions']) {
    assert.ok(!kinds.includes(kind), `finance must stay opted out of ${kind}`);
  }
});

// This test is also what backs a security claim: STUDIO_SYNC_TOKEN is documented as needing NO
// `workflow` scope, because no write ever lands under `.github/workflows/` in any member. If this
// assertion ever fails, fix the native-kind handling — do not widen the token.
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

// cartridge briefly carried explicit agent/skill/prompt lists, on the reasoning that its partial
// canon set (11 of 19 agents) was a deliberate fit decision for an offline catalogue. That was
// retracted. The author of that tree confirmed the list came from a hand-typed OPT_IN object in a
// one-off scaffold script — deliberate in mechanism, a first-pass guess in substance, reasoned from
// "client-side PWA" in the same commit that added a Cloudflare Worker doing an OAuth exchange, KV
// caching and a CORS allowlist. The tell: that commit did opt into the privacy-compliance and
// security-review-methodology *skills*, so the concern was live and simply never carried to the
// agent list. Ruling out one cause for a subset does not establish another.
//
// So the rule is: "*" is the default, because adding canon is cheap and reversible while a frozen
// list is neither — nothing ever prompts a re-read of it. Narrowing is a real decision, and this
// test requires that whoever makes it writes down why, in `notes`.
//
// Note what this test deliberately does NOT do. Its first version asserted that cartridge's three
// keys stay arrays and named the omitted files — pinning a contested inference as an invariant, so
// the next reader to doubt it would have had to argue with a red suite rather than a config value.
// Assert schema and consistency, not which names someone picked. This version constrains how a
// choice is recorded, not what the choice is. It is inert today by design and arms itself the
// moment a member curates.
test('a member that narrows its AI layer records the reason in notes', () => {
  for (const member of manifest.members) {
    const narrowed = ['agents', 'skills', 'prompts'].filter((k) => Array.isArray(member.optIn[k]));
    if (narrowed.length === 0) continue;
    assert.ok(
      typeof member.notes === 'string' && member.notes.length > 0,
      `${member.repo} pins an explicit ${narrowed.join('/')} list but records no reason in notes — ` +
        'a frozen list nothing will ever re-examine needs a stated justification',
    );
  }
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
