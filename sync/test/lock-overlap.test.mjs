// A sync run reads the member's lockfile once, from a clone taken at run start, and writes it
// wholesale at commit. Two runs whose lifetimes overlap therefore race on a single JSON file: the
// second to merge writes a lock built from a base that never contained the first's entries, and
// entries it did not itself touch are reverted (#418).
//
// That is not bookkeeping. A lock entry that disagrees with the file on disk is read as member
// drift, so the path is refused on every later run. The observed instance froze
// `jrmoulckers/finance`'s `tokens.css` for roughly 16 hours and was cleared only by hand-editing a
// generated file.
//
// These pin the fold-back rule. The hard cases are not the regression itself — they are the two
// ways an over-eager rule breaks the branch-reuse path, where our lock legitimately holds entries
// the default branch has never seen.

import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeNewerBaseEntries } from '../lib/lock.mjs';

const entry = (target, syncedAt, source = 'src') => ({
  sourceSha256: source,
  targetSha256: target,
  syncedAt,
});

test('an untouched entry the default branch moved forward is kept', () => {
  // The defect itself, with the values it was observed at: #4027 recorded `9966d8a4` on 08-09, and
  // an overlapping run carrying a pre-#4027 snapshot wrote `bb35859e`/08-07 over it. Both hash and
  // timestamp moved backwards, which is how it was identified as a carried snapshot rather than a
  // recomputed answer.
  const ours = { 'tokens.css': entry('bb35859e', '2026-08-07T15:35:03.616Z') };
  const base = { 'tokens.css': entry('9966d8a4', '2026-08-09T22:23:00.000Z') };

  const { entries, restored } = mergeNewerBaseEntries(ours, base, new Set());

  assert.equal(entries['tokens.css'].targetSha256, '9966d8a4');
  assert.deepEqual(restored.map((r) => r.targetPath), ['tokens.css']);
});

test('an entry the default branch gained is added back', () => {
  // The other half of a lost update: our snapshot predates the key existing at all, so there is
  // nothing to compare timestamps against and the base is simply newer information.
  const { entries, restored } = mergeNewerBaseEntries(
    {},
    { 'new.md': entry('aaa', '2026-08-09T00:00:00.000Z') },
    new Set(),
  );

  assert.equal(entries['new.md'].targetSha256, 'aaa');
  assert.equal(restored[0].from, null);
});

test('an entry this run authored is never displaced, even by a newer base', () => {
  // This is the exclusion that keeps the rule out of #418's undecided question. Our entry describes
  // bytes this run just wrote into its own branch; a newer entry elsewhere describes a different
  // branch's bytes. Taking the base here would leave the lock disagreeing with the file beside it,
  // manufacturing exactly the drift the fold exists to prevent.
  const ours = { 'a.md': entry('mine', '2026-08-07T00:00:00.000Z') };
  const base = { 'a.md': entry('theirs', '2026-08-09T00:00:00.000Z') };

  const { entries, restored } = mergeNewerBaseEntries(ours, base, new Set(['a.md']));

  assert.equal(entries['a.md'].targetSha256, 'mine');
  assert.equal(restored.length, 0);
});

test('an older base entry does not displace ours — the branch-reuse case', () => {
  // Non-vacuity for the timestamp comparison, and the reason a plain "base wins" rule is wrong.
  // On the reuse path our lock comes from the sync branch, which holds entries newer than the
  // default branch precisely because they have not merged yet. Preferring the base would revert
  // the previous run's work on our own branch — a regression introduced by the fix for one.
  const ours = { 'a.md': entry('newer', '2026-08-09T00:00:00.000Z') };
  const base = { 'a.md': entry('older', '2026-08-07T00:00:00.000Z') };

  const { entries, restored } = mergeNewerBaseEntries(ours, base, new Set());

  assert.equal(entries['a.md'].targetSha256, 'newer');
  assert.equal(restored.length, 0);
});

test('a key absent from the default branch is never deleted', () => {
  // Absence is ambiguous from here: it may be a prune an overlapping run performed, or an entry an
  // earlier commit on a reused branch added and the default branch has simply never seen. Deleting
  // on that ambiguity discards a baseline whose file is still on disk, which is the failure being
  // fixed. Leaving it costs a stale entry the next run corrects.
  const ours = { 'a.md': entry('mine', '2026-08-07T00:00:00.000Z') };

  const { entries } = mergeNewerBaseEntries(ours, {}, new Set());

  assert.ok(entries['a.md'], 'an entry missing from the base must survive the fold');
});

test('a base entry with no timestamp does not displace one that has a timestamp', () => {
  // Absence of a timestamp is not evidence of age. If it were allowed to win, a hand-edited or
  // truncated entry would outrank a recorded one purely by carrying less information.
  const ours = { 'a.md': entry('mine', '2026-08-07T00:00:00.000Z') };
  const base = { 'a.md': { sourceSha256: 'src', targetSha256: 'theirs' } };

  const { entries } = mergeNewerBaseEntries(ours, base, new Set());

  assert.equal(entries['a.md'].targetSha256, 'mine');
});

test('an unparseable timestamp is treated as absent, not as epoch', () => {
  // `Date.parse` returns NaN rather than throwing, and NaN comparisons are always false. Asserted
  // so a future refactor to `new Date(x) > new Date(y)` cannot silently make every malformed entry
  // lose or win by accident.
  const ours = { 'a.md': entry('mine', 'not-a-date') };
  const base = { 'a.md': entry('theirs', '2026-08-09T00:00:00.000Z') };

  const { entries } = mergeNewerBaseEntries(ours, base, new Set());
  assert.equal(entries['a.md'].targetSha256, 'theirs', 'a real timestamp outranks an unparseable one');

  const flipped = mergeNewerBaseEntries(
    { 'a.md': entry('mine', '2026-08-09T00:00:00.000Z') },
    { 'a.md': entry('theirs', 'not-a-date') },
    new Set(),
  );
  assert.equal(flipped.entries['a.md'].targetSha256, 'mine', 'an unparseable timestamp wins nothing');
});

test('a newer base entry with identical hashes is not reported as restored', () => {
  // The common case on every overlapping run: another run re-recorded the same baseline with a
  // later timestamp. Nothing about the member changed, so surfacing it would train a reader to
  // skip the warning that matters.
  const ours = { 'a.md': entry('same', '2026-08-07T00:00:00.000Z') };
  const base = { 'a.md': entry('same', '2026-08-09T00:00:00.000Z') };

  const { restored } = mergeNewerBaseEntries(ours, base, new Set());

  assert.equal(restored.length, 0);
});

// The test above is named for both hashes and varies one: `entry()` defaults `sourceSha256` to the
// same value on either side, so a `sameBaseline` consulting `targetSha256` alone left the whole
// suite green -- verified by mutant, not by reading. This supplies the operand it never varied.
//
// The state is ordinary rather than exotic. `sourceSha256` records which canon revision produced the
// bytes, and distinct revisions can render byte-identical output: an edit outside a managed region,
// or a canon change that only reorders something the renderer normalizes. When the default branch
// holds a newer sync recording the same bytes from a newer source, skipping it keeps a stale
// provenance in our lock while the timestamps say we are current.
//
// That matters downstream rather than cosmetically: classification asks whether on-disk bytes are
// recognizable output of a known canon revision, and it asks `sourceSha256`. A lock frozen on a
// superseded source answers that question wrongly for as long as it survives.
test('a newer base entry that moved only the canon source is restored, not skipped as identical', () => {
  const ours = { 'a.md': entry('same', '2026-08-07T00:00:00.000Z', 'canon-before') };
  const base = { 'a.md': entry('same', '2026-08-09T00:00:00.000Z', 'canon-after') };

  const { entries, restored } = mergeNewerBaseEntries(ours, base, new Set());

  assert.equal(
    entries['a.md'].sourceSha256,
    'canon-after',
    'the newer provenance must be folded in; identical bytes do not make the entries the same',
  );
  assert.deepEqual(
    restored.map((r) => r.targetPath),
    ['a.md'],
    'a restored entry is reported, or the fold is silent about what it changed',
  );
});

test('an equal timestamp does not hand the entry to the base', () => {
  // `outranks` documents that the base wins only when it is *strictly* newer, and the word doing
  // all the work is "strictly". Every other case here uses 08-07 against 08-09, where `>` and `>=`
  // return the same answer for every input, so the rule was asserted only where it is untestable.
  // Verified by mutant: relaxing `>` to `>=` left all 454 tests green.
  //
  // A tie means neither side can show it observed the other, and the entry beside ours is the one
  // this run can still account for. Deferring to the base on a tie would revert an untouched entry
  // on the strength of no evidence at all -- the #418 regression, reached from the other direction.
  const stamp = '2026-08-09T00:00:00.000Z';
  const ours = { 'a.md': entry('mine', stamp) };
  const base = { 'a.md': entry('theirs', stamp) };

  const { entries, restored } = mergeNewerBaseEntries(ours, base, new Set());

  assert.equal(entries['a.md'].targetSha256, 'mine', 'a tie is not evidence that the base is newer');
  assert.equal(restored.length, 0, 'nothing was displaced, so nothing may be reported as restored');
});

test('the fold does not mutate the entries it was given', () => {
  // `apply` has already written this object to disk; a caller that folds and then decides not to
  // commit must not have altered the run's own record as a side effect.
  const ours = { 'a.md': entry('mine', '2026-08-07T00:00:00.000Z') };
  mergeNewerBaseEntries(ours, { 'a.md': entry('theirs', '2026-08-09T00:00:00.000Z') }, new Set());

  assert.equal(ours['a.md'].targetSha256, 'mine');
});

// --- the call site: what a failed lookup is allowed to conclude ---

import { mkdtempSync, rmSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { refreshLockAgainstDefault } from '../lib/pr.mjs';
import { LOCK_FILENAME } from '../lib/lock.mjs';
import { readLock } from '../lib/lock.mjs';

function withTmp(fn) {
  const dir = mkdtempSync(join(tmpdir(), 'lock-overlap-'));
  try {
    return fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

const lockOf = (entries) => ({ version: 1, backbone: 'jrmoulckers/.github', entries });

test('a newer default-branch entry is folded into the lockfile on disk', () => {
  withTmp((dir) => {
    const ours = lockOf({ 'a.md': entry('mine', '2026-08-07T00:00:00.000Z') });
    writeFileSync(join(dir, LOCK_FILENAME), JSON.stringify(ours), 'utf8');

    const head = { status: 'ok', content: JSON.stringify(lockOf({ 'a.md': entry('theirs', '2026-08-09T00:00:00.000Z') })) };
    refreshLockAgainstDefault(dir, 'main', ours, new Set(), 'o/r', 'jrmoulckers/.github', () => head);

    const written = JSON.parse(readFileSync(join(dir, LOCK_FILENAME), 'utf8'));
    assert.equal(written.entries['a.md'].targetSha256, 'theirs');
  });
});

test('an unavailable lookup leaves the lockfile exactly as the run wrote it', () => {
  // The three-state distinction earning its keep. `unavailable` means nothing is known about the
  // default branch, and the only safe reading of "I could not look" is to change nothing — which is
  // also precisely the behaviour that shipped before this check existed, so the check can never be
  // worse than its absence.
  withTmp((dir) => {
    const ours = lockOf({ 'a.md': entry('mine', '2026-08-07T00:00:00.000Z') });
    const raw = JSON.stringify(ours);
    writeFileSync(join(dir, LOCK_FILENAME), raw, 'utf8');

    refreshLockAgainstDefault(dir, 'main', ours, new Set(), 'o/r', 'jrmoulckers/.github', () => ({
      status: 'unavailable',
      content: null,
    }));

    assert.equal(readFileSync(join(dir, LOCK_FILENAME), 'utf8'), raw);
  });
});

test('a readable branch with no lockfile is not mistaken for an empty one', () => {
  // A member's first sync. `ok` with null content says the file genuinely is not there, and the
  // fold has nothing to add — but it must not rewrite the lock either, which is the observable
  // difference from having read an empty entry set.
  withTmp((dir) => {
    const ours = lockOf({ 'a.md': entry('mine', '2026-08-07T00:00:00.000Z') });
    const raw = JSON.stringify(ours);
    writeFileSync(join(dir, LOCK_FILENAME), raw, 'utf8');

    refreshLockAgainstDefault(dir, 'main', ours, new Set(), 'o/r', 'jrmoulckers/.github', () => ({
      status: 'ok',
      content: null,
    }));

    assert.equal(readFileSync(join(dir, LOCK_FILENAME), 'utf8'), raw);
  });
});

test('a corrupt default-branch lockfile is skipped, not thrown', () => {
  // The member controls these bytes and can commit anything. A parse failure here must not abort a
  // sync run that is otherwise correct, because the entire member would then stop receiving canon
  // on account of a file the engine only consults as a cross-check.
  withTmp((dir) => {
    const ours = lockOf({ 'a.md': entry('mine', '2026-08-07T00:00:00.000Z') });
    const raw = JSON.stringify(ours);
    writeFileSync(join(dir, LOCK_FILENAME), raw, 'utf8');

    assert.doesNotThrow(() =>
      refreshLockAgainstDefault(dir, 'main', ours, new Set(), 'o/r', 'jrmoulckers/.github', () => ({
        status: 'ok',
        content: '{ not json',
      })),
    );
    assert.equal(readFileSync(join(dir, LOCK_FILENAME), 'utf8'), raw);
  });
});

test('a fold that restores nothing does not rewrite the lockfile', () => {
  // `serializeLock` stamps a fresh `generatedAt` on every write, so an unconditional rewrite would
  // put a diff in every PR that touches nothing and mean nothing.
  withTmp((dir) => {
    const ours = lockOf({ 'a.md': entry('mine', '2026-08-09T00:00:00.000Z') });
    const raw = JSON.stringify(ours);
    writeFileSync(join(dir, LOCK_FILENAME), raw, 'utf8');

    refreshLockAgainstDefault(dir, 'main', ours, new Set(), 'o/r', 'jrmoulckers/.github', () => ({
      status: 'ok',
      content: JSON.stringify(lockOf({ 'a.md': entry('mine', '2026-08-07T00:00:00.000Z') })),
    }));

    assert.equal(readFileSync(join(dir, LOCK_FILENAME), 'utf8'), raw);
  });
});

// A member repo can carry a *different* file under the same name: `jrmoulckers/libro` PR #6 holds a
// pre-engine token-sync lock at `.studio-sync.lock.json` whose top-level keys are `$schema,
// description, source, package, vendor, sync` -- valid JSON, no `entries`. Read with a defaulting
// reader it returned version 1, the expected backbone, and zero entries: a lock that looks current,
// valid and empty, because every field that could identify it as foreign was filled in from our own
// expectations. Empty means "nothing was ever delivered", which reverts every untouched path.
// Corrupt bytes already threw; the well-formed wrong contract was the case that passed silently.
test('a lockfile carrying a foreign contract is refused, not emptied', () => {
  const root = mkdtempSync(join(tmpdir(), 'foreign-lock-'));
  writeFileSync(
    join(root, LOCK_FILENAME),
    JSON.stringify({
      $schema: 'https://jrm.example/token-sync.schema.json',
      description: 'pre-engine token sync',
      source: 'jrmoulckers/.github',
      package: '@jrm/tokens',
      vendor: 'vendor/@jrm/tokens',
      sync: { strategy: 'copy' },
    }),
  );

  assert.throws(() => readLock(root, 'jrmoulckers/.github'), /no "entries" object/);
});

test('an absent lockfile is still the empty lock, not an error', () => {
  const root = mkdtempSync(join(tmpdir(), 'absent-lock-'));
  const lock = readLock(root, 'jrmoulckers/.github');
  assert.deepEqual(lock.entries, {});
  assert.equal(lock.generatedAt, null);
});

// --- the sentence: what the operator is actually told ---
//
// Every test above drives `refreshLockAgainstDefault` and asserts the lockfile bytes it leaves on
// disk. None reads its output, and that is the whole gap: reducing the per-entry line to a bare
// `${item.targetPath}` -- dropping both timestamps -- left all 454 tests green. The docblock says
// "Reported, never silent", and the reporting was the part with no test.
//
// This is `runner.test.mjs`'s recorded lesson one module over. There it was a report computed and
// never published; here it is a report published and never observed, which decays the same way and
// looks identical from CI.

import { formatOverlapWarning } from '../lib/pr.mjs';

test('the overlap warning names every restored path and both sides of each decision', () => {
  const lines = formatOverlapWarning('o/finance', 'main', [
    { targetPath: 'tokens.css', from: '2026-08-07T15:35:03.616Z', to: '2026-08-09T22:23:00.000Z' },
    { targetPath: 'AGENTS.md', from: null, to: '2026-08-09T22:23:00.000Z' },
  ]);

  const body = lines.join('\n');
  assert.match(body, /2 lock entr\(ies\)/, 'the count is the reader\'s first signal of scale');
  assert.match(body, /newer on main/, 'which branch was compared is not inferable from the paths');

  // Both paths named. A count with no names tells a reader an overlap happened and leaves them
  // unable to check whether the frozen file they are looking at is one of them.
  assert.match(body, /tokens\.css/);
  assert.match(body, /AGENTS\.md/);

  // Both sides of every decision. "Kept X" alone is the failure this test exists to prevent: it
  // reports that a choice was made and withholds the only value that makes it checkable.
  assert.match(body, /kept 2026-08-09T22:23:00\.000Z, this run had 2026-08-07T15:35:03\.616Z/);

  // An entry this run never held is spelled out. Rendering `null` or an empty gap reads as a value
  // that failed to print, which is indistinguishable from a formatting bug at exactly the moment a
  // reader is deciding whether to trust the line.
  assert.match(body, /AGENTS\.md \(kept 2026-08-09T22:23:00\.000Z, this run had no entry\)/);
  assert.doesNotMatch(body, /null/);
});

test('a fold that restored nothing produces no warning at all', () => {
  // The overlap warning fires only on the runs where something was displaced. A line emitted every
  // run -- "0 entries were newer" -- is one a reader learns to skip, and this is the warning that
  // most needs reading when it does appear.
  assert.deepEqual(formatOverlapWarning('o/a', 'main', []), []);
  assert.deepEqual(formatOverlapWarning('o/a', 'main', undefined), []);
});

test('the overlap warning is actually wired to the run log', () => {
  // A pure formatter proves nothing about whether anything calls it, and this formatter was
  // extracted precisely because being inline is what kept it unobserved. Following
  // runner.test.mjs, the wiring is asserted at the source: `refreshLockAgainstDefault` writes its
  // own bytes and returns early on every path that reports nothing, so no behavioural assertion
  // here distinguishes "warned" from "warned into a void".
  const source = readFileSync(new URL('../lib/pr.mjs', import.meta.url), 'utf8');
  assert.match(source, /formatOverlapWarning\(repo, defaultBranch, restored\)/, 'the fold must call the formatter');
  assert.match(source, /log\.warn\(line\)/, 'and every line it returns must reach the log');

  // One formatter, not two: a second inline copy would drift from the tested one and the tests
  // would stay green while the operator read the untested sentence.
  const inlineKept = source.match(/log\.warn\(\s*`[^`]*kept /g) ?? [];
  assert.deepEqual(inlineKept, [], 'the warning text must exist only in the formatter');
});
