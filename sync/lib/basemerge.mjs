// Managed-region merge.
//
// Product repos keep their own extending file. The canonical content is injected as a marked,
// tool-managed region; everything outside the markers is product-local and is never touched.
// On each sync only the region between the markers is replaced.
//
//   <!-- studio:base:start -->
//   …canonical AGENTS.md (with provenance)…
//   <!-- studio:base:end -->
//
// The marker identifier is `studio:base` for every managed target, not just the `base` kind: it
// names "the studio-managed region", and `copilot` has always shared it. Only the *comment
// syntax* varies, because a marker has to be a comment in the file it lives in. Markdown targets
// use HTML comments; `.gitattributes` has no HTML comment form, so it uses `#` lines — an
// `<!-- … -->` marker there would be read as a pattern rule, not ignored.
//
// **Placement varies with the format too, and for the same reason.** Where the canonical region
// goes in a file the member already had is not a style choice; it decides which rule wins:
//
//   - Markdown (`AGENTS.md`, `copilot-instructions.md`) — canon is *appended*. Product-local
//     preamble stays on top where a human reads it first, and Markdown has no precedence order.
//   - `.gitattributes` — canon is *prepended*. Git resolves attributes by LAST matching pattern,
//     and the canonical stanza's `*` matches every path. Appended, it would silently reorder every
//     more-specific member rule beneath itself: LFS entries, `linguist-generated`, `binary`,
//     `-diff` on generated files, lockfile rules. Prepending makes canon a *baseline* the member
//     can override, which is the only sane reading of a generic `*` rule.
//
// This is not special-casing by kind; both facts follow from the target's format, so they are
// declared together on the same `MARKERS` entry and resolved by the same `markersFor()` lookup.
// Keeping them in one place is deliberate: a second table keyed independently could drift out of
// step with the first, and the failure would be silent in exactly the way this comment describes.
// See ADR-0011.
//
// Marker detection is deliberately strict. A marker only counts when it stands alone at the
// start of its own line, *outside* any fenced code block, so a file that documents this
// very convention — by quoting the markers inline, indenting them as a code block, or showing
// them in a ``` example — cannot form a phantom managed region. Getting this wrong is silent and
// severe: the phantom block's contents hash as unrecognized drift, the file is skipped, and the
// member never receives the canonical content while the run still reports success.

import { toLF } from './provenance.mjs';
import { commentSyntaxFor } from './comment-syntax.mjs';

export const START_MARKER = '<!-- studio:base:start -->';
export const END_MARKER = '<!-- studio:base:end -->';

/**
 * Comment syntax and placement used for the managed region in a given target file.
 *
 * `placement` says where the region goes when the member's file exists but has no markers yet:
 * `'append'` keeps product-local text on top, `'prepend'` puts canon first so member rules can
 * override it. It rides on the same entry as the marker syntax because both are consequences of
 * the target's format — see the header comment.
 */
export const MARKERS = {
  html: { start: START_MARKER, end: END_MARKER, placement: 'append' },
  hash: { start: '# studio:base:start', end: '# studio:base:end', placement: 'prepend' },
};

/**
 * Pick the marker syntax for a target path. The path is required and the type must be known: a
 * default resolves to HTML, which is correct for every target except the ones that matter and
 * fails silently there.
 *
 * The classification is NOT enumerated here. It is the same question `provenance.mjs` asks when
 * choosing a header syntax, and while the two tables were maintained separately they drifted by
 * eight types — this module claiming hash syntax for files the stamper was corrupting with HTML.
 * Both consumers now derive from `comment-syntax.mjs`, so the pair cannot disagree.
 *
 * Managed regions need a marker *pair*, so only 'hash' and 'html' are usable here. 'block' and
 * 'none' are real classifications that this caller cannot serve, and they throw rather than
 * degrade: a `/*` file has no line-comment form to close a region with, and an unstampable file
 * has none at all.
 */
export function markersFor(targetPath) {
  const syntax = commentSyntaxFor(targetPath);
  if (syntax === 'hash') return MARKERS.hash;
  if (syntax === 'html') return MARKERS.html;

  throw new TypeError(
    `markersFor(${targetPath}): '${syntax}' syntax has no managed-region marker form. ` +
      `Managed regions are supported for hash- and HTML-comment files only.`,
  );
}

/**
 * Marker sets are passed explicitly rather than defaulted. A default that suits most targets and
 * is wrong for one hands the wrong caller an empty region instead of an error.
 */
function requireMarkers(markers, fnName) {
  if (!markers || typeof markers.start !== 'string' || typeof markers.end !== 'string') {
    throw new TypeError(`${fnName} requires an explicit marker set, e.g. markersFor(targetPath)`);
  }
  return markers;
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Leading whitespace is NOT tolerated: `buildFile` always writes the markers at column 0, and any
// indentation means the line is quoted content — most often a 4-space-indented code block, which
// `maskFences` does not cover because it only understands ``` / ~~~ fences. Requiring column 0
// closes that case exactly. Trailing whitespace is tolerated; editors add it and it means nothing.
function blockRe(markers) {
  return new RegExp(
    `^${escapeRe(markers.start)}[ \\t]*$\\n?([\\s\\S]*?)\\n?^${escapeRe(markers.end)}[ \\t]*$`,
    'dm',
  );
}

const FENCE_RE = /^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:^[ \t]*\1[^\n]*$|$)/gm;

/**
 * Blank out fenced code blocks, preserving every offset and newline, so marker matching
 * ignores documentation examples while match indices still address the original text.
 */
function maskFences(text) {
  return text.replace(FENCE_RE, (block) => block.replace(/[^\n]/g, ' '));
}

/**
 * Locate the managed region in already-LF-normalized text.
 * @returns {{ start: number, end: number, inner: string } | null}
 */
function findBlock(lfText, markers) {
  const match = blockRe(requireMarkers(markers, 'findBlock(text, markers)')).exec(maskFences(lfText));
  if (!match) return null;
  const [innerStart, innerEnd] = match.indices[1];
  return {
    start: match.index,
    end: match.index + match[0].length,
    inner: lfText.slice(innerStart, innerEnd),
  };
}

/** Trailing-whitespace normalization applied consistently on build and extract. */
export function canonicalizeInner(inner) {
  return toLF(inner).replace(/\s+$/, '');
}

/**
 * Extract the inner content of the managed block, or `null` when the file has no
 * managed region yet. The returned value is canonicalized to match what `buildFile`
 * would have written, so it can be hashed/compared directly.
 */
export function extractBlock(fileContent, markers) {
  const found = findBlock(toLF(fileContent), requireMarkers(markers, 'extractBlock(content, markers)'));
  return found ? canonicalizeInner(found.inner) : null;
}

function renderBlock(inner, markers) {
  return `${markers.start}\n${canonicalizeInner(inner)}\n${markers.end}`;
}

/**
 * Return new file content with the managed block set to `inner`.
 *   - existing content with markers -> replace the region in place
 *   - empty/whitespace-only content -> the block becomes the whole file
 *   - other content without markers -> insert the block per `markers.placement`, preserving
 *     product-local text: appended for Markdown, prepended for `.gitattributes` (where a later
 *     matching line wins, so canon must come first to remain overridable)
 *
 * In-place replacement deliberately does NOT relocate a region that already exists. A member whose
 * block sits in the wrong position keeps it until a human moves it: silently reordering rules in a
 * file the member owns is the very failure this placement logic exists to prevent, and doing it
 * unasked would be worse than the original defect.
 *
 * Read that guarantee the other way before merging an old sync branch: a region that lands in the
 * wrong position stays there permanently, and no later sync repairs it. For `.gitattributes` that
 * silently downgrades every member rule the canonical `*` outranks. Branches generated before
 * jrmoulckers/.github#125 append the region instead of prepending it, so merging one is not merely
 * stale — it is unrecoverable without a human edit. Regenerate such a branch rather than merging it.
 */
export function buildFile(existingContent, inner, markers) {
  requireMarkers(markers, 'buildFile(existing, inner, markers)');
  const block = renderBlock(inner, markers);
  const existing = toLF(existingContent ?? '');

  const found = findBlock(existing, markers);
  if (found) {
    const replaced = existing.slice(0, found.start) + block + existing.slice(found.end);
    return `${replaced}\n`.replace(/\n+$/, '\n');
  }
  if (existing.trim() === '') {
    return `${block}\n`;
  }
  if (markers.placement === 'prepend') {
    return `${block}\n\n${existing.replace(/^\n+/, '').replace(/\n+$/, '')}\n`;
  }
  return `${existing.replace(/\n+$/, '')}\n\n${block}\n`;
}

