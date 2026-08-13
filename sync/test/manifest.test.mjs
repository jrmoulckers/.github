// The real studio.config.json must validate, and the registry must contain every member.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { readdirSync, existsSync } from 'node:fs';
import {
  engineErrorFragments,
  engineSourcesByGit,
  engineSourcesByWalk,
} from './engine-sources.mjs';
import {
  applyManifestDefaults,
  BREADTH_FLOOR,
  loadManifest,
  KINDS,
  MEMBER_MODES,
  NATIVE_KINDS,
  validateManifest,
} from '../lib/manifest.mjs';
import { resolveAll } from '../lib/resolve.mjs';
import { enumerateTargets } from '../lib/assets.mjs';
import { markersFor, MARKERS } from '../lib/basemerge.mjs';
import { inject } from '../lib/provenance.mjs';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const manifest = loadManifest(REPO_ROOT);

test('studio.config.json validates', () => {
  assert.doesNotThrow(() => validateManifest(manifest));
});

// The corpus sweeps across this suite open with `assert.ok(x.length > 0, ...)`, and that guard
// cannot be pinned from in here: weakening it to `>= 0` is precisely the change the suite would
// have to notice about itself. Measured, not assumed -- five such premises were mutated one at a
// time and all five survived, with an injected `assert.ok(false)` in each file first to prove the
// harness could see a failure at all. So the floor lives in production, where a mutation to it is
// catchable, and these assertions pin that it is reached rather than merely correct.
test('a manifest with no delivery targets is rejected', () => {
  const empty = applyManifestDefaults(
    structuredClone({ ...manifest, members: [], expectedFailures: [], excluded: [] }),
  );
  assert.throws(
    () => validateManifest(empty),
    /members` must contain at least/,
    'zero members plans no writes and passes every corpus sweep vacuously',
  );
});

test('a manifest with an empty canon roster is rejected', () => {
  const stripped = structuredClone(manifest);
  stripped.canon.workflows = [];
  for (const member of stripped.members) delete member.optIn.workflows;
  assert.throws(
    () => validateManifest(applyManifestDefaults(stripped)),
    /canon\.workflows must declare at least/,
    'an empty roster makes every workflow check vacuous',
  );
});

test('the breadth requirement is a floor, not a pin on the current fleet', () => {
  // An exact count breaks the first time a member is onboarded and gets reverted rather than read.
  assert.ok(
    manifest.members.length > BREADTH_FLOOR.members,
    'the real fleet must exceed the floor, or this test cannot distinguish the two',
  );
  const single = applyManifestDefaults(
    structuredClone({
      ...manifest,
      members: [manifest.members[0]],
      expectedFailures: [],
      excluded: [],
    }),
  );
  assert.doesNotThrow(
    () => validateManifest(single),
    'a fleet at the floor must be accepted, or the floor is an exact pin',
  );
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
    'jrmoulckers/engineering',
    'jrmoulckers/product',
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
    ['jrmoulckers/finance', ['agents', 'canon-formatting', 'docs', 'skills', 'tokens', 'workflow']],
    ['jrmoulckers/studio', ['agents', 'canon-formatting', 'docs', 'skills', 'tokens', 'workflow']],
    ['jrmoulckers/homelab', ['agents', 'canon-formatting', 'infrastructure-operations']],
    [
      'jrmoulckers/windows',
      ['agents', 'canon-formatting', 'docs', 'infrastructure-operations', 'skills'],
    ],
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
  // The opt-in is the intent this test guards; the path is deliberately *not* restated here.
  // finance follows the manifest default, so asserting a literal on the member block would pin
  // the very redundancy #390 removed. The resolved value is what matters and is checked below.
  assert.deepEqual(finance.tokens, { enabled: true });
  const [resolvedFinance] = resolveAll(manifest, ['jrmoulckers/finance']);
  assert.equal(resolvedFinance.tokens.targetBase, manifest.tokens.targetPath);

  for (const repo of ['jrmoulckers/studio', 'jrmoulckers/homelab', 'jrmoulckers/windows']) {
    const member = manifest.members.find((candidate) => candidate.repo === repo);
    assert.equal(member.mode, 'infrastructure');
    assert.equal(member.optIn.base, false);
    assert.equal(member.optIn.health, false);
    assert.deepEqual(member.tokens, { enabled: false });

    const [resolved] = resolveAll(manifest, [repo]);
    const { writes } = enumerateTargets(resolved, REPO_ROOT);
    assert.equal(writes.filter((write) => write.kind === 'agents').length, 22);
    assert.ok(!writes.some((write) => write.kind === 'base'), `${repo} has no base writes`);
    assert.ok(!writes.some((write) => write.kind === 'tokens'), `${repo} has no token writes`);
    if (repo !== 'jrmoulckers/studio') {
      assert.equal(member.optIn.workflows, false);
      assert.deepEqual(
        enumerateTargets(resolved, REPO_ROOT).native,
        [],
        `${repo} has no native selections`,
      );
    }

    // The reason runtime and copilot were split out of base: declining the studio operating
    // guide must not also decline canonical MCP policy or Copilot-surface orientation.
    assert.deepEqual(
      writes.filter((write) => write.kind === 'runtime').map((write) => write.targetPath),
      ['agency.toml'],
      `${repo} still receives canonical MCP policy`,
    );
    assert.deepEqual(
      writes.filter((write) => write.kind === 'copilot').map((write) => write.targetPath),
      ['.github/copilot-instructions.md'],
      `${repo} still receives Copilot-surface orientation`,
    );
  }

  const studio = manifest.members.find((member) => member.repo === 'jrmoulckers/studio');
  assert.equal(studio.packageManager, 'pnpm');
  assert.equal(studio.framework, undefined);
  assert.equal(manifest.tokens.sourceRepo, studio.repo);
});

test('every member that calls reusable CI declares reusable-security-ci', () => {
  // The first real distribution run failed six of twelve targets because members had adopted
  // reusable-security-ci without the manifest recording it. Declared workflow availability is a
  // verified fact, so a stale array blocks the whole member — not just its workflow selection.
  for (const member of manifest.members) {
    const declared = member.optIn.workflows;
    if (!Array.isArray(declared) || declared.length === 0) continue;
    assert.ok(
      declared.includes('reusable-security-ci'),
      `${member.repo} calls backbone CI, so it must declare reusable-security-ci`,
    );
    for (const name of declared) {
      assert.ok(
        manifest.canon.workflows.includes(name),
        `${member.repo} declares unknown workflow ${name}`,
      );
    }
    assert.deepEqual([...declared].sort(), declared, `${member.repo} lists workflows in order`);
  }
});

test('every member receives runtime, copilot and attributes regardless of base', () => {
  for (const member of manifest.members) {
    assert.equal(member.optIn.runtime, true, `${member.repo} opts into runtime`);
    assert.equal(member.optIn.copilot, true, `${member.repo} opts into copilot`);
    assert.equal(member.optIn.attributes, true, `${member.repo} opts into attributes`);
  }
});

test('runtime, copilot and attributes are independently selectable booleans', () => {
  for (const kind of ['runtime', 'copilot', 'attributes']) {
    const off = structuredClone(manifest);
    off.members[0].optIn[kind] = false;
    assert.doesNotThrow(() => validateManifest(off), `${kind} may be declined`);

    const [resolved] = resolveAll(off, [off.members[0].repo]);
    assert.ok(
      !resolved.groups.some((group) => group.kind === kind),
      `declining ${kind} removes its group`,
    );

    const bad = structuredClone(manifest);
    bad.members[0].optIn[kind] = '*';
    assert.throws(() => validateManifest(bad), new RegExp(`optIn\\.${kind} must be a boolean`));
  }
});

test('managed-merge kinds own exactly one file at a fixed, Copilot-visible path', () => {
  // Two canon entries would both claim the same marker pair, and a relocated target would be
  // written somewhere Copilot never reads. Both fail loudly rather than silently.
  const extra = structuredClone(manifest);
  extra.canon.copilot = ['copilot-instructions.md', 'extra.md'];
  assert.throws(() => validateManifest(extra), /canon\.copilot must list exactly one managed file/);

  const moved = structuredClone(manifest);
  moved.targetPaths.copilot = 'docs';
  assert.throws(
    () => validateManifest(moved),
    /canon\.copilot must materialize to \.github\/copilot-instructions\.md, got docs\/copilot-instructions\.md/,
  );

  const movedBase = structuredClone(manifest);
  movedBase.targetPaths.base = 'docs';
  assert.throws(() => validateManifest(movedBase), /canon\.base must materialize to AGENTS\.md/);

  const movedAttributes = structuredClone(manifest);
  movedAttributes.targetPaths.attributes = '.github';
  assert.throws(
    () => validateManifest(movedAttributes),
    /canon\.attributes must materialize to \.gitattributes, got \.github\/\.gitattributes/,
  );
});

test('every managed target marks its region in the syntax its own grammar accepts', () => {
  // homelab shipped this bug member-side: a checker that hardcoded the HTML marker pair
  // reported drift on correct `.gitattributes` content, because that target's region is
  // delimited with `# studio:base:*`. The engine derives the syntax from the file type and
  // throws on an unknown one, so a future managed target with a `#` grammar can no longer
  // receive `<!-- ... -->` silently.
  const managed = new Set();
  for (const resolved of resolveAll(manifest)) {
    for (const write of enumerateTargets(resolved, REPO_ROOT).writes) {
      if (write.type === 'managed') managed.add(write.targetPath);
    }
  }
  assert.ok(managed.size > 0, 'no managed targets discovered — this check would assert nothing');

  const provenanceStyle = (targetPath) => {
    const head = inject(targetPath, 'BODY', { sourceRepo: 'x/y' }).split('\n')[0];
    if (head.startsWith('<!--')) return 'html';
    if (head.startsWith('#')) return 'hash';
    if (head.startsWith('/*')) return 'block';
    return 'none';
  };

  for (const targetPath of managed) {
    const markerStyle = markersFor(targetPath) === MARKERS.hash ? 'hash' : 'html';
    assert.equal(
      markerStyle,
      provenanceStyle(targetPath),
      `${targetPath}: managed markers are ${markerStyle} but its provenance comment is ` +
        `${provenanceStyle(targetPath)} — the region delimiters would not be comments in this file`,
    );
  }
});

test('the managed set is a strict subset of the set taking a hash comment', () => {
  // Collapsing "takes a `#` provenance comment" with "is a managed-region target" is the
  // next wrong-unit bug: `agency.toml` takes the comment and is copied wholesale.
  const managed = new Set();
  const hashCommented = new Set();
  for (const resolved of resolveAll(manifest)) {
    for (const write of enumerateTargets(resolved, REPO_ROOT).writes) {
      if (write.type === 'managed') managed.add(write.targetPath);
      if (inject(write.targetPath, 'BODY', { sourceRepo: 'x/y' }).startsWith('#')) {
        hashCommented.add(write.targetPath);
      }
    }
  }
  const managedHash = [...managed].filter((p) => hashCommented.has(p));
  assert.ok(managedHash.length > 0, 'no hash-commented managed target — this check would assert nothing');
  assert.ok(
    [...hashCommented].some((p) => !managed.has(p)),
    'the two sets have converged; a check keyed to one would now silently answer for the other',
  );
});

test('runtime is a whole-file copy while copilot merges a managed region', () => {
  const [finance] = resolveAll(manifest, ['jrmoulckers/finance']);
  const { writes } = enumerateTargets(finance, REPO_ROOT);

  const runtime = writes.find((write) => write.kind === 'runtime');
  assert.equal(runtime.targetPath, 'agency.toml');
  assert.equal(runtime.type, 'file', 'agency.toml is copied wholesale, not marker-merged');

  for (const [kind, targetPath] of [
    ['base', 'AGENTS.md'],
    ['copilot', '.github/copilot-instructions.md'],
    ['attributes', '.gitattributes'],
  ]) {
    const spec = writes.find((write) => write.kind === kind);
    assert.equal(spec.targetPath, targetPath);
    assert.equal(spec.type, 'managed', `${kind} merges into a managed region`);
  }
});

test('engineering and product take the AI layer without a product toolchain', () => {
  for (const repo of ['jrmoulckers/engineering', 'jrmoulckers/product']) {
    const member = manifest.members.find((candidate) => candidate.repo === repo);
    assert.equal(member.mode, 'infrastructure', `${repo} is an authority, not a product`);
    assert.equal(member.optIn.base, false);
    assert.equal(member.optIn.health, false);
    assert.equal(member.optIn.workflows, false);
    assert.deepEqual(member.tokens, { enabled: false }, `${repo} is not a token target`);
    assert.ok(
      !member.optIn.instructions.includes('tokens'),
      `${repo} does not author tokens — Studio owns them`,
    );

    const [resolved] = resolveAll(manifest, [repo]);
    const { writes, native } = enumerateTargets(resolved, REPO_ROOT);
    assert.equal(writes.filter((write) => write.kind === 'agents').length, 22);
    assert.equal(writes.filter((write) => write.kind === 'runtime').length, 1);
    assert.equal(writes.filter((write) => write.kind === 'copilot').length, 1);
    assert.deepEqual(native, [], `${repo} has no native selections`);
  }
});

test('the tokens cohort supports cross-member arbitration', () => {
  // sync/README.md tells a member that a second consumer's recorded sourceSha256 arbitrates a
  // failing inverse audit without studio access. That recipe is only performable while at least
  // two members vendor tokens, and the cohort is manifest state that has changed over time --
  // consumers were opted in one at a time, so this property was false earlier and can become
  // false again. Fail here rather than leaving the published recipe quietly unusable.
  const consumers = manifest.members.filter((member) => member.tokens?.enabled === true);
  assert.ok(
    consumers.length >= 2,
    `cross-member token arbitration needs 2+ consumers, found ${consumers.length}: ` +
      `${consumers.map((member) => member.repo).join(', ') || '(none)'}`,
  );

  // The arbiter compares one target path across members, so the consumers must agree on where
  // the distribution lands. A per-member targetPath would make the lookup in the recipe wrong
  // without making any existing assertion fail.
  const bases = new Set(
    consumers.map((member) => member.tokens.targetPath ?? manifest.canon?.tokens?.targetPath ?? '(default)'),
  );
  assert.equal(
    bases.size,
    1,
    `token consumers must share one target base for the arbiter to compare: ${[...bases].join(', ')}`,
  );
});

test('enumerateTargets partitions every resolved group; nothing is silently dropped', () => {
  // A conservation law, not a count. The original defect was a bare `continue` that removed
  // external groups from the return value entirely, so no caller could discover that a whole
  // delivered class existed -- and a caller that reported `writes` as the delivery understated
  // it by the entire token distribution with nothing in the value to warn it. Asserting today's
  // kinds would self-liquidate the moment the manifest gains or loses one; asserting the
  // partition holds regardless of what canon contains.
  const members = resolveAll(manifest);
  assert.ok(members.length > 0, 'no members resolved: this test would assert nothing');

  let sawExternal = false;
  for (const member of members) {
    const { writes, native, external } = enumerateTargets(member, REPO_ROOT);
    if (external.length > 0) sawExternal = true;

    const accounted = new Set([...native, ...external].map((group) => group.kind));
    for (const write of writes) accounted.add(write.kind);

    for (const group of member.groups) {
      assert.ok(
        accounted.has(group.kind),
        `${member.repo}: group "${group.kind}" appears in no bucket of enumerateTargets`,
      );
    }

    const nativeKinds = new Set(native.map((group) => group.kind));
    for (const group of external) {
      assert.ok(
        !nativeKinds.has(group.kind),
        `${member.repo}: kind "${group.kind}" is both native and external`,
      );
    }
  }

  // Non-vacuity: the external bucket must actually be exercised by the real manifest, or the
  // partition above is proven only for classes that were never at risk.
  assert.ok(sawExternal, 'no member has an external group: the regression cannot recur here');
});

test('Docket records its completed transition from pre-bootstrap to application', () => {  const docket = manifest.members.find((member) => member.repo === 'jrmoulckers/docket');
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

test('finance vendors tokens at the repo root so every platform app can reach them', () => {
  const [finance] = resolveAll(manifest, ['jrmoulckers/finance']);
  assert.equal(finance.tokens.targetBase, 'vendor/@jrm/tokens');
  assert.equal(
    finance.tokens.targetBase,
    manifest.tokens.targetPath,
    'a kmp-web member with android/ios/web/windows apps must not bury native token output inside apps/web',
  );
  const kinds = finance.groups.map((g) => g.kind);
  for (const kind of ['agents', 'skills', 'prompts', 'instructions']) {
    assert.ok(kinds.includes(kind), `finance must opt into ${kind}`);
  }
});

// A member override that restates the default is refused, because it is indistinguishable from
// a deliberate pin and behaves identically to one until the default moves — at which point every
// other member follows the new path and this one silently does not. No diff on its line, nothing
// failing, no channel that would report it.
//
// finance carried exactly this after #108/#109 repointed it to the repo root and the value it
// was given happened to equal the default. It was the fleet's only override, so removing it
// leaves none: "only finance could hit the tokens base-move class" stops being a fact about
// today's manifest and becomes a property of the schema.
//
// The rule is deliberately narrow. Overriding to a *different* path stays legal, because that
// is what pinning means and the engine supports it; only the form that expresses no intent is
// rejected.
test('a member tokens.targetPath equal to the default is rejected, a differing one is not', () => {
  const restated = structuredClone(manifest);
  const finance = restated.members.find((member) => member.repo === 'jrmoulckers/finance');
  finance.tokens.targetPath = restated.tokens.targetPath;
  assert.throws(
    () => validateManifest(restated),
    /tokens\.targetPath \("vendor\/@jrm\/tokens"\) restates tokens\.targetPath/,
    'an override equal to the default must be refused',
  );

  // Non-vacuity, and the boundary of the rule in one assertion: the same field set to a path
  // that actually differs must still validate. Without this, a rule that banned every override
  // outright would pass the throw above while silently removing a supported capability.
  const pinned = structuredClone(manifest);
  pinned.members.find((member) => member.repo === 'jrmoulckers/finance').tokens.targetPath =
    'apps/web/vendor/@jrm/tokens';
  assert.doesNotThrow(() => validateManifest(pinned), 'a genuine pin to a different path stays legal');
});

test('no member restates the default tokens path, and finance resolves without an override', () => {
  for (const [i, member] of manifest.members.entries()) {
    if (!member.tokens || member.tokens.targetPath === undefined) continue;
    assert.notEqual(
      member.tokens.targetPath,
      manifest.tokens.targetPath,
      `members[${i}] (${member.repo}) restates the default tokens path`,
    );
  }
  const finance = manifest.members.find((member) => member.repo === 'jrmoulckers/finance');
  assert.equal(finance.tokens.targetPath, undefined, 'finance follows the default rather than restating it');
  assert.equal(finance.tokens.enabled, true, 'removing the override must not disturb the opt-in');
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
  // An explicit array is a frozen census: it stops tracking canon the moment it is written, so every
  // later addition reaches the wildcard members and silently misses this one. The agents assertion
  // above is keyed to canon and therefore fails when the roster grows; prompts had no equivalent, and
  // the only other prompt reach test filters to `optIn.prompts === '*'`, excluding this member by
  // construction. Keyed to canon minus the single recorded omission so a new prompt forces a decision
  // rather than quietly not arriving.
  assert.deepEqual(
    [...scoreKing.optIn.prompts].sort(),
    manifest.canon.prompts.filter((name) => name !== 'rebase-all').sort(),
    'score-king receives canon prompts except rebase-all, which its notes record as unexplained',
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

// The `excluded` list records repositories the owner has deliberately decided not to govern, so
// that absence from `members` can be told apart from an oversight. It is inert by construction:
// nothing in the engine reads it, which is what stops it becoming a way to suppress real drift.
// The tests below pin the two properties that make it trustworthy — a reason is mandatory, and a
// repository cannot be both governed and deliberately ungoverned.
test('game-library is recorded as a deliberate exclusion, not a member', () => {
  const repos = manifest.members.map((m) => m.repo);
  assert.ok(!repos.includes('jrmoulckers/game-library'), 'game-library must not be a member');

  const entry = manifest.excluded.find((e) => e.repo === 'jrmoulckers/game-library');
  assert.ok(entry, 'game-library must be recorded in `excluded` so a sweep does not re-flag it');
  assert.match(entry.reason, /\S/);
});

test('every excluded entry carries a reason', () => {
  // `?? []` makes a missing `excluded` key pass rather than fail; that is the same
  // state a manifest regression produces.
  assert.ok(
    Array.isArray(manifest.excluded) && manifest.excluded.length > 0,
    'no excluded entries — this check would assert nothing',
  );
  for (const entry of manifest.excluded) {
    assert.match(entry.repo, /^[^/]+\/[^/]+$/);
    assert.ok(
      typeof entry.reason === 'string' && entry.reason.trim(),
      `excluded entry "${entry.repo}" must say why it is not governed`,
    );
  }
});

test('an exclusion without a reason is rejected', () => {
  const bad = structuredClone(manifest);
  bad.excluded = [{ repo: 'jrmoulckers/example' }];
  assert.throws(() => validateManifest(bad), /must be a non-empty string saying why/);
});

test('a repository cannot be both a member and excluded', () => {
  const contradiction = structuredClone(manifest);
  contradiction.excluded = [{ repo: manifest.members[0].repo, reason: 'contradictory' }];
  assert.throws(
    () => validateManifest(contradiction),
    /appears in both `members` and `excluded`/,
  );
});

test('excluded is optional and never affects what is synced', () => {
  const without = structuredClone(manifest);
  delete without.excluded;
  assert.doesNotThrow(() => validateManifest(without));

  // The engine resolves from `members` alone, so removing the record changes no output at all.
  assert.deepEqual(
    resolveAll(applyManifestDefaults(without)),
    resolveAll(applyManifestDefaults(structuredClone(manifest))),
  );
});
// `principles/README.md` states that the principles tree is backbone-internal and that a
// cross-authority handoff recorded there is not self-delivering. That is a claim about the
// delivered surface, and a claim about the surface stated only in prose goes stale the moment the
// surface changes -- silently, and in the direction that makes a handoff look delivered.
//
// The point is not that principles/ *should* stay undelivered. Widening the surface is an owner
// decision. The point is that widening it must update the paragraph that tells a reader a handoff
// named there has not reached anyone, so this fails until it does.
// Extracted so the premise below can be exercised against a constructed surface as well as the
// real one. An inline guard is only ever run against a corpus that satisfies it, which makes it
// indistinguishable from a guard that does nothing -- the failure this whole test exists to catch.
function deliverySurface(members) {
  const origins = new Map();
  const externals = [];
  for (const member of members) {
    const targets = enumerateTargets(member, REPO_ROOT);
    for (const group of targets.external) externals.push({ repo: member.repo, group });
    for (const write of targets.writes) {
      const tree = (write.sourcePath ?? '').split('/')[0];
      origins.set(tree, (origins.get(tree) ?? 0) + 1);
    }
  }
  return { origins, externals };
}

// `writes` is not the delivered surface. Quantifying over it as though it were is the precise
// misuse `enumerateTargets` warns about in its own docblock, and that the partition test above
// describes in its own comment -- both texts predate the test that then did it. Vendored token
// groups are delivered to real members and are structurally absent from `writes`.
//
// Leaving them out of the origin tally stays admissible only because their bytes are copied from
// `sourceRepo` rather than from this repository, which makes a backbone-internal origin impossible
// by construction rather than merely absent today. That premise is asserted, not assumed, and its
// population is guarded: an exclusion that covers nothing silently restores the narrow reading.
function assertExternalsCannotCarryCanon(externals, backboneRepo) {
  assert.ok(
    externals.length > 0,
    'no external groups enumerated: the exclusion this justifies covers nothing, so the origin ' +
      'tally has quietly gone back to quantifying over `writes` alone',
  );
  assert.ok(backboneRepo, 'the manifest names no backbone; the exclusion cannot be checked');
  for (const { repo, group } of externals) {
    assert.ok(
      typeof group.sourceRepo === 'string' && group.sourceRepo.trim(),
      `${repo}: external group "${group.kind}" names no sourceRepo, so nothing establishes that ` +
        'its bytes come from outside this repository',
    );
    assert.notEqual(
      group.sourceRepo,
      backboneRepo,
      `${repo}: external group "${group.kind}" is sourced from the backbone itself, so it can ` +
        'carry a backbone-internal tree into a member and the origin tally would never see it',
    );
  }
}

test('no delivered file originates in a backbone-internal tree, as principles/README.md states', () => {
  const { origins, externals } = deliverySurface(resolveAll(manifest));

  // Without this, an enumeration that returned nothing would satisfy every assertion below.
  const total = [...origins.values()].reduce((sum, n) => sum + n, 0);
  assert.ok(total > 0, 'no writes enumerated: this test would assert nothing');

  for (const tree of ['principles', 'docs', 'sync', 'profile']) {
    assert.equal(
      origins.get(tree) ?? 0,
      0,
      `${tree}/ now reaches members; principles/README.md still says a handoff there is undelivered`,
    );
  }

  // The positive half: the trees that *are* delivered, so this cannot pass by enumerating a
  // population that excludes the interesting one -- the failure it is modelled on.
  assert.ok(origins.get('agents') > 0, 'agents/ is delivered; an enumeration missing it is wrong');
  assert.ok(origins.get('skills') > 0, 'skills/ is delivered; an enumeration missing it is wrong');

  // Read from the manifest rather than written here: a transcribed identity would be one more
  // constant that agrees with canon today and silently stops agreeing later.
  assertExternalsCannotCarryCanon(externals, manifest.backbone);
});

// The guard above fires only in states the real manifest does not reach, so against this corpus it
// is indistinguishable from no guard at all. Weakening it changes no result and no test notices --
// which is the exact shape being fixed, one level up. So the states are constructed here.
test('the delivered-surface premise fails when its population empties or its source moves home', () => {
  const backbone = manifest.backbone;
  const real = deliverySurface(resolveAll(manifest)).externals;
  assert.ok(real.length > 0, 'the real manifest must exercise the premise, or the cases below are hypothetical');

  // Population empties: every token consumer switched off. The origin tally would then cover only
  // `writes` while still claiming the delivered surface, and must not pass quietly.
  const noTokens = structuredClone(manifest);
  for (const member of noTokens.members) if (member.tokens) member.tokens.enabled = false;
  const emptied = deliverySurface(resolveAll(noTokens)).externals;
  assert.equal(emptied.length, 0, 'disabling every token consumer must actually empty the class');
  assert.throws(
    () => assertExternalsCannotCarryCanon(emptied, backbone),
    /covers nothing/,
    'an empty external class must fail the premise rather than satisfy it vacuously',
  );

  // Source moves home: a token group vendored out of the backbone itself could carry a principle
  // into a member, and the origin tally -- which never looks at external groups -- would not see it.
  const fromBackbone = real.map((entry) => ({
    ...entry,
    group: { ...entry.group, sourceRepo: backbone },
  }));
  assert.throws(
    () => assertExternalsCannotCarryCanon(fromBackbone, backbone),
    /sourced from the backbone itself/,
  );

  // And an external group that names no source at all establishes nothing either way.
  const unsourced = real.map((entry) => ({ ...entry, group: { ...entry.group, sourceRepo: undefined } }));
  assert.throws(() => assertExternalsCannotCarryCanon(unsourced, backbone), /names no sourceRepo/);
});

test('an accepted failure must name a member, a signature, and a route to its fix', () => {
  const base = () => {
    const m = structuredClone(manifest);
    m.expectedFailures = [
      {
        repo: m.members[0].repo,
        signature: 'error: 403',
        reason: 'why',
        issue: 'https://example.invalid/1',
      },
    ];
    return m;
  };

  assert.doesNotThrow(() => validateManifest(base()));

  // A repository-wide exemption absorbs the next unrelated failure at that member.
  const noSignature = base();
  delete noSignature.expectedFailures[0].signature;
  assert.throws(() => validateManifest(noSignature), /signature must be a non-empty string/);

  // An accepted failure with no route to a fix is indistinguishable from an abandoned member.
  const noIssue = base();
  delete noIssue.expectedFailures[0].issue;
  assert.throws(() => validateManifest(noIssue), /must name the issue that closes/);

  // The inverse of `excluded`: a fault can only be accepted where the engine actually calls.
  const stranger = base();
  stranger.expectedFailures[0].repo = 'jrmoulckers/not-a-member';
  assert.throws(() => validateManifest(stranger), /is not in `members`/);
});

// An exemption is trusted more than the check it narrows, because narrowing reads as precision --
// and nobody re-derives an exemption's population. `validateExpectedFailures` justifies `signature`
// by narrowness ("pins one fault rather than granting a repository standing amnesty") and enforces
// only non-emptiness. Those are different properties. Measured before this guard existed: with the
// signature set to "e", the real manifest validates clean and `partitionFailures` classifies
// `fatal: could not write lockfile: no space left on device` as the accepted 403, so the run goes
// green on a fault nobody has seen.
//
// The remedy is deliberately not a minimum length. `2832257` retracted a length-based remedy in
// this repo, and a threshold is an arbitrary proxy for the property that actually matters: does
// this string absorb faults other than the one it was recorded for? So the corpus of "other faults"
// is derived from the engine's own `new Error(...)` sites, and a signature contained in one of them
// is one that would absorb it.
//
// LIMITATION, stated because the check must not imply more than it can see: this is a lower bound.
// It enumerates faults the engine raises itself and cannot enumerate messages from git, the network
// or the GitHub API -- which is where the live signature comes from. "failed" collides with nothing
// here and is still a bad signature. This catches a real subclass and is silent about the rest.
const absorbedBy = (signature, fragments) =>
  [...fragments].filter((fragment) => fragment.includes(signature)).sort();

test('an accepted signature must not absorb the failures the engine raises itself', () => {
  // The decoy corpus is only as wide as the population it reads, and a narrowed population stays
  // internally consistent -- the size floor below passes under exactly the narrowing it guards
  // against. So the walk is falsified by an enumeration that shares none of its logic first.
  const walked = engineSourcesByWalk();
  assert.deepEqual(walked, engineSourcesByGit(), 'engine source walk disagrees with git ls-files');

  // The cross-check above is weaker than it looks and the limit is worth naming: both enumerations
  // apply the same `isEngineSource` predicate, so narrowing *the predicate* leaves them agreeing.
  // A mutant that reduced the corpus to `sync/lib` passed this line and died only in the seam
  // suite. So the entry points are named here too, and this suite fails on its own.
  for (const entry of ['sync/index.mjs', 'sync/lib/git.mjs']) {
    assert.ok(walked.includes(entry), `${entry} is shipped engine source and must raise decoys`);
  }

  const fragments = engineErrorFragments(walked);
  assert.ok(fragments.size > 10, `only ${fragments.size} engine error fragment(s) discovered`);

  const manifest = loadManifest(REPO_ROOT);

  // The check, applied to a register rather than read off the live one, so the property can be
  // proved against a corpus that cannot empty.
  const violations = (register) =>
    register
      .filter((entry) => absorbedBy(entry.signature, fragments).length > 0)
      .map((entry) => entry.repo);

  // `expectedFailures` is designed to drain: every entry names the issue whose closure deletes it,
  // and the live register below may legitimately be empty. The floor that used to stand here --
  // `recorded.length > 0`, reported as "this check would be vacuous" -- turned that success into a
  // red suite, on the one day the exemption is correctly removed. A guard that fails when the world
  // improves is resolved by restoring the exemption or deleting the guard, so it pins open the very
  // register it audits. The non-vacuity guarantee belongs on a constructed register instead.
  assert.deepEqual(
    violations([{ repo: 'narrow/fixture', signature: 'The requested URL returned error: 403' }]),
    [],
    'a signature narrow enough to pin one fault must not be reported as absorbing engine errors',
  );
  assert.deepEqual(
    violations([{ repo: 'broad/fixture', signature: 'e' }]),
    ['broad/fixture'],
    'an over-broad signature must be reported through the same path the live register uses',
  );

  // The live register, with no floor on its size. It is an additional corpus, not the guarantee.
  assert.deepEqual(
    violations(manifest.expectedFailures ?? []),
    [],
    'a recorded expectedFailures signature is broad enough to absorb an engine error',
  );

  // Positive control, constructed and routed through the same predicate the assertion uses. A
  // control that re-implements the comparison passes while the production copy is weakened.
  const overBroad = absorbedBy('e', fragments);
  assert.ok(
    overBroad.length > 1,
    `a one-character signature must be reported as absorbing many faults, got ${overBroad.length}`,
  );
});