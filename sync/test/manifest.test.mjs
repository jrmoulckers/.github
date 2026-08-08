// The real studio.config.json must validate, and the registry must contain every member.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readdirSync, existsSync } from 'node:fs';
import {
  applyManifestDefaults,
  loadManifest,
  KINDS,
  MEMBER_MODES,
  NATIVE_KINDS,
  validateManifest,
} from '../lib/manifest.mjs';
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
    'jrmoulckers/docket',
    'jrmoulckers/studio',
    'jrmoulckers/homelab',
    'jrmoulckers/windows',
  ]);
  assert.ok(!repos.includes('jrmoulckers/.github'), 'the backbone is not its own consumer');
});

test('member modes have an application default and a closed schema', () => {
  assert.deepEqual(MEMBER_MODES, ['application', 'infrastructure', 'pre-bootstrap']);

  const legacy = structuredClone(manifest);
  const recipes = legacy.members.find((member) => member.repo === 'jrmoulckers/jrm-recipes');
  delete recipes.mode;
  applyManifestDefaults(legacy);
  assert.equal(recipes.mode, 'application');
  assert.doesNotThrow(() => validateManifest(legacy));

  const invalid = structuredClone(manifest);
  invalid.members[0].mode = 'unverified';
  assert.throws(
    () => validateManifest(invalid),
    /mode must be one of "application", "infrastructure", "pre-bootstrap"/,
  );
});

test('mode schema requires application facts and reserves them until pre-bootstrap upgrades', () => {
  const missingApplicationFact = structuredClone(manifest);
  delete missingApplicationFact.members[0].framework;
  assert.throws(
    () => validateManifest(missingApplicationFact),
    /framework is required in application mode/,
  );

  const prematurePreBootstrapFact = structuredClone(manifest);
  const docket = prematurePreBootstrapFact.members.find(
    (member) => member.repo === 'jrmoulckers/docket',
  );
  docket.mode = 'pre-bootstrap';
  docket.packageManager = 'pnpm';
  assert.throws(
    () => validateManifest(prematurePreBootstrapFact),
    /packageManager must be omitted in pre-bootstrap mode/,
  );
});

test('phase-two members resolve dependency-closed roles and curated instruction profiles', () => {
  const expectedLocalAgents = new Map([
    ['jrmoulckers/finance', ['finance-domain']],
    ['jrmoulckers/studio', []],
    [
      'jrmoulckers/homelab',
      [
        'automation-steward',
        'backup-warden',
        'edge-warden',
        'host-operator',
        'inventory-scribe',
        'media-steward',
        'security-warden',
        'service-steward',
      ],
    ],
    ['jrmoulckers/windows', []],
  ]);
  const expectedInstructions = new Map([
    ['jrmoulckers/finance', ['agents', 'docs', 'skills', 'tokens', 'workflow']],
    ['jrmoulckers/studio', ['agents', 'docs', 'skills', 'tokens', 'workflow']],
    ['jrmoulckers/homelab', ['agents', 'infrastructure-operations']],
    ['jrmoulckers/windows', ['agents', 'docs', 'infrastructure-operations', 'skills']],
  ]);

  assert.equal(manifest.canon.agents.length, 22);
  for (const [repo, localAgents] of expectedLocalAgents) {
    const member = manifest.members.find((candidate) => candidate.repo === repo);
    const [resolved] = resolveAll(manifest, [repo]);

    assert.deepEqual(member.localAgents ?? [], localAgents, `${repo} keeps its verified local roster`);
    for (const kind of ['agents', 'skills']) {
      assert.equal(member.optIn[kind], '*', `${repo} keeps ${kind} dependency-closed`);
      assert.deepEqual(
        resolved.groups.find((group) => group.kind === kind).names,
        manifest.canon[kind],
        `${repo} resolves all canonical ${kind}`,
      );
    }
    assert.deepEqual(member.optIn.instructions, expectedInstructions.get(repo));
    assert.deepEqual(
      resolved.groups.find((group) => group.kind === 'instructions').names,
      expectedInstructions.get(repo),
      `${repo} resolves its curated instruction profile`,
    );
    const resolvedPrompts = resolved.groups.find((group) => group.kind === 'prompts').names;
    if (repo === 'jrmoulckers/homelab') {
      assert.deepEqual(member.optIn.prompts, ['backlog', 'cleanup', 'review']);
      assert.deepEqual(resolvedPrompts, member.optIn.prompts);
    } else {
      assert.equal(member.optIn.prompts, '*', `${repo} keeps prompts dependency-closed`);
      assert.deepEqual(resolvedPrompts, manifest.canon.prompts);
    }

    const selectedAgents = resolved.groups.find((group) => group.kind === 'agents').names;
    assert.deepEqual(
      localAgents.filter((name) => selectedAgents.includes(name)),
      [],
      `${repo} has no canonical/local slug overlap`,
    );
    assert.equal(
      selectedAgents.length + localAgents.length,
      22 + localAgents.length,
      `${repo} has the expected total runtime-agent count`,
    );
  }

  assert.doesNotThrow(() => validateManifest(manifest));
});

test('bug-bash is canonical and selected by application wildcard members', () => {
  assert.ok(manifest.canon.prompts.includes('bug-bash'));
  for (const member of manifest.members.filter(
    (candidate) => candidate.mode === 'application' && candidate.optIn.prompts === '*',
  )) {
    const [resolved] = resolveAll(manifest, [member.repo]);
    assert.ok(
      resolved.groups.find((group) => group.kind === 'prompts').names.includes('bug-bash'),
      `${member.repo} receives bug-bash`,
    );
  }

  const scoreKing = manifest.members.find((member) => member.repo === 'jrmoulckers/score-king');
  assert.ok(scoreKing.optIn.prompts.includes('bug-bash'));
});

test('phase-two activation preserves member modes and non-AI bundle intent', () => {
  const finance = manifest.members.find((member) => member.repo === 'jrmoulckers/finance');
  assert.equal(finance.mode, 'application');
  assert.equal(finance.optIn.base, true);
  assert.equal(finance.optIn.health, true);
  assert.deepEqual(finance.optIn.workflows, []);
  assert.deepEqual(finance.tokens, {
    enabled: true,
    targetPath: 'apps/web/vendor/@jrm/tokens',
  });

  for (const repo of ['jrmoulckers/studio', 'jrmoulckers/homelab', 'jrmoulckers/windows']) {
    const member = manifest.members.find((candidate) => candidate.repo === repo);
    assert.equal(member.mode, 'infrastructure');
    assert.equal(member.optIn.base, false);
    assert.equal(member.optIn.health, false);
    assert.equal(member.optIn.workflows, false);
    assert.deepEqual(member.tokens, { enabled: false });

    const [resolved] = resolveAll(manifest, [repo]);
    const { writes, native } = enumerateTargets(resolved, REPO_ROOT);
    assert.equal(writes.filter((write) => write.kind === 'agents').length, 22);
    assert.ok(!writes.some((write) => write.kind === 'base'), `${repo} has no base writes`);
    assert.ok(!writes.some((write) => write.kind === 'tokens'), `${repo} has no token writes`);
    assert.deepEqual(native, [], `${repo} has no native selections`);
  }

  const studio = manifest.members.find((member) => member.repo === 'jrmoulckers/studio');
  assert.equal(studio.packageManager, 'pnpm');
  assert.equal(studio.framework, undefined);
  assert.equal(manifest.tokens.sourceRepo, studio.repo);
});

test('Docket records its completed transition from pre-bootstrap to application', () => {
  const docket = manifest.members.find((member) => member.repo === 'jrmoulckers/docket');
  assert.equal(docket.mode, 'application');
  assert.equal(docket.framework, 'svelte');
  assert.equal(docket.packageManager, 'pnpm');
  assert.deepEqual(docket.tokens, { enabled: true }, 'preserve Docket token adoption');
});

test('libro, cartridge, and docket use the root-default vendored tokens path', () => {
  for (const repo of ['jrmoulckers/libro', 'jrmoulckers/cartridge', 'jrmoulckers/docket']) {
    const [resolved] = resolveAll(manifest, [repo]);
    assert.equal(resolved.tokens?.enabled, true, `${repo} opts into tokens`);
    assert.equal(resolved.tokens.targetBase, manifest.tokens.targetPath, `${repo} uses the default path`);
  }
});

test('finance keeps its custom tokens path while activating its AI layer', () => {
  const [finance] = resolveAll(manifest, ['jrmoulckers/finance']);
  assert.equal(finance.tokens.targetBase, 'apps/web/vendor/@jrm/tokens');
  const kinds = finance.groups.map((g) => g.kind);
  for (const kind of ['agents', 'skills', 'prompts', 'instructions']) {
    assert.ok(kinds.includes(kind), `finance must opt into ${kind}`);
  }
});

test('wildcard members receive the expanded agent roster while explicit subsets stay pinned', () => {
  for (const member of manifest.members.filter((candidate) => candidate.optIn.agents === '*')) {
    const [resolved] = resolveAll(manifest, [member.repo]);
    const agents = resolved.groups.find((group) => group.kind === 'agents');
    assert.deepEqual(agents.names, manifest.canon.agents, `${member.repo} expands wildcard agents`);
  }

  const scoreKing = manifest.members.find((member) => member.repo === 'jrmoulckers/score-king');
  const [resolvedScoreKing] = resolveAll(manifest, [scoreKing.repo]);
  const scoreKingAgents = resolvedScoreKing.groups.find((group) => group.kind === 'agents');
  assert.deepEqual(scoreKingAgents.names, scoreKing.optIn.agents, 'score-king stays explicit');
  assert.deepEqual(scoreKing.localAgents, ['design-engineer']);
  assert.equal(scoreKing.optIn.skills, '*', 'score-king keeps selected-agent skill closure');
  assert.ok(scoreKing.optIn.prompts.includes('team'), 'score-king includes the declared team prompt');
  assert.deepEqual(
    scoreKingAgents.names,
    manifest.canon.agents.filter((name) => name !== 'design-engineer'),
    'score-king receives canon except its declared local design replacement',
  );
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

// cartridge briefly carried explicit agent/skill/prompt lists, on the reasoning that its initial
// canon set (11 of the then-current 19 agents) was a deliberate fit decision for an offline catalogue. That was
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

test('a local replacement cannot overlap synced canon', () => {
  const bad = structuredClone(manifest);
  const scoreKing = bad.members.find((member) => member.repo === 'jrmoulckers/score-king');
  scoreKing.optIn.agents.push('design-engineer');
  assert.throws(
    () => validateManifest(bad),
    /localAgents "design-engineer" overlaps optIn\.agents/,
  );
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
