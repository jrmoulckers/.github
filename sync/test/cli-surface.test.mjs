import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const ENTRY = join(REPO_ROOT, 'sync', 'index.mjs');

const FLAG = /--[a-z][a-z-]+/g;
const flagsIn = (text) => new Set(text.match(FLAG) ?? []);
const sorted = (set) => [...set].sort();

// The engine advertises its flags in three places: the header comment a source reader meets first,
// the usage text `--help` prints, and the `case '--x':` arms that actually parse them. Only the
// third is executable, so the other two are transcriptions and decay independently of it.
//
// The motivating instance: `--force-paths` was added in #457 -> PR #460 (`0d98ad1`), which updated
// the parser and the printed usage and left the header at nine of ten flags. The header is the
// surface with no consumer -- no test read it and no command emitted it -- so nothing could observe
// the omission, and a reader of the source was told the engine had a flag set it does not have.
//
// This is checked by *executing* the CLI rather than by importing a usage constant. A test that
// asserts over an exported string proves the string's content and says nothing about whether any
// invocation prints it; a help text no command can reach passes that test perfectly.
test('every flag the engine parses is advertised in both places that document it', () => {
  const source = readFileSync(ENTRY, 'utf8').replace(/\r\n/g, '\n');

  // The header comment is everything above the first import: the block a reader sees before code.
  const header = source.slice(0, source.indexOf('\nimport '));
  assert.ok(header.includes('// Flags:'), 'header flag block not found — this check would be vacuous');

  const printed = spawnSync(process.execPath, [ENTRY, '--help'], { encoding: 'utf8' });
  // A spawn failure leaves status null and both streams null, so asserting on status alone would
  // report "--help must exit 0, got null: null" for a process that never started.
  assert.ok(!printed.error, `--help did not run: ${printed.error?.message}`);
  assert.equal(printed.status, 0, `--help must exit 0, got ${printed.status}: ${printed.stderr}`);
  const help = `${printed.stdout}${printed.stderr}`;
  assert.ok(help.includes('Usage:'), '--help printed no usage text');

  // `case '--x':` is the only one of the three that decides behaviour, so it is the reference.
  const parsed = new Set(
    [...source.matchAll(/case '(--[a-z][a-z-]+)'/g)].map((match) => match[1]),
  );
  assert.ok(parsed.size > 1, 'no parsed flags discovered — this check would be vacuous');

  const headerFlags = flagsIn(header);
  const helpFlags = flagsIn(help);

  // Both directions. An advertised flag that is not parsed is as wrong as a parsed flag that is
  // never advertised, and a one-directional subset check passes while the other half rots.
  assert.deepEqual(
    sorted(new Set([...parsed].filter((flag) => !headerFlags.has(flag)))),
    [],
    'flags parsed by the engine but missing from the header comment',
  );
  assert.deepEqual(
    sorted(new Set([...parsed].filter((flag) => !helpFlags.has(flag)))),
    [],
    'flags parsed by the engine but missing from the printed usage',
  );
  assert.deepEqual(
    sorted(new Set([...helpFlags].filter((flag) => !parsed.has(flag)))),
    [],
    'flags the printed usage advertises that the engine does not parse',
  );

  // The guard must discriminate at the resolution of the claim, which is per-flag. Asserting only
  // that each set is non-empty is armed against an empty corpus and blind to a single dropped
  // flag -- the state that actually occurred. So the failing direction is constructed: remove one
  // real flag from a copy of the header and require it to be named.
  const victim = [...parsed][0];
  const narrowedHeader = flagsIn(header.split(victim).join('--zz-absent'));
  const missed = sorted(new Set([...parsed].filter((flag) => !narrowedHeader.has(flag))));
  assert.deepEqual(missed, [victim], `dropping ${victim} from the header must be reported`);
});

// The same help text carries a second enumeration, and for a long time only the first one above was
// checked. `Env:` is a completeness claim in the same template literal as the flag list, and it
// named one of the three variables the engine actually consults: `GITHUB_STEP_SUMMARY` decides
// whether a run publishes a summary at all, and `NO_COLOR` is read on every invocation through
// log.mjs. Reachability was never what protected the flag list -- `--help` is executed by the test
// above, exits 0, and is read by users. Exhaustiveness over the *whole* claim is what protects it,
// and a guard can be rigorous about one clause while the clause below it rots untouched.
//
// The population is the import closure of the entry point, not "every env var in the engine".
// Widening that far would be a second defect: `principles/validate.mjs` reads PRINCIPLES_BASE_SHA
// and `check-caller-permissions.mjs` reads GITHUB_STEP_SUMMARY, and neither is reachable from this
// CLI, so this CLI's help must not advertise them. The property that puts a variable under the rule
// is "this command can reach the code that reads it", so the corpus is derived by following imports.
const ENV = /process\.env\.([A-Z_][A-Z0-9_]*)/g;

// Resolution is deliberately literal: only relative specifiers, and no extension guessing. The
// engine imports its own modules with explicit `.mjs` paths, so anything this fails to resolve is a
// change in convention rather than a file this should have found, and it will surface as a missing
// variable instead of being silently skipped.
function importClosure(entry) {
  const seen = new Set();
  const pending = [entry];
  while (pending.length > 0) {
    const file = pending.pop();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, 'utf8');
    for (const match of source.matchAll(/from\s+'(\.[^']+)'/g)) {
      pending.push(resolve(dirname(file), match[1]));
    }
  }
  return seen;
}

const envVarsIn = (files) => {
  const found = new Set();
  for (const file of files) {
    for (const match of readFileSync(file, 'utf8').matchAll(ENV)) found.add(match[1]);
  }
  return found;
};

// Both directions and the controls route through these two predicates rather than re-implementing
// the comparison inline. A control that rebuilds the check it is controlling passes while the
// production copy is weakened, so the control has to exercise the same code the assertion does.
const notMentionedIn = (names, text) => sorted(new Set([...names].filter((n) => !text.includes(n))));
const notReadBy = (names, read) => sorted(new Set([...names].filter((n) => !read.has(n))));

const advertisedIn = (text) =>
  new Set([...text.matchAll(/\b([A-Z][A-Z0-9_]{4,})\b/g)].map((match) => match[1]));

test('every environment variable the engine can reach is advertised in the printed usage', () => {
  const closure = importClosure(ENTRY);
  // A closure of one is what a broken resolver produces, and it would make the check vacuous while
  // still finding STUDIO_SYNC_TOKEN, which is read in the entry file itself.
  assert.ok(closure.size > 1, `import closure collapsed to ${closure.size} file(s)`);

  const printed = spawnSync(process.execPath, [ENTRY, '--help'], { encoding: 'utf8' });
  assert.ok(!printed.error, `--help did not run: ${printed.error?.message}`);
  assert.equal(printed.status, 0, `--help must exit 0, got ${printed.status}: ${printed.stderr}`);
  const help = `${printed.stdout}${printed.stderr}`;

  const read = envVarsIn(closure);
  assert.ok(read.size > 1, 'no environment variables discovered — this check would be vacuous');

  assert.deepEqual(
    notMentionedIn(read, help),
    [],
    'environment variables the engine reads that the printed usage does not document',
  );

  // The other direction. An advertised variable nothing reads sends an operator to configure a
  // setting that does nothing, which is the failure the flag check treats as equally serious.
  assert.deepEqual(
    notReadBy(advertisedIn(help), read),
    [],
    'environment variables the printed usage documents that the engine never reads',
  );

  // Positive control for the first direction, constructed rather than asserted: drop one real
  // variable from a copy of the help and require it to be named. A non-empty check passes with a
  // single variable documented.
  const victim = [...read].sort()[0];
  assert.deepEqual(
    notMentionedIn(read, help.split(victim).join('ZZ_ABSENT')),
    [victim],
    `dropping ${victim} from the usage must be reported`,
  );

  // Positive control for the second direction. Both halves of a bidirectional check need one; the
  // reverse half is the easier of the two to weaken without any test noticing, because the healthy
  // tree has no advertised-but-unread variable to keep it honest.
  assert.deepEqual(
    notReadBy(advertisedIn(`${help}\nEnv: ZZ_PHANTOM_VAR — documented, never read.`), read),
    ['ZZ_PHANTOM_VAR'],
    'an advertised variable the engine never reads must be reported',
  );

  // Negative control. PRINCIPLES_BASE_SHA is read by principles/validate.mjs, a separate entry
  // point, and must stay out of this claim -- a corpus widened to "all engine source" would demand
  // that the sync CLI document a variable it cannot reach. This pins the derivation, not the list:
  // it fails if the closure ever grows to include that entry point without the help being revisited.
  const reachable = new Set([...closure].map((file) => file.replace(/\\/g, '/')));
  assert.ok(
    ![...reachable].some((file) => file.endsWith('principles/validate.mjs')),
    'principles/validate.mjs entered the CLI closure — its env surface is now in scope here',
  );
  assert.ok(!read.has('PRINCIPLES_BASE_SHA'), 'PRINCIPLES_BASE_SHA is not this CLI’s to document');
});
