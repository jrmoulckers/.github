// The test table in README.md is a hand-maintained list sitting beside a directory that enumerates
// the same thing, which is the duplication shape this repo has now been bitten by twice: five
// documents claiming "nine members" against a manifest of eleven (#176), and this very table
// documenting 16 of 21 suites (#216). Both drifted silently, because nothing reads a prose list.
//
// So the list is pinned to the directory rather than trusted. A new suite that nobody documents
// fails here, naming itself.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TEST_DIR = dirname(fileURLToPath(import.meta.url));
const README = join(TEST_DIR, '..', 'README.md');

const suitesOnDisk = () =>
  readdirSync(TEST_DIR)
    .filter((name) => name.endsWith('.test.mjs'))
    .sort();

test('every test suite on disk is described in the README table', () => {
  const readme = readFileSync(README, 'utf8');
  const onDisk = suitesOnDisk();

  assert.ok(onDisk.length > 0, 'precondition: the sweep found suites to check');
  assert.ok(onDisk.includes('readme-tests.test.mjs'), 'precondition: the sweep sees this file');

  const undocumented = onDisk.filter((name) => !readme.includes(`\`test/${name}\``));
  assert.deepEqual(
    undocumented,
    [],
    `undocumented suites (add a row to the test table in sync/README.md): ${undocumented.join(', ')}`,
  );
});

test('the README table names no suite that has been deleted', () => {
  // The inverse drift, and the one that misleads a reader rather than merely omitting: a row
  // describing coverage that no longer exists reads exactly like a row that does.
  const readme = readFileSync(README, 'utf8');
  const onDisk = new Set(suitesOnDisk());

  const cited = [...readme.matchAll(/`test\/([a-z0-9-]+\.test\.mjs)`/g)].map((match) => match[1]);
  assert.ok(cited.length > 0, 'precondition: the table was found and parsed');

  const stale = [...new Set(cited)].filter((name) => !onDisk.has(name)).sort();
  assert.deepEqual(stale, [], `README cites suites that do not exist: ${stale.join(', ')}`);
});
