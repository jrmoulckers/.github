// A hardcoded member count is a latent 403.
//
// STUDIO_SYNC_TOKEN is a fine-grained PAT whose repository grant is enumerated by hand from the
// instructions in this repo. When those instructions state a number instead of pointing at the
// list, adding a member silently invalidates them: the operator grants the documented count, the
// new member is missing from the PAT, and `git clone` returns 403 for that member alone. Every
// other member syncs, so the run reports partial success and exits non-zero.
//
// That is what happened. `homelab` and `windows` were added to studio.config.json while five
// separate places still said "nine members", and the scheduled sync failed on `jrmoulckers/windows`
// for five consecutive weeks (2026-07-13 through 2026-08-10). The failure was visible the whole
// time and read by nobody, because a weekly job that is always red carries no information.
//
// Correcting "nine" to "eleven" would only reset that clock. This test fails the build instead the
// next time a count disagrees with the manifest, which is the only version of the fix that survives
// the twelfth member.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest } from '../lib/manifest.mjs';

const REPO_ROOT = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

/** Files that describe the fleet to a human who is about to grant something. */
const SURFACES = [
  'sync/README.md',
  'sync/index.mjs',
  'docs/sync.md',
  '.github/workflows/studio-sync.yml',
  'README.md',
];

const WORD_NUMBERS = new Map([
  ['one', 1],
  ['two', 2],
  ['three', 3],
  ['four', 4],
  ['five', 5],
  ['six', 6],
  ['seven', 7],
  ['eight', 8],
  ['nine', 9],
  ['ten', 10],
  ['eleven', 11],
  ['twelve', 12],
  ['thirteen', 13],
  ['fourteen', 14],
  ['fifteen', 15],
]);

/**
 * Only *totality* claims, never subset prose.
 *
 * "Three members were in that group" and "a filter matching two members" are legitimate and
 * must stay writable. What causes the 403 is an instruction asserting the fleet's size at grant
 * time — always phrased "all N members" / "all N member repos" — so that is what this matches.
 * Narrow beats broad here: a guard that fires on ordinary sentences gets weakened or deleted,
 * and then it protects nothing.
 */
const COUNT_PHRASE = new RegExp(
  String.raw`\ball\s+(\d+|${[...WORD_NUMBERS.keys()].join('|')})\s+member(?:s|\s+repos?|\s+repositories)\b`,
  'gi',
);

function toNumber(token) {
  return WORD_NUMBERS.get(token.toLowerCase()) ?? Number(token);
}

test('no surface states a member count that disagrees with the manifest', () => {
  const expected = loadManifest(REPO_ROOT).members.length;
  const wrong = [];

  for (const relativePath of SURFACES) {
    const text = readFileSync(join(REPO_ROOT, ...relativePath.split('/')), 'utf8');
    for (const match of text.matchAll(COUNT_PHRASE)) {
      const stated = toNumber(match[1]);
      if (stated !== expected) {
        wrong.push(`${relativePath}: "${match[0].trim()}" but the manifest has ${expected} members`);
      }
    }
  }

  assert.deepEqual(
    wrong,
    [],
    `Point at studio.config.json's members list instead of restating its length:\n  - ${wrong.join('\n  - ')}`,
  );
});

test('the count phrases this guard looks for are the ones that actually appear', () => {
  // A guard that matches nothing passes forever. Prove the pattern fires on the exact
  // sentences that caused #176 before trusting it against the real tree.
  const regressions = [
    'Grant Contents + Pull requests: Read and write on all 9 members and jrmoulckers/jrmoulckers.',
    'read/write on all nine members and the profile destination',
    'Contents: Read and write      — all 9 member repos + `jrmoulckers/jrmoulckers`',
    'on all nine member repos and `jrmoulckers/jrmoulckers`',
    'the token must cover all nine member repositories',
  ];

  for (const line of regressions) {
    const matches = [...line.matchAll(COUNT_PHRASE)];
    assert.equal(matches.length, 1, `pattern must fire on: ${line}`);
    assert.equal(toNumber(matches[0][1]), 9, `must read the stated count from: ${line}`);
  }

  // Subset prose is not a grant instruction and must remain writable.
  for (const line of [
    'every repo in studio.config.json "members"',
    'Three members were in that group when the policy was declined.',
    '(no filter, or a filter matching two members) fails with',
    "The `copilot` kind's first distribution failed CI in four members",
    'the token instructions still said "nine members" after the fleet had grown',
    'Grant the list, never a count.',
  ]) {
    assert.deepEqual([...line.matchAll(COUNT_PHRASE)].map((m) => m[0]), [], `must not fire on: ${line}`);
  }
});
