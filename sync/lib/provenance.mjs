// Provenance injector. Every synced file carries a header noting it is canonical
// and must not be edited in the member repo. The comment syntax depends on the
// file type:
//   - Markdown WITH YAML frontmatter -> HTML comment immediately AFTER the closing '---'
//   - Plain Markdown                  -> HTML comment at the very top
//   - .toml / .yml / .yaml            -> leading '#' comment line
//   - .gitattributes / .gitignore     -> leading '#' comment line (no HTML comment form; an
//                                        '<!-- … -->' line there would be read as a pattern)
//   - .css / .js / .cjs / .mjs / .ts  -> leading '/* … */' block comment
//   - uncommentable text (.json/.map) -> passthrough, no header (a comment would corrupt it)
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

/** Extensions that use C-style block comments. */
const BLOCK_COMMENT_EXTS = new Set(['.css', '.js', '.cjs', '.mjs', '.ts', '.cts', '.mts']);

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

/** True when the content opens with a YAML frontmatter block (`---` ... `---`). */
export function hasFrontmatter(content) {
  const lf = toLF(content);
  if (!lf.startsWith('---\n')) return false;
  return /\n---[ \t]*(\n|$)/.test(lf.slice(3));
}

function injectAfterFrontmatter(content, htmlComment) {
  const lines = content.split('\n');
  // lines[0] === '---'. Find the next line that is exactly '---'.
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      lines.splice(i + 1, 0, htmlComment);
      return lines.join('\n');
    }
  }
  // No closing delimiter found (shouldn't happen given hasFrontmatter); fall back.
  return `${htmlComment}\n\n${content}`;
}
