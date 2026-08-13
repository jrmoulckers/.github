// Which members actually receive each canon document, derived from the engine.
//
// The alternative is reading `optIn` by hand, and that structure does not read uniformly:
// `optIn.base` is a boolean, `optIn.instructions` is `"*" | string[] | false`, and
// `workflows`/`health` resolve to groups that are listed but never written. A reader that treats
// those alike gets a plausible number. `resolveAll` + `enumerateTargets` are the code that decides
// what is delivered, so asking them is the only reading that cannot disagree with the sync run.
//
// Audience is reported for the *source* path, because that is the file an author edits and the
// name that appears in prose. `alias` maps both the source path and the member-side target path
// onto it, so a sentence naming `.github/instructions/workflow.instructions.md` and one naming
// `instructions/workflow.instructions.md` resolve to the same document.
//
// A document in no canon kind at all — `docs/sync.md`, this file — has an audience of zero rather
// than being absent. Absence and zero read the same at a call site using `??`, and they are
// different facts: one means "not delivered", the other means "not asked about". Callers get zero
// for both only because `audienceOf` decides it explicitly, in one place.
//
// ---------------------------------------------------------------------------------------------
// On the shortcut that is deliberately not here.
//
// Enumerating eleven members costs about 36 seconds, nearly all of it `attachCanonHistory` walking
// git per source path. Enumerating a single merged plan — every kind carrying the union of every
// member's names — yields the same 62 documents, and was written first because an early
// measurement put it at 1.3 seconds.
//
// That measurement was taken second, in a process where the eleven-member run had already warmed
// git's object cache. Re-run cold in fresh processes, in both orders, the merged plan takes 25
// seconds against 36. The saving was real and about a third of what it appeared to be.
//
// The shortcut also has to map `(kind, name)` back to paths, and the first version keyed that on
// the spec name — which for a dir kind is `<skill>/<file>`, not the group name. All 21 skills
// documents dropped out of the map. Four named controls and a size floor passed anyway, the floor
// because it had been written by reading the already-broken output.
//
// Eleven seconds does not buy twenty lines of subtle key derivation plus the oracle needed to keep
// it honest. The straightforward enumeration below is memoized, so a test file pays it once.
// ---------------------------------------------------------------------------------------------

import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadManifest } from '../lib/manifest.mjs';
import { enumerateTargets } from '../lib/assets.mjs';
import { resolveAll } from '../lib/resolve.mjs';

export const REPO_ROOT = join(dirname(dirname(dirname(fileURLToPath(import.meta.url)))));

const CACHE = new Map();

/**
 * @returns {{ audience: Map<string, Set<string>>, alias: Map<string, string>, fleet: number }}
 *   `audience` is keyed by canon source path and holds short member names.
 *   `alias` maps every name a document can be called by onto its source path.
 *   `fleet` is the manifest's member count.
 */
export function canonAudience(root = REPO_ROOT) {
  const cached = CACHE.get(root);
  if (cached) return cached;

  const manifest = loadManifest(root);
  const audience = new Map();
  const alias = new Map();

  for (const plan of resolveAll(manifest)) {
    const member = plan.repo.split('/')[1];
    for (const spec of enumerateTargets(plan, root).writes) {
      if (!audience.has(spec.sourcePath)) audience.set(spec.sourcePath, new Set());
      audience.get(spec.sourcePath).add(member);
      alias.set(spec.sourcePath, spec.sourcePath);
      alias.set(spec.targetPath, spec.sourcePath);
    }
  }

  const value = { audience, alias, fleet: manifest.members.length };
  CACHE.set(root, value);
  return value;
}

/**
 * How many members receive `docPath`, where "not a canon document" is zero rather than undefined.
 */
export function audienceOf({ audience }, docPath) {
  return audience.get(docPath)?.size ?? 0;
}
