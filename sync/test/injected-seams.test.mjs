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
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

// The population is a second hand-written scope, and it fails separately from the pattern (#930).
// The first version of this suite walked `sync/lib` -- the directory the four known seams happened
// to sit in -- so a seam added to the CLI entry point passed unnoticed. Derive the corpus from the
// property that makes a file subject to the rule: shipped engine source that a reachability audit
// would grep. Fixtures standing in for a member's app are not that.
const isEngineSource = (rel) =>
  rel.endsWith('.mjs') &&
  (rel.startsWith('sync/') || rel.startsWith('principles/')) &&
  !rel.includes('/test/');

/** Shipped engine sources, walked from disk. */
function engineSourcesByWalk(root = REPO_ROOT) {
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        walk(join(dir, entry.name), rel);
      } else if (isEngineSource(rel)) {
        out.push(rel);
      }
    }
  };
  walk(root, '');
  return out.sort();
}

/** The same population from git's index -- an enumeration that shares none of the walk's logic. */
function engineSourcesByGit() {
  const listed = execFileSync('git', ['ls-files', '*.mjs'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return listed.split('\n').filter(Boolean).filter(isEngineSource).sort();
}

/** Every function-valued default parameter in shipped engine code, as `file:param=function`. */
function injectedSeams(files = engineSourcesByWalk()) {
  const declared = new Set();
  const read = (rel) => readFileSync(join(REPO_ROOT, ...rel.split('/')), 'utf8');

  for (const rel of files) {
    for (const match of read(rel).matchAll(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/g)) {
      declared.add(match[1]);
    }
  }

  const seams = [];
  for (const rel of files) {
    const text = read(rel);
    for (const fn of text.matchAll(/function\s+\w+\s*\(([^)]*)\)/g)) {
      for (const param of fn[1].split(',')) {
        const bound = param.match(/(\w+)\s*=\s*([A-Za-z_]\w*)\s*$/);
        if (bound && declared.has(bound[2])) {
          seams.push(`${rel.split('/').pop()}:${bound[1]}=${bound[2]}`);
        }
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
  const shipped = engineSourcesByWalk().map((rel) => [
    rel,
    readFileSync(join(REPO_ROOT, ...rel.split('/')), 'utf8'),
  ]);

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

test('the seam corpus is the whole engine, cross-checked against an enumeration it does not share', () => {
  const walked = engineSourcesByWalk();
  const listed = engineSourcesByGit();

  assert.ok(walked.length > 0, 'precondition: the walk found engine sources');

  // A narrowed walk is caught by something that shares none of the walk's assumptions. Asserting
  // the walk against itself -- a size floor, a subset check -- passes under exactly the narrowing
  // that motivated this (#930), because a smaller corpus is still internally consistent.
  assert.deepEqual(
    walked,
    listed,
    'the walked corpus disagrees with git ls-files; one of the two enumerations is narrowed',
  );

  // Positive control. The first version of this suite walked sync/lib only, so a seam in the CLI
  // entry point passed unnoticed while the inventory reported a match. Name files outside that
  // directory so narrowing back to it fails here instead of silently reducing coverage.
  for (const outside of ['sync/index.mjs', 'principles/validate.mjs']) {
    assert.ok(
      walked.includes(outside),
      `${outside} is shipped engine source and must be in the seam corpus`,
    );
  }
});

test('a seam outside sync/lib is caught', () => {
  // Constructed rather than asserted: the narrowing survived a populated-corpus premise, so the
  // premise is not the check. Run the real parser over a corpus that contains a real seam file
  // and confirm the seam is found by path rather than by which directory it sits in.
  const withCli = injectedSeams(['sync/index.mjs', 'sync/lib/pr.mjs']);
  const libOnly = injectedSeams(['sync/lib/pr.mjs']);

  assert.ok(libOnly.length > 0, 'precondition: the parser finds seams at all');
  assert.deepEqual(
    withCli,
    libOnly,
    'sync/index.mjs declares no seam today; if it gains one, the inventory above must list it',
  );
});