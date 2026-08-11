// Copier + drift detector.
//
// Applies a resolved member's target list to a member checkout (`memberRoot`), using the
// lockfile to distinguish four outcomes per target:
//
//   add       — target absent          -> write, record in lock
//   update    — upstream canon changed  -> write, refresh lock
//   unchanged — identical to canon      -> no-op (idempotent)
//   drift     — locally modified        -> FLAG "⚠️ locally modified", skip (unless --force)
//
// A pre-existing file that is already identical to canon but has no lock entry is "adopted":
// its baseline hash is recorded so a later upstream change updates it rather than tripping
// drift. Adoption counts as a change (the lock must persist), but is content-neutral.
//
// Before any of that, the lock is reconciled against the plan (see rekey.mjs): entries left
// under an abandoned target base follow their file to the current base, and entries pointing
// at paths that no longer exist are dropped. Without that step a base move strands the
// baseline, and every relocated file is misread as member-authored drift and skipped forever.
//
// Drift is decided from the lockfile: if the target's current hash differs from the
// `targetSha256` we last wrote, a human edited it. A pre-existing file with no lock entry
// that differs from canon is treated the same way (a conflict), so we never clobber
// member-authored content silently.
//
// The lockfile is only rewritten when entries actually change (a write or an adoption), so a
// re-run with no upstream change produces no diff (and therefore no PR).

import { existsSync, readFileSync, mkdirSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { hashText, writeLock } from './lock.mjs';
import { reconcileLockKeys } from './rekey.mjs';
import { extractBlock, buildFile, canonicalizeInner, markersFor } from './basemerge.mjs';

const BUCKET = {
  add: 'added',
  update: 'updated',
  forced: 'forced',
};

/**
 * @param {string} memberRoot  checkout directory (may be missing targets)
 * @param {TargetSpec[]} writes
 * @param {object} lock  as returned by readLock
 * @param {{ force?: boolean, forcePaths?: string[], write?: boolean }} opts
 * @returns {{ report, lock }}
 */
export function apply(memberRoot, writes, lock, opts = {}) {
  const { force = false, forcePaths = [], write = false } = opts;
  const forceable = new Set(forcePaths);
  const reconciled = reconcileLockKeys(memberRoot, writes, lock.entries);
  const entries = reconciled.entries;
  const report = {
    added: [],
    updated: [],
    unchanged: [],
    drift: [],
    forced: [],
    adopted: [],
    rekeyed: reconciled.rekeyed,
    pruned: reconciled.pruned,
    ambiguous: reconciled.ambiguous,
    outranked: [],
  };

  for (const spec of writes) {
    const res =
      spec.type === 'managed'
        ? planManaged(memberRoot, spec, entries, force)
        : planFile(memberRoot, spec, entries, force, forceable);
    const item = { targetPath: spec.targetPath, kind: spec.kind, name: spec.name };
    if (res.outranks?.length) report.outranked.push({ ...item, rules: res.outranks });

    switch (res.action) {
      case 'add':
      case 'update':
      case 'forced':
        if (write) writeTarget(join(memberRoot, ...spec.targetPath.split('/')), res.newContent);
        entries[spec.targetPath] = res.newEntry;
        report[BUCKET[res.action]].push(item);
        break;
      case 'unchanged':
        if (!entries[spec.targetPath] && res.newEntry) {
          // Pre-existing file already identical to canon but never recorded: adopt a
          // baseline so a future upstream change updates it instead of being mistaken
          // for local drift. This counts as a change so the lock is persisted.
          entries[spec.targetPath] = res.newEntry;
          report.adopted.push(item);
        } else {
          report.unchanged.push(item);
        }
        break;
      default: // drift — leave the lock entry untouched so the reviewer can reconcile.
        report.drift.push({ ...item, ...withholdingState(entries[spec.targetPath], spec), ...(res.note ? { note: res.note } : {}) });
    }
  }

  report.changed =
    report.added.length +
      report.updated.length +
      report.forced.length +
      report.adopted.length +
      report.rekeyed.length +
      report.pruned.length >
    0;
  report.hasDrift = report.drift.length > 0;
  report.abandoned = findAbandoned(memberRoot, writes, entries, report.rekeyed);
  const newLock = { ...lock, entries };

  if (write && report.changed) writeLock(memberRoot, newLock);

  return { report, lock: newLock };
}

/**
 * Files still in the member that the plan will never write again.
 *
 * Distinct from `rekeyed`/`pruned`, which describe what happens to lock *entries*. This is about
 * what is left on *disk*. The engine does not prune (see "Deselection cleanup is manual and
 * hash-verified" in the README), so deselecting a kind or moving a target base leaves the old
 * files exactly where they are. That is deliberate: pruning means deleting outside the current
 * plan, and a mechanism that can delete outside its plan can be wrong outside its plan.
 *
 * What was missing is the other half — nothing said which files had been abandoned, so the
 * documented cleanup procedure had no trigger. Three shapes reach here:
 *
 *   - an orphaned entry that could not be rekeyed, whose file still exists;
 *   - the `from` side of a rekey whose file still exists. Reconciliation moves the entry to the
 *     new base, which is right for the baseline, but it leaves the old file with *no* lock record
 *     at all — making it less visible after reconciliation than it was before;
 *   - any *other* file still sitting under a base that this run's rekeys prove has been abandoned.
 *
 * The third shape is the one that motivated all of this, and neither of the first two catches it.
 * `jrmoulckers/finance` repointed `tokens.targetPath` to the repo root; a later sync resolving
 * older canon wrote the native token files to the *old* base and minted their lock entries at the
 * *new* one. So there is no entry under the old base and no rekey pointing at it — the files are
 * absent from every record the engine keeps. They are still there today, and one of them carries
 * the pre-#121 comment syntax that Kotlin cannot parse; finance is the only `kmp-web` member, so
 * it is the one repository in the fleet with a toolchain that would compile it.
 *
 * Informational, and deliberately excluded from `hasDrift`: expected mid-transition, resolvable
 * only by a human, and never a reason to fail a run or gate a PR.
 */
function findAbandoned(memberRoot, writes, entries, rekeyed) {
  const planned = new Set(writes.map((spec) => spec.targetPath));
  const onDisk = (targetPath) => existsSync(join(memberRoot, ...targetPath.split('/')));

  // reconcileLockKeys already drops unplanned entries whose file is gone, so onDisk() is
  // currently always true here. It is kept deliberately: this report exists to name files a
  // human may delete, and inheriting a phantom from a change in that prune condition would be
  // worse than a redundant stat. The invariant is pinned by a test rather than assumed.
  const orphaned = Object.keys(entries).filter((key) => !planned.has(key) && onDisk(key));
  const relocated = rekeyed
    .map((item) => item.from)
    .filter((from) => !planned.has(from) && onDisk(from));

  const swept = [];
  for (const base of abandonedBases(writes, rekeyed)) {
    for (const found of walkFiles(memberRoot, base)) {
      if (!planned.has(found)) swept.push(found);
    }
  }

  return [...new Set([...orphaned, ...relocated, ...swept])].sort().map((targetPath) => ({
    targetPath,
    // An untracked abandoned file has no hash to verify a safe deletion against, so it needs a
    // different cleanup from one the lock still remembers.
    tracked: Object.hasOwn(entries, targetPath),
  }));
}

/**
 * Bases this run proved the engine has moved away from.
 *
 * A rekey pair is evidence: the entry `from` and the planned target `to` differ only in their
 * base, so stripping the shared plan-relative tail from `from` yields a directory the engine
 * demonstrably used to write into. That evidence is what bounds the sweep — the engine never goes
 * looking through a member at large, only into directories its own lockfile attests to.
 *
 * The limit is real and worth stating rather than implying: if *every* entry under an old base had
 * already been re-minted elsewhere, no rekey happens, no base is identified, and files stranded
 * there stay invisible. Nothing in the engine's records would point at them, so there is nothing
 * to reason from. A member-wide scan would find them, and is precisely the licence this declines
 * to take.
 */
function abandonedBases(writes, rekeyed) {
  const baseOf = new Map(writes.map((spec) => [spec.targetPath, spec.targetBase]));
  const bases = new Set();

  for (const { from, targetPath } of rekeyed) {
    const newBase = baseOf.get(targetPath);
    if (!newBase || newBase === '.') continue;
    const rel = targetPath.slice(`${newBase.replace(/\/+$/, '')}/`.length);
    if (!rel || !from.endsWith(`/${rel}`)) continue;
    const oldBase = from.slice(0, from.length - rel.length - 1);
    // A base that is still targeted is not abandoned, and an empty one would sweep the repo root.
    if (oldBase && oldBase !== newBase) bases.add(oldBase);
  }
  return [...bases];
}

/** Every file under `base`, as member-relative POSIX paths. Missing directories yield nothing. */
function walkFiles(memberRoot, base) {
  const abs = join(memberRoot, ...base.split('/'));
  if (!existsSync(abs)) return [];

  const found = [];
  for (const dirent of readdirSync(abs, { withFileTypes: true })) {
    const child = `${base}/${dirent.name}`;
    if (dirent.isDirectory()) found.push(...walkFiles(memberRoot, child));
    else if (dirent.isFile()) found.push(child);
  }
  return found;
}

function planFile(memberRoot, spec, entries, force, forceable = new Set()) {
  const abs = join(memberRoot, ...spec.targetPath.split('/'));
  const rendered = spec.content;
  const renderedHash = hashText(rendered);
  const newEntry = entry(spec.sourceSha256, renderedHash);

  if (!existsSync(abs)) return { action: 'add', newContent: rendered, newEntry };

  const currentHash = hashText(readFileSync(abs, 'utf8'));
  const lockEntry = entries[spec.targetPath];
  if (isLocallyModified(lockEntry, currentHash, renderedHash)) {
    if (
      isUnstampedCanon(lockEntry, currentHash, spec) ||
      isHistoricalCanonOutput(lockEntry, currentHash, spec) ||
      isSupersededEngineOutput(lockEntry, currentHash, spec)
    ) {
      return { action: 'update', newContent: rendered, newEntry };
    }
    // `--force` is scoped by member, but the request it answers is almost always about one file:
    // the operator asks to force "a known file" and the flag overrides every drifted target in
    // that repo. For a target the engine has *never* delivered canon to, the on-disk bytes are
    // member-authored and canon holds no copy, so forcing is an unrecoverable delete of content
    // nobody chose to discard. Those must be named path-by-path; a member-wide `--force` refuses
    // them and says so. A target with a lock entry has received canon before and is recoverable,
    // so member-wide force still applies there.
    if (force && !lockEntry && !forceable.has(spec.targetPath)) {
      return { action: 'drift', note: 'force refused — never received canon; name this path in --force-paths to overwrite it' };
    }
    return force
      ? { action: 'forced', newContent: rendered, newEntry }
      : { action: 'drift' };
  }
  if (currentHash === renderedHash) return { action: 'unchanged', newEntry };
  return { action: 'update', newContent: rendered, newEntry };
}

/**
 * Plan a managed-region target (AGENTS.md, .github/copilot-instructions.md, .gitattributes):
 * only the block between the studio markers is ours, so drift is judged on the block inner
 * rather than the whole file and the member's surrounding content is always preserved.
 */
function planManaged(memberRoot, spec, entries, force) {
  const abs = join(memberRoot, ...spec.targetPath.split('/'));
  const markers = markersFor(spec.targetPath);
  const inner = canonicalizeInner(spec.content);
  const renderedHash = hashText(inner);
  const newEntry = entry(spec.sourceSha256, renderedHash);

  if (!existsSync(abs)) return { action: 'add', newContent: buildFile('', inner, markers), newEntry };

  const existing = readFileSync(abs, 'utf8');
  const currentInner = extractBlock(existing, markers);
  if (currentInner === null) {
    // No managed region yet: insert one, preserving all product-local content.
    return { action: 'add', newContent: buildFile(existing, inner, markers), newEntry };
  }
  const currentHash = hashText(currentInner);
  const outranks = outrankedRules(existing, markers, spec.targetPath);
  if (isLocallyModified(entries[spec.targetPath], currentHash, renderedHash)) {
    return force
      ? { action: 'forced', newContent: buildFile(existing, inner, markers), newEntry, outranks }
      : { action: 'drift', note: suspectBlockNote(spec.targetPath, currentInner, inner), outranks };
  }
  if (currentHash === renderedHash) return { action: 'unchanged', newEntry, outranks };
  return { action: 'update', newContent: buildFile(existing, inner, markers), newEntry, outranks };
}

/**
 * Member rules that canon's region silently overrides because the region sits after them.
 *
 * Only meaningful for `prepend` targets. In `.gitattributes` the *last* matching pattern wins and
 * canon's `*` matches every path, so a region below a member's rules outranks all of them. A
 * member that marks `*.glb binary` — shorthand for `-text -diff`, *never inspect this file* — has
 * that flipped to `text: auto`, handing a binary asset to git's content heuristic. That is the
 * corruption ADR-0011 exists to prevent, and it is the one case where the engine's own output is
 * worse than doing nothing.
 *
 * `buildFile` prepends, so the engine never creates this. It is reachable two ways: a region
 * placed by hand, or one written by a sync that predates the placement fix. Both are permanent,
 * because an existing region is replaced in place and never relocated — deliberately, since
 * silently reordering a file the member owns is its own failure. So nothing repairs this and,
 * until now, nothing reported it either.
 *
 * Detection is by *precedence*, not position. Position is a lossy proxy: a comment above the
 * region carries no precedence at all, and a rule byte-identical to canon overrides a value to
 * itself. Both read as violations if you check "is the region first" and neither is one. What
 * matters is whether an earlier line sets an attribute canon's `*` then resets — so that is what
 * is checked, and only those lines are named.
 */
function outrankedRules(existing, markers, targetPath) {
  if (markers.placement !== 'prepend') return [];
  const start = existing.indexOf(markers.start);
  if (start <= 0) return [];

  const canonAttrs = canonAttributeValues(existing, markers);
  if (!canonAttrs.size) return [];

  const outranked = [];
  for (const raw of existing.slice(0, start).split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue; // comments carry no precedence
    const [pattern, ...attrs] = line.split(/\s+/);
    const lost = [];
    for (const [name, value] of attributeValues(attrs)) {
      // A rule canon resets to the value it already had loses nothing. This is the case that
      // makes position a lossy proxy: a member repeating canon's own stanza reads as a violation
      // by position and is not one by precedence.
      if (canonAttrs.has(name) && canonAttrs.get(name) !== value) lost.push(name);
    }
    if (lost.length) outranked.push({ pattern, line, attributes: [...new Set(lost)] });
  }
  return outranked;
}

/** Attribute values canon's universal (`*`) rules set inside the managed region. */
function canonAttributeValues(existing, markers) {
  const values = new Map();
  for (const raw of (extractBlock(existing, markers) ?? '').split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const [pattern, ...attrs] = line.split(/\s+/);
    if (pattern !== '*') continue; // only a universal pattern outranks everything beneath it
    for (const [name, value] of attributeValues(attrs)) values.set(name, value);
  }
  return values;
}

/**
 * Resolve attribute tokens to git's own value vocabulary, so comparison is on what git decides
 * rather than on how it was spelled. `binary` is a macro for `-text -diff`.
 */
function attributeValues(tokens) {
  const out = [];
  for (const token of tokens) {
    if (token === 'binary') {
      out.push(['text', 'unset'], ['diff', 'unset']);
    } else if (token.startsWith('-')) {
      out.push([token.slice(1), 'unset']);
    } else if (token.startsWith('!')) {
      out.push([token.slice(1), 'unspecified']);
    } else if (token.includes('=')) {
      const [name, ...rest] = token.split('=');
      out.push([name, rest.join('=')]);
    } else {
      out.push([token, 'set']);
    }
  }
  return out;
}

/**
 * A managed block a small fraction of canon's size is far more likely to be a stray pair
 * of marker strings in prose than a deliberate edit. Say so, because the alternative is a
 * generic drift line for the most important files the sync delivers.
 */
function suspectBlockNote(targetPath, currentInner, canonInner) {
  if (currentInner.length >= Math.min(512, canonInner.length / 4)) return undefined;
  return (
    `managed block is only ${currentInner.length} char(s) vs ${canonInner.length} in canon — ` +
    `check ${targetPath} for stray studio:base markers`
  );
}

/**
 * Locally modified when a recorded target no longer matches what we last wrote, or when
 * an unrecorded, pre-existing target differs from canon (treated as a conflict).
 */
function isLocallyModified(lockEntry, currentHash, renderedHash) {
  return lockEntry ? currentHash !== lockEntry.targetSha256 : currentHash !== renderedHash;
}

/**
 * An unrecorded target whose bytes are *raw canon* — canon hand-copied into the member without
 * going through `inject()`, so it differs from what the engine would write by exactly the
 * provenance header.
 *
 * This has to be distinguished from drift because otherwise it is a permanent skip: the file
 * never matches `rendered`, so every run flags it and no run ever fixes it, and `--check` fails
 * forever. It is also the hardest kind of staleness to notice by eye, since the *content* is
 * current — only the provenance is missing.
 *
 * Rewriting is safe in a way ordinary drift is not: bytes equal to canon are provably not
 * member-authored, so the write discards no human work and changes nothing but the header. That
 * is why this returns `update` rather than requiring `--force`, which would suppress the drift
 * signal for every other target in the same run.
 *
 * `spec.sourceSha256` is already the hash of raw canon, and `hashText` normalizes line endings,
 * so the comparison needs no new plumbing and is CRLF-safe.
 *
 * Restricted to targets with **no lock entry**. Once a file is recorded, bytes equal to raw canon
 * mean someone deliberately stripped the header, which is a local edit and stays drift.
 */
function isUnstampedCanon(lockEntry, currentHash, spec) {
  return !lockEntry && currentHash === spec.sourceSha256;
}

/**
 * Recover an unrecorded target only when its exact bytes match committed historical canon or the
 * engine rendering reconstructed from it. Headers, similarity, and file history in the member repo
 * are not evidence: only a hash derived from canon authorizes the overwrite.
 */
function isHistoricalCanonOutput(lockEntry, currentHash, spec) {
  return !lockEntry && (spec.historicalCanonSha256 ?? []).includes(currentHash);
}

/**
 * A **recorded** target whose bytes are a superseded engine *rendering* of canon.
 *
 * This is the recovery path for a lockfile that has gone backwards. The lock is the engine's record
 * of what it wrote; when an entry regresses, `isLocallyModified` compares the file against a stale
 * `targetSha256`, attributes the difference to the member, and refuses. The refusal is correct given
 * the lock and wrong given reality, and it is *permanent* — every later run repeats the same
 * comparison against the same bad entry, so no run can ever clear it.
 *
 * Not hypothetical: `jrmoulckers/finance` held `vendor/@jrm/tokens/css/default/tokens.css` at bytes
 * byte-identical to the rendering of canon `37b5f2b0`, while its entry had reverted to the hash and
 * timestamp of a revision two versions older (their #4027 recorded it, an overlapping run in #4062
 * overwrote it — see the race in the companion issue). It stayed frozen until a human hand-edited
 * the lockfile. A repair that requires noticing a wrong hash in a generated file will not be found
 * a second time.
 *
 * **Why a rendering is safe evidence where raw canon is not.** `isUnstampedCanon` restricts itself
 * to unrecorded targets because bytes equal to *raw* canon in a recorded file mean someone stripped
 * the provenance header — a deliberate local act. Reproducing a past *rendering* is not something
 * editing produces: it carries the header, the note text and the exact bytes of a published
 * revision, and `dist/` history is what proves which one. Only a hash derived from canon authorizes
 * the overwrite, so this discards no member work by construction.
 *
 * Note also that the case the `!lockEntry` gate appears to protect is already unreachable: a member
 * reverting a sync commit reverts the lock entry in the same commit, leaving the two consistent and
 * the path an ordinary update. This adds no exposure that reverting did not already have.
 */
function isSupersededEngineOutput(lockEntry, currentHash, spec) {
  return Boolean(lockEntry) && (spec.historicalRenderedSha256 ?? []).includes(currentHash);
}

/**
 * Whether a refusal is *costing* the member anything, and since when.
 *
 * Refusing to overwrite a locally-modified file is correct and must stay correct. But a correct
 * refusal that repeats indefinitely is, in the output, indistinguishable from a member who
 * customised a file on purpose — and one of those is a member silently frozen out of canon. That
 * is not hypothetical: `jrmoulckers/finance` held a vendored `tokens.css` of 20,889 characters
 * against canon's 45,465, refused correctly on every run since its baseline, while the warning
 * went into a log nobody read.
 *
 * The distinction needs no new state, no counter and no threshold, because the lockfile already
 * records both halves. `sourceSha256` is the canon the member last received; compare it with the
 * canon this run resolved:
 *
 * - **canon has not moved** — the member edited a file that is otherwise current. They are missing
 *   nothing. This is the deliberate-customisation case, and it is benign.
 * - **canon has moved** — the member is behind and the refusal is what keeps them there. Every
 *   further run widens the gap. This is the case that needs to be loud.
 *
 * A counter of consecutive skips was the obvious alternative and measures the wrong thing: it
 * counts how often the engine ran, not whether anything is being withheld. A file customised on
 * purpose accrues exactly the same count as a frozen one.
 *
 * `lastWrittenAt` is the entry's `syncedAt`, left untouched by drift precisely so it keeps
 * meaning "when this path last successfully received canon". Note what it is not: the moment drift
 * *began*, which the engine cannot know — a member may have edited the file long after that write.
 * It is an upper bound on the refusal's age and an exact measure of the baseline's, and the
 * baseline's age is the quantity the harm is made of.
 *
 * An unrecorded target has no baseline to compare, and it differs from canon or it would not be
 * here — so the member has never received this path and is withheld by definition.
 *
 * `revisionsBehind` is the magnitude: how many distinct versions canon has published since the one
 * the member last received. It is the number that grows, and growth is what separates a file
 * frozen out of updates from one customised on purpose, which sits at zero forever. `null` means
 * the question is unanswerable rather than zero — a baseline describing content that appears
 * nowhere in the source's history — and unanswerable must not read as "up to date".
 *
 * Having *no* baseline is a third thing, and it is answerable: the member has received zero of the
 * versions canon published, so the answer is all of them. Reporting that as `null` was the original
 * shape and it was silent for the worst class of file — an unrecorded target cannot self-heal,
 * because both recovery paths require a hash match and neither mints a baseline for content
 * matching nothing. Every file that *can* recover got a growing number; the permanently stuck ones
 * printed nothing. See `neverReceived`.
 */
function withholdingState(lockEntry, spec) {
  if (!lockEntry) {
    return { withheld: true, lastWrittenAt: null, revisionsBehind: neverReceived(spec) };
  }
  return {
    withheld: lockEntry.sourceSha256 !== spec.sourceSha256,
    lastWrittenAt: lockEntry.syncedAt ?? null,
    revisionsBehind: revisionsBehind(lockEntry, spec),
  };
}

/**
 * Position of the member's baseline in the ordered revision list. Index 0 is current canon, so the
 * index *is* the number of versions published since — no arithmetic, and no off-by-one to get
 * wrong when a revert makes two entries share content.
 */
function revisionsBehind(lockEntry, spec) {
  const revisions = spec.canonRevisionSha256;
  if (!revisions?.length || !lockEntry.sourceSha256) return null;
  const index = revisions.indexOf(lockEntry.sourceSha256);
  return index < 0 ? null : index;
}

/**
 * Magnitude for a target the member has never received: the whole published history.
 *
 * This keeps the same index semantics as the recorded case rather than inventing a scale. A member
 * holding the oldest version sits at index `length - 1` and is that many behind, so "holds none of
 * them" is `length` — exactly one past the oldest, and monotone with every recorded value.
 *
 * An empty history stays `null`, not `0`. Zero published versions cannot support a claim in either
 * direction, and `0` is already spoken for: it means *customised on current canon*, the benign
 * state. Returning it here would print nothing while asserting the one thing this whole signal
 * exists to prevent — that a file nobody can measure reads as up to date.
 */
function neverReceived(spec) {
  const revisions = spec.canonRevisionSha256;
  return revisions?.length ? revisions.length : null;
}

/**
 * Render `revisionsBehind` for a human, or nothing at all.
 *
 * Lives here, beside the field it formats, so the log line and the PR body cannot drift apart —
 * and so neither reporting surface has to know that `null` and `0` mean different things. `null`
 * is unanswerable (no baseline, or a baseline matching nothing in the source's history); printing
 * it as "0 canon revisions behind" would assert a currency the engine cannot support.
 */
export function formatBehind(revisionsBehind) {
  if (!revisionsBehind) return '';
  return `, ${revisionsBehind} canon revision${revisionsBehind === 1 ? '' : 's'} behind`;
}

function entry(sourceSha256, targetSha256) {
  return { sourceSha256, targetSha256, syncedAt: new Date().toISOString() };
}

function writeTarget(absPath, content) {
  mkdirSync(dirname(absPath), { recursive: true });
  writeFileSync(absPath, content, 'utf8');
}
