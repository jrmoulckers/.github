import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest } from '../lib/manifest.mjs';
import { validatePromptIntegrity } from '../lib/prompt-integrity.mjs';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

test('the real canonical prompt roster passes integrity validation', () => {
  const manifest = loadManifest(REPO_ROOT);
  const prompts = validatePromptIntegrity(REPO_ROOT, manifest);

  assert.deepEqual(
    prompts.map((prompt) => prompt.name),
    ['backlog', 'bug-bash', 'cleanup', 'fix-ci', 'rebase-all', 'review', 'sprint', 'team'],
  );
  assert.deepEqual(
    prompts.find((prompt) => prompt.name === 'bug-bash').agentDependencies,
    ['qa-tester'],
  );
});

test('schema, names, dependencies, placeholders, and gh fields fail with clear paths', () => {
  withFixture(
    {
      'alpha.prompt.md': `---
name: shared
description: Test prompt.
parameters:
  - name: count
    description: Missing a type.
    default: 1
built_ins: []
agent_dependencies: []
---

# Test

## Runtime Contract

Use {{ missing }}.

task(agent_type="missing-agent")
gh pr checks 1 --json 'name,conclusion,detailsUrl,totallyInvalid'
gh pr checks 2 --json
`,
      'beta.prompt.md': validPrompt('shared'),
    },
    {
      prompts: ['alpha', 'beta'],
      agents: [],
      members: [],
    },
    (root, manifest) => {
      assert.throws(
        () => validatePromptIntegrity(root, manifest),
        (error) => {
          assert.match(error.message, /frontmatter name "shared" must match filename "alpha"/);
          assert.match(error.message, /duplicate prompt name "shared"/);
          assert.match(error.message, /parameter missing field "type"/);
          assert.match(error.message, /unresolved placeholder "\{\{ missing \}\}"/);
          assert.match(error.message, /references undeclared built-in dependency "task"/);
          assert.match(error.message, /references undeclared agent dependency "missing-agent"/);
          assert.match(error.message, /unsupported JSON field "conclusion"/);
          assert.match(error.message, /unsupported JSON field "detailsUrl"/);
          assert.match(error.message, /unsupported JSON field "totallyInvalid"/);
          assert.match(error.message, /unparseable --json selection/);
          return true;
        },
      );
    },
  );
});

test('selected prompts require their declared canonical agents', () => {
  const prompt = validPrompt('alpha', {
    agentDependencies: ['qa-tester'],
    body: 'task(agent_type="qa-tester")',
    builtIns: ['task'],
  });
  const member = {
    repo: 'o/member',
    optIn: { prompts: ['alpha'], agents: false },
  };

  withFixture(
    { 'alpha.prompt.md': prompt },
    {
      prompts: ['alpha'],
      agents: ['qa-tester'],
      members: [member],
    },
    (root, manifest) => {
      assert.throws(
        () => validatePromptIntegrity(root, manifest),
        /selected prompt "alpha" requires unavailable agent "qa-tester"/,
      );

      member.optIn.agents = ['qa-tester'];
      assert.doesNotThrow(() => validatePromptIntegrity(root, manifest));
    },
  );
});

test('integer and agent-list parameters require defaults and positive bounds', () => {
  withFixture(
    {
      'alpha.prompt.md': `---
name: alpha
description: Test prompt.
parameters:
  - name: N
    type: integer
    description: Invalid wave count.
    default: 0
    minimum: 0
    maximum: 3
  - name: agents
    type: agent-list
    description: Invalid list.
    default: ''
    minimum_items: 0
    maximum_items: 5
built_ins: []
agent_dependencies: []
---

# Test

## Runtime Contract

Use {{ N }} and {{ agents }}.
`,
    },
    {
      prompts: ['alpha'],
      agents: [],
      members: [],
    },
    (root, manifest) => {
      assert.throws(
        () => validatePromptIntegrity(root, manifest),
        (error) => {
          assert.match(error.message, /parameter "N" minimum must be positive/);
          assert.match(error.message, /parameter "agents" must set required: true/);
          assert.match(error.message, /minimum_items must be a positive integer/);
          return true;
        },
      );
    },
  );
});

test('bare lists and malformed interpolation delimiters are rejected', () => {
  withFixture(
    {
      'alpha.prompt.md': `---
name: alpha
description: Test prompt.
parameters:
built_ins:
agent_dependencies:
---

# Test

## Runtime Contract

Use {{{ scope }}}.
`,
    },
    {
      prompts: ['alpha'],
      agents: [],
      members: [],
    },
    (root, manifest) => {
      assert.throws(
        () => validatePromptIntegrity(root, manifest),
        (error) => {
          assert.match(error.message, /"parameters" must use explicit \[\] or at least one list item/);
          assert.match(error.message, /"built_ins" must use explicit \[\] or at least one list item/);
          assert.match(
            error.message,
            /"agent_dependencies" must use explicit \[\] or at least one list item/,
          );
          assert.match(error.message, /malformed or unresolved parameter placeholder/);
          return true;
        },
      );
    },
  );
});

function withFixture(files, config, run) {
  const root = mkdtempSync(join(tmpdir(), 'studio-prompt-integrity-'));
  try {
    const dir = join(root, 'prompts');
    mkdirSync(dir);
    for (const [name, content] of Object.entries(files)) {
      writeFileSync(join(dir, name), content, 'utf8');
    }
    run(root, {
      sourcePaths: { prompts: 'prompts' },
      canon: { prompts: config.prompts, agents: config.agents },
      members: config.members,
    });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

function validPrompt(name, options = {}) {
  const builtIns = options.builtIns ?? [];
  const agentDependencies = options.agentDependencies ?? [];
  return `---
name: ${name}
description: Test prompt.
parameters: []
built_ins:${builtIns.length ? `\n${builtIns.map((item) => `  - ${item}`).join('\n')}` : ' []'}
agent_dependencies:${
    agentDependencies.length
      ? `\n${agentDependencies.map((item) => `  - ${item}`).join('\n')}`
      : ' []'
  }
---

# Test

## Runtime Contract

${options.body ?? 'No runtime dependencies.'}
`;
}
