// Shared derivation of "shipped engine source" for suites that need a population rather than a list.
//
// This exists as one module because it was about to exist as two. `injected-seams.test.mjs` derived
// this corpus for reachability and `manifest.test.mjs` needed the same corpus to enumerate the
// faults the engine can raise. A duplicated derivation does not merely drift: it absorbs the probes
// aimed at the original, so a mutant that narrows one copy dies while the other keeps its blindness.
//
// The population is derived from the property that makes a file subject to these rules -- shipped
// engine source, the code a run actually executes -- and never from the directory today's instances
// occupy. `sync/lib` was that directory once, and it held 24 of the 30 shipped files (#930).
//
// A walk and `git ls-files` are both provided because a narrowed corpus stays internally consistent:
// size floors and subset assertions pass under exactly the narrowing they exist to catch. Only an
// enumeration that shares none of the walk's logic can falsify it.

import { readdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = dirname(dirname(dirname(fileURLToPath(import.meta.url))));

/** Fixtures standing in for a member's app are not engine source, and neither are the tests. */
export const isEngineSource = (rel) =>
  rel.endsWith('.mjs') &&
  (rel.startsWith('sync/') || rel.startsWith('principles/')) &&
  !rel.includes('/test/');

/** Shipped engine sources, walked from disk. */
export function engineSourcesByWalk(root = REPO_ROOT) {
  const out = [];
  const walk = (dir, prefix) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === '.git') continue;
        walk(join(dir, entry.name), rel);
      } else if (isEngineSource(rel)) {
        out.push(rel);
      }
    }
  };
  walk(root, '');
  return out.sort();
}

/** The same population from git's index -- an enumeration that shares none of the walk's logic. */
export function engineSourcesByGit() {
  const listed = execFileSync('git', ['ls-files', '*.mjs'], { cwd: REPO_ROOT, encoding: 'utf8' });
  return listed.split('\n').filter(Boolean).filter(isEngineSource).sort();
}

export const readEngineSource = (rel) => readFileSync(join(REPO_ROOT, ...rel.split('/')), 'utf8');

/**
 * Static text of every `new Error(...)` the engine can raise, as one fragment per literal segment.
 *
 * Interpolations are split out because only the static text is common to every run that reaches the
 * site. These are decoys: a string contained in one of them is a string that would also match that
 * failure, which is how an exemption stops pinning one fault.
 *
 * This is a **lower bound** on the faults a run can report. It enumerates what the engine raises
 * itself and cannot enumerate messages from git, the network, or the GitHub API -- which is where
 * the recorded 403 signature comes from. A signature colliding with nothing here is not thereby
 * narrow; it has only survived the part that can be checked.
 */
export function engineErrorFragments(files = engineSourcesByWalk()) {
  const fragments = new Set();
  for (const rel of files) {
    for (const match of readEngineSource(rel).matchAll(/new Error\(\s*([`'"])([\s\S]*?)\1/g)) {
      for (const piece of match[2].split(/\$\{[^}]*\}/)) {
        const text = piece.replace(/\s+/g, ' ').trim();
        if (text) fragments.add(text);
      }
    }
  }
  return fragments;
}
