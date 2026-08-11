// PR opener. For a repo with changes: clone (shallow), create a dated sync branch,
// apply the canon, commit, push, and open a PR against the repo's default branch.
// Never pushes to the default branch; skips repos with no changes.
//
// `syncRepo` is the generic engine; member sync and the profile mirror both use it.

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readLock, writeLock, mergeNewerBaseEntries, LOCK_FILENAME } from './lock.mjs';
import { apply, formatBehind } from './copier.mjs';
import { cloneShallow, prepareSyncBranch, commitAll, push, createPr, findOpenPr, findOtherOpenSyncPrs, readFileAtRemoteBranch, CO_AUTHOR } from './git.mjs';
import { log } from './log.mjs';
import { assertMemberFacts } from './member-facts.mjs';
import { observeCallerPermissions } from './caller-permissions.mjs';


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
 *
 * A same-day branch is reused only while an open PR owns it. Commits a reviewer pushed to that
 * active branch are preserved, and their edits to synced files are evaluated as ordinary drift.
 * A retained branch from a merged or closed PR is bypassed with a clean `-rerun-N` branch from the
 * current default. The engine never force-pushes either path.
 *
 * @returns {{ status: 'unchanged'|'pr', prUrl?: string, branch?: string, reused?: boolean, report }}
 */
export function syncRepo({ repo, writes, token, date, force, forcePaths, backbone, title, intro, inspectCheckout }) {
  const tmp = mkdtempSync(join(tmpdir(), 'studio-sync-'));
  try {
    const defaultBranch = cloneShallow(repo, token, tmp);
    const inspection = inspectCheckout?.(tmp);
    const datedBranch = branchName(date);
    const existing = findOpenPr(repo, datedBranch, token, tmp);
    const base = prepareSyncBranch(tmp, existing?.branch ?? datedBranch, {
      reuse: Boolean(existing),
      defaultBranch,
    });
    const branch = base.branch;
    if (base.reused) {
      log.info(`${repo}: reusing existing remote branch ${branch} (fast-forward, no force-push).`);
      if (base.foreignStatus === 'unavailable') {
        // Not cosmetic: an empty list here would otherwise read as "no reviewer work on this
        // branch", on the one path that exists to preserve reviewer work.
        log.warn(
          `${repo}: could not determine whether ${branch} carries commits the engine did not ` +
            'author — treat it as if it might, and inspect before merging.',
        );
      } else if (base.foreign.length) {
        log.warn(
          `${repo}: ${base.foreign.length} commit(s) on ${branch} were not authored by the sync ` +
            'engine and are preserved:',
        );
        for (const line of base.foreign) log.warn(`    ${line}`);
      }
    }

    const lock = readLock(tmp, backbone);
    const { report, lock: newLock, touchedKeys } = apply(tmp, writes, lock, { force, forcePaths, write: true });
    if (!report.changed) return { status: 'unchanged', report, inspection };

    refreshLockAgainstDefault(tmp, defaultBranch, newLock, touchedKeys, repo, backbone);

    if (!commitAll(tmp, commitMessage(date))) return { status: 'unchanged', report, inspection };

    push(tmp, branch);

    // Only meaningful once this run has actually produced a wave to sit beside an older one.
    const waveLookup = findOtherOpenSyncPrs(repo, branch, token);
    const otherWaves = waveLookup.waves;
    if (waveLookup.status === 'unavailable') {
      log.warn(
        `${repo}: could not check for older open sync waves — this is not a report that none exist.`,
      );
    }
    for (const wave of otherWaves) {
      const kind = wave.authored.length
        ? `mixed — ${wave.authored.length} of ${wave.total} commit(s) not authored by the engine`
        : 'pure canon';
      log.warn(`${repo}: an older sync wave is still open: ${wave.url} (${wave.branch}, ${kind}).`);
      for (const headline of wave.authored) log.warn(`    ${headline}`);
    }

    if (existing) {
      // Reuse fast-forwards an open PR and never rewrites its body, so a wave that opened after
      // that body was written cannot appear in it. This log line is the only place the pairing is
      // reported on the reuse path.
      if (otherWaves.length) {
        log.warn(`${repo}: ${existing.url} was updated in place; its body does not carry the above.`);
      }
      return { status: 'pr', prUrl: existing.url, branch, reused: true, report, inspection, waveLookup };
    }

    const bodyFile = join(tmp, '.studio-sync-pr-body.md');
    writeFileSync(bodyFile, buildPrBody(report, { date, intro, waveLookup }), 'utf8');
    const prUrl = createPr(
      repo,
      { base: defaultBranch, head: branch, title: title ?? commitTitle(date), bodyFile },
      token,
    );
    return { status: 'pr', prUrl, branch, report, inspection, waveLookup };
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

/**
 * Fold back lock entries the member's default branch gained while this run was in flight.
 *
 * `apply` planned against a clone taken at run start. If another run merged since, this run's lock
 * describes a state older than the member already has, and committing it wholesale reverts entries
 * this run never touched (#418). Re-reading the default branch here — after all planning, before
 * the commit — is the narrowest point where the newer state is knowable and still actionable.
 *
 * Reported, never silent. A restored entry means two runs overlapped, which is the condition worth
 * knowing about even on the runs where it costs nothing.
 */
export function refreshLockAgainstDefault(dest, defaultBranch, lock, touchedKeys, repo, backbone, read = readFileAtRemoteBranch) {
  const head = read(dest, defaultBranch, LOCK_FILENAME);
  if (head.status === 'unavailable') {
    // Not cosmetic, and deliberately not fatal. Proceeding is exactly the behaviour that shipped
    // before this check existed, so a failed lookup is never worse than not looking — but silence
    // here would claim the lock was reconciled when nothing was compared.
    log.warn(
      `${repo}: could not re-read ${defaultBranch}'s lockfile before committing — entries this run ` +
        'did not touch were not checked against it, and an overlapping run may be reverted.',
    );
    return;
  }
  if (head.content === null) return;

  let baseEntries;
  try {
    baseEntries = JSON.parse(head.content)?.entries ?? {};
  } catch {
    log.warn(`${repo}: ${defaultBranch}'s lockfile is not valid JSON — skipping the overlap check.`);
    return;
  }

  const { entries, restored } = mergeNewerBaseEntries(lock.entries, baseEntries, touchedKeys);
  if (!restored.length) return;

  writeLock(dest, { ...lock, backbone, entries });
  log.warn(
    `${repo}: ${restored.length} lock entr(ies) were newer on ${defaultBranch} than in this run's ` +
      'snapshot and were kept — another sync run merged while this one was in flight:',
  );
  for (const item of restored) {
    log.warn(`    ${item.targetPath} (kept ${item.to}, this run had ${item.from ?? 'no entry'})`);
  }
}

export function syncMemberRepo(  { repo, member, writes, token, date, force, forcePaths, backbone },
  sync = syncRepo,
  observe = observeCallerPermissions,
) {
  return sync({
    repo,
    writes,
    token,
    date,
    force,
    forcePaths,
    backbone,
    inspectCheckout: (root) => {
      const facts = assertMemberFacts(root, member, backbone);
      facts.workflowObservations.callerPermissions = observe({
        root,
        repo,
        backbone,
        token,
        includePullRequests: true,
      });
      return facts;
    },
  });
}

/** Render a PR body summarizing added/updated assets and drift warnings. */
export function buildPrBody(report, { date, intro, waveLookup } = {}) {
  const lines = [];
  lines.push(`## Studio canon sync — ${date}`);
  lines.push('');
  lines.push(
    intro ??
      'Synced from [`jrmoulckers/.github`](https://github.com/jrmoulckers/.github) by the studio sync tool.',
  );

  // A run can be lockfile-only: adoption, a relocated base, or stale-entry pruning all leave
  // file contents untouched, so the only file in the diff is the lockfile. Say so before listing
  // the paths, or a reviewer reads "Baselined (68)" over a one-file diff and hunts for 67 more.
  const wroteFiles =
    report.added.length + report.updated.length + (report.forced?.length ?? 0) > 0;
  const lockOnly =
    (report.adopted?.length ?? 0) + (report.rekeyed?.length ?? 0) + (report.pruned?.length ?? 0);
  if (!wroteFiles && lockOnly) {
    lines.push('');
    lines.push(
      '**No file contents changed.** This run only updated `.studio-sync.lock.json` — the entire ' +
        'diff of this PR is that one file.',
    );
  }

  section(lines, `Added (${report.added.length})`, report.added);
  section(lines, `Updated (${report.updated.length})`, report.updated);
  if (report.forced?.length) section(lines, `Force-updated (${report.forced.length})`, report.forced);
  if (report.adopted?.length) {
    section(
      lines,
      `Baselined in lockfile (${report.adopted.length})`,
      report.adopted,
      'These files already existed and are byte-identical to canon. Nothing was written to them; ' +
        'they are now tracked in `.studio-sync.lock.json` so later canon changes reach them.',
    );
  }

  if (report.rekeyed?.length) {
    section(
      lines,
      `Relocated in lockfile (${report.rekeyed.length})`,
      report.rekeyed,
      'These files moved to a new target base. Their existing `.studio-sync.lock.json` entries ' +
        'were left behind at the old path, so the engine no longer recognized its own writes and ' +
        'would have reported each file as a local modification on every run. The entries now ' +
        'point at the current paths. No file contents were changed by this step.',
    );
  }
  if (report.pruned?.length) {
    section(
      lines,
      `Stale lockfile entries removed (${report.pruned.length})`,
      report.pruned,
      'These `.studio-sync.lock.json` entries referenced paths that no longer exist in this ' +
        'repository. Only the entries were removed — no files were deleted.',
    );
  }

  if (report.drift.length) {
    lines.push('');
    lines.push(`### ⚠️ Locally modified — not overwritten (${report.drift.length})`);
    lines.push('');
    lines.push(
      'These targets were changed in this repo since the last sync and were **left untouched**. ' +
        'To clear one, reconcile it by hand in this repo — edit it to match canon, or delete it ' +
        'and let the next sync add it.',
    );
    lines.push('');
    // `--force` is per *invocation*, not per file: one CLI flag is threaded into every member of
    // the run. `--members` narrows the run; it does not narrow the override. This note sits inside
    // one member's PR next to that member's drift list, so "re-run with --force" reads as scoped to
    // the paths directly below it. It is not. Naming the scale here is the only place it reaches
    // the person about to act on it — the flag's name already reads like the answer, and nobody
    // opens the design doc to check an answer they were just handed.
    lines.push(
      '> **`--force` is not a per-file fix.** It rewrites **every** drifted file in **every** ' +
        'member that run touches, discarding member-authored edits in repos whose PRs you may ' +
        'never open. `--members` scopes the run, not the override. The one exception is a target ' +
        'canon has never delivered: those are refused, and overwriting one requires naming its ' +
        'path in `--force-paths`, because its current bytes exist nowhere else. Use `--force` ' +
        'only against a state you have already checked across every member in the run.',
    );
    lines.push('');
    for (const item of report.drift) {
      if (!item.withheld) {
        lines.push(`- \`${item.targetPath}\``);
        continue;
      }
      const since = item.lastWrittenAt
        ? `last received canon ${item.lastWrittenAt}`
        : 'never received canon';
      lines.push(
        `- \`${item.targetPath}\` — ⚠️ **withholding an update** (${since}${formatBehind(item.revisionsBehind)})`,
      );
    }

    const withheld = report.drift.filter((item) => item.withheld);
    if (withheld.length) {
      lines.push('');
      lines.push(
        `**${withheld.length} of these ${report.drift.length} are not merely customised — they are ` +
          'behind.** Canon for those paths has changed since this repo last received it, so the ' +
          'refusal above is what is keeping them stale, and every further run widens the gap. The ' +
          'other entries differ from canon only by your own edits, with no pending update behind ' +
          'them; those are fine to leave indefinitely.',
      );
    }
  }

  if (report.outranked?.length) {
    lines.push('');
    lines.push('### ⚠️ The managed region is losing precedence to your own rules');
    lines.push('');
    lines.push(
      'In `.gitattributes` the **last** matching pattern wins, and canon\'s `*` matches every path. ' +
        'The managed region here sits *below* rules of yours, so canon silently overrides them. ' +
        'The engine did not put it there — it prepends — but it replaces an existing region in ' +
        'place and never relocates it, so **this does not fix itself**.',
    );
    lines.push('');
    for (const file of report.outranked) {
      lines.push(`\`${file.targetPath}\` — ${file.rules.length} rule(s) overridden:`);
      lines.push('');
      lines.push('| Your rule | Attribute lost |');
      lines.push('| --- | --- |');
      for (const rule of file.rules) {
        lines.push(`| \`${rule.line}\` | \`${rule.attributes.join('`, `')}\` |`);
      }
      lines.push('');
    }
    lines.push(
      'A `binary` rule losing `text` is the serious one: `binary` means *never inspect this file*, ' +
        'so overriding it hands an asset to git\'s content heuristic and to EOL conversion. ' +
        '**Move the region above these rules by hand before merging.** Verify with ' +
        '`git check-attr text -- <a matching file>`: it should not read `text: auto`. See ADR-0011.',
    );
  }

  if (report.abandoned?.length) {
    lines.push('');
    lines.push(`### 📌 Still present but no longer synced (${report.abandoned.length})`);
    lines.push('');
    lines.push(
      'The plan no longer targets these paths — usually because a kind was deselected or a ' +
        '`targetPath` moved. The engine does not prune, so the files were **not** deleted. ' +
        'Nothing here is broken by this PR.',
    );
    lines.push('');
    lines.push(
      'What matters is that they are now **frozen**: no future sync will update them, so they keep ' +
        'whatever the last run that did target them wrote — including defects fixed upstream since. ' +
        'Where a lock entry was relocated to the new base, the file left behind is no longer ' +
        'recorded anywhere, which makes it easier to miss, not harder. Removing them is a separate, ' +
        'hash-verified cleanup; see "Deselection cleanup is manual and hash-verified" in ' +
        '`sync/README.md`.',
    );
    lines.push('');
    for (const item of report.abandoned) {
      lines.push(
        `- \`${item.targetPath}\`${item.tracked ? '' : ' — no lock entry; verify against history before deleting'}`,
      );
    }
  }

  // Silence in a PR body reads as "checked, nothing found" — so a lookup that failed has to say so
  // here, not only in a run log the reviewer will never see.
  if (waveLookup?.status === 'unavailable') {
    lines.push('');
    lines.push('### ⚠️ Could not check for an older open sync wave');
    lines.push('');
    lines.push(
      'The lookup for other open `studio-sync/*` PRs failed, so **this PR carries no claim either ' +
        'way**. Absence of a warning below is not evidence that none exists. If this repo does have ' +
        'an older wave open, merge order decides whether canon moves forward or backward — check ' +
        'by hand with `gh pr list --state open` before merging.',
    );
  }

  const otherWaves = waveLookup?.waves ?? [];
  if (otherWaves.length) {
    lines.push('');
    lines.push(`### ⚠️ An older sync wave is still open (${otherWaves.length})`);
    lines.push('');
    lines.push(
      'This repo has an open sync PR from an earlier wave. **Merge order now decides whether canon ' +
        'moves forward or backward.** Landing this PR first is right, but the older branch still ' +
        'carries a generated commit describing canon as it stood days ago; rebasing it onto the new ' +
        'default replays those files over these. Where the two waves touched the same paths that ' +
        'conflicts loudly, which is the good case — where they did not, it applies clean and green ' +
        'and silently rolls canon back on whatever the older wave happened to cover.',
    );
    lines.push('');
    for (const wave of otherWaves) {
      const label = wave.authored.length
        ? `**mixed** — ${wave.authored.length} of ${wave.total} commit(s) not authored by the engine`
        : `**pure canon** — all ${wave.total} commit(s) authored by the engine`;
      lines.push(`- ${wave.url} (\`${wave.branch}\`) — ${label}`);
      for (const headline of wave.authored) lines.push(`  - \`${headline}\``);
    }
    lines.push('');
    // The engine reports the discriminator and stops. Which branch to reduce, and to what, depends
    // on what this wave already covers — a judgement the run cannot make and should not pre-empt.
    lines.push(
      '**Mixed or pure is the fact that selects what to do, which is why it is the one thing ' +
        'reported here.** A *pure* older branch can simply be closed: the next run re-emits every ' +
        'file it held, at no cost. A *mixed* one must not be rebased and merged — reduce it to its ' +
        'member-authored commits, which are the only irreplaceable part, by cherry-picking them onto ' +
        'the default branch after this PR lands and dropping the stale sync commit entirely.',
    );
    lines.push('');
    lines.push(
      '> Decide the reduction **before** merging, not as a pre-merge check. What the older branch ' +
        'should be reduced *to* depends on what this wave already covers, so a check run at merge ' +
        'time can only confirm a decision already made. See "A stale sync commit merged after a ' +
        'newer one reverts canon" in `docs/sync.md`.',
    );
  }

  lines.push('');
  lines.push('---');
  lines.push(
    '<sub>Native assets are not copied: community-health files are inherited from the backbone ' +
      '`.github` repo, and reusable workflows are called via ' +
      '`uses: jrmoulckers/.github/.github/workflows/*@<reviewed-commit-sha>`. Vendored `@jrm/tokens` files under ' +
      '`vendor/@jrm/tokens/` are generated in `jrmoulckers/studio` and carried here by the sync ' +
      'engine — do not hand-edit them.</sub>',
  );
  lines.push('');
  return lines.join('\n');
}

function section(lines, heading, items, note) {
  if (!items.length) return;
  lines.push('');
  lines.push(`### ${heading}`);
  lines.push('');
  if (note) {
    lines.push(note);
    lines.push('');
  }
  for (const item of items) lines.push(`- \`${item.targetPath}\``);
}
