// Provenance injector. Every synced file carries a header noting it is canonical
// and must not be edited in the member repo. The comment syntax depends on the
// file type:
//   - Markdown WITH YAML frontmatter -> HTML comment immediately AFTER the closing '---'
//   - Plain Markdown                  -> HTML comment at the very top
//   - .toml / .yml / .yaml            -> leading '#' comment line
//   - .gitattributes / .gitignore     -> leading '#' comment line (no HTML comment form; an
//                                        '<!-- … -->' line there would be read as a pattern)
//   - .css / .js / .cjs / .mjs / .ts  -> leading '/* … */' block comment
//   - .kt / .kts / .swift             -> leading '/* … */' block comment (the @jrm/tokens native
//                                        distribution; an HTML comment would not compile)
//   - uncommentable text (.json/.map) -> passthrough, no header (a comment would corrupt it)
//   - anything else                   -> HTML comment (Markdown and other prose)
//
// The fallback is HTML, which is right for Markdown and wrong — often *silently* wrong — for
// anything with a real grammar. A source file that lands in the fallback gets `<!-- … -->`
// prepended and stops compiling, so a new binary-ish or source-ish extension arriving in a
// distribution must be classified here. See `provenance.test.mjs`.
//
// The default note marks backbone canon (jrmoulckers/.github). Vendored assets sourced from a
// different repo (e.g. @jrm/tokens from jrmoulckers/studio) pass their own `note` so the header
// points at the true origin.
//
// All content is normalized to LF first so the rendered output (and therefore the
// stored hashes) are deterministic regardless of the checkout's line-endings.

export const PROVENANCE_NOTE =
  'synced from jrmoulckers/.github — canonical source; do not edit here';

/** Extensions whose content cannot carry a leading comment without corruption. */
const UNCOMMENTABLE = new Set(['.json', '.map']);

/**
 * Extensions that use C-style block comments.
 *
 * `.kt`/`.kts`/`.swift` are here because `@jrm/tokens` ships a native distribution
 * (`native/compose/JrmTokens.kt`, `native/swift/JRMTokens.swift`) that is vendored into
 * multi-platform members alongside the web artifacts. Without them these files fall through to the
 * Markdown fallback and are written with a leading `<!-- … -->`, which is not a comment in either
 * language — the vendored tokens simply fail to compile.
 */
const BLOCK_COMMENT_EXTS = new Set([
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

/** Extensions that use a leading '#' comment line. */
const HASH_COMMENT_EXTS = new Set(['.toml', '.yml', '.yaml']);

/**
 * Whole file names that use a leading '#' comment line. These are dotfiles with no extension,
 * so they are matched by basename rather than by suffix.
 */
const HASH_COMMENT_NAMES = new Set(['.gitattributes', '.gitignore']);

function basename(filePath) {
  return filePath.split(/[\\/]/).pop() || '';
}

/** Normalize CRLF/CR to LF. */
export function toLF(text) {
  return text.replace(/\r\n?/g, '\n');
}

function extname(filePath) {
  const base = basename(filePath);
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot).toLowerCase() : '';
}

/**
 * Inject the provenance header into `rawContent` based on `filePath`'s type.
 * Input is normalized to LF; the returned string uses LF throughout.
 * @param {string} filePath  target path (used only for its extension)
 * @param {string} rawContent
 * @param {{ note?: string }} [opts]  override the provenance note (e.g. for vendored tokens)
 */
export function inject(filePath, rawContent, opts = {}) {
  const content = toLF(rawContent);
  const note = opts.note ?? PROVENANCE_NOTE;
  const ext = extname(filePath);

  // Source maps / JSON can't hold a leading comment without breaking parsers. They are still
  // LF-normalized (so hashing stays stable) but ship without a header.
  if (UNCOMMENTABLE.has(ext)) return content;

  if (HASH_COMMENT_EXTS.has(ext) || HASH_COMMENT_NAMES.has(basename(filePath))) {
    return `# ${note}\n${content}`;
  }
  if (BLOCK_COMMENT_EXTS.has(ext)) {
    return `/* ${note} */\n${content}`;
  }

  // Markdown (and any other text): use HTML comments.
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
