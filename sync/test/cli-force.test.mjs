// `--force` must name its members, asserted at the CLI and in the workflow that dispatches it.
//
// Forcing is the deliberate override of drift classification, and drift classification is the
// only thing that keeps the engine from overwriting member-authored content. An unscoped
// `--force` therefore means "override that protection across the entire fleet" — and it is
// reached by *omitting* a flag, which is the cheapest possible mistake.
//
// The safety of any particular forced run is a fact about member state at that moment, not a
// property of the command: when this guard was written, finance had exactly one drifting file
// out of 81 lock entries, so a forced run would have been harmless. That measurement expires
// the moment a member edits anything. A guard that has to be re-derived per invocation is not
// a guard, which is why this one is structural.
//
// Two surfaces are asserted because either alone can be true while the operation stays broken:
// the engine can enforce a rule the workflow gives no way to trigger (which is how `--force`
// shipped undispatchable), and the workflow can offer an input the engine ignores. The pairing
// is the thing under test.
//
// Offline: the guard is in argument parsing, so it fires before any clone, token, or network.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = join(HERE, '..', 'index.mjs');
const WORKFLOW = join(HERE, '..', '..', '.github', 'workflows', 'studio-sync.yml');

/** Run the CLI with the token deliberately absent, so nothing can reach the network. */
function run(args) {
  const env = { ...process.env };
  delete env.STUDIO_SYNC_TOKEN;
  const r = spawnSync(process.execPath, [CLI, ...args], { encoding: 'utf8', env });
  return { code: r.status, out: `${r.stdout}${r.stderr}` };
}

test('--force without --members is refused', () => {
  const { code, out } = run(['--force', '--dry-run']);
  assert.notEqual(code, 0, '--force with no member filter must exit non-zero');
  assert.match(out, /--force requires --members/);
});

test('--force is refused even when it would only plan', () => {
  // `--dry-run` writes nothing, so this case is harmless in itself. It is refused anyway: a
  // dry run is how an operator confirms the invocation they are about to repeat for real, and
  // one that accepts an unscoped `--force` teaches that the unscoped form is valid.
  const { code } = run(['--dry-run', '--force']);
  assert.notEqual(code, 0, 'a planning-only forced run must not model an accepted invocation');
});

test('--force with --members is accepted by argument parsing', () => {
  // Non-vacuity: proves the rejections above come from the missing filter and not from
  // `--force` being unparseable or rejected outright. Without this, deleting the flag
  // entirely would pass both tests above.
  const { code, out } = run(['--force', '--members', 'finance', '--dry-run']);
  assert.doesNotMatch(out, /--force requires --members/);
  assert.equal(code, 0, `a scoped forced dry run should plan cleanly, got:\n${out}`);
});

test('the sync workflow can dispatch a forced run, and refuses an unscoped one', () => {
  const yml = readFileSync(WORKFLOW, 'utf8');

  // The input must exist, or the engine's capability is unreachable from the only mechanism
  // we have for running it — the state this guard was written in response to.
  assert.match(yml, /^\s{6}force:$/m, 'workflow_dispatch must expose a `force` input');

  // ...and be forwarded. An input that is declared but never appended to `args` is worse than
  // no input: the dispatch reports success having done an ordinary, unforced run.
  assert.match(yml, /FORCE:\s*\$\{\{\s*inputs\.force\s*\}\}/, '`force` must reach the run step env');
  assert.match(
    yml,
    /if\s+\[\s+"\$FORCE"\s+=\s+"true"\s+\];\s+then\s+args\+=\("--force"\)/,
    '`force` must be appended to the CLI arguments',
  );

  // The workflow-side refusal is redundant with the engine's by design — it fails in the UI
  // before a runner starts. Asserted so the two surfaces cannot drift apart silently.
  assert.match(
    yml,
    /inputs\.force\s*==\s*true\s*&&\s*inputs\.members\s*==\s*''/,
    'workflow must refuse force with a blank members filter',
  );
});
