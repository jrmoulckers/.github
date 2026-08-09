// Canonical scoped-instruction and member-selection integrity validation.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const GENERAL_INSTRUCTIONS = ['agents', 'docs', 'skills', 'tokens', 'workflow'];
const APPLY_TO = new Map([
  ['agents', 'agents/**,.github/agents/**'],
  ['docs', 'docs/**,*.md,**/README.md'],
  ['infrastructure-operations', '**'],
  ['skills', 'skills/**,.github/skills/**'],
  [
    'tokens',
    'tokens/**,packages/tokens/**,vendor/@jrm/tokens/**,**/vendor/@jrm/tokens/**,**/*.tokens.json',
  ],
  ['workflow', '**'],
]);
const APPLICATION_REPOS = new Set([
  'jrmoulckers/jrm-recipes',
  'jrmoulckers/score-king',
  'jrmoulckers/finance',
  'jrmoulckers/libro',
  'jrmoulckers/cartridge',
  'jrmoulckers/docket',
]);
const WORKFLOW_CALL =
  /uses:\s*jrmoulckers\/\.github\/\.github\/workflows\/[^\s`'"]+@([^\s`'"]+)/gi;

export function validateInstructionIntegrity(repoRoot, manifest) {
  const errors = [];
  const sourceBase = manifest?.sourcePaths?.instructions;
  const declared = manifest?.canon?.instructions;

  if (typeof sourceBase !== 'string' || !Array.isArray(declared)) {
    throw new Error(
      'Cannot validate canonical instructions without sourcePaths.instructions and canon.instructions.',
    );
  }

  const instructionDir = join(repoRoot, ...sourceBase.split('/'));
  const files = readdirSync(instructionDir)
    .filter((name) => name.endsWith('.instructions.md'))
    .sort();
  const records = files.map((fileName) => {
    const name = fileName.slice(0, -'.instructions.md'.length);
    const relativePath = `${sourceBase}/${fileName}`;
    const text = readText(join(instructionDir, fileName));
    return { name, relativePath, text, applyTo: parseApplyTo(relativePath, text, errors) };
  });
  const byName = new Map(records.map((record) => [record.name, record]));

  validateRoster(records, declared, errors);
  validateScopes(byName, errors);
  validateContent(byName, errors);
  validateMemberSelections(manifest, errors);
  validateSourceTargetReferences(repoRoot, errors);
  validateImmutableWorkflowExamples(repoRoot, errors);

  if (errors.length) {
    throw new Error(`Invalid canonical instructions:\n  - ${errors.join('\n  - ')}`);
  }

  return records;
}

function validateRoster(records, declared, errors) {
  for (const name of duplicates(declared)) {
    errors.push(`studio.config.json: canon.instructions contains duplicate "${name}"`);
  }

  const onDisk = new Set(records.map((record) => record.name));
  const inManifest = new Set(declared);
  for (const name of [...inManifest].sort()) {
    if (!onDisk.has(name)) {
      errors.push(`studio.config.json: canon.instructions "${name}" has no instruction file`);
    }
  }
  for (const name of [...onDisk].sort()) {
    if (!inManifest.has(name)) {
      errors.push(`${name}.instructions.md is not declared in canon.instructions`);
    }
  }
}

function validateScopes(byName, errors) {
  for (const [name, expected] of APPLY_TO) {
    const record = byName.get(name);
    if (!record) continue;
    if (record.applyTo !== expected) {
      errors.push(`${record.relativePath}: applyTo must be "${expected}"`);
    }
  }

  const docs = byName.get('docs');
  if (docs?.applyTo.includes('**/*.md')) {
    errors.push(`${docs.relativePath}: applyTo must not blanket-match **/*.md`);
  }
}

function validateContent(byName, errors) {
  requirePatterns(
    byName.get('agents'),
    [
      [/localAgents/, 'declared localAgents'],
      [/local schema|schema extensions?/i, 'documented local schema extensions'],
      [/canonical slug.*local slug|same-slug local replacement/is, 'canonical/local collision guard'],
      [/root\/local `AGENTS\.md`.*more-specific scoped instructions.*override/is, 'local precedence'],
    ],
    errors,
  );
  requirePatterns(
    byName.get('skills'),
    [
      [/skills\/\*\*,\.github\/skills\/\*\*/, 'source and materialized skill scope'],
      [/generated, upstream-owned, read-only/i, 'consumer read-only ownership'],
    ],
    errors,
  );
  requirePatterns(
    byName.get('docs'),
    [
      [/Root\/local `AGENTS\.md`.*more-specific scoped instruction.*override/is, 'precedence language'],
      [/Generated assets are not local editing surfaces/i, 'generated ownership'],
    ],
    errors,
  );
  requirePatterns(
    byName.get('tokens'),
    [
      [/`dist\/\*\*`.*`vendor\/\*\*`/is, 'dist and vendor output distinction'],
      [/consumer repositories.*always read-only/is, 'consumer output protection'],
      [/Studio\/token owner.*sync/is, 'owner and sync routing'],
      [/local product overlay wins/i, 'local token-path precedence'],
    ],
    errors,
  );
  requirePatterns(
    byName.get('workflow'),
    [
      [/Read-only research, audits, and planning do not require an issue/i, 'read-only issue exception'],
      [/every repository change.*issue.*feature branch and PR/is, 'issue-first PR-always changes'],
      [/local `AGENTS\.md` decides.*self-merge.*operational authority/is, 'local merge authority'],
      [/reviewed immutable commit SHA/i, 'immutable reusable workflow policy'],
      [/app-native isolated project session\/worktree/i, 'app-native isolation'],
    ],
    errors,
  );
  if (byName.get('workflow')?.text.match(/\.\.[/\\]wt-/)) {
    errors.push('instructions/workflow.instructions.md: must not hard-code ../wt-* worktrees');
  }
  requirePatterns(
    byName.get('infrastructure-operations'),
    [
      [/Repo-first is the default/i, 'repo-first mode'],
      [/Host-first is reserved/i, 'host-first mode'],
      [/explicit, immediate human confirmation/i, 'explicit confirmation'],
      [/last-known-good.*rollback.*second\s+access\s+path/is, 'recovery and second access path'],
      [/reflect the exact live state back.*canonical repository\s+state/is, 'live-to-repo reconciliation'],
      [/drift checks/i, 'drift validation'],
      [/operations log/i, 'operations logging'],
      [/local operator authority/i, 'local operator authority'],
      [/generic canonical agent does not authorize host access/i, 'no generic live authority'],
      [/declared `localAgents`/i, 'local agent routing'],
    ],
    errors,
  );
}

function validateMemberSelections(manifest, errors) {
  for (const member of manifest.members ?? []) {
    const selected = member.optIn?.instructions;
    let expected;
    if (APPLICATION_REPOS.has(member.repo) || member.repo === 'jrmoulckers/studio') {
      expected = GENERAL_INSTRUCTIONS;
    } else if (member.repo === 'jrmoulckers/homelab') {
      expected = ['agents', 'infrastructure-operations'];
    } else if (member.repo === 'jrmoulckers/windows') {
      expected = ['agents', 'docs', 'infrastructure-operations', 'skills'];
    }
    if (expected && !sameArray(selected, expected)) {
      errors.push(
        `${member.repo}: optIn.instructions must be explicit [${expected.join(', ')}], got ${formatSelection(selected)}`,
      );
    }

    const selectedAgents =
      member.optIn?.agents === '*'
        ? manifest.canon?.agents ?? []
        : Array.isArray(member.optIn?.agents)
          ? member.optIn.agents
          : [];
    for (const localName of member.localAgents ?? []) {
      if (selectedAgents.includes(localName)) {
        errors.push(`${member.repo}: local agent "${localName}" collides with selected canon`);
      }
    }
  }

  for (const member of manifest.members ?? []) {
    const selected = member.optIn?.instructions;
    if (
      Array.isArray(selected) &&
      selected.includes('infrastructure-operations') &&
      !['jrmoulckers/homelab', 'jrmoulckers/windows'].includes(member.repo)
    ) {
      errors.push(`${member.repo}: infrastructure-operations is not approved for this member`);
    }
  }
}

function validateSourceTargetReferences(repoRoot, errors) {
  const agents = readText(join(repoRoot, 'AGENTS.md'));
  const readme = readText(join(repoRoot, 'README.md'));
  for (const [label, text] of [
    ['AGENTS.md', agents],
    ['README.md', readme],
  ]) {
    for (const path of ['skills/', '.github/skills/', 'instructions/', '.github/instructions/']) {
      if (!text.includes(path)) errors.push(`${label}: must reference "${path}"`);
    }
  }
}

function validateImmutableWorkflowExamples(repoRoot, errors) {
  const paths = [
    'README.md',
    'principles/github/actions-and-delivery.md',
    'docs/sync.md',
    'sync/README.md',
    'sync/lib/pr.mjs',
    'instructions/workflow.instructions.md',
  ];
  for (const relativePath of paths) {
    const text = readText(join(repoRoot, ...relativePath.split('/')));
    for (const match of text.matchAll(WORKFLOW_CALL)) {
      if (match[1] !== '<reviewed-commit-sha>' && !/^[0-9a-f]{40}$/.test(match[1])) {
        errors.push(
          `${relativePath}: reusable workflow examples must use <reviewed-commit-sha> or a full commit SHA`,
        );
      }
    }
  }
  const workflowDir = join(repoRoot, '.github', 'workflows');
  for (const fileName of readdirSync(workflowDir).filter((name) => /^reusable-.*\.yml$/.test(name))) {
    const relativePath = `.github/workflows/${fileName}`;
    const text = readText(join(workflowDir, fileName));
    for (const match of text.matchAll(WORKFLOW_CALL)) {
      if (match[1] !== '<reviewed-commit-sha>' && !/^[0-9a-f]{40}$/.test(match[1])) {
        errors.push(
          `${relativePath}: reusable workflow examples must use <reviewed-commit-sha> or a full commit SHA`,
        );
      }
    }
  }
}

function parseApplyTo(relativePath, text, errors) {
  const match = text.match(/^---\napplyTo:\s*(['"])([^'"]+)\1\n---(?:\n|$)/);
  if (!match) {
    errors.push(`${relativePath}: requires frontmatter containing exactly one quoted applyTo value`);
    return '';
  }
  return match[2];
}

function requirePatterns(record, requirements, errors) {
  if (!record) return;
  for (const [pattern, label] of requirements) {
    if (!pattern.test(record.text)) errors.push(`${record.relativePath}: missing ${label}`);
  }
}

function readText(path) {
  return readFileSync(path, 'utf8').replace(/\r\n?/g, '\n');
}

function sameArray(actual, expected) {
  return Array.isArray(actual) && actual.length === expected.length && actual.every((v, i) => v === expected[i]);
}

function formatSelection(selection) {
  return Array.isArray(selection) ? `[${selection.join(', ')}]` : JSON.stringify(selection);
}

function duplicates(values) {
  const seen = new Set();
  const repeated = new Set();
  for (const value of values) {
    if (seen.has(value)) repeated.add(value);
    seen.add(value);
  }
  return [...repeated].sort();
}
