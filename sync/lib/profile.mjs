// Profile README mirror.
//
// `jrmoulckers` is a GitHub *user*, so a `.github` repo's profile/README.md does not render
// on the account page — that must live in the special `<user>/<user>` repo. This mirrors the
// canonical `profile/README.md` there. If that repo does not exist yet, the run logs a clear
// WARNING and continues (it never fails the whole sync).

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { inject } from './provenance.mjs';
import { hashText } from './lock.mjs';
import { repoPresence } from './git.mjs';
import { syncRepo } from './pr.mjs';
import { log } from './log.mjs';

const PROFILE_INTRO =
  'Mirrored from [`jrmoulckers/.github`](https://github.com/jrmoulckers/.github) `profile/README.md` — ' +
  'the canonical JRM Studio profile. Edit it there, not here.';

export function profileTarget(owner, backboneRoot) {
  const raw = readFileSync(join(backboneRoot, 'profile', 'README.md'), 'utf8');
  return {
    repo: `${owner}/${owner}`,
    write: {
      kind: 'profile',
      name: 'README.md',
      sourcePath: 'profile/README.md',
      targetPath: 'README.md',
      sourceSha256: hashText(raw),
      content: inject('README.md', raw),
      type: 'file',
    },
  };
}

/**
 * Mirror the profile README to the user's profile repo.
 * @returns {{ status: 'missing'|'unknown'|'unchanged'|'pr', repo, prUrl? }}
 */
export function mirrorProfile({ owner, backbone, backboneRoot, token, date, force }) {
  const { repo, write } = profileTarget(owner, backboneRoot);

  if (!token) {
    log.warn(`profile mirror skipped: STUDIO_SYNC_TOKEN not set (would mirror to ${repo}).`);
    return { status: 'missing', repo };
  }

  const presence = repoPresence(repo, token);

  if (presence.status === 'absent') {
    log.warn(
      `profile repo ${repo} does not exist yet. Create it (a public repo named "${owner}") so the ` +
        'profile README renders on the account page; until then the mirror is skipped.',
    );
    return { status: 'missing', repo };
  }

  if (presence.status === 'unavailable') {
    log.warn(
      `profile repo ${repo} could not be reached, so whether it exists is unknown — do not create ` +
        'it on the strength of this run. A token without a grant for the repo answers the same way ' +
        `as a rate limit or a dropped network: ${presence.detail}`,
    );
    return { status: 'unknown', repo };
  }

  const result = syncRepo({
    repo,
    writes: [write],
    token,
    date,
    force,
    backbone,
    title: `chore(sync): update profile README (${date})`,
    intro: PROFILE_INTRO,
  });

  if (result.status === 'pr') log.ok(`profile mirror PR: ${result.prUrl}`);
  else log.info(`profile mirror: ${repo} already up to date`);
  return { ...result, repo };
}
