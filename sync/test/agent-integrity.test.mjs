import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateAgentIntegrity } from '../lib/agent-integrity.mjs';
import { loadManifest } from '../lib/manifest.mjs';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

test('the real canonical agent roster passes integrity validation', () => {
  const manifest = loadManifest(REPO_ROOT);
  const agents = validateAgentIntegrity(REPO_ROOT, manifest);

  assert.equal(agents.length, manifest.canon.agents.length);
  for (const name of ['native-app-engineer', 'database-engineer', 'sre-engineer']) {
    assert.ok(agents.some((agent) => agent.name === name), `${name} should be in canonical agents`);
  }
});

test('name, uniqueness, sections, and handoff references fail together with clear paths', () => {
  withFixture(
    {
      'alpha.agent.md': validAgent('shared', {
        omitSection: 'Technical Context',
        extraBody: '\nRoute implementation to @missing-agent.\n',
      }),
      'beta.agent.md': validAgent('shared'),
    },
    ['alpha', 'beta'],
    (root, manifest) => {
      assert.throws(
        () => validateAgentIntegrity(root, manifest),
        (error) => {
          assert.match(error.message, /frontmatter name "shared" must match filename "alpha"/);
          assert.match(error.message, /duplicate agent name "shared"/);
          assert.match(error.message, /requires exactly one "## Technical Context" section/);
          assert.match(error.message, /references undeclared agent "@missing-agent"/);
          return true;
        },
      );
    },
  );
});

test('manifest parity and canonical skill/prompt references are enforced', () => {
  withFixture(
    {
      'alpha.agent.md': validAgent('alpha', {
        relatedSkill: 'missing-skill',
        extraBody: '\nUse the `missing-prompt` prompt.\n',
      }),
      'extra.agent.md': validAgent('extra'),
    },
    ['alpha', 'absent'],
    (root, manifest) => {
      assert.throws(
        () => validateAgentIntegrity(root, manifest),
        (error) => {
          assert.match(error.message, /canon\.agents "absent" has no agent file/);
          assert.match(error.message, /extra\.agent\.md is not declared in canon\.agents/);
          assert.match(error.message, /references undeclared related skill "missing-skill"/);
          assert.match(error.message, /references undeclared prompt "missing-prompt"/);
          return true;
        },
      );
    },
  );
});

test('explicit member rosters require referenced canon or a declared local replacement', () => {
  const files = {
    'alpha.agent.md': validAgent('alpha', { extraBody: '\nHand off to @beta.\n' }),
    'beta.agent.md': validAgent('beta'),
  };
  const member = { repo: 'o/member', optIn: { agents: ['alpha'] }, localAgents: [] };

  withFixture(files, ['alpha', 'beta'], (root, manifest) => {
    manifest.members = [member];
    assert.throws(
      () => validateAgentIntegrity(root, manifest),
      /selected agent "alpha" references unavailable "@beta"/,
    );

    member.localAgents = ['beta'];
    assert.doesNotThrow(() => validateAgentIntegrity(root, manifest));
  });
});

test('explicit member rosters require declared skills while prompt mentions remain optional', () => {
  const files = {
    'alpha.agent.md': validAgent('alpha', {
      relatedSkill: 'known-skill',
      extraBody: '\nUse the `known-prompt` prompt.\n',
    }),
  };
  const member = {
    repo: 'o/member',
    optIn: { agents: ['alpha'], skills: false, prompts: false },
  };

  withFixture(files, ['alpha'], (root, manifest) => {
    manifest.members = [member];
    assert.throws(
      () => validateAgentIntegrity(root, manifest),
      /requires unavailable skill "known-skill"/,
    );

    member.optIn.skills = ['known-skill'];
    assert.doesNotThrow(() => validateAgentIntegrity(root, manifest));
  });
});

// These three field-shape validators can each be blinded with the whole suite green: no fixture in
// this file ever gave them a value to reject. Every domain validator here -- rosters, references,
// closures -- has a violating-state test because some past defect forced one to be written. The
// generic helpers are blind in agent-integrity and prompt-integrity alike, which is the signature of
// coverage accumulated from incidents rather than designed.
test('frontmatter field shapes are rejected: empty strings, unknown enums, and bad lists', () => {
  const clean = validAgent('alpha');
  withFixture({ 'alpha.agent.md': clean }, ['alpha'], (root, manifest) => {
    assert.doesNotThrow(
      () => validateAgentIntegrity(root, manifest),
      'PREMISE: the baseline fixture must pass, or every case below could fail for another reason',
    );
  });

  const cases = [
    ['description', clean.replace('description: Test agent.', "description: '   '"), /"description" must be a non-empty string/],
    ['when_to_use', clean.replace("when_to_use: 'Testing integrity validation.'", "when_to_use: ''"), /"when_to_use" must be a non-empty string/],
    ['model', clean.replace('model: standard', 'model: not-a-real-model'), /"model" must be one of standard, strong-reasoning/],
    ['write_scope', clean.replace('write_scope: full', 'write_scope: everything'), /"write_scope" must be one of read-only, scoped-write, full/],
    ['risk_level', clean.replace('risk_level: low', 'risk_level: catastrophic'), /"risk_level" must be one of low, medium, high/],
    ['tools empty', clean.replace('tools:\n  - read\n  - edit', 'tools: []'), /"tools" must be a non-empty list/],
    ['tools unknown', clean.replace('tools:\n  - read\n  - edit', 'tools:\n  - read\n  - telepathy'), /"tools" contains unsupported value "telepathy"/],
    ['tools duplicated', clean.replace('tools:\n  - read\n  - edit', 'tools:\n  - read\n  - read'), /"tools" must not contain duplicates/],
    ['primary_paths', clean.replace("primary_paths:\n  - 'src/**'", 'primary_paths: []'), /"primary_paths" must be a non-empty list/],
  ];

  for (const [label, content, expected] of cases) {
    assert.notEqual(content, clean, `${label}: the fixture edit changed nothing, so it tests nothing`);
    withFixture({ 'alpha.agent.md': content }, ['alpha'], (root, manifest) => {
      assert.throws(() => validateAgentIntegrity(root, manifest), expected, `${label} must be rejected`);
    });
  }
});

function withFixture(files, canonAgents, run) {
  const root = mkdtempSync(join(tmpdir(), 'studio-agent-integrity-'));
  try {
    const dir = join(root, 'agents');
    mkdirSync(dir);
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content, 'utf8');
    }
    run(root, {
      sourcePaths: { agents: 'agents' },
      canon: { agents: canonAgents, skills: ['known-skill'], prompts: ['known-prompt'] },
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function validAgent(name, options = {}) {
  const sections = [
    'Role',
    'Capabilities',
    'File Ownership',
    'Workflow',
    'Planning & Verification',
    'Technical Context',
    'Boundaries',
  ].filter((section) => section !== options.omitSection);
  const related = options.relatedSkill
    ? `\n> **Related skills:** \`${options.relatedSkill}\` — use when needed.\n`
    : '';
  const body = sections
    .map((section) =>
      section === 'Boundaries'
        ? `## ${section}\n\nText.\n\n### Human-Gated Operations\n\nText.\n`
        : `## ${section}\n\nText.\n`,
    )
    .join('\n');

  return `---
name: ${name}
description: Test agent.
model: standard
when_to_use: 'Testing integrity validation.'
primary_paths:
  - 'src/**'
write_scope: full
risk_level: low
tools:
  - read
  - edit
---

# Test Agent
${related}
${body}${options.extraBody ?? ''}`;
}
