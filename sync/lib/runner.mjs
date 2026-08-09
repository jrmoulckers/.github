// Per-member sync loop.
//
// Extracted from the CLI so failure isolation is testable: a member whose push or PR call
// fails must not take down the members after it, nor the profile mirror. The engine talks to
// nine member repos plus the profile destination — treating the first git error as fatal to the whole
// run makes a transient failure look like a total outage and silently skips work that would
// have succeeded.

import { log } from './log.mjs';
import { syncMemberRepo } from './pr.mjs';

/**
 * @param {Array<{resolved, targets}>} plans
 * @param {{ token: string, date: string, force?: boolean, backbone: string }} ctx
 * @param {Function} [syncOne] injection seam for tests
 * @returns {Array<{repo: string, message: string}>} failures, in encounter order
 */
export function syncMembers(plans, ctx, syncOne = syncMemberRepo) {
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
      } else {
        log.info(`${resolved.repo}: no changes`);
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
      log.error(`${resolved.repo}: sync failed — ${err.message}`);
      log.warn(`${resolved.repo}: skipped; continuing with the remaining member(s).`);
    }
  }

  return failures;
}

export function formatDriftWarning(repo, drift) {
  return `${repo}: locally-modified file(s) left untouched: ${drift
    .map((item) => item.targetPath)
    .join(', ')}`;
}
