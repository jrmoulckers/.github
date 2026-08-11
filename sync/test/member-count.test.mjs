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
//
// #246: the first version of this guard could not see the engine's own source. `sync/lib/runner.mjs`
// said "the engine talks to nine member repos" through *two* independent gaps — the file was not in
// the surface list, and the phrase carries no literal "all", so listing it would not have helped
// either. Prose and source therefore get different patterns, for a reason given at each.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest } from '../lib/manifest.mjs';

const REPO_ROOT = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

/** Prose that describes the fleet to a human who is about to grant something. */
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

/**
 * The same claim in engine source, with the "all" requirement dropped.
 *
 * Narrowness is correct for prose and pointless here. A module under `sync/` can import
 * `loadManifest` — the list is reachable from the same file — so a comment there has no reason to
 * state a fleet size in any phrasing, totality or subset. Requiring "all" bought nothing and cost
 * exactly the blind spot in #246. If this ever fires on a legitimate sentence, rephrase it to point
 * at the manifest; do not re-narrow the pattern, or the blind spot comes back.
 */
const ANY_COUNT_PHRASE = new RegExp(
  String.raw`\b(\d+|${[...WORD_NUMBERS.keys()].join('|')})\s+member(?:s|\s+repos?|\s+repositories)\b`,
  'gi',
);

/**
 * Discovered, never enumerated.
 *
 * A hardcoded surface list is the same wrong-unit error one level up: it protects the files someone
 * remembered, and the next `sync/lib/*.mjs` arrives unguarded. Walking the tree means a new module
 * is covered the moment it exists.
 *
 * `sync/test/**` is excluded on purpose — the counts there are quoted regression fixtures and
 * narrative about #176, and a test that asserts a wrong count fails on its own.
 */
function engineSources(dir = join(REPO_ROOT, 'sync'), found = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'test' || entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) engineSources(full, found);
    else if (entry.name.endsWith('.mjs')) found.push(full);
  }
  return found;
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

test('engine source states no fleet size in any phrasing', () => {
  const wrong = [];

  for (const file of engineSources()) {
    const text = readFileSync(file, 'utf8');
    for (const match of text.matchAll(ANY_COUNT_PHRASE)) {
      wrong.push(`${relative(REPO_ROOT, file).split('\\').join('/')}: "${match[0].trim()}"`);
    }
  }

  assert.deepEqual(
    wrong,
    [],
    `Engine source can read studio.config.json; point at it instead of counting it:\n  - ${wrong.join('\n  - ')}`,
  );
});

test('the engine-source sweep reaches the modules it claims to cover', () => {
  // A walk that silently returns nothing passes the test above forever — a broken check fails
  // clean (#203). Pin that the discovery actually reaches the file #246 was found in, that it
  // descends into lib/, and that it stays out of the fixture directory.
  const found = engineSources().map((file) => relative(REPO_ROOT, file).split('\\').join('/'));

  for (const expected of ['sync/index.mjs', 'sync/lib/runner.mjs', 'sync/lib/copier.mjs']) {
    assert.ok(found.includes(expected), `discovery must reach ${expected}; found ${found.length} files`);
  }

  assert.deepEqual(
    found.filter((file) => file.startsWith('sync/test/')),
    [],
    'regression fixtures live in sync/test and must stay out of the strict sweep',
  );
});

test('the source pattern catches the claim the prose pattern let through', () => {
  // #246 in one assertion. This exact line sat in sync/lib/runner.mjs against a manifest of
  // eleven. It is why the two tiers are not the same pattern: adding runner.mjs to SURFACES
  // would have left it passing, because it never says "all".
  const line = 'The engine talks to nine member repos plus the profile destination';

  assert.deepEqual([...line.matchAll(COUNT_PHRASE)].map((m) => m[0]), [], 'prose pattern misses it — that was the gap');

  const strict = [...line.matchAll(ANY_COUNT_PHRASE)];
  assert.equal(strict.length, 1, 'source pattern must fire on it');
  assert.equal(toNumber(strict[0][1]), 9, 'and must read the stated count');
});

// #374: a count is not the only way to hardcode the fleet.
//
// The guard above catches "all N members" and is blind by construction to the other form — an
// enumeration that names them. `docs/sync.md` classified the fleet into public and private and
// listed 8 of 12, omitting two members that were blocked at the time, so the list dropped live
// instances of the condition its own section taught the reader to find. No count appeared
// anywhere in it, so nothing fired.
//
// The discriminator is a hedge, not a length. `README.md` names three members and is correct
// because it says "and more" — that is subset prose and must stay writable, exactly as the
// count guard keeps "three members were in that group" writable. An unhedged run of names is
// asserting the population, and an asserted population goes stale the next time one is added.

const MEMBER_RUN = (names) =>
  new RegExp(String.raw`(\`(?:${names})\`[,;]?\s+(?:and\s+|or\s+)?){2,}\`(?:${names})\``, 'g');

/** Marks the list as illustrative. Anything else is a claim about the whole fleet. */
const HEDGE = /and more|and others|among (?:them|others)|for example|such as|e\.g\./i;

test('no prose enumerates the fleet without marking the list as partial', () => {
  const names = loadManifest(REPO_ROOT)
    .members.map((m) => m.repo.split('/')[1].replaceAll('.', String.raw`\.`))
    .join('|');
  const offenders = [];

  for (const relativePath of SURFACES) {
    const text = readFileSync(join(REPO_ROOT, ...relativePath.split('/')), 'utf8');
    for (const line of text.split('\n')) {
      for (const match of line.matchAll(MEMBER_RUN(names))) {
        if (!HEDGE.test(line)) offenders.push(`${relativePath}: "${match[0].trim()}"`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Derive the list from studio.config.json, or mark it partial ("and more"):\n  - ${offenders.join('\n  - ')}`,
  );
});

test('the enumeration guard fires on the list #374 removed and spares the one it kept', () => {
  // Non-vacuity, using the real removed text rather than a synthetic fixture: these two lines
  // stood in docs/sync.md, and the third stands in README.md today.
  const names = loadManifest(REPO_ROOT)
    .members.map((m) => m.repo.split('/')[1].replaceAll('.', String.raw`\.`))
    .join('|');

  for (const removed of [
    'Public (immune, useless as evidence): `.github`, `studio`, `finance`, `score-king`.',
    'Private (exposed): `homelab`, `libro`, `docket`, `windows`.',
  ]) {
    assert.equal([...removed.matchAll(MEMBER_RUN(names))].length, 1, `must fire on: ${removed}`);
    assert.equal(HEDGE.test(removed), false, `and must not read as hedged: ${removed}`);
  }

  const kept = 'Product repos (`jrm-recipes`, `score-king`, `finance`, and more) share DNA from';
  assert.equal([...kept.matchAll(MEMBER_RUN(names))].length, 1, 'the pattern does reach the README line');
  assert.equal(HEDGE.test(kept), true, 'but the hedge is what makes it legitimate, so it must be seen');
});