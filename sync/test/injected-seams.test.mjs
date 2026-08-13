// A function passed as an injected default is called under the *parameter's* name, so the function's
// own name never appears at the call site. Grepping for `name(` therefore reports it as uncalled
// (#924). Two of the four seams below return zero call sites that way and run on every sync; a third
// returns exactly one — a complete, plausible answer naming the wrong caller, which is the reading
// that invites changing member behaviour while testing only the profile path.
//
// Nothing can make a name grep follow a binding. What was missing is an inventory, so this pins one:
// a new seam has to be declared here rather than discovered by someone auditing reachability.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const LIB = join(REPO_ROOT, 'sync', 'lib');

/** Every function-valued default parameter in shipped engine code, as `file:param=function`. */
function injectedSeams() {
  const declared = new Set();
  const files = readdirSync(LIB).filter((name) => name.endsWith('.mjs'));

  for (const name of files) {
    const text = readFileSync(join(LIB, name), 'utf8');
    for (const match of text.matchAll(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/g)) {
      declared.add(match[1]);
    }
  }

  const seams = [];
  for (const name of files) {
    const text = readFileSync(join(LIB, name), 'utf8');
    for (const fn of text.matchAll(/function\s+\w+\s*\(([^)]*)\)/g)) {
      for (const param of fn[1].split(',')) {
        const bound = param.match(/(\w+)\s*=\s*([A-Za-z_]\w*)\s*$/);
        if (bound && declared.has(bound[2])) seams.push(`${name}:${bound[1]}=${bound[2]}`);
      }
    }
  }
  return seams.sort();
}

const EXPECTED_SEAMS = [
  'pr.mjs:observe=observeCallerPermissions',
  'pr.mjs:read=readFileAtRemoteBranch',
  'pr.mjs:sync=syncRepo',
  'runner.mjs:syncOne=syncMemberRepo',
];

test('the injected seam inventory matches shipped code', () => {
  const found = injectedSeams();

  // Non-vacuity: an empty sweep would satisfy a subset check and would also satisfy deepEqual
  // against an empty expectation, so assert the parser found something before comparing.
  assert.ok(found.length > 0, 'precondition: the parser found function-valued default parameters');

  assert.deepEqual(
    found,
    EXPECTED_SEAMS,
    'a function passed as a default parameter is invisible to a grep for its own name; ' +
      'declare it here so reachability can be established by reading rather than searching',
  );
});

test('each seam names a function a grep for its call would miss', () => {
  // The premise of the inventory: these really are unfindable by name. If a seam ever gains a
  // direct call site, this fails and the entry can be retired rather than kept out of habit.
  const shipped = readdirSync(LIB)
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => [name, readFileSync(join(LIB, name), 'utf8')]);

  const invisible = [];
  for (const seam of EXPECTED_SEAMS) {
    const fn = seam.split('=')[1];
    let calls = 0;
    for (const [, text] of shipped) {
      for (const line of text.split('\n')) {
        if (new RegExp(`\\b${fn}\\s*\\(`).test(line) && !new RegExp(`function\\s+${fn}\\b`).test(line)) {
          calls += 1;
        }
      }
    }
    if (calls === 0) invisible.push(fn);
  }

  assert.ok(
    invisible.length > 0,
    'precondition: at least one seam is genuinely unfindable, or this inventory has no purpose',
  );
});
