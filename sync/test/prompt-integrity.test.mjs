import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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

test('a line-continued gh pr checks command is still field-validated', () => {
  withFixture(
    {
      'alpha.prompt.md': `---
name: alpha
description: Test prompt.
parameters: []
built_ins: []
agent_dependencies: []
---

# Test

## Runtime Contract

gh pr checks 1 \\
  --json name,totallyInvalid
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
          assert.match(error.message, /unsupported JSON field "totallyInvalid"/);
          return true;
        },
      );
    },
  );
});

test('an emphasised or backticked gh pr checks command is still field-validated', () => {
  for (const [label, command] of [
    ['bold subcommand', 'gh **pr** checks 1 --json name,totallyInvalid'],
    ['backticked command', '`gh pr checks` 1 --json name,totallyInvalid'],
    ['backticked flag', 'gh pr checks 1 `--json name,totallyInvalid`'],
    ['fully inline', '`gh pr checks 1 --json name,totallyInvalid`'],
  ]) {
    withFixture(
      {
        'alpha.prompt.md': `---
name: alpha
description: Test prompt.
parameters: []
built_ins: []
agent_dependencies: []
---

# Test

## Runtime Contract

${command}
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
            assert.match(error.message, /unsupported JSON field "totallyInvalid"/, label);
            return true;
          },
          label,
        );
      },
    );
  }
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

// The same two generic field validators are blind here as in agent-integrity: each can be given a
// `return;` and the full suite stays green. Every prompt-specific validator above has a test that
// feeds it something to reject; these two never did.
test('prompt frontmatter field shapes are rejected: empty description and bad lists', () => {
  const clean = validPrompt('alpha');
  withFixture({ 'alpha.prompt.md': clean }, { prompts: ['alpha'], agents: [], members: [] }, (root, manifest) => {
    assert.doesNotThrow(
      () => validatePromptIntegrity(root, manifest),
      'PREMISE: the baseline fixture must pass, or every case below could fail for another reason',
    );
  });

  const cases = [
    ['description', clean.replace('description: Test prompt.', "description: '  '"), /"description" must be a non-empty string/],
    ['built_ins unsupported', clean.replace('built_ins: []', 'built_ins:\n  - telepathy'), /"built_ins" contains unsupported value "telepathy"/],
    ['agent_dependencies duplicated', clean.replace('agent_dependencies: []', 'agent_dependencies:\n  - qa-tester\n  - qa-tester'), /"agent_dependencies" contains duplicate "qa-tester"/],
  ];
  // The `must be a list` arm of validateStringList is deliberately absent: the frontmatter parser
  // rejects a non-list first ("must use a YAML list or []"), so that branch is latent through this
  // entry point rather than untested. Pinning it here would freeze a claim about a state the parser
  // makes unreachable, and would pass on the parser's message rather than the validator's.

  for (const [label, content, expected] of cases) {
    assert.notEqual(content, clean, `${label}: the fixture edit changed nothing, so it tests nothing`);
    withFixture(
      { 'alpha.prompt.md': content },
      { prompts: ['alpha'], agents: ['qa-tester'], members: [] },
      (root, manifest) => {
        assert.throws(() => validatePromptIntegrity(root, manifest), expected, `${label} must be rejected`);
      },
    );
  }
});

// Reaching a validator directly proves the validator works. Only reaching it THROUGH the entry
// point proves the entry point still calls it -- deleting `validateRoster(records, declared, errors)`
// from validatePromptIntegrity left the whole suite green, because every test that covers rostering
// calls into behaviour the dispatch is merely the delivery mechanism for. Each row corrupts a
// fixture in a way only its own validator reports, so the needle is an isolation check, not just a
// throw check: a bystander error would satisfy `assert.throws` and tell us nothing.
const PROMPT_DISPATCH = [
  {
    call: 'validateUniqueNames(records, errors)',
    files: { 'alpha.prompt.md': validPrompt('alpha'), 'beta.prompt.md': validPrompt('alpha') },
    config: { prompts: ['alpha', 'beta'], agents: [], members: [] },
    needle: 'duplicate prompt name "alpha"',
  },
  {
    call: 'validateRoster(records, declared, errors)',
    files: { 'alpha.prompt.md': validPrompt('alpha'), 'beta.prompt.md': validPrompt('beta') },
    config: { prompts: ['alpha'], agents: [], members: [] },
    needle: 'beta.prompt.md is not declared in canon.prompts',
  },
  {
    call: 'validateMemberDependencyClosure(records, manifest, errors)',
    files: { 'alpha.prompt.md': validPrompt('alpha', { agentDependencies: ['ghost'] }) },
    config: { prompts: ['alpha'], agents: [], members: [] },
    needle: 'references unknown canonical agent "ghost"',
  },
];

test('every prompt validator is reached from the integrity entry point', () => {
  for (const row of PROMPT_DISPATCH) {
    withFixture(row.files, row.config, (root, manifest) => {
      let message = null;
      try {
        validatePromptIntegrity(root, manifest);
      } catch (error) {
        message = error.message;
      }
      assert.ok(message, `${row.call} must be reached: its corruption produced no error at all`);
      assert.ok(
        message.includes(row.needle),
        `${row.call} must be reached from validatePromptIntegrity: no ${JSON.stringify(row.needle)} in ${JSON.stringify(message)}`,
      );
    });
  }
});

// The table above is maintained by hand, in the same repository as the dispatch it mirrors, which is
// the very shape the test exists to catch one level up. Deriving the population from the entry
// point's own source means a validator added to the dispatch without a row here fails rather than
// passing unnoticed.
test('the prompt dispatch table covers every validator the entry point calls', () => {
  const source = readFileSync(join(REPO_ROOT, 'sync', 'lib', 'prompt-integrity.mjs'), 'utf8');
  const start = source.indexOf('export function validatePromptIntegrity');
  assert.ok(start >= 0, 'validatePromptIntegrity is no longer an exported declaration');
  const end = source.indexOf('\nfunction ', start);
  assert.ok(end > start, 'could not find the end of the validatePromptIntegrity body');
  // Slice past the signature: the entry point's own declaration matches the call regex, and counting
  // it would make the table permanently one row short of a set that can never be satisfied.
  const body = source.slice(source.indexOf('\n', start), end);

  const called = [...body.matchAll(/\bvalidate[A-Z]\w*\([^)]*\)/g)].map((match) => match[0]);
  assert.ok(called.length > 0, 'extracted no validator calls, so this check would pass vacuously');

  const covered = PROMPT_DISPATCH.map((row) => row.call);
  assert.deepEqual(
    [...new Set(called)].sort(),
    [...new Set(covered)].sort(),
    'the reachability table and the entry point dispatch must name the same validators',
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
