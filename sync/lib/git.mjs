// Git + gh helpers (via child_process). All network/write operations funnel through
// here so the rest of the tool stays side-effect free and testable.
//
// The member remote is authenticated with a short-lived token embedded in the clone URL;
// tokens are redacted from any surfaced error output.

import { execFileSync } from 'node:child_process';

const COMMIT_NAME = 'jrm-studio-sync';
const COMMIT_EMAIL = 'studio-sync@users.noreply.github.com';
export const CO_AUTHOR = 'Co-authored-by: Copilot App <223556219+Copilot@users.noreply.github.com>';

function redact(text) {
  return String(text ?? '').replace(/x-access-token:[^@]+@/g, 'x-access-token:***@');
}

function run(cmd, args, { cwd, token, trim = true } = {}) {
  const env = { ...process.env };
  if (token) {
    env.GH_TOKEN = token;
    env.GITHUB_TOKEN = token;
  }
  try {
    const output = execFileSync(cmd, args, {
      cwd,
      env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return trim ? output.trim() : output;
  } catch (err) {
    const detail = redact(err.stderr || err.stdout || err.message);
    throw new Error(`\`${redact(`${cmd} ${args.join(' ')}`)}\` failed: ${detail}`);
  }
}

export const git = (args, cwd, token) => run('git', args, { cwd, token });
export const gitRaw = (args, cwd, token) => run('git', args, { cwd, token, trim: false });
export const gh = (args, token) => run('gh', args, { token });

export function tokenUrl(repo, token) {
  return `https://x-access-token:${token}@github.com/${repo}.git`;
}

/** Shallow-clone a member repo; returns the checked-out default branch name. */
export function cloneShallow(repo, token, dest) {
  git(['clone', '--depth', '1', tokenUrl(repo, token), dest]);
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], dest);
}

/**
 * Clone a repo with its full history; returns the checked-out default branch name.
 *
 * Used for the token source repo, whose committed dist/ history is the only evidence that a
 * vendored member file is stale engine output rather than member-authored content. A shallow
 * clone would drop the blob that proves it, so recovery must not run against one.
 */
export function cloneFull(repo, token, dest) {
  git(['clone', tokenUrl(repo, token), dest]);
  return git(['rev-parse', '--abbrev-ref', 'HEAD'], dest);
}

export function createBranch(dest, branch) {
  git(['checkout', '-b', branch], dest);
}

/**
 * Check out a sync branch, reusing a remote branch only when an open PR owns it.
 *
 * A same-day re-run must not discard work that landed on the sync branch after the previous run —
 * a reviewer's fixup commit, for example — and must actually be able to update the open PR.
 * Rebuilding the branch from the default branch could do neither: a plain force-push would clobber,
 * and `--force-with-lease` on a fresh shallow clone is refused as `stale info` (no reflog to prove
 * the remote value was observed), so the update path always failed. Fetching the existing remote
 * branch and using it as the base gives both properties at once — the push is an ordinary
 * fast-forward that succeeds and cannot overwrite anything.
 *
 * A retained branch from a closed or squash-merged PR is not safe to reuse. In that case a
 * non-colliding `-rerun-N` branch is created from the current default branch, leaving the retained
 * remote ref untouched.
 *
 * @returns {{ branch: string, reused: boolean, foreign: string[], foreignStatus: 'ok'|'unavailable' }}
 *   `foreign` lists short descriptions of ahead-of-default commits on the reused branch that the
 *   engine did not author. `foreignStatus` is `unavailable` when that list could not be obtained,
 *   so an empty `foreign` is never mistaken for a branch that carries no reviewer work.
 */
export function prepareSyncBranch(dest, branch, { reuse = false, defaultBranch = 'main' } = {}) {
  if (reuse) {
    if (!fetchRemoteBranch(dest, branch)) {
      throw new Error(`Open PR branch ${branch} disappeared before it could be reused.`);
    }
    git(['checkout', '-B', branch, `refs/remotes/origin/${branch}`], dest);
    const foreign = foreignCommits(dest, branch, defaultBranch);
    return { branch, reused: true, foreign: foreign.commits, foreignStatus: foreign.status };
  }

  if (!fetchRemoteBranch(dest, branch)) {
    createBranch(dest, branch);
    return { branch, reused: false, foreign: [], foreignStatus: 'ok' };
  }

  let sequence = 2;
  let freshBranch;
  do {
    freshBranch = `${branch}-rerun-${sequence}`;
    sequence += 1;
  } while (fetchRemoteBranch(dest, freshBranch));

  createBranch(dest, freshBranch);
  return { branch: freshBranch, reused: false, foreign: [], foreignStatus: 'ok' };
}

/** Fetch `branch` from origin into its remote-tracking ref. False when the remote branch is absent. */
export function fetchRemoteBranch(dest, branch) {
  try {
    git(['fetch', '--depth', '50', 'origin', `${branch}:refs/remotes/origin/${branch}`], dest);
    return true;
  } catch {
    return false;
  }
}

/**
 * Commits ahead of the default branch that were not authored by the sync engine.
 * Used to report preserved reviewer work; never used to gate the push.
 *
 * Returns a verdict rather than a bare list. An empty list means "this branch carries no reviewer
 * commits" — a positive claim — and a failure here must not be able to make it. The `--unshallow`
 * fetch below is a network call, so failure is ordinary rather than exceptional, and this is the
 * one path whose whole purpose is preserving reviewer work: reporting "none" when the lookup
 * failed erases exactly what the caller came to protect. See `memberIdentity` in `workdir.mjs`
 * for the same three-state shape and ADR/`docs/sync.md` for why empty must not stand in for
 * unknown.
 *
 * @returns {{ status: 'ok'|'unavailable', commits: string[] }}
 */
export function foreignCommits(dest, branch, defaultBranch = 'main') {
  try {
    if (git(['rev-parse', '--is-shallow-repository'], dest) === 'true') {
      git(['fetch', '--unshallow', 'origin', defaultBranch], dest);
      git(['fetch', 'origin', `${branch}:refs/remotes/origin/${branch}`], dest);
    }
    const log = git(['log', '--format=%h %an %s', `${defaultBranch}..${branch}`], dest);
    return {
      status: 'ok',
      commits: log
        .split('\n')
        .filter(Boolean)
        .filter((line) => !line.slice(line.indexOf(' ') + 1).startsWith(`${COMMIT_NAME} `)),
    };
  } catch {
    return { status: 'unavailable', commits: [] };
  }
}

/**
 * Read one file from the current tip of a remote branch.
 *
 * Fetches first, so the answer reflects the remote *now* rather than the snapshot this clone was
 * taken from — the whole point at the call site, which is checking whether the default branch moved
 * under a run in flight.
 *
 * Three states, not two. `unavailable` means the fetch failed and nothing is known; `ok` with a
 * null content means the branch is readable and the file genuinely is not on it, which is ordinary
 * for a member's first sync. Collapsing those would let a network failure read as "this member has
 * no lockfile", and the caller would then treat every entry as new.
 *
 * @returns {{ status: 'ok'|'unavailable', content: string|null }}
 */
export function readFileAtRemoteBranch(dest, branch, path) {
  try {
    // `+` forces the remote-tracking ref, so a non-fast-forward on the default branch surfaces as
    // updated bytes rather than a fetch failure that would be reported as `unavailable`.
    git(['fetch', '--depth', '1', 'origin', `+${branch}:refs/remotes/origin/${branch}`], dest);
  } catch {
    return { status: 'unavailable', content: null };
  }
  try {
    return { status: 'ok', content: git(['show', `refs/remotes/origin/${branch}:${path}`], dest) };
  } catch {
    return { status: 'ok', content: null };
  }
}

/** Stage everything and commit. Returns false when there is nothing to commit. */
export function commitAll(dest, message) {
  git(['add', '-A'], dest);
  const status = git(['status', '--porcelain'], dest);
  if (!status) return false;
  git(['-c', `user.name=${COMMIT_NAME}`, '-c', `user.email=${COMMIT_EMAIL}`, 'commit', '-m', message], dest);
  return true;
}

/**
 * Push the sync branch as a **fast-forward only**. The engine never force-pushes: the branch is
 * always based on the current remote tip (see `prepareSyncBranch`), so a rejected push means the
 * remote moved mid-run and must fail loudly rather than overwrite someone else's commits.
 */
export function push(dest, branch) {
  git(['push', '-u', 'origin', branch], dest);
}

/** Remote dated branch and clean rerun branches that could belong to an open PR. */
export function remoteSyncBranches(dest, branch) {
  const output = git(
    ['ls-remote', '--heads', 'origin', `refs/heads/${branch}`, `refs/heads/${branch}-rerun-*`],
    dest,
  );
  return output
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(line.indexOf('refs/heads/') + 'refs/heads/'.length));
}

/** Most recent open PR whose head is the dated branch or one of its clean rerun branches. */
export function findOpenPr(repo, branch, token, dest) {
  try {
    const list = remoteSyncBranches(dest, branch).flatMap((head) => {
      const json = gh(
        [
          'pr',
          'list',
          '--repo',
          repo,
          '--head',
          head,
          '--state',
          'open',
          '--limit',
          '1',
          '--json',
          'url,headRefName,number',
        ],
        token,
      );
      return JSON.parse(json || '[]');
    });
    return selectOpenPr(list, branch);
  } catch {
    return null;
  }
}

/** Any `studio-sync/<date>` branch, with or without a `-rerun-N` suffix. */
const SYNC_BRANCH = /^studio-sync\/\d{4}-\d{2}-\d{2}(?:-rerun-[0-9]+)?$/;

/**
 * Open sync PRs belonging to a wave other than `currentBranch`'s.
 *
 * `findOpenPr` deliberately looks only at the current dated branch, so a wave left open from an
 * earlier day is invisible to the run that opens the next one. That is the state `docs/sync.md`
 * warns about — merging the older branch after the newer one replays stale canon, and where the
 * two waves touched different paths it applies clean and rolls those files back with no conflict
 * to raise the alarm. Reporting is all this does: the disposition is the reviewer's to choose, and
 * refusing to open the new wave would punish exactly the members already behind.
 *
 * `authored` carries the commits the engine did not write, because mixed-vs-pure is the single
 * fact that selects the disposition. A commit with no author attributed counts as authored: this
 * is a prompt to look, so over-reporting is the safe direction.
 *
 * @returns {{ status: 'ok'|'unavailable', waves: Array<{
 *   number, url, branch, createdAt, authored: string[], total: number }> }}
 *
 * A verdict rather than a bare list, for the reason #304's own body gave and then failed to act
 * on: an empty list is the positive claim "no other wave is open", and a `gh` failure must not be
 * able to make it. That shape is precisely what would have made the node-budget bug below
 * permanent and silent, so fixing the trigger while leaving the mechanism was not a fix.
 */
export function findOtherOpenSyncPrs(repo, currentBranch, token) {
  try {
    // `commits` is deliberately NOT requested here. Asking for it across a PR list multiplies out
    // to a GraphQL node count that GitHub rejects outright — `--limit 50` on a real member returns
    // "requests up to 505,050 possible nodes which exceeds the maximum limit of 500,000", and 49
    // only squeaks under a ceiling nothing in this repo controls. The cheap list is unconditional;
    // commits are fetched per PR below, and only for the sync branches, which is normally none.
    const json = gh(
      ['pr', 'list', '--repo', repo, '--state', 'open', '--limit', '100', '--json', 'number,url,headRefName,createdAt'],
      token,
    );
    const others = JSON.parse(json || '[]').filter((pr) => isOtherSyncWave(pr.headRefName, currentBranch));
    const enriched = others.map((pr) => ({
      ...pr,
      commits: JSON.parse(
        gh(['pr', 'view', String(pr.number), '--repo', repo, '--json', 'commits'], token) || '{}',
      ).commits,
    }));
    return { status: 'ok', waves: selectOtherOpenSyncPrs(enriched, currentBranch) };
  } catch {
    return { status: 'unavailable', waves: [] };
  }
}

/** True when `head` is a sync branch from a wave other than `currentBranch`'s. */
export function isOtherSyncWave(head, currentBranch) {
  if (!SYNC_BRANCH.test(head ?? '')) return false;
  const dated = (name) => String(name ?? '').replace(/-rerun-[0-9]+$/, '');
  return dated(head) !== dated(currentBranch);
}

/** Pure half of `findOtherOpenSyncPrs`, split out so the classification is testable offline. */
export function selectOtherOpenSyncPrs(prs, currentBranch) {
  return prs
    .filter((pr) => isOtherSyncWave(pr.headRefName, currentBranch))
    .map((pr) => {
      const commits = pr.commits ?? [];
      return {
        number: pr.number,
        url: pr.url,
        branch: pr.headRefName,
        createdAt: pr.createdAt,
        total: commits.length,
        authored: commits
          .filter((commit) => (commit.authors?.[0]?.name ?? '') !== COMMIT_NAME)
          .map((commit) => commit.messageHeadline ?? ''),
      };
    })
    .sort((left, right) => String(left.branch).localeCompare(String(right.branch)));
}

export function listOpenPullRequests(repo, token) {
  const limit = 1000;
  const pullRequests = JSON.parse(
    gh(
      [
        'pr',
        'list',
        '--repo',
        repo,
        '--state',
        'open',
        '--limit',
        String(limit + 1),
        '--json',
        'number,headRefName,headRefOid',
      ],
      token,
    ) || '[]',
  );
  return {
    pullRequests: pullRequests
      .slice(0, limit)
      .map((pullRequest) => ({
        number: pullRequest.number,
        headRefName: pullRequest.headRefName,
        headRefOid: pullRequest.headRefOid,
      }))
      .sort((left, right) => left.number - right.number),
    truncated: pullRequests.length > limit,
  };
}

export function readPullRequestWorkflowSources(dest, pullRequest) {
  const { number, headRefOid } = pullRequest;
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw new Error(`invalid pull request number: ${number}`);
  }
  const ref = `refs/studio-sync/pull/${number}`;
  git(['fetch', '--depth', '1', 'origin', `+refs/pull/${number}/head:${ref}`], dest);
  const fetchedOid = git(['rev-parse', ref], dest);
  if (headRefOid && fetchedOid !== headRefOid) {
    throw new Error(
      `pull request head moved during inspection (listed ${headRefOid}, fetched ${fetchedOid})`,
    );
  }
  const listing = git(['ls-tree', '-r', '--name-only', ref, '--', '.github/workflows'], dest);
  return listing
    .split('\n')
    .filter((path) => /\.ya?ml$/i.test(path))
    .sort()
    .map((path) => ({ path, text: gitRaw(['show', `${ref}:${path}`], dest) }));
}

export function selectOpenPr(prs, branch) {
  const escaped = branch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const candidates = prs
    .filter((pr) => new RegExp(`^${escaped}(?:-rerun-[0-9]+)?$`).test(pr.headRefName))
    .sort((left, right) => right.number - left.number);
  return candidates.length ? { url: candidates[0].url, branch: candidates[0].headRefName } : null;
}

/** True when the repo exists and is visible to the token. */
export function repoExists(repo, token) {
  try {
    gh(['repo', 'view', repo, '--json', 'name'], token);
    return true;
  } catch {
    return false;
  }
}

/** Open a PR via gh; returns the PR URL. */
export function createPr(repo, { base, head, title, bodyFile }, token) {
  return gh(
    ['pr', 'create', '--repo', repo, '--base', base, '--head', head, '--title', title, '--body-file', bodyFile],
    token,
  );
}
