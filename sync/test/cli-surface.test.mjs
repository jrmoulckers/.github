import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
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
