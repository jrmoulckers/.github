import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest } from '../lib/manifest.mjs';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const prompt = (name) => readFileSync(join(REPO_ROOT, 'prompts', `${name}.prompt.md`), 'utf8');

test('branch-mutating prompts prove ownership before isolation or mutation', () => {
  for (const name of ['fix-ci', 'rebase-all']) {
    const text = prompt(name);
    const ownership = text.indexOf('Author name alone is not proof of branch ownership');
    const isolation = Math.min(
      ...['app-native isolated', 'git worktree add']
        .map((marker) => text.indexOf(marker))
        .filter((index) => index >= 0),
    );

    assert.ok(ownership >= 0, `${name} must reject author-name ownership inference`);
    assert.ok(ownership < isolation, `${name} must filter ownership before isolation`);
    assert.match(text, /Fork PRs and human\/shared branches are read-only\s+handoffs by default/);
    assert.match(text, /git branch --track <local-branch> origin\/<head-ref>/);
    assert.match(text, /Use `--force-with-lease` only .*current(?:-| )session/is);
    assert.doesNotMatch(text, /\.\.[/\\]wt-/);
    assert.doesNotMatch(text, /git add -A/);
    assert.doesNotMatch(text, /git commit --amend/);
  }

  assert.match(prompt('fix-ci'), /git status --porcelain/);
  assert.match(prompt('fix-ci'), /git add -- <repaired-paths>/);
});

test('cleanup audits before authority-gated targeted mutation', () => {
  const text = prompt('cleanup');
  const inventory = text.indexOf('git worktree prune --dry-run --verbose');
  const authority = text.indexOf('### 6. Authority Gate and Targeted Cleanup');
  const removal = text.indexOf('git worktree remove <approved-owned-worktree-path>');

  assert.ok(inventory >= 0 && inventory < authority && authority < removal);
  assert.match(text, /this session created and owns the worktree/);
  assert.match(text, /Never recursively\s+delete a path/);
  assert.doesNotMatch(text, /rm\s+-rf|Remove-Item\s+.*-Recurse/i);
});

test('fleet prompts enforce bounded applicable local routing', () => {
  for (const name of ['sprint', 'team']) {
    const text = prompt(name);
    assert.match(text, /scoped `AGENTS\.md`/);
    assert.match(text, /\.github\/instructions\//);
    assert.match(text, /handoff-only/);
    assert.match(text, /infrastructure.*infrastructure-safe override/is);
    assert.match(text, /(?:this|the) session owns the PR/);
    assert.match(text, /all required\s+checks are green/is);
    assert.match(text, /conflict-free/);
    assert.match(text, /reports it mergeable/);
    assert.doesNotMatch(text, /\.\.[/\\]wt-/);
  }

  assert.match(prompt('team'), /Presence in `.github\/agents\/` alone is not\s+sufficient/);
});

test('Homelab receives only its audited conservative prompt subset', () => {
  const manifest = loadManifest(REPO_ROOT);
  const homelab = manifest.members.find((member) => member.repo === 'jrmoulckers/homelab');

  assert.deepEqual(homelab.optIn.prompts, ['backlog', 'cleanup', 'review']);
  for (const unsafe of ['sprint', 'team', 'fix-ci', 'rebase-all', 'bug-bash']) {
    assert.ok(!homelab.optIn.prompts.includes(unsafe), `Homelab must exclude ${unsafe}`);
  }
});
