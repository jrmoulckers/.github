// AGENTS.md managed-region merge.
//
// Product repos keep their own extending AGENTS.md. The studio base guide is injected
// as a marked, tool-managed region; everything outside the markers is product-local and
// is never touched. On each sync only the region between the markers is replaced.
//
//   <!-- studio:base:start -->
//   …canonical AGENTS.md (with provenance)…
//   <!-- studio:base:end -->
//
// Marker detection is deliberately strict. A marker only counts when it stands alone at the
// start of its own line, *outside* any fenced code block, so an AGENTS.md that documents this
// very convention — by quoting the markers inline, indenting them as a code block, or showing
// them in a ``` example — cannot form a phantom managed region. Getting this wrong is silent and
// severe: the phantom block's contents hash as unrecognized drift, AGENTS.md is skipped, and the
// member never receives the canonical base guide while the run still reports success.

import { toLF } from './provenance.mjs';

export const START_MARKER = '<!-- studio:base:start -->';
export const END_MARKER = '<!-- studio:base:end -->';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// Leading whitespace is NOT tolerated: `buildFile` always writes the markers at column 0, and any
// indentation means the line is quoted content — most often a 4-space-indented code block, which
// `maskFences` does not cover because it only understands ``` / ~~~ fences. Requiring column 0
// closes that case exactly. Trailing whitespace is tolerated; editors add it and it means nothing.
const BLOCK_RE = new RegExp(
  `^${escapeRe(START_MARKER)}[ \\t]*$\\n?([\\s\\S]*?)\\n?^${escapeRe(END_MARKER)}[ \\t]*$`,
  'dm',
);

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
function findBlock(lfText) {
  const match = BLOCK_RE.exec(maskFences(lfText));
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
export function extractBlock(fileContent) {
  const found = findBlock(toLF(fileContent));
  return found ? canonicalizeInner(found.inner) : null;
}

function renderBlock(inner) {
  return `${START_MARKER}\n${canonicalizeInner(inner)}\n${END_MARKER}`;
}

/**
 * Return new file content with the managed block set to `inner`.
 *   - existing content with markers -> replace the region in place
 *   - empty/whitespace-only content -> the block becomes the whole file
 *   - other content without markers -> append the block, preserving product-local text
 */
export function buildFile(existingContent, inner) {
  const block = renderBlock(inner);
  const existing = toLF(existingContent ?? '');

  const found = findBlock(existing);
  if (found) {
    const replaced = existing.slice(0, found.start) + block + existing.slice(found.end);
    return `${replaced}\n`.replace(/\n+$/, '\n');
  }
  if (existing.trim() === '') {
    return `${block}\n`;
  }
  return `${existing.replace(/\n+$/, '')}\n\n${block}\n`;
}

