import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, cpSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { validateInstructionIntegrity } from '../lib/instruction-integrity.mjs';
import { loadManifest } from '../lib/manifest.mjs';
import { enumerateTargets } from '../lib/assets.mjs';
import { resolveAll } from '../lib/resolve.mjs';

const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

test('canonical instruction scopes, ownership, precedence, and member profiles pass', () => {
  const manifest = loadManifest(REPO_ROOT);
  const records = validateInstructionIntegrity(REPO_ROOT, manifest);

  assert.deepEqual(
    records.map((record) => record.name),
    [...manifest.canon.instructions].sort(),
  );
  assert.equal(
    records.find((record) => record.name === 'docs').applyTo,
    'docs/**,*.md,**/README.md',
  );
  assert.equal(
    records.find((record) => record.name === 'skills').applyTo,
    'skills/**,.github/skills/**',
  );
});

test('every canonical instruction carries a non-empty description', () => {
  const manifest = loadManifest(REPO_ROOT);
  const records = validateInstructionIntegrity(REPO_ROOT, manifest);

  // A blank description renders as an empty cell in the consumer's instruction index, leaving the
  // filename as the only retrieval signal. Assert on the parsed value rather than on the file text
  // so this fails if the frontmatter parser ever stops reading the field.
  for (const record of records) {
    assert.equal(typeof record.description, 'string', `${record.name} description is not a string`);
    assert.ok(record.description.trim().length > 0, `${record.name} has a blank description`);
  }
});

test('a description may contain the quote character it is not delimited by', () => {
  const manifest = loadManifest(REPO_ROOT);
  const records = validateInstructionIntegrity(REPO_ROOT, manifest);

  // A description is a sentence of English, so an apostrophe is the ordinary case. The first parser
  // matched both quote characters against one class and rejected a valid double-quoted scalar
  // containing one. Guard it with real canon rather than a fixture: a regression makes validation
  // fail on the file itself, and asserting the parsed value here fails even if validation is relaxed
  // to a warning. The apostrophe below is load-bearing — this test is why it is there.
  const withApostrophe = records.filter((record) => record.description.includes("'"));
  assert.ok(
    withApostrophe.length > 0,
    'no canonical description exercises the apostrophe path; add one rather than deleting this test',
  );
  for (const record of withApostrophe) {
    assert.ok(
      record.text.includes(record.description),
      `${record.name} description was altered in parsing rather than read verbatim`,
    );
  }
});

// Rewrite rendered single-asterisk emphasis the way a markdown formatter does (`*x*` -> `_x_`),
// leaving code spans and fenced blocks alone because their asterisks are content: several pinned
// patterns assert literal globs such as `dist/**` and `skills/**,.github/skills/**`, and a
// character-class strip would destroy the thing being asserted rather than normalize it.
function reformatEmphasis(text) {
  return text
    .split(/(```[\s\S]*?```|`[^`\n]*`)/g)
    .map((part, i) => (i % 2 ? part : part.replace(/(^|[^*\w])\*([^*\n]+)\*(?![*\w])/g, '$1_$2_')))
    .join('');
}

test('no pinned pattern depends on the emphasis characters a formatter would rewrite', () => {
  // Prettier rewrites markdown emphasis from `*value*` to `_value_`. This validator pinned the
  // asterisk, so formatting canon made the check fail on a file that still stated the rule exactly
  // right — and that rule is the one nothing else in the org enforces. Copy the repo, apply the
  // rewrite a formatter would, and require the validator to still accept it. Asserting through
  // validateInstructionIntegrity rather than against a re-declared pattern, so this fails if the
  // requirement is dropped as well as if the emphasis tolerance is lost.
  //
  // The rewrite is deliberately corpus-wide rather than the single `*value*` span that motivated
  // it. A test built from one instance passes for every pattern that pins a *different* span, which
  // is the same defect wearing different words — and the corpus carries 276 emphasis spans, so
  // pinning one is the ordinary way these patterns get written, not a remote scenario. Measured
  // against a real span (`erases *absence*` … `erases *failure*`): the narrow rewrite leaves such a
  // pattern matching and reports success; this one fails it.
  //
  // The guarantee belongs one layer lower — normalizing markup out of the scanned text, as
  // jrmoulckers/finance does for its count claims — but that does not transfer here: stripping
  // [*`_] before matching breaks 7 of the 30 pinned patterns, because the ones pinning file names
  // and globs have markup as their content. Distinguishing the two needs a markdown parser, which
  // a test can afford and a scanner should not carry.
  const tmp = mkdtempSync(join(tmpdir(), 'canon-emphasis-'));
  try {
    cpSync(REPO_ROOT, tmp, {
      recursive: true,
      filter: (src) => !src.includes(`${sep}.git${sep}`) && !src.endsWith(`${sep}.git`),
    });

    const dir = join(tmp, 'instructions');
    let rewritten = 0;
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.instructions.md'))) {
      const path = join(dir, file);
      const original = readFileSync(path, 'utf8');
      const reformatted = reformatEmphasis(original);
      if (reformatted === original) continue;
      writeFileSync(path, reformatted);
      rewritten += 1;
    }
    assert.ok(rewritten > 0, 'no file changed; the rewrite matched nothing and proves nothing');

    const manifest = loadManifest(tmp);
    const records = validateInstructionIntegrity(tmp, manifest);
    assert.ok(records.some((record) => record.name === 'tokens'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

function reflowProse(text, width = 44) {
  // Mimics what a prose-wrapping formatter does: rewrap running text, leave fenced code, tables and
  // frontmatter alone. Narrower than any real printWidth so a break lands inside essentially every
  // pinned phrase rather than the three that `prettier --prose-wrap always` happens to hit today.
  const out = [];
  let fenced = false;
  const lines = text.split('\n');
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*```/.test(line)) fenced = !fenced;
    const frontmatter = i < 6 && /^(---|applyTo:|description:)/.test(line);
    if (fenced || frontmatter || /^\s*```/.test(line) || /^\s*#/.test(line) || /^\s*\|/.test(line)) {
      out.push(line);
      continue;
    }
    const indent = line.match(/^[\s>*\-+]*/)[0];
    const body = line.slice(indent.length);
    if (!body.includes(' ') || indent.length >= width) {
      out.push(line);
      continue;
    }
    let current = indent;
    let first = true;
    for (const word of body.split(' ')) {
      if (!first && current.length + 1 + word.length > width) {
        out.push(current);
        current = ' '.repeat(indent.length) + word;
      } else {
        current = first ? current + word : `${current} ${word}`;
      }
      first = false;
    }
    out.push(current);
  }
  return out.join('\n');
}

test('no pinned pattern depends on where the corpus happens to be hard-wrapped', () => {
  // Every pinned pattern spells a phrase with literal spaces and used to be matched against raw
  // bytes, so each one silently depended on canon's line breaks never falling inside it. Measured
  // with `prettier --prose-wrap always`: 7 of 7 files reflow and 3 patterns then report guidance as
  // missing from text that still states the rule exactly.
  //
  // This was already known one instance at a time, which is why it is worth a corpus-wide guard.
  // Two `infrastructure-operations` patterns are hand-written `second\s+access\s+path` and
  // `canonical repository\s+state`, and both of those `\s+` sites sit on a real newline in the
  // source — the author hit the failure twice while authoring, patched the two phrases their own
  // wrap straddled, and left the rest resting on wrap positions holding still. A test built from
  // those three phrases would pass for every pattern that straddles a different break, so this one
  // reflows the whole corpus and asserts through validateInstructionIntegrity.
  const tmp = mkdtempSync(join(tmpdir(), 'canon-reflow-'));
  try {
    cpSync(REPO_ROOT, tmp, {
      recursive: true,
      filter: (src) => !src.includes(`${sep}.git${sep}`) && !src.endsWith(`${sep}.git`),
    });

    const dir = join(tmp, 'instructions');
    let rewritten = 0;
    for (const file of readdirSync(dir).filter((name) => name.endsWith('.instructions.md'))) {
      const path = join(dir, file);
      const original = readFileSync(path, 'utf8');
      const reflowed = reflowProse(original);
      if (reflowed === original) continue;
      writeFileSync(path, reflowed);
      rewritten += 1;
    }
    assert.ok(rewritten > 0, 'no file reflowed; the rewrite matched nothing and proves nothing');

    const manifest = loadManifest(tmp);
    const records = validateInstructionIntegrity(tmp, manifest);
    assert.ok(records.some((record) => record.name === 'workflow'));
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
});

test('workflow and documentation surfaces use immutable reusable workflow examples', () => {
  for (const relativePath of [
    'README.md',
    'principles/github/actions-and-delivery.md',
    'docs/sync.md',
    'sync/README.md',
    'sync/lib/pr.mjs',
    'instructions/workflow.instructions.md',
  ]) {
    const text = readFileSync(join(REPO_ROOT, ...relativePath.split('/')), 'utf8');
    assert.doesNotMatch(
      text,
      /uses:\s*jrmoulckers\/\.github\/\.github\/workflows\/[^\s`'"]+@(?!<reviewed-commit-sha>|[0-9a-f]{40}(?:\s|$))/i,
      relativePath,
    );
  }
  // A discovered population is silent when discovery returns nothing, and an empty loop
  // reports `pass`, not `skipped` — so it is indistinguishable from a real assertion.
  // Pin the population before iterating it.
  const reusable = readdirSync(join(REPO_ROOT, '.github', 'workflows')).filter((name) =>
    /^reusable-.*\.yml$/.test(name),
  );
  assert.ok(reusable.length > 0, 'no reusable workflows discovered — this check would assert nothing');
  for (const fileName of reusable) {
    const relativePath = `.github/workflows/${fileName}`;
    const text = readFileSync(join(REPO_ROOT, '.github', 'workflows', fileName), 'utf8');
    assert.doesNotMatch(
      text,
      /uses:\s*jrmoulckers\/\.github\/\.github\/workflows\/[^\s`'"]+@(?!<reviewed-commit-sha>|[0-9a-f]{40}(?:\s|$))/i,
      relativePath,
    );
  }
});

test('workflow guidance separates the two causes of a no-log run failure', () => {
  const text = readFileSync(
    join(REPO_ROOT, 'instructions', 'workflow.instructions.md'),
    'utf8',
  ).replace(/\r\n?/g, '\n');

  // The permissions trap alone is a trap: it trains the reader to search the workflow
  // file for a defect that, in the billing case, is not in the repository at all.
  assert.match(text, /startup_failure/);
  assert.match(text, /spending limit/i);

  // The discriminator is the load-bearing part. Documenting both causes without a way
  // to tell them apart leaves the reader exactly where they started.
  assert.match(text, /jobs you did not touch failed[\s\S]{0,200}check billing/i);

  // The observational check degenerates on a single-job workflow, and `--log-failed`
  // returns the same "log not found" for both causes. Pin the mechanical fallback and
  // the warning that the obvious command cannot substitute for it.
  assert.match(text, /check-runs\/[^\s`]*\/annotations/i);
  assert.match(text, /--log-failed[\s\S]{0,120}log not found/i);
});

test('all declared local agents remain disjoint from selected canon', () => {  const manifest = loadManifest(REPO_ROOT);
  // Without this the check passes when no member declares a local agent, which is also
  // what a manifest regression that drops `localAgents` looks like.
  assert.ok(
    manifest.members.some((member) => (member.localAgents ?? []).length > 0),
    'no member declares a local agent — this check would assert nothing',
  );
  for (const member of manifest.members) {
    const selected =
      member.optIn.agents === '*' ? manifest.canon.agents : Array.isArray(member.optIn.agents) ? member.optIn.agents : [];
    for (const localName of member.localAgents ?? []) {
      assert.ok(!selected.includes(localName), `${member.repo}: ${localName} collides with canon`);
    }
  }
});

// A citation of the form `### Name` asserts that Name is a *structural* element. Resolving it with a
// substring search confirms only that the characters occur somewhere, and returns the same answer
// whether the match is a heading, a bold lead-in, a table cell, or a line inside a fenced block --
// so the check that was meant to validate the scheme is blind to the way it fails. Canon carried a
// citation to `### Two Prettier API traps` for several revisions: the string was real, at the line
// reported, and was bold paragraph text that had never been a heading at any revision.
test('every heading citation in canon resolves to a real heading', () => {
  const files = [
    'docs/sync.md',
    'sync/README.md',
    'instructions/workflow.instructions.md',
    'AGENTS.md',
  ];

  let citations = 0;
  for (const relativePath of files) {
    const lines = readFileSync(join(REPO_ROOT, ...relativePath.split('/')), 'utf8')
      .replace(/\r\n/g, '\n')
      .split('\n');

    // Fence state must be tracked from line 0 in a single pass; starting mid-document inverts it.
    // Both the headings and the citations are collected under the same mask, or a citation quoted
    // inside an example block would be judged against a heading table that block never contributed to.
    const headings = new Set();
    const prose = [];
    let inFence = false;
    for (const line of lines) {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (inFence) continue;
      prose.push(line);
      const heading = line.match(/^(#{1,6})\s+(.+?)\s*$/);
      if (heading) headings.add(`${heading[1]} ${heading[2]}`);
    }

    // Detect citations at `###` and deeper only, and note that this is narrower than "every
    // citation" rather than equal to it. Writing the obvious `#{1,6}` produced two false positives
    // on the first run, both instructive: `# synced from ...` is a `.prettierignore` comment quoted
    // inline, so `#` is comment syntax rather than a heading marker; and `## Needs Human Action`
    // names a section the reader is told to *write*, not one to resolve. Backticked heading syntax
    // is therefore not the same predicate as "a citation" -- which is the same substring-for-structure
    // substitution this test exists to catch, reproduced inside the test on its first run.
    for (const match of prose.join('\n').matchAll(/`(#{3,6} [^`\n]+)`/g)) {
      citations += 1;
      assert.ok(
        headings.has(match[1]),
        `${relativePath}: cites \`${match[1]}\`, which is not a heading in that file`,
      );
    }
  }

  // The population must be pinned: zero citations would make every assertion above vacuous while
  // still reporting `pass`.
  assert.ok(citations > 0, 'no heading citations discovered — this check would assert nothing');
});

// Member-facing instructions must address code by name, not by position: a line number decays
// silently while the prose around it stays true, so the reader has no trigger to re-check. The
// motivating instance cited `copier.mjs:217-218` for `hashText(rendered)`, which had moved to 240.
//
// docs/ and sync/README.md are deliberately out of scope. Neither is in any canon kind, so they
// reach no member, and docs/sync.md is where the rule itself is argued -- it has to be able to quote
// the bad form as an example. That is the same hazard as canon quoting `studio:base:start` in prose
// while the marker check counts only the delimiter form.
//
// The detector below used to enumerate extensions -- `mjs|js|json|ya?ml` -- which gave the rule a
// durable half and a fragile half that decay independently. "Cite by name, not by position" stays
// true forever; the list of file types it can see rots every time canon delivers a new one. Measured
// against the delivery surface, the two had gone fully disjoint: 653 writes across `.md`,
// `.agent.md`, `.prompt.md`, `.instructions.md`, `.toml` and `.gitattributes`, and the detector
// could see *none* of them. A member-facing instruction citing `AGENTS.md:120` or `agency.toml:14`
// -- both delivered targets, and the likeliest things such a file would point at -- was invisible.
//
// The rule's expected count is zero, so nothing about that was observable: a detector that matches
// nothing and a corpus that contains nothing report the identical `pass`. The old control probed two
// `.mjs` citations, which demonstrates the pattern can return non-empty for the extensions it was
// born with and says nothing about the claim, which is about coordinate citations as such.
//
// So the extension is no longer enumerated, and the control's population is derived from the
// delivery surface rather than transcribed -- the same reasoning as the `requirePatterns` count
// check below. A future canon kind shipping `.kt` or `.swift` widens this control automatically.
test('member-facing instructions cite code by name, not by line number', () => {
  const dir = join(REPO_ROOT, 'instructions');
  const files = readdirSync(dir).filter((name) => name.endsWith('.instructions.md'));

  // A citation is a backticked path-like token followed by a line or line range. "Path-like" is
  // required to hold a letter and a `.` or `/`, which is what separates `AGENTS.md:120` from a
  // clock reading (`10:30`) or an image tag (`ubuntu:22`) without naming any file type.
  const COORDINATE = /`[A-Za-z0-9_./-]+:\d+(?:-\d+)?`/g;
  const citations = (text) =>
    (text.match(COORDINATE) ?? []).filter((hit) => {
      const token = hit.slice(1, hit.lastIndexOf(':'));
      return /[A-Za-z]/.test(token) && /[./]/.test(token);
    });

  // The expected count is zero, so the detector has to be shown capable of returning the other
  // answer. A pattern that matches nothing passes this test perfectly while checking nothing.
  //
  // The population is every extension canon actually delivers, read from the engine, so this cannot
  // silently narrow to the file types that happened to exist when it was written.
  const extensionOf = (targetPath) => {
    const base = targetPath.split('/').pop();
    return base.includes('.') ? base.slice(base.indexOf('.')) : base;
  };

  const writes = [];
  for (const member of resolveAll(loadManifest(REPO_ROOT))) {
    writes.push(...enumerateTargets(member, REPO_ROOT).writes);
  }
  assert.ok(writes.length > 0, 'no delivered writes discovered — this control would be vacuous');

  const delivered = new Set();
  for (const write of writes) delivered.add(extensionOf(write.targetPath));

  // A non-empty population is not a complete one. Emptying the set above trips the vacuity guard,
  // but *narrowing* it -- collecting one extension and dropping the rest -- leaves a set that still
  // probes successfully while covering less than it claims, and nothing observes the difference.
  // That is the same fragile half this test was rewritten to remove, one level up in its own
  // control, so the coverage relation is checked through an independent aggregation: every
  // extension every write-producing canon kind delivers must appear among the probes.
  //
  // It is a named function rather than an inline loop because an inline guard is only ever run
  // against a corpus that satisfies it, which is indistinguishable from no guard. Below it is
  // called on a deliberately narrowed probe set, so the failing direction is exercised too.
  const uncoveredKinds = (delivery, probes) => {
    const byKind = new Map();
    for (const write of delivery) {
      if (!byKind.has(write.kind)) byKind.set(write.kind, new Set());
      byKind.get(write.kind).add(extensionOf(write.targetPath));
    }
    if (byKind.size === 0) throw new Error('no write-producing kinds — this cross-check would be vacuous');
    const missing = [];
    for (const [kind, extensions] of byKind) {
      for (const extension of extensions) {
        if (!probes.has(extension)) missing.push(`${kind} delivers ${extension}`);
      }
    }
    return missing;
  };

  assert.deepEqual(
    uncoveredKinds(writes, delivered),
    [],
    'the probe population must cover every extension every canon kind delivers',
  );

  // The guard's failing state, constructed: a probe set narrowed to one extension must be reported
  // as uncovering the kinds it dropped, or the assertion above is decorative.
  const narrowed = uncoveredKinds(writes, new Set(['.toml']));
  assert.ok(
    narrowed.length > 0 && narrowed.some((entry) => entry.includes('.md')),
    `a narrowed probe set must be reported as uncovered, got: ${JSON.stringify(narrowed)}`,
  );

  for (const extension of delivered) {
    const probe = `see \`docs/example${extension}:120\` for the rule`;
    assert.deepEqual(
      citations(probe),
      [`\`docs/example${extension}:120\``],
      `a coordinate citing a delivered ${extension} target must be detectable`,
    );
  }

  // Both directions, so the filter above is pinned as a filter and not merely as a pass-through.
  assert.deepEqual(citations('at `10:30` we pulled `ubuntu:22`'), [], 'non-paths are not coordinates');
  assert.deepEqual(citations('see `copier.mjs:217-218` and `assets.mjs:131`'), [
    '`copier.mjs:217-218`',
    '`assets.mjs:131`',
  ]);

  assert.ok(files.length > 0, 'no instruction files discovered — this check would assert nothing');

  for (const name of files) {
    const lines = readFileSync(join(dir, name), 'utf8').replace(/\r\n/g, '\n').split('\n');

    // Fenced examples are excluded on the same reasoning as the heading-citation check above: a
    // block quoting a coordinate is showing one, not relying on one.
    let inFence = false;
    const prose = [];
    for (const line of lines) {
      if (/^\s*(```|~~~)/.test(line)) {
        inFence = !inFence;
        continue;
      }
      if (!inFence) prose.push(line);
    }

    const found = citations(prose.join('\n'));
    assert.deepEqual(
      found,
      [],
      `instructions/${name}: cites ${found.join(', ')} by line number; name the function or symbol instead`,
    );
  }
});

// The comment above `requirePatterns` argues from counts — how many pinned patterns a reflow
// breaks, how many markup-stripping breaks, how each candidate normalization scores. Those numbers
// were transcribed by hand twice and were wrong both times, in both digits, because the
// transcription silently omitted a whole file's worth of patterns. #643 corrected one figure and
// left its twin four lines above the paragraph announcing the correction.
//
// So the denominator is derived here rather than trusted there. Every count claim in that block is
// checked against the patterns actually present in the module, which means adding or removing a
// pattern fails this test until the prose it invalidated is updated. A note recording that a number
// was once wrong is not a check that it is now right.
test('the pattern counts cited above requirePatterns are derived, not transcribed', () => {
  const source = readFileSync(join(REPO_ROOT, 'sync', 'lib', 'instruction-integrity.mjs'), 'utf8');

  // Same extraction the measurements use: read the requirement tables out of the module instead of
  // re-declaring them, so this cannot drift from the list it describes.
  const table = source.slice(
    source.indexOf('function validateContent'),
    source.indexOf('function validateMemberSelections'),
  );
  const patterns = table
    .split('\n')
    .filter((line) => /^\s*\[\/.*\/[a-z]*, '[^']+'\],?\s*$/.test(line));

  assert.ok(patterns.length > 0, 'no pinned patterns extracted — this check would assert nothing');

  const block = source.slice(
    source.indexOf('// Every pattern below pins a phrase'),
    source.indexOf('function requirePatterns'),
  );
  assert.ok(block.length > 0, 'requirePatterns commentary not found — this check would assert nothing');

  // Historical figures are quoted ("6 of 21") precisely because they are wrong and are being
  // recorded as wrong. Drop quoted spans before scanning so the record of the defect does not
  // read as an instance of it.
  const live = block.replace(/"[^"]*"/g, '""');
  const claims = [...live.matchAll(/\b(\d+) of (?:the |these )?(\d+)\b/g)];

  assert.ok(claims.length > 0, 'no count claims found in the block — this check would assert nothing');

  for (const [text, numerator, denominator] of claims) {
    assert.equal(
      Number(denominator),
      patterns.length,
      `"${text}" counts against ${denominator} pinned patterns, but the module declares ${patterns.length}`,
    );
    assert.ok(
      Number(numerator) <= patterns.length,
      `"${text}" claims more patterns than the module declares (${patterns.length})`,
    );
  }
});


test('a hub-local canon surface states that it is undistributed, and the claim tracks the manifest', () => {
  const manifest = loadManifest(REPO_ROOT);
  const sourceDirs = new Set(Object.values(manifest.sourcePaths));

  // Guard the notice in both directions. The premise is that these kinds exist at all: an empty
  // sourcePaths would make the "not distributed" half vacuously true and the test would pass
  // without reading anything.
  assert.ok(sourceDirs.size >= 2, 'sourcePaths must be populated for this test to mean anything');

  const HUB_LOCAL_NOTICE = 'Hub-local: this file is never distributed.';
  const distributed = sourceDirs.has('docs') || sourceDirs.has('./docs');
  const text = readFileSync(join(REPO_ROOT, 'docs', 'sync.md'), 'utf8');

  if (distributed) {
    assert.ok(
      !text.includes(HUB_LOCAL_NOTICE),
      'docs/ became a source path, so docs/sync.md must stop claiming it is undistributed',
    );
  } else {
    assert.ok(
      text.includes(HUB_LOCAL_NOTICE),
      'docs/ is not a source path, so docs/sync.md must say so where a rule would be written',
    );
  }
});