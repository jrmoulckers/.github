// Single source of truth for "what comment syntax does this file type use?".
//
// This lived in two places — `basemerge.mjs` (which syntax do managed-region markers use?) and
// `provenance.mjs` (which syntax does the provenance header use?) — each with its own table.
// They are the same question asked by two callers, so two tables is one predicate re-derived,
// and the copies drifted: after `markersFor` was tightened to derive-or-throw, `basemerge`
// claimed hash syntax for eight types `provenance` still handed to an HTML fallback. One table
// being repaired is what made the pair inconsistent; both being wrong together had been
// survivable because a reader comparing them found agreement.
//
// Families, and why a file belongs to one:
//   hash  '# …'      — the file's grammar treats '#' as a comment. Also the dotfiles with no
//                      extension, matched by basename: an '<!-- … -->' line in `.gitattributes`
//                      is not a comment but a pattern git tries to match.
//   html  '<!-- … -->'
//   block '/* … */'  — C-style. `.kt`/`.kts`/`.swift` are here because `@jrm/tokens` ships a
//                      native distribution vendored into multi-platform members; an HTML comment
//                      there does not compile.
//   none              — the content cannot carry a leading comment at all (`.json`, `.map`):
//                      any header corrupts the parse, so the file ships unstamped.
//
// There is no fallback. An unknown type throws, because the two plausible defaults are both
// wrong in the direction that does not announce itself: HTML is right for prose and silently
// destroys anything with a real grammar, and 'none' silently drops provenance. A throw fires in
// this repo's own test run the first time an unclassified type arrives; the obligation it
// replaces ("a new extension must be classified here", stated in prose) fired in nobody's run,
// and typically in a different repo than the one that added the type.

import { createHash } from 'node:crypto';

/** Whole file names — dotfiles with no extension, so matched by basename, not suffix. */
const HASH_BASENAMES = new Set([
  '.gitattributes',
  '.gitignore',
  '.gitmodules',
  '.editorconfig',
  '.npmrc',
  '.dockerignore',
  '.prettierignore',
]);

const HASH_EXTENSIONS = new Set(['.toml', '.yml', '.yaml', '.sh', '.properties', '.conf']);
const HTML_EXTENSIONS = new Set(['.md', '.markdown', '.html']);
const BLOCK_EXTENSIONS = new Set([
  '.css',
  '.js',
  '.cjs',
  '.mjs',
  '.ts',
  '.cts',
  '.mts',
  '.kt',
  '.kts',
  '.swift',
]);
const NO_COMMENT_EXTENSIONS = new Set(['.json', '.map']);

/**
 * Split a target path into its lowercased basename and extension.
 *
 * Both are lowercased. Lowercasing only the extension would resolve `README.MD` while throwing
 * on `.GITATTRIBUTES`, an asymmetry with no justification on a case-insensitive filesystem.
 */
function parts(targetPath) {
  const base = (targetPath.split(/[\\/]/).pop() ?? '').toLowerCase();
  const dot = base.lastIndexOf('.');
  return { base, ext: dot > 0 ? base.slice(dot) : '' };
}

/**
 * Classify a target path into a comment-syntax family: 'hash' | 'html' | 'block' | 'none'.
 *
 * Throws on an unknown type rather than defaulting. Callers that support only some families are
 * expected to reject the rest themselves — `commentSyntaxFor` answers what the file *is*, not
 * what a given caller can do with it.
 */
export function commentSyntaxFor(targetPath) {
  if (typeof targetPath !== 'string' || targetPath === '') {
    throw new TypeError('commentSyntaxFor(targetPath) requires a non-empty target path');
  }
  const { base, ext } = parts(targetPath);

  if (HASH_BASENAMES.has(base) || HASH_EXTENSIONS.has(ext)) return 'hash';
  if (HTML_EXTENSIONS.has(ext)) return 'html';
  if (BLOCK_EXTENSIONS.has(ext)) return 'block';
  if (NO_COMMENT_EXTENSIONS.has(ext)) return 'none';

  throw new TypeError(
    `commentSyntaxFor(${targetPath}): unknown comment syntax. Add the type to ` +
      `sync/lib/comment-syntax.mjs. There is no default: HTML would be prepended to a file ` +
      `with a real grammar and stop it compiling, and skipping the header would drop provenance.`,
  );
}

/** The families, exported so tests can enumerate them rather than restating the list. */
export const SYNTAX_FAMILIES = Object.freeze(['hash', 'html', 'block', 'none']);

/**
 * Every classified name and extension, exported so a test can assert the two consumers agree on
 * the whole population rather than on a sample.
 */
export const CLASSIFIED_TYPES = Object.freeze([
  ...HASH_BASENAMES,
  ...HASH_EXTENSIONS,
  ...HTML_EXTENSIONS,
  ...BLOCK_EXTENSIONS,
  ...NO_COMMENT_EXTENSIONS,
]);

/**
 * A digest of the whole classification, published in each member's lockfile.
 *
 * A member that validates sync output has to re-derive this table to know which marker syntax to
 * look for, and nothing otherwise tells it when the table moves. A stale member copy and a wrong
 * file are indistinguishable from the member side — both surface as "canonical provenance marker
 * is missing" against content the engine wrote correctly — and only the first is actionable by the
 * member. Publishing the digest lets it say *your classifier is stale* instead.
 *
 * It covers the family assignment and not merely the type list, because moving `.conf` from hash
 * to block drifts a consumer exactly as much as dropping it, and a set-membership digest is blind
 * to that. Rows are sorted so the value depends on the classification and not on declaration
 * order.
 */
export function classifierDigest() {
  const rows = [
    ...[...HASH_BASENAMES].map((name) => `basename\t${name}\thash`),
    ...[...HASH_EXTENSIONS].map((ext) => `ext\t${ext}\thash`),
    ...[...HTML_EXTENSIONS].map((ext) => `ext\t${ext}\thtml`),
    ...[...BLOCK_EXTENSIONS].map((ext) => `ext\t${ext}\tblock`),
    ...[...NO_COMMENT_EXTENSIONS].map((ext) => `ext\t${ext}\tnone`),
  ].sort();
  return createHash('sha256').update(rows.join('\n')).digest('hex');
}
