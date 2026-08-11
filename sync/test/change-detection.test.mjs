// Behaviour of the change-detection classifier, executed rather than pattern-matched.
//
// The logic lives in a heredoc inside `reusable-change-detection.yml`, so a workflow that is
// never run on this repo has no other way to be tested. This extracts the script, runs it with
// a real two-commit git repository, and asserts on the outputs it writes.
//
// The case that motivated it: a member deleted 13 files under a vendored tree and every build
// job was SKIPPED, because those paths matched no declared path group. That deletion happened
// to be safe, but nothing in the run said so — the outputs a caller gates on cannot distinguish
// "no group matched" from "your groups are fine and nothing relevant changed". Both present as
// an absent group.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const WORKFLOW = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  '.github',
  'workflows',
  'reusable-change-detection.yml',
);

/** Pull the heredoc body out of the workflow so the real shipped script is what runs. */
function extractScript() {
  const text = readFileSync(WORKFLOW, 'utf8');
  const start = text.indexOf("node <<'NODE'");
  assert.notEqual(start, -1, 'the detect step must invoke node with a NODE heredoc');
  const body = text.slice(text.indexOf('\n', start) + 1);
  const end = body.indexOf('\n          NODE');
  assert.notEqual(end, -1, 'the NODE heredoc must be terminated');
  // Strip the 10-space YAML block indent the heredoc carries.
  return body
    .slice(0, end)
    .split('\n')
    .map((line) => (line.startsWith('          ') ? line.slice(10) : line))
    .join('\n');
}

const git = (args, cwd) =>
  execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();

function withRepo(fn) {
  const root = mkdtempSync(join(tmpdir(), 'chg-'));
  try {
    return fn(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/**
 * Seed a repo with `before` files, commit, apply `after` (null value = delete), commit again,
 * then run the extracted classifier over the two commits with the given groups.
 */
function classify({ before, after, groups }) {
  return withRepo((root) => {
    const repo = join(root, 'repo');
    mkdirSync(repo, { recursive: true });
    git(['init', '-q', '-b', 'main'], repo);
    const write = (rel, content) => {
      const abs = join(repo, ...rel.split('/'));
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, content, 'utf8');
    };
    for (const [rel, content] of Object.entries(before)) write(rel, content);
    git(['add', '-A'], repo);
    git(['-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '-qm', 'base'], repo);
    const baseSha = git(['rev-parse', 'HEAD'], repo);

    for (const [rel, content] of Object.entries(after)) {
      if (content === null) rmSync(join(repo, ...rel.split('/')), { force: true });
      else write(rel, content);
    }
    git(['add', '-A'], repo);
    git(['-c', 'user.email=t@e', '-c', 'user.name=t', 'commit', '-qm', 'change'], repo);
    const headSha = git(['rev-parse', 'HEAD'], repo);

    const scriptPath = join(root, 'detect.cjs');
    writeFileSync(scriptPath, extractScript(), 'utf8');
    const outPath = join(root, 'out.txt');
    const sumPath = join(root, 'summary.md');
    writeFileSync(outPath, '', 'utf8');
    writeFileSync(sumPath, '', 'utf8');

    const run = spawnSync(process.execPath, [scriptPath], {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        BASE_SHA: baseSha,
        HEAD_SHA: headSha,
        PATH_GROUPS_JSON: JSON.stringify(groups),
        GITHUB_OUTPUT: outPath,
        GITHUB_STEP_SUMMARY: sumPath,
      },
    });
    assert.equal(run.status, 0, `detect script failed:\n${run.stderr}`);

    const outputs = {};
    for (const line of readFileSync(outPath, 'utf8').split('\n')) {
      const eq = line.indexOf('=');
      if (eq > 0) outputs[line.slice(0, eq)] = line.slice(eq + 1);
    }
    return { outputs, summary: readFileSync(sumPath, 'utf8'), stdout: run.stdout };
  });
}

test('a deletion outside every path group is reported rather than silently dropped', () => {
  // finance's shape: source lives under apps/web/src, the deleted files under a vendored tree
  // that no group claims.
  const { outputs, summary, stdout } = classify({
    before: {
      'apps/web/src/main.ts': 'x\n',
      'vendor/@jrm/tokens/js/index.js': 'a\n',
      'vendor/@jrm/tokens/tailwind/default.cjs': 'b\n',
    },
    after: {
      'vendor/@jrm/tokens/js/index.js': null,
      'vendor/@jrm/tokens/tailwind/default.cjs': null,
    },
    groups: { web: ['apps/web/src'] },
  });

  // The pre-existing behaviour, unchanged: no group matched, so a caller gating a build on
  // `changed-groups-json` still skips. That is the caller's contract and is not this fix's to
  // alter — what changes is that the omission is now visible.
  assert.equal(outputs['changed-groups-json'], '[]');
  assert.equal(outputs['any-changed'], 'true');

  assert.deepEqual(JSON.parse(outputs['unclassified-files-json']), [
    'vendor/@jrm/tokens/js/index.js',
    'vendor/@jrm/tokens/tailwind/default.cjs',
  ]);
  assert.match(summary, /matched no path group/);
  assert.match(summary, /vendor\/@jrm\/tokens\/js\/index\.js/);
  assert.match(stdout, /^::warning::2 changed file\(s\) matched no path group/m);
});

test('a fully classified change set reports no residue and emits no warning', () => {
  // Non-vacuity in the direction that matters: a reporter that always fired would make the
  // warning meaningless within a week, which is the failure mode of every gate that cries wolf.
  const { outputs, summary, stdout } = classify({
    before: { 'apps/web/src/main.ts': 'x\n' },
    after: { 'apps/web/src/main.ts': 'y\n' },
    groups: { web: ['apps/web/src'] },
  });

  assert.deepEqual(JSON.parse(outputs['changed-groups-json']), ['web']);
  assert.deepEqual(JSON.parse(outputs['unclassified-files-json']), []);
  assert.doesNotMatch(summary, /matched no path group/);
  assert.doesNotMatch(stdout, /::warning::/);
});

test('the default catch-all group leaves nothing unclassified', () => {
  // `{"all":["."]}` is the documented default, and `.` matches everything. A caller who has not
  // narrowed anything must never see the warning, or the signal is noise from the first run.
  const { outputs } = classify({
    before: { 'vendor/@jrm/tokens/js/index.js': 'a\n' },
    after: { 'vendor/@jrm/tokens/js/index.js': null },
    groups: { all: ['.'] },
  });
  assert.deepEqual(JSON.parse(outputs['changed-groups-json']), ['all']);
  assert.deepEqual(JSON.parse(outputs['unclassified-files-json']), []);
});

test('deletions reach the classifier at all', () => {
  // Guards the diff filter. If `D` were dropped from --diff-filter, every assertion above would
  // still pass by reporting an empty change set, and the workflow would be blind to deletions —
  // the exact class of change that motivated this test file.
  const { outputs } = classify({
    before: { 'docs/a.md': 'a\n', 'apps/web/src/main.ts': 'x\n' },
    after: { 'docs/a.md': null },
    groups: { web: ['apps/web/src'] },
  });
  assert.deepEqual(JSON.parse(outputs['changed-files-json']), ['docs/a.md']);
  assert.deepEqual(JSON.parse(outputs['unclassified-files-json']), ['docs/a.md']);
});
