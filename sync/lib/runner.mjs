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
import { formatCallerPermissionWarnings } from './caller-permissions.mjs';

/**
 * @param {Array<{resolved, targets}>} plans
 * @param {{ token: string, date: string, force?: boolean, forcePaths?: string[], backbone: string }} ctx
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
        forcePaths: ctx.forcePaths,
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
      for (const warning of formatCallerPermissionWarnings(
        resolved.repo,
        result.inspection?.workflowObservations?.callerPermissions,
      )) {
        log.warn(warning);
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
 * Split a run's failures into the ones an owner has already accepted and the ones that are news.
 *
 * A monitor that is red every week detects nothing. `jrmoulckers/windows` has 403'd on clone since
 * 2026-07-13 because the sync token carries no write access to it; every scheduled run since has
 * exited 1 while every other member synced normally underneath. The run list cannot tell that state
 * from a fleet-wide outage, so the one alarm that fires without anyone opening a run has been
 * uninformative for a month. `renderRunSummary` below already made the red *legible* — but only
 * after a reader clicks into it, which is not where detection happens.
 *
 * The exemption is deliberately narrow in three ways, because a blanket downgrade of a failure
 * class is a worse defect than the noise it silences:
 *
 *   1. It is pinned to a **signature**, not to a repository. If windows starts failing for some
 *      other reason, that failure is unexpected and the run goes red — the accepted fault is one
 *      specific fault, not a standing amnesty for one member.
 *   2. It is **self-liquidating**. An entry whose repository was attempted and did *not* fail is
 *      itself a blocking finding: the access gap has closed and the record must be deleted. An
 *      exemption that outlives its defect is how the next real failure gets absorbed silently.
 *   3. It never suppresses reporting. Expected failures are still named, still counted as failures
 *      in the summary, and still carry the issue that closes them. Green here means "delivery is
 *      healthy apart from a fault the owner has already seen and recorded", not "all clear".
 *
 * Scoping matters for the staleness check: a member filter or a dry run that never attempted
 * windows says nothing about whether the gap is closed, so only attempted repositories can make an
 * entry stale. Concluding "fixed" from a repository nobody contacted is the same absent-versus-
 * unreadable confusion the engine refuses elsewhere.
 *
 * @param {Array<{repo: string, message: string}>} failures
 * @param {Array<{repo: string, signature: string, issue?: string, reason?: string}>} expectedFailures
 * @param {string[]} attempted repositories this run actually contacted
 * @returns {{expected: Array, unexpected: Array, stale: Array}}
 */
export function partitionFailures(failures, expectedFailures = [], attempted = []) {
  const expected = [];
  const unexpected = [];

  for (const failure of failures) {
    const match = expectedFailures.find(
      (entry) => entry.repo === failure.repo && String(failure.message).includes(entry.signature),
    );
    if (match) expected.push({ ...failure, issue: match.issue, reason: match.reason });
    else unexpected.push(failure);
  }

  const failed = new Set(failures.map((f) => f.repo));
  const contacted = new Set(attempted);
  const stale = expectedFailures.filter(
    (entry) => contacted.has(entry.repo) && !failed.has(entry.repo),
  );

  return { expected, unexpected, stale };
}

/**
 * Decide a `--check` run's verdict from per-member results.
 *
 * `--check` answers one question — "are the members up to date?" — and the answer is trusted
 * enough to gate CI. Before this it was computed from drift alone, and drift is only meaningful
 * relative to a population that was actually compared. A member whose vendored `@jrm/tokens`
 * targets were never enumerated has zero drift in them, which rendered as `up to date`, which
 * summed to `All members up to date.` That is the same shape as a caller-permission scan that read
 * no workflow file: **zero drifted is byte-identical to zero compared**, and the reassuring line
 * names the axis it did not measure.
 *
 * It is not hypothetical. Token targets live in an external repository, so `--work-dir` and
 * `--dry-run` runs cannot resolve them and drop the whole group. Every member declaring a `tokens`
 * block in `studio.config.json` is affected: an offline check compares the writes it enumerated and
 * silently omits the rest.
 *
 * So an unmeasured population is reported as **unresolved** rather than folded into either answer,
 * following `caller-permissions.mjs`: a check that could not look is not a check that found
 * nothing. `compared` is carried into the per-member line for the same reason — a count is the
 * only thing that distinguishes a real comparison from a vacuous one, and it costs one word.
 *
 * @param {Array<{repo: string, compared: number, stale?: boolean, failed?: boolean,
 *                unmeasured?: string[]}>} results
 * @returns {{ok: boolean, failed: number, outOfDate: number, unresolved: number, lines: string[]}}
 */
export function summarizeCheck(results) {
  const failed = results.filter((r) => r.failed);
  const outOfDate = results.filter((r) => !r.failed && r.stale);
  const unresolved = results.filter((r) => !r.failed && (r.unmeasured?.length ?? 0) > 0);
  const lines = [];

  if (failed.length) lines.push(`${failed.length} member(s) could not be verified.`);
  if (outOfDate.length) lines.push(`${outOfDate.length} member(s) out of date.`);
  for (const r of unresolved) {
    lines.push(
      `${r.repo}: ${r.unmeasured.join(', ')} was not compared, so "up to date" does not cover ` +
        'it. Pass --studio-dir <checkout> to include it.',
    );
  }

  // The clean line states its own scope. A verdict that cannot name what it covered is the defect
  // this function exists to remove, so it is never emitted alongside an unresolved population.
  if (!failed.length && !outOfDate.length && !unresolved.length) {
    const compared = results.reduce((sum, r) => sum + (r.compared ?? 0), 0);
    lines.push(
      `All ${results.length} member(s) up to date — ${compared} target(s) compared.`,
    );
  }

  return {
    ok: !failed.length && !outOfDate.length && !unresolved.length,
    failed: failed.length,
    outOfDate: outOfDate.length,
    unresolved: unresolved.length,
    lines,
  };
}

/**
 * The scope of a run, as one phrase.
 *
 * Shared by the step summary and the console tally so the two cannot drift: the console line is
 * the one a reader tails, and for a long time it stated a tally without the population it was
 * drawn from. See `renderRunSummary` for why a scoped tally is the only honest one.
 */
export function formatScope(members = [], fleetSize = null, fallbackSize = null) {
  return members.length
    ? `${members.length} of ${fleetSize ?? '?'} member(s): ${members.join(', ')}`
    : `all ${fleetSize ?? fallbackSize ?? '?'} member(s)`;
}

/**
 * The run summary written to GITHUB_STEP_SUMMARY.
 *
 * A run's published result is one bit wide, and a red bit says only "something went wrong" —
 * so a single member's expired token reads exactly like a fleet-wide outage. That ambiguity is
 * what let five consecutive weeks of red pass for a dead transport while per-member syncs were
 * in fact landing normally. Naming what succeeded costs nothing and makes the red legible.
 *
 * The green bit is worse, because it is trusted. A dry run scoped to one member writes nothing
 * and contacts no repository, yet renders in the run list as a green check on a workflow called
 * "Studio sync" — indistinguishable from a fleet run that wrote to eleven repos. A reader
 * concluded from exactly that entry that the transport was healthy. So the summary states mode
 * and scope first: an outcome tally means nothing without knowing what was attempted.
 *
 * This surface is not enough on its own. The same tally prints to stdout, which is what
 * `gh run view --log` shows, and a scope stated only here is absent from the surface people read
 * — a member-filtered run reads `1 of 1 target(s) succeeded` in the log and looks fleet-wide.
 *
 * Failures lead, because a summary is read top-down and the failing rows are the actionable ones.
 */
export function renderRunSummary(outcomes, { mode = 'sync', members = [], fleetSize = null } = {}) {
  const failed = outcomes.filter((o) => o.status === 'failed');
  const succeeded = outcomes.filter((o) => o.status !== 'failed');
  const scope = formatScope(members, fleetSize, outcomes.length);
  const lines = [
    `### Studio sync — ${MODE_LABELS[mode] ?? mode}`,
    '',
    `**Scope:** ${scope}`,
  ];
  if (mode !== 'sync') {
    lines.push('', `> ${MODE_CAVEATS[mode] ?? 'No member repository was modified.'}`);
  }
  lines.push('', `${succeeded.length} of ${outcomes.length} target(s) succeeded.`);
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

const MODE_LABELS = {
  sync: 'sync',
  'dry-run': 'DRY RUN',
  'work-dir': 'local checkout',
};

// A dry run's green check is the misleading artifact, so the summary has to contradict it in
// words. A run that wrote nothing must not be readable as a run that delivered.
const MODE_CAVEATS = {
  'dry-run': 'Nothing was written. No member repository was contacted and no pull request was opened.',
  'work-dir': 'Applied to a local checkout only. No member repository was contacted.',
};

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
