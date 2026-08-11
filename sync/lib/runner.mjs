// Per-member sync loop.
//
// Extracted from the CLI so failure isolation is testable: a member whose push or PR call
// fails must not take down the members after it, nor the profile mirror. The engine talks to
// every member in studio.config.json plus the profile destination — treating the first git error
// as fatal to the whole run makes a transient failure look like a total outage and silently skips
// work that would have succeeded.

import { log } from './log.mjs';
import { syncMemberRepo } from './pr.mjs';
import { formatBehind } from './copier.mjs';

/**
 * @param {Array<{resolved, targets}>} plans
 * @param {{ token: string, date: string, force?: boolean, backbone: string }} ctx
 * @param {Function} [syncOne] injection seam for tests
 * @returns {{ outcomes: Array<{repo: string, status: string, detail?: string}>,
 *             failures: Array<{repo: string, message: string}> }}
 *   Outcomes for every member in encounter order, and the failing subset. Successes are
 *   returned rather than discarded: isolation keeps the run going, but only a record of what
 *   survived can tell a partial failure from a total one after the fact.
 */
export function syncMembers(plans, ctx, syncOne = syncMemberRepo) {
  const outcomes = [];
  const failures = [];

  for (const { resolved, targets } of plans) {
    log.step(`Syncing ${resolved.repo}`);
    try {
      const result = syncOne({
        repo: resolved.repo,
        member: resolved,
        writes: targets.writes,
        token: ctx.token,
        date: ctx.date,
        force: ctx.force,
        backbone: ctx.backbone,
      });
      if (result.status === 'pr') {
        log.ok(`${resolved.repo}: ${result.reused ? 'updated' : 'opened'} ${result.prUrl}`);
        outcomes.push({
          repo: resolved.repo,
          status: result.reused ? 'updated' : 'opened',
          detail: result.prUrl,
        });
      } else {
        log.info(`${resolved.repo}: no changes`);
        outcomes.push({ repo: resolved.repo, status: 'no changes' });
      }
      if (result.report?.hasDrift) {
        log.warn(formatDriftWarning(resolved.repo, result.report.drift));
      }
      const unused = result.inspection?.workflowObservations?.unusedDeclarations ?? [];
      if (unused.length) {
        log.info(
          `${resolved.repo}: reusable workflow availability not currently called: ${unused.join(', ')}`,
        );
      }
    } catch (err) {
      failures.push({ repo: resolved.repo, message: err.message });
      outcomes.push({ repo: resolved.repo, status: 'failed', detail: err.message });
      log.error(`${resolved.repo}: sync failed — ${err.message}`);
      log.warn(`${resolved.repo}: skipped; continuing with the remaining member(s).`);
    }
  }

  return { outcomes, failures };
}

/**
 * The run summary written to GITHUB_STEP_SUMMARY.
 *
 * A run's published result is one bit wide, and a red bit says only "something went wrong" —
 * so a single member's expired token reads exactly like a fleet-wide outage. That ambiguity is
 * what let five consecutive weeks of red pass for a dead transport while per-member syncs were
 * in fact landing normally. Naming what succeeded costs nothing and makes the red legible.
 *
 * Failures lead, because a summary is read top-down and the failing rows are the actionable ones.
 */
export function renderRunSummary(outcomes, { dryRun = false } = {}) {
  const failed = outcomes.filter((o) => o.status === 'failed');
  const succeeded = outcomes.filter((o) => o.status !== 'failed');
  const lines = [
    `### Studio sync${dryRun ? ' (dry run)' : ''}`,
    '',
    `${succeeded.length} of ${outcomes.length} target(s) succeeded.`,
  ];
  if (failed.length) {
    lines.push(
      '',
      `#### Failed (${failed.length})`,
      '',
      ...failed.map((o) => `- \`${o.repo}\` — ${o.detail ?? 'unknown error'}`),
      '',
      'The targets below were unaffected by these failures — each member syncs independently.',
    );
  }
  lines.push('', '#### Targets', '', '| Target | Outcome |', '| --- | --- |');
  for (const o of outcomes) {
    const detail = o.status === 'failed' ? ` — ${o.detail ?? 'unknown error'}` : '';
    lines.push(`| \`${o.repo}\` | ${o.status}${detail} |`);
  }
  return `${lines.join('\n')}\n`;
}

/**
 * The warning line that goes to the run log.
 *
 * This is the surface that failed in practice: a correct refusal, repeated every run, reading
 * identically whether the member customised the file or was frozen out of canon. So the line now
 * leads with the consequence rather than the count — a withheld path is one where canon has moved
 * since the member's baseline, so the refusal is actively costing them an update.
 *
 * Each withheld path carries how far behind it is, because a permanently red gate carries no
 * information: a reader needs to tell a file that went stale this week from one that has been
 * stale for five releases, and only a number that grows does that.
 */
export function formatDriftWarning(repo, drift) {
  const withheld = drift.filter((item) => item.withheld);
  const paths = drift.map((item) => item.targetPath).join(', ');
  if (!withheld.length) {
    return `${repo}: locally-modified file(s) left untouched: ${paths}`;
  }
  return (
    `${repo}: locally-modified file(s) left untouched: ${paths}` +
    ` — ${withheld.length} of ${drift.length} withholding a canon update` +
    ` (${withheld.map(formatWithheld).join('; ')})`
  );
}

function formatWithheld(item) {
  return `${item.targetPath} last synced ${item.lastWrittenAt ?? 'never'}${formatBehind(item.revisionsBehind)}`;
}
