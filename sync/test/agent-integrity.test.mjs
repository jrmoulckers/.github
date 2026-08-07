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

test('manifest parity and related-skill references are enforced', () => {
  withFixture(
    {
      'alpha.agent.md': validAgent('alpha', { relatedSkill: 'missing-skill' }),
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

test('explicit member rosters require declared skills and prompts', () => {
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
      (error) => {
        assert.match(error.message, /requires unavailable skill "known-skill"/);
        assert.match(error.message, /requires unavailable prompt "known-prompt"/);
        return true;
      },
    );

    member.optIn.skills = ['known-skill'];
    member.optIn.prompts = ['known-prompt'];
    assert.doesNotThrow(() => validateAgentIntegrity(root, manifest));
  });
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
