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

const LISTING = /\bgh\s+(?:pr|issue)\s+list\b[^\n`]*/g;

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
      for (const match of text.matchAll(LISTING)) {
        if (!isBounded(match[0])) {
          unbounded.push(`${relative(REPO_ROOT, file)}: ${match[0].trim()}`);
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

// The sweep is worthless if it inspects nothing, and an empty file list is the failure mode that
// looks identical to success.
test('the sweep actually reads the canon asset directories', () => {
  const files = ASSET_DIRS.flatMap((d) => markdownFiles(d));
  assert.ok(files.length > 0, 'no canon markdown found - the sweep would pass vacuously');

  const withListings = files.filter((f) => LISTING.test(readFileSync(f, 'utf8')));
  assert.ok(
    withListings.length > 0,
    'no canon file contains a gh listing command - the sweep would pass vacuously'
  );
});
