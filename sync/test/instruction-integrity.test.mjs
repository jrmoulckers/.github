import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateInstructionIntegrity } from '../lib/instruction-integrity.mjs';
import { loadManifest } from '../lib/manifest.mjs';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

test('canonical instruction scopes, ownership, precedence, and member profiles pass', () => {
  const manifest = loadManifest(REPO_ROOT);
  const records = validateInstructionIntegrity(REPO_ROOT, manifest);

  assert.deepEqual(
    records.map((record) => record.name),
    [...manifest.canon.instructions].sort(),
  );
  assert.equal(
    records.find((record) => record.name === 'docs').applyTo,
    'docs/**,*.md,**/README.md',
  );
  assert.equal(
    records.find((record) => record.name === 'skills').applyTo,
    'skills/**,.github/skills/**',
  );
});

test('workflow and documentation surfaces use immutable reusable workflow examples', () => {
  for (const relativePath of [
    'README.md',
    'principles/github/actions-and-delivery.md',
    'docs/sync.md',
    'sync/README.md',
    'sync/lib/pr.mjs',
    'instructions/workflow.instructions.md',
  ]) {
    const text = readFileSync(join(REPO_ROOT, ...relativePath.split('/')), 'utf8');
    assert.doesNotMatch(
      text,
      /uses:\s*jrmoulckers\/\.github\/\.github\/workflows\/[^\s`'"]+@(?!<reviewed-commit-sha>|[0-9a-f]{40}(?:\s|$))/i,
      relativePath,
    );
  }
  // A discovered population is silent when discovery returns nothing, and an empty loop
  // reports `pass`, not `skipped` — so it is indistinguishable from a real assertion.
  // Pin the population before iterating it.
  const reusable = readdirSync(join(REPO_ROOT, '.github', 'workflows')).filter((name) =>
    /^reusable-.*\.yml$/.test(name),
  );
  assert.ok(reusable.length > 0, 'no reusable workflows discovered — this check would assert nothing');
  for (const fileName of reusable) {
    const relativePath = `.github/workflows/${fileName}`;
    const text = readFileSync(join(REPO_ROOT, '.github', 'workflows', fileName), 'utf8');
    assert.doesNotMatch(
      text,
      /uses:\s*jrmoulckers\/\.github\/\.github\/workflows\/[^\s`'"]+@(?!<reviewed-commit-sha>|[0-9a-f]{40}(?:\s|$))/i,
      relativePath,
    );
  }
});

test('workflow guidance separates the two causes of a no-log run failure', () => {
  const text = readFileSync(
    join(REPO_ROOT, 'instructions', 'workflow.instructions.md'),
    'utf8',
  ).replace(/\r\n?/g, '\n');

  // The permissions trap alone is a trap: it trains the reader to search the workflow
  // file for a defect that, in the billing case, is not in the repository at all.
  assert.match(text, /startup_failure/);
  assert.match(text, /spending limit/i);

  // The discriminator is the load-bearing part. Documenting both causes without a way
  // to tell them apart leaves the reader exactly where they started.
  assert.match(text, /jobs you did not touch failed[\s\S]{0,200}check billing/i);

  // The observational check degenerates on a single-job workflow, and `--log-failed`
  // returns the same "log not found" for both causes. Pin the mechanical fallback and
  // the warning that the obvious command cannot substitute for it.
  assert.match(text, /check-runs\/[^\s`]*\/annotations/i);
  assert.match(text, /--log-failed[\s\S]{0,120}log not found/i);
});

test('all declared local agents remain disjoint from selected canon', () => {  const manifest = loadManifest(REPO_ROOT);
  // Without this the check passes when no member declares a local agent, which is also
  // what a manifest regression that drops `localAgents` looks like.
  assert.ok(
    manifest.members.some((member) => (member.localAgents ?? []).length > 0),
    'no member declares a local agent — this check would assert nothing',
  );
  for (const member of manifest.members) {
    const selected =
      member.optIn.agents === '*' ? manifest.canon.agents : Array.isArray(member.optIn.agents) ? member.optIn.agents : [];
    for (const localName of member.localAgents ?? []) {
      assert.ok(!selected.includes(localName), `${member.repo}: ${localName} collides with canon`);
    }
  }
});

// A citation of the form `### Name` asserts that Name is a *structural* element. Resolving it with a
// substring search confirms only that the characters occur somewhere, and returns the same answer
// whether the match is a heading, a bold lead-in, a table cell, or a line inside a fenced block --
// so the check that was meant to validate the scheme is blind to the way it fails. Canon carried a
// citation to `### Two Prettier API traps` for several revisions: the string was real, at the line
// reported, and was bold paragraph text that had never been a heading at any revision.
test('every heading citation in canon resolves to a real heading', () => {
  const files = [
    'docs/sync.md',
    'sync/README.md',
    'instructions/workflow.instructions.md',
    'AGENTS.md',
  ];

  let citations = 0;
  for (const relativePath of files) {
    const lines = readFileSync(join(REPO_ROOT, ...relativePath.split('/')), 'utf8')
      .replace(/\r\n/g, '\n')
      .split('\n');

    // Fence state must be tracked from line 0 in a single pass; starting mid-document inverts it.
    // Both the headings and the citations are collected under the same mask, or a citation quoted
    // inside an example block would be judged against a heading table that block never contributed to.
    const headings = new Set();
    const prose = [];
    let inFence = false;
    for (const line of lines) {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      prose.push(line);
      const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
      if (heading) headings.add(`${heading[1]} ${heading[2]}`);
    }

    // Detect citations at `###` and deeper only, and note that this is narrower than "every
    // citation" rather than equal to it. Writing the obvious `#{1,6}` produced two false positives
    // on the first run, both instructive: `# synced from ...` is a `.prettierignore` comment quoted
    // inline, so `#` is comment syntax rather than a heading marker; and `## Needs Human Action`
    // names a section the reader is told to *write*, not one to resolve. Backticked heading syntax
    // is therefore not the same predicate as "a citation" -- which is the same substring-for-structure
    // substitution this test exists to catch, reproduced inside the test on its first run.
    for (const match of prose.join('\n').matchAll(/`(#{3,6} [^`\n]+)`/g)) {
      citations += 1;
      assert.ok(
        headings.has(match[1]),
        `${relativePath}: cites \`${match[1]}\`, which is not a heading in that file`,
      );
    }
  }

  // The population must be pinned: zero citations would make every assertion above vacuous while
  // still reporting `pass`.
  assert.ok(citations > 0, 'no heading citations discovered — this check would assert nothing');
});
