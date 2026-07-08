// Provenance injector. Every synced file carries a header noting it is canonical
// and must not be edited in the member repo. The comment syntax depends on the
// file type:
//   - Markdown WITH YAML frontmatter -> HTML comment immediately AFTER the closing '---'
//   - Plain Markdown                  -> HTML comment at the very top
//   - .toml / .yml / .yaml            -> leading '#' comment line
//
// All content is normalized to LF first so the rendered output (and therefore the
// stored hashes) are deterministic regardless of the checkout's line-endings.

export const PROVENANCE_NOTE =
  'synced from jrmoulckers/.github — canonical source; do not edit here';

const HTML_COMMENT = `<!-- ${PROVENANCE_NOTE} -->`;
const HASH_COMMENT = `# ${PROVENANCE_NOTE}`;

/** Normalize CRLF/CR to LF. */
export function toLF(text) {
  return text.replace(/\r\n?/g, '\n');
}

function extname(filePath) {
  const base = filePath.split(/[\\/]/).pop() || '';
  const dot = base.lastIndexOf('.');
  return dot >= 0 ? base.slice(dot).toLowerCase() : '';
}

/**
 * Inject the provenance header into `rawContent` based on `filePath`'s type.
 * Input is normalized to LF; the returned string uses LF throughout.
 */
export function inject(filePath, rawContent) {
  const content = toLF(rawContent);
  const ext = extname(filePath);

  if (ext === '.toml' || ext === '.yml' || ext === '.yaml') {
    return `${HASH_COMMENT}\n${content}`;
  }

  // Markdown (and any other text): use HTML comments.
  if (hasFrontmatter(content)) {
    return injectAfterFrontmatter(content);
  }
  return `${HTML_COMMENT}\n\n${content}`;
}

/** True when the content opens with a YAML frontmatter block (`---` ... `---`). */
export function hasFrontmatter(content) {
  const lf = toLF(content);
  if (!lf.startsWith('---\n')) return false;
  return /\n---[ \t]*(\n|$)/.test(lf.slice(3));
}

function injectAfterFrontmatter(content) {
  const lines = content.split('\n');
  // lines[0] === '---'. Find the next line that is exactly '---'.
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      lines.splice(i + 1, 0, HTML_COMMENT);
      return lines.join('\n');
    }
  }
  // No closing delimiter found (shouldn't happen given hasFrontmatter); fall back.
  return `${HTML_COMMENT}\n\n${content}`;
}
