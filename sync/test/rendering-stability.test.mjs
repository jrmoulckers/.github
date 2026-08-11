import test from 'node:test';
import assert from 'node:assert/strict';

import { inject } from '../lib/provenance.mjs';
import { CLASSIFIED_TYPES, commentSyntaxFor } from '../lib/comment-syntax.mjs';

/**
 * `inject` is a hashed interface, not a formatter.
 *
 * Recovery of an unrecorded target reconstructs past engine output by rendering *historical raw
 * canon through the current renderer* (`attachCanonHistory` in lib/assets.mjs), then comparing
 * hashes. So the rendered form of every type is an input to recognition, and changing it is a
 * compatibility break against every file any member was stamped with before the change — those
 * bytes become unreproducible, recovery misses, and the member is reported as having modified a
 * file it never touched.
 *
 * This has already happened twice, both times by someone editing comment syntax with no reason to
 * think they were touching recovery:
 *
 *   31b5271  .kt/.swift   `<!-- -->` -> block comments
 *   e4e8f23  .editorconfig .npmrc .dockerignore .prettierignore .gitmodules .sh
 *                          `<!-- -->` -> `#`   (the HTML-fallback fix, #339)
 *
 * The pin below is deliberately dumb: it states the rendered first line for one sample of every
 * classified type. A change that is merely cosmetic still fails it, because from recovery's point
 * of view there is no such thing as a cosmetic change here. If you are changing a rendering on
 * purpose, updating this table is not the whole task — see the header of #460 for what a member
 * holding the old bytes needs before the change can land safely.
 */

/** One representative target per classified type, and the exact first line `inject` must emit. */
const RENDERED_FIRST_LINE = Object.freeze({
  '.md': '<!-- synced from jrmoulckers/.github — canonical source; do not edit here -->',
  '.markdown': '<!-- synced from jrmoulckers/.github — canonical source; do not edit here -->',
  '.html': '<!-- synced from jrmoulckers/.github — canonical source; do not edit here -->',
  '.toml': '# synced from jrmoulckers/.github — canonical source; do not edit here',
  '.properties': '# synced from jrmoulckers/.github — canonical source; do not edit here',
  '.conf': '# synced from jrmoulckers/.github — canonical source; do not edit here',
  '.yml': '# synced from jrmoulckers/.github — canonical source; do not edit here',
  '.yaml': '# synced from jrmoulckers/.github — canonical source; do not edit here',
  '.sh': '# synced from jrmoulckers/.github — canonical source; do not edit here',
  '.editorconfig': '# synced from jrmoulckers/.github — canonical source; do not edit here',
  '.npmrc': '# synced from jrmoulckers/.github — canonical source; do not edit here',
  '.dockerignore': '# synced from jrmoulckers/.github — canonical source; do not edit here',
  '.prettierignore': '# synced from jrmoulckers/.github — canonical source; do not edit here',
  '.gitignore': '# synced from jrmoulckers/.github — canonical source; do not edit here',
  '.gitattributes': '# synced from jrmoulckers/.github — canonical source; do not edit here',
  '.gitmodules': '# synced from jrmoulckers/.github — canonical source; do not edit here',
  '.kt': '/* synced from jrmoulckers/.github — canonical source; do not edit here */',
  '.swift': '/* synced from jrmoulckers/.github — canonical source; do not edit here */',
  '.css': '/* synced from jrmoulckers/.github — canonical source; do not edit here */',
  '.js': '/* synced from jrmoulckers/.github — canonical source; do not edit here */',
  '.mjs': '/* synced from jrmoulckers/.github — canonical source; do not edit here */',
  '.ts': '/* synced from jrmoulckers/.github — canonical source; do not edit here */',
  '.cjs': '/* synced from jrmoulckers/.github — canonical source; do not edit here */',
  '.cts': '/* synced from jrmoulckers/.github — canonical source; do not edit here */',
  '.mts': '/* synced from jrmoulckers/.github — canonical source; do not edit here */',
  '.kts': '/* synced from jrmoulckers/.github — canonical source; do not edit here */',
});

/** Types that carry no comment syntax, so `inject` must return the body untouched. */
const UNSTAMPED_BODY = 'body\n';

/**
 * Resolve a type to a target filename. `CLASSIFIED_TYPES` mixes whole basenames (`.editorconfig`,
 * `.gitattributes`) with extensions (`.md`, `.kt`), and the two are indistinguishable by shape —
 * both are a dot followed by letters. Probe rather than pattern-match: if the type resolves as a
 * complete filename it is a basename, otherwise treat it as an extension.
 */
function targetFor(type) {
  try {
    commentSyntaxFor(type);
    return type;
  } catch {
    return `sample${type}`;
  }
}

test('every classified type has its rendered form pinned', () => {
  const unpinned = CLASSIFIED_TYPES.filter(
    (type) =>
      commentSyntaxFor(targetFor(type)) !== 'none' &&
      !Object.prototype.hasOwnProperty.call(RENDERED_FIRST_LINE, type),
  );
  assert.deepEqual(
    unpinned,
    [],
    `A classified type has no pinned rendering, so a change to it would not be caught:\n  ${unpinned.join('\n  ')}\n` +
      'Add it to RENDERED_FIRST_LINE with the form inject currently emits.',
  );
});

test('the rendered first line of every classified type is unchanged', () => {
  for (const [type, expected] of Object.entries(RENDERED_FIRST_LINE)) {
    const rendered = inject(targetFor(type), UNSTAMPED_BODY, {});
    const first = rendered.split('\n')[0];
    assert.equal(
      first,
      expected,
      `The rendering of ${type} changed.\n` +
        `  was: ${expected}\n  now: ${first}\n` +
        'This is a compatibility break, not a formatting change: every member file stamped with ' +
        'the old form becomes unreproducible by attachCanonHistory, so recovery misses and the ' +
        'member is reported as having modified a file it never touched.',
    );
  }
});

test('a type with no comment syntax is returned unstamped', () => {
  for (const type of CLASSIFIED_TYPES) {
    const target = targetFor(type);
    if (commentSyntaxFor(target) !== 'none') continue;
    assert.equal(
      inject(target, UNSTAMPED_BODY, {}),
      UNSTAMPED_BODY,
      `${type} classifies as 'none', so inject must not alter the body`,
    );
  }
});

test('the pin is not vacuous: a changed rendering is detected', () => {
  // Mutation proof against the real assertion rather than a restatement of it: the check above
  // compares inject's first line to the table, so feeding it the wrong table entry must fail.
  const rendered = inject('sample.toml', UNSTAMPED_BODY, {});
  const first = rendered.split('\n')[0];
  assert.notEqual(first, RENDERED_FIRST_LINE['.md'], 'hash and html forms must be distinguishable');
  assert.throws(
    () => assert.equal(first, RENDERED_FIRST_LINE['.md']),
    'comparing a hash-rendered file against the html form must fail',
  );
});
