#!/usr/bin/env node
// JRM Studio sync engine — CLI entry.
//
// Distributes the canonical AI layer from jrmoulckers/.github to member repos described in
// studio.config.json. See sync/README.md and docs/sync.md.
//
// Flags:
//   --dry-run            Plan only. No writes, no git, no network. Prints the resolved
//                        file set per member (and the profile mirror plan).
//   --members <a,b>      Restrict to these member repos (full "owner/name" or bare "name").
//   --check              CI gate. Exit non-zero if any member is out of date or has drift.
//                        Needs member state: clones each member, or use with --work-dir.
//   --force              Overwrite locally-modified (drift) targets instead of skipping them.
//   --work-dir <path>    Treat <path> as a single member's checkout: apply/inspect locally,
//                        no clone/push/PR. Requires exactly one --members. Offline testing seam.
//   --studio-dir <path>  Use <path> as a local checkout of the token source repo (jrmoulckers/
//                        studio) instead of cloning it. Offline seam for tokens; needed to
//                        list/apply vendored @jrm/tokens under --dry-run / --work-dir.
//   --date <YYYY-MM-DD>  Override the sync date used for branch/commit naming.
//   --help               Show this help.
//
// Env: STUDIO_SYNC_TOKEN — fine-grained PAT with Contents + Pull requests read/write on
// member repos (required for real syncs and for --check without --work-dir). Also needs
// Contents read on the token source repo (jrmoulckers/studio) when a member opts into
// tokens. No `workflow` scope and no blanket `repo` scope — see docs/sync.md. The default
// GITHUB_TOKEN cannot push to other repos.
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { loadManifest } from './lib/manifest.mjs';
import { resolveAll } from './lib/resolve.mjs';
import { enumerateTargets, enumerateTokenTargets } from './lib/assets.mjs';
import { readLock } from './lib/lock.mjs';
import { apply } from './lib/copier.mjs';
import { cloneShallow } from './lib/git.mjs';
import { assertMemberCheckout, repoMismatchWarning } from './lib/workdir.mjs';
import { resolveStudioRoot } from './lib/studio.mjs';
import { syncMembers } from './lib/runner.mjs';
import { mirrorProfile, profileTarget } from './lib/profile.mjs';
import { log } from './lib/log.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';

const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
const out = (s = '') => process.stdout.write(`${s}\n`);

function parseArgs(argv) {
  const opts = { dryRun: false, check: false, force: false, members: [], workDir: null, studioDir: null, date: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const [key, inlineVal] = arg.startsWith('--') ? splitFlag(arg) : [arg, undefined];
    const take = () => inlineVal ?? argv[++i];
    switch (key) {
      case '--dry-run': opts.dryRun = true; break;
      case '--check': opts.check = true; break;
      case '--force': opts.force = true; break;
      case '--members': opts.members = String(take()).split(',').map((s) => s.trim()).filter(Boolean); break;
      case '--work-dir': opts.workDir = take(); break;
      case '--studio-dir': opts.studioDir = take(); break;
      case '--date': opts.date = take(); break;
      case '--help': case '-h': opts.help = true; break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
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
  if (opts.workDir) assertMemberCheckout(opts.workDir);

  // Vendored @jrm/tokens come from an external repo. Resolve a source checkout once (shared by
  // every opted-in member) and splice the token writes into each member's plan. Runs that touch
  // no tokens never clone anything. Dry-run / work-dir stay offline (source via --studio-dir).
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
  out('\nDry run complete — no files written, no git or network operations performed.');
  return 0;
}

function runWorkDir(plans, opts, manifest, date) {
  const { resolved, targets } = plans[0];
  const write = !opts.dryRun;
  const mismatch = repoMismatchWarning(opts.workDir, resolved.repo);
  if (mismatch) log.warn(mismatch);  const lock = readLock(opts.workDir, manifest.backbone);
  const { report } = apply(opts.workDir, targets.writes, lock, { force: opts.force, write });
  log.step(`${resolved.repo} → ${opts.workDir}${write ? '' : '  (dry-run: no writes)'}`);
  printReport(report);
  return 0;
}

function runCheck(plans, opts, manifest, token) {
  let outOfDate = 0;
  for (const { resolved, targets } of plans) {
    const { root, cleanup } = memberRootForCheck(resolved.repo, opts, token, manifest.backbone);
    try {
      const lock = readLock(root, manifest.backbone);
      const { report } = apply(root, targets.writes, lock, { force: false, write: false });
      const stale = report.changed || report.hasDrift;
      if (stale) outOfDate++;
      const bits = [
        report.added.length ? `${report.added.length} to add` : null,
        report.updated.length ? `${report.updated.length} to update` : null,
        report.adopted.length ? `${report.adopted.length} to baseline` : null,
        report.drift.length ? `${report.drift.length} drifted` : null,
      ].filter(Boolean);
      log[stale ? 'warn' : 'ok'](`${resolved.repo}: ${stale ? bits.join(', ') : 'up to date'}`);
    } finally {
      cleanup();
    }
  }
  if (outOfDate) {
    log.error(`${outOfDate} member(s) out of date.`);
    process.exitCode = 1;
  } else {
    log.ok('All members up to date.');
  }
  return process.exitCode ?? 0;
}

function runSync(plans, opts, manifest, token, date) {
  if (!token) throw new Error('STUDIO_SYNC_TOKEN is required to sync (set it or use --dry-run).');
  const failures = syncMembers(plans, {
    token,
    date,
    force: opts.force,
    backbone: manifest.backbone,
  });
  if (!opts.members.length) {
    try {
      mirrorProfile({
        owner: manifest.owner,
        backbone: manifest.backbone,
        backboneRoot: REPO_ROOT,
        token,
        date,
        force: opts.force,
      });
    } catch (err) {
      failures.push({ repo: `${manifest.owner}/${manifest.owner}`, message: err.message });
      log.error(`profile mirror failed — ${err.message}`);
    }
  } else {
    log.info('Profile mirror skipped (member filter active).');
  }
  if (failures.length) {
    log.error(`${failures.length} of ${plans.length + (opts.members.length ? 0 : 1)} target(s) failed:`);
    for (const f of failures) log.error(`    ${f.repo}: ${f.message}`);
    return 1;
  }
  return 0;
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
  const meta = [resolved.framework, resolved.packageManager].filter(Boolean).join(' · ');
  out(`▶ ${resolved.repo}${meta ? `  (${meta})` : ''}`);

  const byKind = groupByKind(targets.writes);
  for (const group of resolved.groups) {
    if (group.native) continue;
    const items = byKind.get(group.kind) ?? [];
    if (group.kind === 'skills') {
      out(`  skills (${items.length} files in ${group.names.length} dirs):`);
    } else if (group.kind === 'base') {
      out(`  base (${items.length} files):`);
    } else if (group.kind === 'tokens') {
      out(`  tokens (${items.length} files) ⟵ vendored from ${group.sourceRepo} ${group.package}:`);
      if (!items.length) {
        out('    (source not resolved — pass --studio-dir <checkout> to list files)');
      }
    } else {
      out(`  ${group.kind} (${items.length} files):`);
    }
    for (const item of items) {
      const note = item.type === 'agents-md' ? '   ⟵ managed block merge' : '';
      out(`    ${item.targetPath}${note}`);
    }
  }
  for (const nat of targets.native) {
    const how =
      nat.kind === 'workflows'
        ? 'called via uses:@main'
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
  line('force-updated', report.forced);
  line('baselined (lock only)', report.adopted);
  if (report.drift.length) {
    log.warn(`    ⚠️ locally modified (skipped): ${report.drift.length}`);
    for (const item of report.drift) {
      log.warn(`        ${item.targetPath}${item.note ? ` — ${item.note}` : ''}`);
    }
    // A skipped AGENTS.md means the member did not receive the base guide at all, which
    // is easy to miss among a successful run's other counts.
    if (report.drift.some((item) => item.targetPath === 'AGENTS.md')) {
      log.warn('    ⚠️ AGENTS.md was NOT updated — this member has no current base guide.');
    }
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
  --members <a,b>      Restrict to these member repos ("owner/name" or bare "name").
  --check              Exit non-zero if any member is out of date or has drift (CI gate).
  --force              Overwrite locally-modified (drift) targets instead of skipping.
  --work-dir <path>    Apply/inspect against a local checkout (one --members); no clone/push/PR.
                       Must be the checkout itself, not a directory containing it.
  --studio-dir <path>  Local checkout of the token source repo (jrmoulckers/studio) to vendor
                       @jrm/tokens from, instead of cloning it. Offline seam for tokens.
  --date <YYYY-MM-DD>  Override the sync date used for branch/commit naming.
  --help               Show this help.

Env: STUDIO_SYNC_TOKEN — fine-grained PAT: Contents + Pull requests read/write on members,
Contents read on jrmoulckers/studio. No workflow scope, no blanket repo scope. See docs/sync.md.`);
  return 0;
}

try {
  const code = main();
  if (typeof code === 'number' && !process.exitCode) process.exitCode = code;
} catch (err) {
  log.error(err.message);
  process.exitCode = 1;
}
