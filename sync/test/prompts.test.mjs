// Canon assets tell an agent which commands to run, so a defective command in `prompts/` is
// distributed to every member that opts in. This sweep guards the one defect class that produces
// no error when it fires: a listing that silently truncates.
//
// `gh pr list` and `gh issue list` paginate by default and return 30 rows unless told otherwise.
// There is no warning and no truncation notice, so a prompt that enumerates open PRs to build a
// dashboard reports a confident, complete-looking, wrong answer once the repo crosses 30. It is
// silently correct until the population crosses the page size, then silently wrong forever --
// which is why this cannot be left to review: nothing about the command looks wrong, and the
// defect is invisible in every repo small enough to test it in.
//
// See issue #69. The tell for a truncated listing is that the row count equals the limit.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';
import { readdirSync, readFileSync, statSync } from 'node:fs';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** Canon directories whose contents are copied verbatim into members. */
const ASSET_DIRS = ['prompts', 'agents', 'skills', 'instructions'];

function markdownFiles(dir) {
  const abs = join(REPO_ROOT, dir);
  let entries;
  try {
    entries = readdirSync(abs, { withFileTypes: true });
  } catch {
    return [];
  }
  const out = [];
  for (const entry of entries) {
    const full = join(abs, entry.name);
    if (entry.isDirectory()) out.push(...markdownFiles(join(dir, entry.name)));
    else if (entry.name.endsWith('.md') && statSync(full).isFile()) out.push(full);
  }
  return out;
}

const LISTING = /\bgh[\s*`]+(?:pr|issue)[\s*`]+list\b(?:\\\r?\n|[^\n])*/g;

// Retained as a control, not as a spare: the emphasis-tolerant pattern above is only worth having
// if it differs from this one on an emphasised specimen, and a test written beside its own fix
// passes either way unless it is exercised against the version it replaced. See issue #738.
const LISTING_BARE = /\bgh\s+(?:pr|issue)\s+list\b[^\n`]*/g;

function normalizeCommand(command) {
  return command.replace(/[`*]/g, '');
}

function findListings(text) {
  return [...text.matchAll(LISTING)].map((match) => normalizeCommand(match[0]));
}

/**
 * A listing is bounded when it caps the page explicitly, or when a filter restricts it to a
 * population that cannot reach a page boundary. `--head <branch>` is the latter: a single branch
 * cannot accumulate 30 open PRs.
 */
function isBounded(command) {
  return /--limit\b/.test(command) || /--head\b/.test(command);
}

test('every canon listing command bounds its own page size', () => {
  const unbounded = [];

  for (const dir of ASSET_DIRS) {
    for (const file of markdownFiles(dir)) {
      const text = readFileSync(file, 'utf8');
      for (const command of findListings(text)) {
        if (!isBounded(command)) {
          unbounded.push(`${relative(REPO_ROOT, file)}: ${command.trim()}`);
        }
      }
    }
  }

  assert.deepEqual(
    unbounded,
    [],
    'These commands enumerate without a --limit, so they silently return at most 30 rows:\n' +
      unbounded.join('\n')
  );
});

// A guard that only ever refuses is satisfied by a matcher that never matches anything, so this
// asserts the sweep can actually see a defect. Without it, deleting ASSET_DIRS or breaking the
// regex would leave the test above passing for the wrong reason.
test('the sweep detects an unbounded listing when one is present', () => {
  const offending = 'gh pr list --state open --json number,title';
  assert.equal(isBounded(offending), false);
  assert.match(offending, new RegExp(LISTING.source));

  assert.equal(isBounded('gh pr list --state open --limit 200 --json number'), true);
  assert.equal(isBounded('gh pr list --repo o/r --head my-branch --state open --json url'), true);
});

// The emphasis-tolerant matcher must actually differ from the one it replaced, on a specimen that
// exercises the difference -- otherwise it is the old pattern under a new name. See issue #738.
test('the listing matcher tolerates emphasis and backticks that defeated its predecessor', () => {
  const specimens = [
    ['bold subcommand', 'gh **pr** list --limit 5'],
    ['backticked command', '`gh pr list` --limit 5'],
    ['backticked flag', 'gh pr list `--limit 5`'],
    ['line continuation', 'gh pr list \\\n  --limit 5'],
  ];

  for (const [label, specimen] of specimens) {
    const found = findListings(specimen);
    assert.equal(found.length, 1, `${label}: not matched`);
    assert.equal(isBounded(found[0]), true, `${label}: bound not seen`);
  }

  // The control: at least one specimen must be invisible to the old pattern, or the two agree and
  // this test is asserting nothing.
  const escapesOld = specimens.filter(
    ([, specimen]) => !new RegExp(LISTING_BARE.source).test(specimen)
  );
  assert.ok(
    escapesOld.length > 0,
    'the retained bare pattern matches every specimen - the patterns no longer discriminate'
  );
});

// A global regex carries lastIndex between calls, so `.test()` in a filter drops every other
// match. This guards the vacuity check above against silently inspecting half its input.
test('listing detection is not stateful across documents', () => {
  const docs = ['gh pr list --limit 5', 'gh issue list --limit 5', 'gh pr list --limit 5'];
  assert.equal(docs.filter((d) => findListings(d).length > 0).length, docs.length);
});

// The sweep is worthless if it inspects nothing, and an empty file list is the failure mode that
// looks identical to success.
test('the sweep actually reads the canon asset directories', () => {
  const files = ASSET_DIRS.flatMap((d) => markdownFiles(d));
  assert.ok(files.length > 0, 'no canon markdown found - the sweep would pass vacuously');

  const withListings = files.filter((f) => findListings(readFileSync(f, 'utf8')).length > 0);
  assert.ok(
    withListings.length > 0,
    'no canon file contains a gh listing command - the sweep would pass vacuously'
  );
});
