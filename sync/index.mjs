#!/usr/bin/env node
// JRM Studio sync engine — CLI entry.
//
// Distributes the canonical AI layer from jrmoulckers/.github to member repos described in
// studio.config.json. See sync/README.md and docs/sync.md.
//
// Flags:
//   --dry-run            Plan only. No writes or network. Reads local backbone history to
//                        build historical-canon evidence. Prints the resolved
//                        file set per member (and the profile mirror plan). It does not
//                        read member lockfiles, so it reports no per-file outcomes and
//                        cannot preview --force; pair with --work-dir for that.
//   --members <a,b>      Restrict to these member repos (full "owner/name" or bare "name").
//   --check              CI gate. Exit non-zero if any member is out of date or has drift.
//                        Needs member state: clones each member, or use with --work-dir.
//   --force              Overwrite locally-modified (drift) targets instead of skipping them.
//                        Requires --members: forcing overrides the protection for
//                        member-authored content, so the affected repos must be named.
//                        Run-wide within them: applies to every drifted file, not to one file.
//   --work-dir <path>    Treat <path> as a single member's checkout: apply/inspect locally,
//                        no clone/push/PR. Requires exactly one --members. Offline testing seam.
//                        Refuses to run unless the checkout's origin is that member.
//   --allow-unverified-work-dir
//                        Proceed when --work-dir cannot be identified as the named member (a
//                        fork, mirror or local-only clone). Scoped to that one check.
//   --studio-dir <path>  Use <path> as a local checkout of the token source repo (jrmoulckers/
//                        studio) instead of cloning it. Offline seam for tokens; needed to
//                        list/apply vendored @jrm/tokens under --dry-run / --work-dir.
//   --date <YYYY-MM-DD>  Override the sync date used for branch/commit naming.
//   --help               Show this help.
//
// Env: STUDIO_SYNC_TOKEN — fine-grained PAT with Contents + Pull requests read/write on
// all members and the profile destination (required for real syncs and for --check
// without --work-dir). Studio is both a member and the private token source, so that grant
// includes vendoring reads. No `workflow` scope and no blanket `repo` scope — see docs/sync.md.
// The default GITHUB_TOKEN cannot push to other repos.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadManifest } from './lib/manifest.mjs';
import { resolveAll } from './lib/resolve.mjs';
import { enumerateTargets, enumerateTokenTargets } from './lib/assets.mjs';
import { readLock } from './lib/lock.mjs';
import { apply, formatBehind } from './lib/copier.mjs';
import { cloneShallow } from './lib/git.mjs';
import { assertMemberCheckout, assertMemberIdentity } from './lib/workdir.mjs';
import { resolveStudioRoot } from './lib/studio.mjs';
import { formatDriftWarning, renderRunSummary, syncMembers } from './lib/runner.mjs';
import { mirrorProfile, profileTarget } from './lib/profile.mjs';
import { log } from './lib/log.mjs';
import { assertMemberFacts } from './lib/member-facts.mjs';
import {
  formatCallerPermissionWarnings,
  observeCallerPermissions,
} from './lib/caller-permissions.mjs';
import { mkdtempSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const out = (s = '') => process.stdout.write(`${s}\n`);

function parseArgs(argv) {
  const opts = { dryRun: false, check: false, force: false, forcePaths: [], members: [], workDir: null, studioDir: null, date: null, help: false, allowUnverifiedWorkDir: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [key, inlineVal] = arg.startsWith('--') ? splitFlag(arg) : [arg, undefined];
    const take = () => inlineVal ?? argv[++i];
    switch (key) {
      case '--dry-run': opts.dryRun = true; break;
      case '--check': opts.check = true; break;
      case '--force': opts.force = true; break;
      case '--force-paths': opts.forcePaths = String(take()).split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--members': opts.members = String(take()).split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--work-dir': opts.workDir = take(); break;
      case '--allow-unverified-work-dir': opts.allowUnverifiedWorkDir = true; break;
      case '--studio-dir': opts.studioDir = take(); break;
      case '--date': opts.date = take(); break;
      case '--help': case '-h': opts.help = true; break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
  }
  // `--force` overrides drift protection, which is the only thing standing between the engine
  // and member-authored content. An unscoped `--force` means "override it on every member for
  // every target", and that is one omitted flag away from a single-member recovery. Requiring
  // the filter makes the fleet-wide shape unreachable rather than merely unusual: the blast
  // radius has to be stated, never defaulted.
  if (opts.force && !opts.members.length) {
    throw new Error(
      '--force requires --members. Forcing overwrites targets the engine classified as ' +
        'member-authored drift, so the affected repositories must be named explicitly ' +
        '(e.g. --force --members finance).',
    );
  }
  // `--members` scopes the run; it does not scope the override. The request `--force` answers is
  // almost always about one file, so a member-wide flag granting a repo-wide override is the
  // remaining gap: the operator authorizes what they were asked for and the engine applies it to
  // every drifted target in that repo. Targets that never received canon are refused unless named
  // here, because for those the member's bytes are the only copy in existence.
  if (opts.forcePaths.length && !opts.force) {
    throw new Error('--force-paths requires --force; on its own it authorizes nothing.');
  }
  return opts;
}

function splitFlag(arg) {
  const eq = arg.indexOf('=');
  return eq >= 0 ? [arg.slice(0, eq), arg.slice(eq + 1)] : [arg, undefined];
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) return printHelp();

  const manifest = loadManifest(REPO_ROOT);
  const date = opts.date ?? today();
  const token = process.env.STUDIO_SYNC_TOKEN || '';
  const resolvedList = resolveAll(manifest, opts.members);

  if (!resolvedList.length) {
    log.warn(`No members matched${opts.members.length ? ` filter: ${opts.members.join(', ')}` : ''}.`);
    return 0;
  }

  const plans = resolvedList.map((resolved) => ({
    resolved,
    targets: enumerateTargets(resolved, REPO_ROOT),
  }));

  if (opts.workDir && plans.length !== 1) {
    throw new Error('--work-dir requires exactly one member (use --members <owner/name>).');
  }
  // Both guards run here, before the mode dispatch, so they cover --check --work-dir and
  // --dry-run --work-dir as well as an applying run. --check is the one that most needs it: a
  // wrong-checkout apply leaves a lockfile that makes the next --check report "up to date", so
  // the mistake certifies itself, and the certifying run must be stopped by the same gate.
  if (opts.workDir) {
    assertMemberCheckout(opts.workDir);
    const identity = assertMemberIdentity(opts.workDir, plans[0].resolved.repo, {
      allowUnverified: opts.allowUnverifiedWorkDir,
    });
    if (identity.overridden) {
      log.warn(
        `--work-dir identity check overridden: ${opts.workDir} ` +
          (identity.origin ? `has origin ${identity.origin}` : 'has no origin remote') +
          `, not verifiably ${plans[0].resolved.repo}. Proceeding because ` +
          '--allow-unverified-work-dir was passed.',
      );
    }
  }

  // Vendored @jrm/tokens come from an external repo. Resolve a source checkout once (shared by
  // every opted-in member) and splice the token writes into each member's plan. Runs that touch
  // no tokens never clone anything. Dry-run / work-dir stay network-offline (source via
  // --studio-dir), while target enumeration still reads local backbone Git history.
  const needTokens = plans.some((p) => p.resolved.tokens?.enabled);
  const allowClone = !opts.dryRun && !opts.workDir;
  const studio = needTokens ? resolveStudioRoot(opts, manifest, token, { allowClone }) : null;

  try {
    if (needTokens && studio) {
      for (const plan of plans) {
        if (plan.resolved.tokens?.enabled) {
          plan.targets.writes.push(...enumerateTokenTargets(plan.resolved.tokens, studio.root));
        }
      }
    } else if (needTokens) {
      log.warn(
        'Token source not resolved (offline): pass --studio-dir <checkout> to list/apply vendored ' +
          `@jrm/tokens files for ${plans.filter((p) => p.resolved.tokens?.enabled).map((p) => p.resolved.repo).join(', ')}.`,
      );
    }

    if (opts.check) return runCheck(plans, opts, manifest, token);
    if (opts.workDir) return runWorkDir(plans, opts, manifest, date);
    if (opts.dryRun) return runDryRun(plans, opts, manifest, REPO_ROOT, date);
    return runSync(plans, opts, manifest, token, date);
  } finally {
    studio?.cleanup();
  }
}

// --- modes -----------------------------------------------------------------

function runDryRun(plans, opts, manifest, backboneRoot, date) {
  out(`JRM Studio sync — dry run (${date}) — ${plans.length} member(s)\n`);
  for (const { resolved, targets } of plans) printPlan(resolved, targets);
  // A dry run exists to predict the real run, so it must model the same member filter:
  // runSync mirrors the profile only on unfiltered runs.
  const profile = profileTarget(manifest.owner, backboneRoot);
  if (opts.members.length) {
    out('▶ profile mirror');
    out(`  skipped — member filter active (--members); a real run would not mirror ${profile.repo}`);
  } else {
    out('▶ profile mirror');
    out(`  ${profile.repo}:${profile.write.targetPath}  ⟵ profile/README.md`);
  }
  out('\nDry run complete — no files written and no network operations performed.');
  publishRunSummary(
    plans.map(({ resolved, targets }) => ({
      repo: resolved.repo,
      status: `${targets.writes.length} file(s) would be written`,
    })),
    opts,
    manifest,
    'dry-run',
  );
  return 0;
}

function runWorkDir(plans, opts, manifest, date) {
  const { resolved, targets } = plans[0];
  const write = !opts.dryRun;
  const facts = assertMemberFacts(opts.workDir, resolved, manifest.backbone);
  facts.workflowObservations.callerPermissions = observeCallerPermissions({
    root: opts.workDir,
    repo: resolved.repo,
    backbone: manifest.backbone,
    rootLabel: 'working tree',
  });
  reportWorkflowObservations(resolved.repo, facts);
  const lock = readLock(opts.workDir, manifest.backbone);
  const { report } = apply(opts.workDir, targets.writes, lock, { force: opts.force, forcePaths: opts.forcePaths, write });
  log.step(`${resolved.repo} → ${opts.workDir}${write ? '' : '  (dry-run: no writes)'}`);
  printReport(report);
  publishRunSummary(
    [{ repo: resolved.repo, status: write ? 'applied to local checkout' : 'inspected (no writes)' }],
    opts,
    manifest,
    'work-dir',
  );
  return 0;
}

function runCheck(plans, opts, manifest, token) {
  let outOfDate = 0;
  let failed = 0;
  for (const { resolved, targets } of plans) {
    let checkout;
    try {
      checkout = memberRootForCheck(resolved.repo, opts, token, manifest.backbone);
      const facts = assertMemberFacts(checkout.root, resolved, manifest.backbone);
      facts.workflowObservations.callerPermissions = observeCallerPermissions({
        root: checkout.root,
        repo: resolved.repo,
        backbone: manifest.backbone,
        token,
        includePullRequests: !opts.workDir,
        rootLabel: opts.workDir ? 'working tree' : 'default branch',
      });
      reportWorkflowObservations(resolved.repo, facts);
      const lock = readLock(checkout.root, manifest.backbone);
      const { report } = apply(checkout.root, targets.writes, lock, { force: false, write: false });
      const stale = report.changed || report.hasDrift;
      if (stale) outOfDate++;
      const bits = [
        report.added.length ? `${report.added.length} to add` : null,
        report.updated.length ? `${report.updated.length} to update` : null,
        report.adopted.length ? `${report.adopted.length} to baseline` : null,
        report.rekeyed?.length ? `${report.rekeyed.length} to relocate in lockfile` : null,
        report.pruned?.length ? `${report.pruned.length} stale lock entries to remove` : null,
        report.drift.length ? `${report.drift.length} drifted` : null,
      ].filter(Boolean);
      log[stale ? 'warn' : 'ok'](`${resolved.repo}: ${stale ? bits.join(', ') : 'up to date'}`);
      if (report.hasDrift) log.warn(formatDriftWarning(resolved.repo, report.drift));
    } catch (err) {
      failed++;
      log.error(`${resolved.repo}: check failed — ${err.message}`);
    } finally {
      checkout?.cleanup();
    }
  }
  if (outOfDate || failed) {
    if (failed) log.error(`${failed} member(s) could not be verified.`);
    if (outOfDate) log.error(`${outOfDate} member(s) out of date.`);
    process.exitCode = 1;
  } else {
    log.ok('All members up to date.');
  }
  return process.exitCode ?? 0;
}

function reportWorkflowObservations(repo, facts) {
  const unused = facts.workflowObservations?.unusedDeclarations ?? [];
  if (unused.length) {
    log.info(`${repo}: reusable workflow availability not currently called: ${unused.join(', ')}`);
  }
  for (const warning of formatCallerPermissionWarnings(
    repo,
    facts.workflowObservations?.callerPermissions,
  )) {
    log.warn(warning);
  }
}

function runSync(plans, opts, manifest, token, date) {
  if (!token) throw new Error('STUDIO_SYNC_TOKEN is required to sync (set it or use --dry-run).');
  const { outcomes, failures } = syncMembers(plans, {
    token,
    date,
    force: opts.force,
    forcePaths: opts.forcePaths,
    backbone: manifest.backbone,
  });
  if (!opts.members.length) {
    const profileRepo = `${manifest.owner}/${manifest.owner}`;
    try {
      const mirror = mirrorProfile({
        owner: manifest.owner,
        backbone: manifest.backbone,
        backboneRoot: REPO_ROOT,
        token,
        date,
        force: opts.force,
      });
      // Report what the mirror did, not that it was attempted. It answers `missing` when the repo
      // is absent and `unknown` when it could not tell, and printing `mirrored` over either told an
      // operator the profile had been published when nothing was written.
      outcomes.push({
        repo: profileRepo,
        status: mirror.status === 'pr' ? 'mirrored' : mirror.status,
      });
    } catch (err) {
      failures.push({ repo: profileRepo, message: err.message });
      outcomes.push({ repo: profileRepo, status: 'failed', detail: err.message });
      log.error(`profile mirror failed — ${err.message}`);
    }
  } else {
    log.info('Profile mirror skipped (member filter active).');
  }
  publishRunSummary(outcomes, opts, manifest, 'sync');
  log.info(`${outcomes.filter((o) => o.status !== 'failed').length} of ${outcomes.length} target(s) succeeded.`);
  if (failures.length) {
    log.error(`${failures.length} of ${outcomes.length} target(s) failed:`);
    for (const f of failures) log.error(`    ${f.repo}: ${f.message}`);
    return 1;
  }
  return 0;
}

/**
 * Write the run summary where CI will surface it.
 *
 * Best-effort by design: a summary that cannot be written must never fail a sync that otherwise
 * succeeded, and outside Actions there is no file to write to at all.
 */
function publishRunSummary(outcomes, opts, manifest, mode) {
  const path = process.env.GITHUB_STEP_SUMMARY;
  if (!path) return;
  try {
    appendFileSync(
      path,
      renderRunSummary(outcomes, {
        mode,
        members: opts.members,
        fleetSize: manifest.members.length,
      }),
    );
  } catch (err) {
    log.warn(`could not write run summary — ${err.message}`);
  }
}

function memberRootForCheck(repo, opts, token, backbone) {
  if (opts.workDir) return { root: opts.workDir, cleanup: () => {} };
  if (!token) throw new Error('--check without --work-dir requires STUDIO_SYNC_TOKEN to clone members.');
  const tmp = mkdtempSync(join(tmpdir(), 'studio-check-'));
  try {
    cloneShallow(repo, token, tmp);
  } catch (err) {
    rmSync(tmp, { recursive: true, force: true });
    throw err;
  }
  return { root: tmp, cleanup: () => rmSync(tmp, { recursive: true, force: true }) };
}

// --- formatting ------------------------------------------------------------

function printPlan(resolved, targets) {
  const meta = [resolved.mode, resolved.framework, resolved.packageManager].filter(Boolean).join(' · ');
  out(`▶ ${resolved.repo}${meta ? `  (${meta})` : ''}`);

  const byKind = groupByKind(targets.writes);
  for (const group of resolved.groups) {
    if (group.native) continue;
    const items = byKind.get(group.kind) ?? [];
    if (group.kind === 'skills') {
      out(`  skills (${items.length} files in ${group.names.length} dirs):`);
    } else if (group.kind === 'tokens') {
      out(`  tokens (${items.length} files) ⟵ vendored from ${group.sourceRepo} ${group.package}:`);
      if (!items.length) {
        out('    (source not resolved — pass --studio-dir <checkout> to list files)');
      }
    } else {
      out(`  ${group.kind} (${items.length} files):`);
    }
    for (const item of items) {
      const note = item.type === 'managed' ? '   ⟵ managed block merge' : '';
      out(`    ${item.targetPath}${note}`);
    }
  }
  for (const nat of targets.native) {
    const how =
      nat.kind === 'workflows'
        ? 'availability declared; actual SHA-pinned calls require checkout verification'
        : 'inherited from backbone .github';
    out(`  ${nat.kind}: native — ${how} (not written)${nat.names.length ? `: ${nat.names.join(', ')}` : ''}`);
  }
  out(`  Σ ${targets.writes.length} file(s) would be written\n`);
}

function printReport(report) {
  const line = (label, arr) => arr?.length && log.info(`    ${label}: ${arr.length}`);
  line('added', report.added);
  line('updated', report.updated);
  line('unchanged', report.unchanged);
  // Named, not counted. Forcing is the only action in a run that destroys member-authored work,
  // and it was the one reported as a bare integer while every *skipped* file was listed by name —
  // the reversible outcome legible and the irreversible one not. A count also cannot separate
  // re-asserting a known baseline from overwriting something canon never delivered, which is the
  // distinction an operator authorizing the run is actually deciding on.
  if (report.forced?.length) {
    log.info(`    force-updated: ${report.forced.length}`);
    for (const item of report.forced) log.info(`        ${item.targetPath}`);
  }
  line('baselined (lock only)', report.adopted);
  line('relocated in lockfile', report.rekeyed);
  line('stale lock entries removed', report.pruned);
  if (report.drift.length) {
    const withheld = report.drift.filter((item) => item.withheld);
    log.warn(`    ⚠️ locally modified (skipped): ${report.drift.length}`);
    for (const item of report.drift) {
      const behind = item.withheld
        ? ` — WITHHOLDING an update (last received canon ${item.lastWrittenAt ?? 'never'}` +
          `${formatBehind(item.revisionsBehind)})`
        : '';
      log.warn(`        ${item.targetPath}${behind}${item.note ? ` — ${item.note}` : ''}`);
    }
    // Refusing is correct; repeating a correct refusal forever is what goes unnoticed. Separating
    // "customised on purpose" from "frozen out of canon" is the whole point of the line below —
    // without it both read as the same steady-state warning.
    if (withheld.length) {
      log.warn(
        `    ⚠️ ${withheld.length} of those ${report.drift.length} are behind canon, not merely ` +
          'customised — the skip is what keeps them stale.',
      );
    }
    // A skipped AGENTS.md means the member did not receive the base guide at all, which
    // is easy to miss among a successful run's other counts.
    if (report.drift.some((item) => item.targetPath === 'AGENTS.md')) {
      log.warn('    ⚠️ AGENTS.md was NOT updated — this member has no current base guide.');
    }
  }
  if (report.outranked?.length) {
    for (const file of report.outranked) {
      log.warn(`    ⚠️ ${file.targetPath}: the managed region sits below ${file.rules.length} member rule(s) it overrides`);
      for (const rule of file.rules.slice(0, 5)) {
        log.warn(`        ${rule.line}  →  loses ${rule.attributes.join(', ')} to canon's *`);
      }
      if (file.rules.length > 5) log.warn(`        …and ${file.rules.length - 5} more`);
      log.warn('        The engine replaces a region in place and never relocates it, so this does');
      log.warn('        not self-heal. Move the region above these rules by hand. See ADR-0011.');
    }
  }

  if (report.orphaned?.length) {
    for (const file of report.orphaned) {
      const lines = file.lines.join(', ');
      log.warn(`    ⚠️ ${file.targetPath}: ${file.lines.length} extra managed region(s) at line ${lines}`);
      log.warn('        Only the first region is maintained. The rest hold whatever canon said when');
      log.warn('        they appeared, inside markers that assert they ARE canon — so the file reads');
      log.warn('        as current, hashes as clean, and is fenced off from the member who would');
      log.warn('        notice. A duplicate is a merge artifact; delete the extra block(s) by hand.');
    }
  }

  if (report.abandoned?.length) {
    // Left on disk, and the plan no longer names them, so they are frozen at whatever the last
    // run that did target them wrote. Saying so is the only thing that ever triggers the manual
    // cleanup procedure — and after a rekey the lock no longer records them either.
    log.warn(`    ⚠️ still present but no longer synced: ${report.abandoned.length}`);
    for (const item of report.abandoned) {
      log.warn(`        ${item.targetPath}${item.tracked ? '' : ' (no lock entry — nothing records this file)'}`);
    }
    log.warn('        These are never updated again. See "Deselection cleanup" in sync/README.md.');
  }
  const status = report.changed
    ? 'changes pending'
    : report.hasDrift
      ? 'drift only — see warnings'
      : 'up to date';
  log.info(`    → ${status}`);
}

function groupByKind(writes) {
  const map = new Map();
  for (const w of writes) {
    if (!map.has(w.kind)) map.set(w.kind, []);
    map.get(w.kind).push(w);
  }
  return map;
}

function printHelp() {
  out(`JRM Studio sync engine

Usage: node sync/index.mjs [options]

  --dry-run            Plan only; no writes, git, or network. Prints the resolved file set.
                       Reports the plan, not per-file outcomes: it never reads a member's
                       lock, so it cannot show add/update/drift/forced. Combine with
                       --work-dir to rehearse those.
  --members <a,b>      Restrict to these member repos ("owner/name" or bare "name").
  --check              Exit non-zero if any member is out of date or has drift (CI gate).
  --force              Overwrite locally-modified (drift) targets instead of skipping.
                       Requires --members. Targets that never received canon are refused;
                       name them in --force-paths to overwrite them.
                       To see what a forced run would do, add --work-dir <checkout>: a bare
                       --dry-run lists the plan and never evaluates force, so it reports no
                       forced targets even when a real run would overwrite many. Reading it
                       as "nothing would be forced" certifies every forced run as safe.
  --force-paths <p,..> Target paths that --force may overwrite even though canon has never
                       been delivered to them. Their current bytes are member-authored and
                       exist nowhere else, so each must be named.
                       Requires --members. Run-wide within those members: rewrites every
                       drifted file in each one. Not a per-file fix.
  --work-dir <path>    Apply/inspect against a local checkout (one --members); no clone/push/PR.
                       Must be the checkout itself, not a directory containing it, and its
                       origin must be the named member.
  --allow-unverified-work-dir
                       Proceed when --work-dir has a different origin or none at all (fork,
                       mirror, local-only clone). Affects only that check.
  --studio-dir <path>  Local checkout of the token source repo (jrmoulckers/studio) to vendor
                       @jrm/tokens from, instead of cloning it. Offline seam for tokens.
  --date <YYYY-MM-DD>  Override the sync date used for branch/commit naming.
  --help               Show this help.

Env: STUDIO_SYNC_TOKEN — fine-grained PAT: Contents + Pull requests read/write on every repo
in studio.config.json "members", plus the profile destination. Studio is both a member and token
source. No workflow scope, no blanket repo scope. See docs/sync.md.`);
  return 0;
}

try {
  const code = main();
  if (typeof code === 'number' && !process.exitCode) process.exitCode = code;
} catch (err) {
  log.error(err.message);
  process.exitCode = 1;
}
