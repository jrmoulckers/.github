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
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { loadManifest } from '../lib/manifest.mjs';
import { canonAudience, audienceOf } from './canon-audience.mjs';

const REPO_ROOT = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

/**
 * Prose that describes the fleet to a human who is about to grant something.
 *
 * Enumerated by hand until #842, and the list was exactly "the files someone remembered" —
 * the conclusion this file had already reached for `engineSources()` below and applied in only
 * one of the two places it holds. `instructions/workflow.instructions.md` carried six claims of
 * the guarded form and sat outside the list; it is delivered to nine of the eleven members, so
 * it is the document most likely to state a fleet size *to an agent* and it was the one the
 * guard could not see.
 *
 * Discovered, never enumerated, for the same reason given at `engineSources()`: a new document
 * is covered the moment it exists.
 *
 * `sync/test/**` stays excluded on the original grounds — the counts there are quoted regression
 * fixtures, and a test asserting a wrong count fails on its own.
 */
/*
 * Takes its root as a parameter so the exclusions above can be exercised against a constructed
 * tree (#880).
 *
 * Both were unkillable before that: mutated away one at a time, neither changed a single
 * assertion. Not because either is dead code -- because this repo has no `node_modules` (it has
 * no `package.json` at all), and because `.git` in a git *worktree* is a file rather than a
 * directory, so it is never recursed and its name never matches the extension filter.
 *
 * That is a different finding from an operand that can never decide, and it takes a different
 * repair. An accident of the current working tree is not an invariant, so pinning the deadness
 * would freeze the accident; enriching the corpus makes the operands decide. Add one dependency,
 * or run this suite in a plain clone instead of a worktree, and both go load-bearing with no
 * edit here.
 */
function proseSurfaces(dir = REPO_ROOT, found = [], root = dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.git' || entry.name === 'node_modules') continue;
    const full = join(dir, entry.name);
    const rel = relative(root, full).split('\\').join('/');
    if (rel === 'sync/test') continue;
    if (entry.isDirectory()) proseSurfaces(full, found, root);
    else if (/\.(md|mjs|yml)$/.test(entry.name)) found.push(rel);
  }
  return found;
}

/**
 * The discovered set must stay broad enough to be worth sweeping.
 *
 * A walk that silently narrows to nothing passes forever (#834): the guard would report a clean
 * fleet-count sweep computed over zero documents. A floor is falsifiable in both directions,
 * where an exact count of today's markdown would break on the next document and get deleted.
 */
const SURFACE_FLOOR = 40;

/**
 * `all N members` is a claim about the fleet. `all N members that receive the file` is not.
 *
 * Reach and fleet size are different quantities that read identically up to the qualifier, and
 * pinning one to the manifest misfires on the other. `workflow.instructions.md` says "all nine
 * members that receive the file" above a tally summing to nine — true, and independently
 * confirmed against `studio.config.json`, which puts that file in nine members' `optIn`.
 * Widening the sweep without this discriminator would have failed CI on a correct sentence,
 * which is how a guard gets weakened or deleted.
 *
 * The exemption is bounded rather than total: a subset cannot exceed its population, so a
 * qualified claim is still checked against the manifest, just with `<=` instead of `===`. That
 * keeps `all twelve members that receive the file` failing, and stops the qualifier from being
 * an escape hatch for a stale grant instruction.
 */
const REACH_QUALIFIER = /^\s*(?:that|which|who|whose|receiving|carrying|with|without|in|on|under|opted)\b/i;

/**
 * One predicate, called by the sweep and by the fixtures below.
 *
 * Written inline first, with the fixture test reimplementing it. A mutant that deleted the
 * bounds arm outright survived: the sweep had nothing out-of-bounds on disk to catch it, and
 * the fixtures were exercising a copy. Two implementations agreeing proves nothing about the
 * one that runs — the same content-versus-reachability split as #826.
 *
 * Returns the reason a claim is wrong, or `null` if it stands.
 */
function countClaimFault(stated, qualified, expected) {
  if (qualified) {
    return stated > expected || stated < 1
      ? `is a subset of a fleet of ${expected}, so it cannot be ${stated}`
      : null;
  }
  return stated === expected ? null : `but the manifest has ${expected} members`;
}

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

  for (const relativePath of proseSurfaces()) {
    const text = readFileSync(join(REPO_ROOT, ...relativePath.split('/')), 'utf8');
    for (const match of text.matchAll(COUNT_PHRASE)) {
      const stated = toNumber(match[1]);
      const qualified = REACH_QUALIFIER.test(text.slice(match.index + match[0].length));
      const fault = countClaimFault(stated, qualified, expected);

      if (fault) wrong.push(`${relativePath}: "${match[0].trim()}" ${fault}`);
    }
  }

  assert.deepEqual(
    wrong,
    [],
    `Point at studio.config.json's members list instead of restating its length:\n  - ${wrong.join('\n  - ')}`,
  );
});

test('the prose sweep reaches the documents it claims to cover', () => {
  // Same reason as the engine-source sweep below: a walk that silently returns nothing passes
  // the test above forever. Pin the file #842 was found in, one document per canon surface,
  // and the fixture exclusion.
  const found = proseSurfaces();

  for (const expected of [
    'instructions/workflow.instructions.md',
    'AGENTS.md',
    'README.md',
    'docs/sync.md',
    'sync/README.md',
    '.github/workflows/studio-sync.yml',
  ]) {
    assert.ok(found.includes(expected), `discovery must reach ${expected}; found ${found.length} documents`);
  }

  assert.ok(
    SURFACE_FLOOR >= 1,
    'a floor of zero is not a floor — `found.length >= 0` holds for a walk that returns nothing',
  );

  assert.ok(
    found.length >= SURFACE_FLOOR,
    `the sweep covers ${found.length} documents, below the floor of ${SURFACE_FLOOR} — the walk has narrowed`,
  );

  assert.deepEqual(
    found.filter((file) => file.startsWith('sync/test/')),
    [],
    'regression fixtures live in sync/test and must stay out of the sweep',
  );
});

test('a reach claim is bounded by the fleet, not equal to it', () => {
  // The discriminator that let the sweep widen at all. Both halves matter: exempting the
  // qualified form is what stops a true sentence failing CI, and keeping it bounded is what
  // stops the qualifier becoming an escape hatch for a stale grant instruction.
  const expected = loadManifest(REPO_ROOT).members.length;
  const bounded = (line) => {
    const match = [...line.matchAll(COUNT_PHRASE)][0];
    assert.ok(match, `pattern must fire on: ${line}`);
    const stated = toNumber(match[1]);
    const qualified = REACH_QUALIFIER.test(line.slice(match.index + match[0].length));
    return { stated, qualified, ok: countClaimFault(stated, qualified, expected) === null };
  };

  // The real sentence, from the file this issue was found in.
  const real = bounded('Extending the same measurement to all nine members that receive the file:');
  assert.equal(real.qualified, true, 'a restrictive clause marks a reach claim');
  assert.equal(real.ok, true, 'and nine of eleven is a legal reach');

  // A reach cannot exceed its population.
  assert.equal(bounded('all twelve members that receive the file').ok, false);

  // Dropping the qualifier makes the same number a fleet-size claim, and a wrong one.
  assert.equal(bounded('all nine members').qualified, false);
  assert.equal(bounded('all nine members').ok, false);

  // The qualifier does not excuse the grant instructions the guard was built for.
  assert.equal(bounded('the token must cover all nine member repositories').ok, false);
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
  // eleven. It is why the two tiers are not the same pattern: sweeping runner.mjs with the
  // prose pattern would have left it passing, because it never says "all". #842 widened which
  // documents the prose tier reaches and changed nothing about this — a wider sweep with the
  // weaker pattern still cannot see a claim that omits the totality word.
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

/**
 * A run of names is a fragment; the claim it belongs to is the block.
 *
 * The line was the wrong unit and it produced seven false positives (#844). A markdown table
 * puts each arm of a partition on its own row, and ordinary line-wrapping splits a prose
 * partition mid-sentence — so a paragraph that accounts for every member reaches the line-level
 * guard as several separate lists, each of which looks like a stale subset. Six of the seven
 * measured hits were fragments of a partition that named the whole fleet correctly.
 *
 * A block is a maximal run of non-blank lines, which is a paragraph, a list, or a table.
 */
function proseBlocks(text) {
  const blocks = [];
  let current = null;
  text.split('\n').forEach((line, index) => {
    if (line.trim() === '') {
      if (current) blocks.push(current);
      current = null;
      return;
    }
    current ??= { line: index + 1, lines: [] };
    current.lines.push(line);
  });
  if (current) blocks.push(current);
  return blocks.map((b) => ({ line: b.line, text: b.lines.join('\n') }));
}

/**
 * A complete enumeration is stronger than a hedge, and the guard used to reject it.
 *
 * The rule accepted "and more" and failed a block that named every member — backwards on its own
 * stated purpose. A hedge is **unfalsifiable**: it stays true after the twelfth member arrives,
 * so it is invisible to the drift this file exists to catch. A block naming the whole fleet
 * breaks the moment a member is added — coverage drops, and the guard fires carrying the new
 * name. That is the property worth requiring, so covering the fleet is a legitimizer and not
 * merely a tolerated case.
 *
 * Deliberately a coverage test, not a partition test: whether the arms are disjoint is not
 * checkable from names alone, and asserting only what is derivable is the point.
 */
function coversFleet(blockText, memberNames) {
  const named = new Set(
    [...blockText.matchAll(/`([^`]+)`/g)].map((m) => m[1]).filter((n) => memberNames.includes(n)),
  );
  return named.size === memberNames.length;
}

/**
 * The third legitimizer: a run that states its own size is bounded to that size.
 *
 * "Three members (`a`, `b`, `c`)" never implicitly claims the fleet, because the cardinality
 * says how far the list reaches. It is the count tier's discipline applied to a list — the same
 * reason a tally must carry its denominator — and it stays falsifiable in the direction that
 * matters: adding a fourth name without updating the word fires this guard.
 *
 * Required to *equal* the run length rather than merely be present, or any nearby number would
 * launder any list.
 */
function boundedByOwnCount(blockText, match, memberNames) {
  const listed = [...match[0].matchAll(/`([^`]+)`/g)].filter((m) => memberNames.includes(m[1]));
  const preceding = blockText.slice(Math.max(0, match.index - 80), match.index);
  const tokens = [...preceding.matchAll(CARDINALITY)];
  const last = tokens.at(-1);
  return last !== undefined && toNumber(last[1]) === listed.length;
}

const CARDINALITY = new RegExp(
  String.raw`\b(\d+|${[...WORD_NUMBERS.keys()].join('|')})\b`,
  'gi',
);

/**
 * One predicate, called by the sweep and by the fixtures below.
 *
 * The count tier learned this in #842: a fixture test that reimplements the rule tests a copy,
 * and a mutant unwiring the real one survives. The enumeration tier kept its fixtures wired to
 * `MEMBER_RUN` and `HEDGE` directly, so it held the same defect one test lower in the same file
 * — the transcription class again, and again inside the guard written against it.
 *
 * Returns the runs in this block that assert the fleet without standing behind the claim.
 */
function unboundedRuns(blockText, memberNames) {
  if (HEDGE.test(blockText) || coversFleet(blockText, memberNames)) return [];
  const names = memberNames.map((n) => n.replaceAll('.', String.raw`\.`)).join('|');
  return [...blockText.matchAll(MEMBER_RUN(names))]
    .filter((match) => !boundedByOwnCount(blockText, match, memberNames))
    .map((match) => match[0].trim().replaceAll('\n', ' '));
}

test('no prose enumerates the fleet without marking the list as partial', () => {
  const memberNames = loadManifest(REPO_ROOT).members.map((m) => m.repo.split('/')[1]);
  const offenders = [];

  for (const relativePath of proseSurfaces()) {
    const text = readFileSync(join(REPO_ROOT, ...relativePath.split('/')), 'utf8');
    for (const block of proseBlocks(text)) {
      for (const run of unboundedRuns(block.text, memberNames)) {
        offenders.push(`${relativePath}:${block.line}: "${run}"`);
      }
    }
  }

  assert.deepEqual(
    offenders,
    [],
    `Name the whole fleet, state the list's own size, or mark it partial ("and more"):\n  - ${offenders.join('\n  - ')}`,
  );
});

test('the enumeration guard fires on the list it removed and spares the one it kept', () => {
  // Non-vacuity, through the predicate the sweep runs rather than a copy of it, and using the
  // real removed text rather than a synthetic fixture: these two lines stood in docs/sync.md,
  // and the third stands in README.md today.
  const memberNames = loadManifest(REPO_ROOT).members.map((m) => m.repo.split('/')[1]);

  for (const removed of [
    'Public (immune, useless as evidence): `.github`, `studio`, `finance`, `score-king`.',
    'Private (exposed): `homelab`, `libro`, `docket`, `windows`.',
  ]) {
    assert.equal(unboundedRuns(removed, memberNames).length, 1, `must fire on: ${removed}`);
  }

  const kept = 'Product repos (`jrm-recipes`, `score-king`, `finance`, and more) share DNA from';
  assert.equal(unboundedRuns(kept, memberNames).length, 0, 'the hedge is what makes it legitimate');
});

test('a block naming the whole fleet stands, and stops standing when the fleet grows', () => {
  // The inversion in #844: a hedge is unfalsifiable and was accepted, a complete enumeration is
  // falsifiable and was rejected. Both directions are pinned here, because accepting coverage
  // is only safe if losing coverage is what makes it fail.
  const memberNames = loadManifest(REPO_ROOT).members.map((m) => m.repo.split('/')[1]);
  const partition = `Some: ${memberNames
    .slice(0, 3)
    .map((n) => `\`${n}\``)
    .join(', ')}.\nThe rest: ${memberNames
    .slice(3)
    .map((n) => `\`${n}\``)
    .join(', ')}.`;

  assert.equal(unboundedRuns(partition, memberNames).length, 0, 'a complete partition is the strongest form, not a tolerated one');
  assert.ok(
    unboundedRuns(partition, [...memberNames, 'twelfth-member']).length > 0,
    'and it must fail the moment a member it does not name exists',
  );
});

test('a run stands on its own stated size, and only on the size it actually has', () => {
  // The ADR form: "Three members (`a`, `b`, `c`)" bounds itself and never implies the fleet.
  // The cardinality must equal the run, or any nearby number launders any list.
  const memberNames = loadManifest(REPO_ROOT).members.map((m) => m.repo.split('/')[1]);
  const [a, b, c, d] = memberNames;

  assert.equal(
    unboundedRuns(`Three members (\`${a}\`, \`${b}\`, \`${c}\`) were in that position.`, memberNames).length,
    0,
    'a list that states its own size is bounded by it',
  );
  assert.equal(
    unboundedRuns(`Three members (\`${a}\`, \`${b}\`, \`${c}\`, \`${d}\`) were in that position.`, memberNames).length,
    1,
    'and a fourth name added without updating the word is exactly what must fire',
  );
  assert.equal(
    unboundedRuns(`Rejected in 2019: \`${a}\`, \`${b}\`, \`${c}\`.`, memberNames).length,
    1,
    'an unrelated number nearby is not a statement of the list size',
  );
});

test('the block is the unit, so a partition survives the line breaks that split it', () => {
  // The seven false positives in #844 were all fragments: table rows and wrapped prose. If the
  // sweep ever reverts to per-line evaluation this fails, which is the regression that matters.
  const memberNames = loadManifest(REPO_ROOT).members.map((m) => m.repo.split('/')[1]);
  const wrapped = memberNames.map((n) => `| row | \`${n}\` |`).join('\n');

  assert.equal(unboundedRuns(wrapped, memberNames).length, 0, 'a table naming every member is complete');
  assert.equal(proseBlocks('a\nb\n\n\nc\n').length, 2, 'blank lines separate blocks and runs of them do not make empty ones');
  assert.equal(proseBlocks('a\nb\n\nc').at(-1).line, 4, 'and a block reports the line it starts on');
});
/*
 * The two walk exclusions, made decidable (#880).
 *
 * Mutated away one at a time against the real repo, neither changed an assertion -- there is no
 * `node_modules` here and `.git` is a worktree file rather than a directory. A constructed root
 * supplies both, so each operand now decides an outcome and each mutant dies by name.
 *
 * Asserting instead that the real sweep contains no `.git/` path would have passed without the
 * exclusions existing at all, which is the bystander kill from #174 wearing a different hat.
 */
test('the sweep skips version-control and dependency trees even when they hold sweepable files', () => {
  const root = mkdtempSync(join(tmpdir(), 'surfaces-'));
  try {
    mkdirSync(join(root, '.git'));
    mkdirSync(join(root, 'node_modules', 'pkg'), { recursive: true });
    mkdirSync(join(root, 'docs'));
    writeFileSync(join(root, '.git', 'COMMIT_EDITMSG.md'), 'all four members\n');
    writeFileSync(join(root, 'node_modules', 'pkg', 'readme.md'), 'all four members\n');
    writeFileSync(join(root, 'node_modules', 'pkg', 'index.mjs'), '// all four members\n');
    writeFileSync(join(root, 'docs', 'real.md'), 'all four members\n');

    const swept = proseSurfaces(root);

    assert.deepEqual(swept, ['docs/real.md'], 'only the tracked document is swept');
    assert.equal(
      swept.filter((p) => p.startsWith('node_modules/')).length,
      0,
      'a dependency tree is vendored prose the fleet does not own, and would flood the sweep',
    );
    assert.equal(
      swept.filter((p) => p.startsWith('.git/')).length,
      0,
      'and object storage is not prose at all',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/*
 * The lower bound of the qualified arm (#880).
 *
 * `stated > expected` dies; `stated < 1` decided nothing anywhere in the suite. Unlike the
 * exclusions above this one is constructible from an ordinary argument, so it was a plain hole
 * rather than a latent guard -- the distinction the shared SURVIVED score erases.
 */
test('a subset claim of zero is a fault, not a vacuously safe subset', () => {
  assert.equal(countClaimFault(11, true, 11), null, 'a subset may be the whole fleet');
  assert.equal(countClaimFault(4, true, 11), null, 'and may be smaller');
  assert.ok(countClaimFault(12, true, 11), 'but may not exceed its population');
  assert.ok(
    countClaimFault(0, true, 11),
    'and may not be empty: "all zero members that receive the file" states nothing, so it cannot go on standing merely because zero is under the bound',
  );
});
/*
 * The same latent pair, in the other walk (#880).
 *
 * `engineSources` already took its root, so only a corpus was missing. Fixing the twin in
 * `proseSurfaces` and leaving this one would have closed the instance and not the class -- and
 * the tally would have looked one better either way.
 */
test('the engine-source walk skips fixtures and dependencies, and both exclusions decide it', () => {
  const root = mkdtempSync(join(tmpdir(), 'engine-'));
  try {
    mkdirSync(join(root, 'lib'));
    mkdirSync(join(root, 'test'));
    mkdirSync(join(root, 'node_modules', 'dep'), { recursive: true });
    writeFileSync(join(root, 'lib', 'runner.mjs'), '// nine member repos\n');
    writeFileSync(join(root, 'test', 'fixture.mjs'), '// nine member repos\n');
    writeFileSync(join(root, 'node_modules', 'dep', 'index.mjs'), '// nine member repos\n');

    const sources = engineSources(root).map((p) => p.split(/[\\/]/).slice(-2).join('/'));

    assert.deepEqual(sources, ['lib/runner.mjs'], 'only first-party engine source is swept');
    assert.equal(
      sources.filter((p) => p.startsWith('test/')).length,
      0,
      'quoted counts in fixtures are regression data, and a fixture with a wrong count fails on its own',
    );
    assert.equal(
      sources.filter((p) => p.startsWith('node_modules/')).length,
      0,
      'and a dependency states counts about its own project, not about this fleet',
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

/*
 * ---------------------------------------------------------------------------------------------
 * #958 — a fleet size stated as a fraction, which the pattern above cannot see.
 *
 * `COUNT_PHRASE` requires the word `all`. `AGENTS.md` says "this file is distributed to six of
 * the eleven members", which states the fleet's size just as flatly and matches nothing. This is
 * #246 again — *"requiring `all` bought nothing and cost exactly the blind spot"* — recurring in
 * the sibling pattern rather than in the one that was widened, which is the part worth recording:
 * widening a pattern fixes the pattern, not the reasoning that made it narrow.
 *
 * The definite article is what makes the fraction form tractable. `the M members` names the whole
 * population; `M members` names some M. The tree holds roughly thirty fraction-shaped sentences
 * -- "three of six", "one of nine members holds a", "Twelve of the thirteen repositories" -- and
 * they are historical narrative and subset claims that are correct as written. Requiring `of the`
 * leaves every one of them alone. A guard that failed them would be weakened or deleted, which
 * this file has already said twice and is the reason it is said a third time here.
 *
 * `none of the eleven members` is included on purpose: a numeral-only pattern misses it, and it
 * is as much a claim about the fleet's size as any other.
 * ---------------------------------------------------------------------------------------------
 */

/**
 * Zero-words, kept local rather than added to `WORD_NUMBERS` above.
 *
 * Adding them there would silently widen `ANY_COUNT_PHRASE`, which has no `all` requirement, so
 * an engine comment reading "no members" would start failing as a fleet-size claim. The shared
 * map is load-bearing for two other patterns; a third caller's needs do not get to edit it.
 */
const FRACTION_WORDS = new Map([...WORD_NUMBERS, ['no', 0], ['none', 0], ['zero', 0]]);

const FRACTION_TOKENS = [...FRACTION_WORDS.keys()].join('|');

const FLEET_FRACTION = new RegExp(
  String.raw`\b(\d+|${FRACTION_TOKENS})\s+of\s+the\s+(\d+|${FRACTION_TOKENS})\s+member(?:s|\s+repos?|\s+repositories)\b`,
  'gi',
);

const toFraction = (token) => FRACTION_WORDS.get(token.toLowerCase()) ?? Number(token);

/** How far back to look for the document a reach claim is about. */
const SUBJECT_WINDOW = 300;

/**
 * The document a reach claim is about: the nearest mention preceding it.
 *
 * `this file` counts as a mention of the containing document, which is how `AGENTS.md`'s own
 * sentence resolves — it names `.github/copilot-instructions.md` earlier in the same sentence, so
 * nearest-wins is doing real work rather than picking the only candidate.
 *
 * Returns `null` when nothing is named, and the caller treats that as a fault rather than as a
 * pass. A reach claim that names no document cannot be checked against anything, and an
 * unverifiable claim is the shape that decays quietly — exempting it here would be an exemption
 * scoped by "the guard found this one hard", which is not a property of the prose.
 */
function subjectOf(before, names, alias, containingDoc) {
  let subject = null;
  let at = -1;
  for (const name of names) {
    const i = before.lastIndexOf(name);
    if (i > at) {
      at = i;
      subject = alias.get(name);
    }
  }
  for (const self of ['this file', 'this document']) {
    const i = before.toLowerCase().lastIndexOf(self);
    if (i > at) {
      at = i;
      subject = containingDoc;
    }
  }
  return subject;
}

/**
 * One predicate, called by the sweep and by the fixtures below.
 *
 * Written this way from the start because of the mutant recorded at `countClaimFault`: a fixture
 * exercising its own copy certifies the copy. Returns the reason a claim is wrong, or `null`.
 */
function reachFault({ numerator, denominator, subject, audience, fleet }) {
  if (subject === null) {
    return 'names no document, so its reach cannot be checked against what the engine delivers';
  }
  if (denominator !== fleet) {
    return `states a fleet of ${denominator}, but the manifest has ${fleet} members`;
  }
  return numerator === audience
    ? null
    : `but the engine delivers ${subject} to ${audience} of the ${fleet} members`;
}

/**
 * Every fraction claim on a surface, resolved and judged. Shared by the sweep and its controls so
 * neither can drift from the other.
 */
function fractionClaims(text, containingDoc, mentions, audienceMap, fleet) {
  const flat = text.replace(/\s+/g, ' ');
  const claims = [];
  for (const match of flat.matchAll(FLEET_FRACTION)) {
    const before = flat.slice(Math.max(0, match.index - SUBJECT_WINDOW), match.index);
    const subject = subjectOf(before, mentions.names, mentions.alias, containingDoc);
    claims.push({
      phrase: match[0],
      numerator: toFraction(match[1]),
      denominator: toFraction(match[2]),
      subject,
      audience: subject === null ? 0 : audienceOf(audienceMap, subject),
      fleet,
    });
  }
  return claims;
}

/**
 * Document names as they can appear in prose, including surfaces that are delivered to nobody.
 *
 * Sorted longest-first once, here, rather than per match: `.github/instructions/x.instructions.md`
 * must win over `instructions/x.instructions.md` when both occur at the same place, and re-sorting
 * several hundred names inside the scan loop dominated the sweep's runtime.
 */
function mentionable(audienceMap, surfaces) {
  const alias = new Map(audienceMap.alias);
  for (const surface of surfaces) if (!alias.has(surface)) alias.set(surface, surface);
  return { alias, names: [...alias.keys()].sort((a, b) => b.length - a.length) };
}

function sweepFractions() {
  const audienceMap = canonAudience(REPO_ROOT);
  const surfaces = proseSurfaces();
  const mentions = mentionable(audienceMap, surfaces);
  const claims = [];
  for (const relativePath of surfaces) {
    const text = readFileSync(join(REPO_ROOT, ...relativePath.split('/')), 'utf8');
    for (const claim of fractionClaims(text, relativePath, mentions, audienceMap, audienceMap.fleet)) {
      claims.push({ ...claim, surface: relativePath });
    }
  }
  return { audienceMap, claims };
}

test('a reach stated as a fraction of the fleet matches the audience the engine computes', () => {
  const { claims } = sweepFractions();
  const wrong = [];

  for (const claim of claims) {
    const fault = reachFault(claim);
    if (fault) wrong.push(`${claim.surface}: "${claim.phrase}" ${fault}`);
  }

  assert.deepEqual(
    wrong,
    [],
    `A document's reach is computable from studio.config.json — state the number the engine delivers, or name the document so it can be checked:\n  - ${wrong.join('\n  - ')}`,
  );
});

test('the fraction sweep finds the claims that are actually written, and resolves each to a document', () => {
  // The half that keeps the test above from passing over an empty match set forever. These are
  // the whole population as of #958, and each exercises a different branch of the resolver: a
  // self-reference, a document delivered to nobody, and a named document other than the writer.
  const { claims } = sweepFractions();
  const found = claims.map((c) => `${c.surface} -> ${c.subject} (${c.numerator}/${c.denominator})`);

  assert.ok(
    found.includes('AGENTS.md -> AGENTS.md (6/11)'),
    `AGENTS.md's self-reach is the claim #958 was filed for and must resolve to itself; found:\n  ${found.join('\n  ')}`,
  );
  assert.ok(
    found.includes('docs/sync.md -> docs/sync.md (0/11)'),
    'a document in no canon kind has an audience of zero, and "none of the eleven members" is a fleet claim a numeral-only pattern misses',
  );
  assert.ok(
    found.some((entry) => entry.endsWith('-> instructions/workflow.instructions.md (9/11)')),
    'a claim about another document resolves to that document, not to the file making it',
  );
  assert.ok(
    found.length >= 4,
    `the sweep resolved ${found.length} fraction claims — below the population #958 measured, so the pattern or the walk has narrowed`,
  );
});

test('the fraction guard fires on a wrong numerator, a wrong fleet, and an unattributed claim', () => {
  // Both directions, because a healthy tree keeps every claim true and so the sweep above stays
  // silent whatever the predicate does. Each case goes through `reachFault`, the function the
  // sweep itself calls.
  const fleet = 11;

  assert.equal(
    reachFault({ numerator: 6, denominator: 11, subject: 'AGENTS.md', audience: 6, fleet }),
    null,
    'the real sentence stands',
  );
  assert.ok(
    reachFault({ numerator: 7, denominator: 11, subject: 'AGENTS.md', audience: 6, fleet }),
    'a numerator one off the computed audience is the decay this guard exists for',
  );
  assert.ok(
    reachFault({ numerator: 6, denominator: 12, subject: 'AGENTS.md', audience: 6, fleet }),
    'and the denominator is a fleet-size claim, which is the half the `all N members` pattern could not see here',
  );
  assert.ok(
    reachFault({ numerator: 6, denominator: 11, subject: null, audience: 0, fleet }),
    'a claim naming no document cannot be verified, so it is a fault rather than a pass',
  );
});

test('the audience map is derived from the engine, and is pinned by documents named one at a time', () => {
  // The lesson from #944, applied before it bites: `canonAudience` and `proseSurfaces` are both
  // derivations, so comparing them would only confirm they agree. What pins them is naming
  // documents whose audiences are known independently — read out of studio.config.json's optIn by
  // a human — and asserting the engine reports those numbers.
  const audienceMap = canonAudience(REPO_ROOT);

  assert.equal(
    audienceOf(audienceMap, 'AGENTS.md'),
    6,
    'base is opted into by six members, so the operating guide reaches six',
  );
  assert.equal(
    audienceOf(audienceMap, 'copilot-instructions.md'),
    11,
    'copilot is opted into by every member, so it is the one fleet-universal document',
  );
  assert.equal(
    audienceOf(audienceMap, 'instructions/workflow.instructions.md'),
    9,
    'the workflow instructions reach nine, which is the number two other surfaces state',
  );
  assert.equal(
    audienceOf(audienceMap, 'docs/sync.md'),
    0,
    'docs/ is in no canon kind, and a document delivered to nobody must report zero rather than undefined',
  );

  assert.ok(
    audienceMap.audience.size >= 60,
    `the audience map covers ${audienceMap.audience.size} documents — the enumeration has narrowed to a corner of canon`,
  );
  assert.ok(
    audienceMap.alias.has('.github/instructions/workflow.instructions.md'),
    'a sentence naming the member-side path must resolve to the same document as one naming the source path',
  );
});

test('a dir kind reaches the map through the group name, not the spec name', () => {
  // Kept as a coverage control after the shortcut it guarded was withdrawn (see the note in
  // canon-audience.mjs). The class of document the shortcut silently lost was the dir kind, whose
  // specs are named `<skill>/<file>` rather than after the group — so that is the class named here
  // rather than left to a total.
  const audienceMap = canonAudience(REPO_ROOT);
  const skills = [...audienceMap.audience.keys()].filter((doc) => doc.startsWith('skills/'));

  assert.ok(
    skills.length >= 20,
    `a dir kind expands to files beneath the group name, and the map reached only ${skills.length} of them`,
  );
  assert.ok(
    audienceOf(audienceMap, 'skills/fleet-orchestration/SKILL.md') === 11,
    'a skill opted into by every member reaches every member, named rather than counted',
  );
  assert.ok(
    audienceMap.alias.has('.github/skills/fleet-orchestration/SKILL.md'),
    'and its member-side path resolves back to the source path a sentence would name',
  );
});
