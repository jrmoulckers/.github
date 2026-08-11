// Provenance injector. Every synced file carries a header noting it is canonical
// and must not be edited in the member repo. The comment syntax is not enumerated here: it is
// classified by `comment-syntax.mjs`, which is also what `basemerge.mjs` uses to pick managed-
// region markers. The two used to keep separate tables and drifted eight types apart, with
// `basemerge` claiming hash syntax for files this module was stamping with HTML.
//
// Given a family, the header form is:
//   hash  -> leading '#' comment line
//   block -> leading '/* … */' comment
//   none  -> passthrough, no header (a comment would corrupt the parse)
//   html  -> '<!-- … -->', placed immediately AFTER the closing '---' when the file has YAML
//            frontmatter, and at the very top when it does not
//
// There is no fallback for an unclassified type; `commentSyntaxFor` throws. It used to default
// to HTML, which is right for Markdown and silently wrong for anything with a real grammar — a
// source file landing there was given `<!-- … -->` and stopped compiling. The remedy stated here
// was that a new extension "must be classified", but that obligation bound whoever added a file
// type in a *distribution* repo, and no run in either repo could check it. A throw is checked by
// this repo's own test run, at the moment the unclassified file first appears.
//
// The default note marks backbone canon (jrmoulckers/.github). Vendored assets sourced from a
// different repo (e.g. @jrm/tokens from jrmoulckers/studio) pass their own `note` so the header
// points at the true origin.
//
// All content is normalized to LF first so the rendered output (and therefore the
// stored hashes) are deterministic regardless of the checkout's line-endings.
//
// The note deliberately carries NO revision. It is inside `targetSha256` (which hashes the
// injected rendering) while `sourceSha256` hashes raw canon, so a revision here changes every
// file's rendering whenever that revision moves. Stamping canon HEAD would rewrite every synced
// file on every run and destroy the reviewability of the sync PR without failing anything.
//
// A per-file last-modifying commit avoids that churn, but is still not safe on its own:
// `attachCanonHistory` reconstructs prior engine output by injecting *this* note into historical
// raw blobs, and blobs carry no commit identity. Any revision-valued note makes files synced under
// an older value unrecognizable, and they are then reported as member drift — a file the member
// never touched. See "A revision in the provenance header is inside the target hash" in
// docs/sync.md before changing this.

import { commentSyntaxFor } from './comment-syntax.mjs';

export const PROVENANCE_NOTE =
  'synced from jrmoulckers/.github — canonical source; do not edit here';

/** Normalize CRLF/CR to LF. */
export function toLF(text) {
  return text.replace(/\r\n?/g, '\n');
}

/**
 * Inject the provenance header into `rawContent` based on `filePath`'s type.
 * Input is normalized to LF; the returned string uses LF throughout.
 * @param {string} filePath  target path (used only to classify the file type)
 * @param {string} rawContent
 * @param {{ note?: string }} [opts]  override the provenance note (e.g. for vendored tokens)
 */
export function inject(filePath, rawContent, opts = {}) {
  const content = toLF(rawContent);
  const note = opts.note ?? PROVENANCE_NOTE;
  const syntax = commentSyntaxFor(filePath);

  // Source maps / JSON can't hold a leading comment without breaking parsers. They are still
  // LF-normalized (so hashing stays stable) but ship without a header.
  if (syntax === 'none') return content;
  if (syntax === 'hash') return `# ${note}\n${content}`;
  if (syntax === 'block') return `/* ${note} */\n${content}`;

  const htmlComment = `<!-- ${note} -->`;
  if (hasFrontmatter(content)) {
    return injectAfterFrontmatter(content, htmlComment);
  }
  return `${htmlComment}\n\n${content}`;
}

/**
 * The one predicate for a frontmatter delimiter line: `---` at column 0, optionally followed by
 * trailing spaces or tabs. `hasFrontmatter` and `injectAfterFrontmatter` must agree exactly — when
 * the second is more permissive than the first, the guard's promise no longer constrains it.
 */
const DELIMITER_RE = /^---[ \t]*$/;

/** True when the content opens with a YAML frontmatter block (`---` ... `---`). */
export function hasFrontmatter(content) {
  const lf = toLF(content);
  if (!lf.startsWith('---\n')) return false;
  return lf.slice(4).split('\n').some((line) => DELIMITER_RE.test(line));
}

function injectAfterFrontmatter(content, htmlComment) {
  const lines = toLF(content).split('\n');
  // lines[0] === '---'. Find the next delimiter line, using the same predicate as the guard.
  // An indented `---` is NOT one: it is ordinary text, and a markdown horizontal rule inside a
  // YAML block scalar is the common case. Splicing there would put the stamp inside the
  // frontmatter — still valid YAML, so nothing would error, and the stamp would silently become
  // part of a value instead of provenance.
  for (let i = 1; i < lines.length; i++) {
    if (DELIMITER_RE.test(lines[i])) {
      lines.splice(i + 1, 0, htmlComment);
      return lines.join('\n');
    }
  }
  // Unreachable: hasFrontmatter has already found a delimiter under the same predicate.
  return `${htmlComment}\n\n${content}`;
}
