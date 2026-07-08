// AGENTS.md managed-region merge.
//
// Product repos keep their own extending AGENTS.md. The studio base guide is injected
// as a marked, tool-managed region; everything outside the markers is product-local and
// is never touched. On each sync only the region between the markers is replaced.
//
//   <!-- studio:base:start -->
//   …canonical AGENTS.md (with provenance)…
//   <!-- studio:base:end -->

import { toLF } from './provenance.mjs';

export const START_MARKER = '<!-- studio:base:start -->';
export const END_MARKER = '<!-- studio:base:end -->';

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const BLOCK_RE = new RegExp(
  `${escapeRe(START_MARKER)}\\n?([\\s\\S]*?)\\n?${escapeRe(END_MARKER)}`,
);

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
  const match = BLOCK_RE.exec(toLF(fileContent));
  if (!match) return null;
  return canonicalizeInner(match[1]);
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

  if (BLOCK_RE.test(existing)) {
    return `${existing.replace(BLOCK_RE, block)}\n`.replace(/\n+$/, '\n');
  }
  if (existing.trim() === '') {
    return `${block}\n`;
  }
  return `${existing.replace(/\n+$/, '')}\n\n${block}\n`;
}
