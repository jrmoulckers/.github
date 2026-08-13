// Canonical scoped-instruction and member-selection integrity validation.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const GENERAL_INSTRUCTIONS = ['agents', 'canon-formatting', 'docs', 'skills', 'tokens', 'workflow'];
const APPLY_TO = new Map([
  ['agents', 'agents/**,.github/agents/**'],
  ['canon-formatting', '**'],
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
    return { name, relativePath, text, ...parseFrontmatter(relativePath, text, errors) };
  });
  const byName = new Map(records.map((record) => [record.name, record]));

  validateRoster(records, declared, errors);
  validateScopes(byName, errors);
  validateContent(byName, errors);
  validateMemberSelections(manifest, errors);
  validateSourceTargetReferences(repoRoot, errors);
  validateImmutableWorkflowExamples(repoRoot, manifest, errors);

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
      // A value shift is the one token change that cannot announce itself: names hold, every
      // consumer compiles, and the rendered result moves. The engine mirrors bytes and reports it
      // as an ordinary `Updated` path, so if this guidance is ever dropped from the instructions
      // there is nothing else in the org that tells a member to look.
      //
      // The emphasis character is optional and either form, because the contract is that the rule
      // is *stated* — not that it is marked up one way. Prettier rewrites `*value*` to `_value_`,
      // and pinning the asterisk made this check fail on canon that still said exactly the right
      // thing. Measured, not hypothetical: formatting the instructions and running this validator
      // failed here and nowhere else. Nothing formats this repo today, which is the only reason it
      // has not happened, and an absence is not a safeguard.
      [/changed token [*_]?value[*_]?.*announced change/is, 'token value-change announcement'],
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
      [/spending limit/i, 'Actions spending-limit cliff'],
      [
        /jobs you did not touch failed[\s\S]{0,200}check billing/i,
        'no-log failure discriminator',
      ],
      [/check-runs\/[^\s`]*\/annotations/i, 'no-log failure annotation fallback'],
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
      expected = ['agents', 'canon-formatting', 'infrastructure-operations'];
    } else if (member.repo === 'jrmoulckers/windows') {
      expected = ['agents', 'canon-formatting', 'docs', 'infrastructure-operations', 'skills'];
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

function validateImmutableWorkflowExamples(repoRoot, manifest, errors) {
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
  const inspected = new Set();
  for (const fileName of readdirSync(workflowDir).filter((name) => /^reusable-.*\.yml$/.test(name))) {
    inspected.add(fileName.slice(0, -'.yml'.length));
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

  // The half above discovers its own population, so it is silent exactly when discovery fails: an
  // empty walk runs no assertions and reports success. The sibling half of this function reads a
  // hand-listed array and fails closed, because `readText` throws on a path that moved — so the
  // transcribed population is the safe one here and the derived population is the hole.
  //
  // `canon.workflows` already declares this exact set and is pinned in both directions by
  // `validateWorkflowIntegrity`, so the floor costs nothing to state and moves with the fleet. It is
  // read without a `?? []` fallback on purpose: a default that degrades to empty would delete the
  // floor in precisely the case it exists for.
  const declared = manifest?.canon?.workflows;
  if (!Array.isArray(declared) || declared.length === 0) {
    errors.push(
      'studio.config.json: canon.workflows must declare the reusable workflows read here; without it this check asserts nothing',
    );
    return;
  }
  for (const name of declared) {
    if (!inspected.has(name)) {
      errors.push(
        `.github/workflows/${name}.yml: declared in canon.workflows but not read by the immutable-example check`,
      );
    }
  }
}

/**
 * Instruction frontmatter is exactly two quoted scalars, in order: `applyTo` then `description`.
 *
 * `description` is required rather than optional because it is not decoration. A consumer receives
 * scoped instructions as an index — pattern, path, description — and retrieves a body only when the
 * row persuades it to. An absent description renders as a blank cell, which leaves the filename as
 * the only thing a session can decide from, so an optional field would fail silently in exactly the
 * case it exists to serve. The quoted-scalar shape keeps the parse anchored, so a description can
 * never be mistaken for a second `applyTo` or smuggle one in.
 *
 * Each delimiter is matched against its own character class, not against both. A description is a
 * sentence of English, so possessives and contractions are the ordinary case rather than the exotic
 * one; a class excluding both quote characters rejected `"a session's own file"`, which is valid
 * YAML and the natural way to write it.
 *
 * The single-line restriction is deliberate and stays, and the precedent does not argue against it.
 * `skills/*\/SKILL.md` is cited above as evidence that a description is worth *requiring* — 17 of 17
 * carry one and a consumer indexes them by it — but that is an argument about the field, not about
 * how its value is written. On style the two surfaces diverge on purpose: every one of those 17 uses
 * a folded block scalar, and none is accepted here, because a block scalar ends where its indentation
 * ends, so knowing where the value stops means parsing YAML rather than matching a shape. The
 * anchored two-scalar form is what proves this block holds exactly `applyTo` and `description` and
 * nothing else. An author who reaches for `description: >` because every neighbouring file uses one
 * is therefore refused by design; the failure says so, rather than leaving a correct-looking line to
 * read as an oversight.
 */
function parseFrontmatter(relativePath, text, errors) {
  const match = text.match(
    /^---\napplyTo:\s*(?:'([^'\n]+)'|"([^"\n]+)")\ndescription:\s*(?:'([^'\n]+)'|"([^"\n]+)")\n---(?:\n|$)/,
  );
  if (!match) {
    errors.push(
      `${relativePath}: requires frontmatter of exactly two single-line quoted scalars, applyTo then description ` +
        `(a value may contain the quote character it is not delimited by; folded and literal block scalars are not accepted)`,
    );
    return { applyTo: '', description: '' };
  }
  return { applyTo: match[1] ?? match[2], description: match[3] ?? match[4] };
}

// Every pattern below pins a phrase, and a phrase is a sequence of words — not a sequence of
// words with the line breaks canon happens to carry today. Matching raw bytes made each check
// depend on where the file is wrapped: reflowing the corpus (`prettier --prose-wrap always`)
// broke 5 of 30 patterns on canon that still stated the rule exactly. The corpus is 3,700 hand
// wrapped lines, so a break can land inside any phrase the next time someone edits a paragraph.
//
// This was already known one instance at a time. Two `infrastructure-operations` patterns are
// written `second\s+access\s+path` and `canonical repository\s+state`, and both of those `\s+`
// sites sit on a real newline in the source — the author hit the failure twice while authoring,
// patched the two phrases their own wrap straddled, and left the other twenty-eight resting on it.
// Normalizing here fixes the class, and fixes it for patterns not yet written.
//
// Whitespace, specifically. Stripping markup the same way does not transfer: 7 of these 30 pin
// file names and globs where a backtick delimits and an asterisk *is* the glob, so collapsing
// those characters destroys the assertion instead of normalizing it. Whitespace is never content
// in a pinned phrase — the two hand-patched patterns already assert that.
//
// (That figure read "6 of 21" until #643, and the reflow figure above read "3 of 21" until #651.
// Both numbers came from a hand transcription of this list that omitted `infrastructure-operations`
// entirely, so the denominator was wrong and the pattern it hides — `local agent routing` — went
// uncounted; it is one of the five the reflow breaks. Measured since by extracting the patterns
// from this module rather than retyping them.
//
// #643 corrected one of the two figures and left its twin four lines above the paragraph
// announcing the correction. A note that a number was wrong is not a check that the number is
// right, so the denominator is now derived: `instruction-integrity.test.mjs` extracts these
// patterns and fails if any count cited in this file disagrees with how many there are.)
//
// And global, not scoped to prose paragraphs. The narrower rule — join blank-line-separated prose
// and leave any block holding a fence, list marker, table row or heading alone — is the better
// default in general and is what jrmoulckers/finance runs, correctly, because its scanner matches
// `<number> <noun>` claims that sit in list items and must not pair a number in one bullet with a
// noun in the next. This corpus keeps pinned prose *inside* list items, which a prose formatter
// wraps like anything else, so that rule is unsafe here. Measured over the patterns below, against
// a corpus reflowed at 44 columns: raw 17 of 30, paragraph-scoped 24 of 30, global 30 of 30. The
// six it loses are `app-native isolation` and five of the `infrastructure-operations` rules.
//
// The guard catches a narrowing — substituting the paragraph-scoped rule fails exactly the
// hard-wrap test and names those six. This note exists because that failure names the *patterns*
// and not the cause, and the obvious next move on seeing it is to assume the test is wrong.
//
// Callers that depend on line structure must keep using `record.text`: frontmatter parsing, the
// `../wt-*` negative check, and the `uses:` scans all read fenced or line-anchored syntax that a
// prose formatter does not reflow and that this collapse would flatten.
function requirePatterns(record, requirements, errors) {
  if (!record) return;
  const prose = record.text.replace(/\s+/g, ' ');
  for (const [pattern, label] of requirements) {
    if (!pattern.test(prose)) errors.push(`${record.relativePath}: missing ${label}`);
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
