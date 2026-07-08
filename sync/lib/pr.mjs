// PR opener. For a repo with changes: clone (shallow), create a dated sync branch,
// apply the canon, commit, push, and open a PR against the repo's default branch.
// Never pushes to the default branch; skips repos with no changes.
//
// `syncRepo` is the generic engine; member sync and the profile mirror both use it.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLock } from './lock.mjs';
import { apply } from './copier.mjs';
import { cloneShallow, createBranch, commitAll, push, createPr, findOpenPr, CO_AUTHOR } from './git.mjs';

export function branchName(date) {
  return `studio-sync/${date}`;
}

export function commitTitle(date) {
  return `chore(sync): update studio canon (${date})`;
}

export function commitMessage(date) {
  return `${commitTitle(date)}\n\n${CO_AUTHOR}`;
}

/**
 * Clone a repo, apply `writes`, and open a PR if anything changed.
 * If an open PR already targets today's sync branch (e.g. a same-day re-run), its branch is
 * updated in place instead of opening a duplicate.
 * @returns {{ status: 'unchanged'|'pr', prUrl?: string, branch?: string, reused?: boolean, report }}
 */
export function syncRepo({ repo, writes, token, date, force, backbone, title, intro }) {
  const tmp = mkdtempSync(join(tmpdir(), 'studio-sync-'));
  try {
    const defaultBranch = cloneShallow(repo, token, tmp);
    const branch = branchName(date);
    createBranch(tmp, branch);

    const lock = readLock(tmp, backbone);
    const { report } = apply(tmp, writes, lock, { force, write: true });
    if (!report.changed) return { status: 'unchanged', report };

    if (!commitAll(tmp, commitMessage(date))) return { status: 'unchanged', report };

    const existing = findOpenPr(repo, branch, token);
    push(tmp, branch, { force: Boolean(existing) });
    if (existing) return { status: 'pr', prUrl: existing, branch, reused: true, report };

    const bodyFile = join(tmp, '.studio-sync-pr-body.md');
    writeFileSync(bodyFile, buildPrBody(report, { date, intro }), 'utf8');
    const prUrl = createPr(
      repo,
      { base: defaultBranch, head: branch, title: title ?? commitTitle(date), bodyFile },
      token,
    );
    return { status: 'pr', prUrl, branch, report };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

export function syncMemberRepo({ repo, writes, token, date, force, backbone }) {
  return syncRepo({ repo, writes, token, date, force, backbone });
}

/** Render a PR body summarizing added/updated assets and drift warnings. */
export function buildPrBody(report, { date, intro } = {}) {
  const lines = [];
  lines.push(`## Studio canon sync — ${date}`);
  lines.push('');
  lines.push(
    intro ??
      'Synced from [`jrmoulckers/.github`](https://github.com/jrmoulckers/.github) by the studio sync tool.',
  );

  section(lines, `Added (${report.added.length})`, report.added);
  section(lines, `Updated (${report.updated.length})`, report.updated);
  if (report.forced?.length) section(lines, `Force-updated (${report.forced.length})`, report.forced);
  if (report.adopted?.length) section(lines, `Baselined in lockfile (${report.adopted.length})`, report.adopted);

  if (report.drift.length) {
    lines.push('');
    lines.push(`### ⚠️ Locally modified — not overwritten (${report.drift.length})`);
    lines.push('');
    lines.push(
      'These targets were changed in this repo since the last sync and were **left untouched**. ' +
        'Reconcile them by hand, or re-run the sync with `--force` to overwrite with canon.',
    );
    lines.push('');
    for (const item of report.drift) lines.push(`- \`${item.targetPath}\``);
  }

  lines.push('');
  lines.push('---');
  lines.push(
    '<sub>Native assets are not copied: community-health files are inherited from the backbone ' +
      '`.github` repo, and reusable workflows are called via ' +
      '`uses: jrmoulckers/.github/.github/workflows/*@main`.</sub>',
  );
  lines.push('');
  return lines.join('\n');
}

function section(lines, heading, items) {
  if (!items.length) return;
  lines.push('');
  lines.push(`### ${heading}`);
  lines.push('');
  for (const item of items) lines.push(`- \`${item.targetPath}\``);
}
