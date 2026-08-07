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

function run(cmd, args, { cwd, token } = {}) {
  const env = { ...process.env };
  if (token) {
    env.GH_TOKEN = token;
    env.GITHUB_TOKEN = token;
  }
  try {
    return execFileSync(cmd, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (err) {
    const detail = redact(err.stderr || err.stdout || err.message);
    throw new Error(`\`${redact(`${cmd} ${args.join(' ')}`)}\` failed: ${detail}`);
  }
}

export const git = (args, cwd, token) => run('git', args, { cwd, token });
export const gh = (args, token) => run('gh', args, { token });

export function tokenUrl(repo, token) {
  return `https://x-access-token:${token}@github.com/${repo}.git`;
}

/** Shallow-clone a member repo; returns the checked-out default branch name. */
export function cloneShallow(repo, token, dest) {
  git(['clone', '--depth', '1', tokenUrl(repo, token), dest]);
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
 * @returns {{ branch: string, reused: boolean, foreign: string[] }} `foreign` lists short
 *   descriptions of ahead-of-default commits on the reused branch that the engine did not author.
 */
export function prepareSyncBranch(dest, branch, { reuse = false, defaultBranch = 'main' } = {}) {
  if (reuse) {
    if (!fetchRemoteBranch(dest, branch)) {
      throw new Error(`Open PR branch ${branch} disappeared before it could be reused.`);
    }
    git(['checkout', '-B', branch, `refs/remotes/origin/${branch}`], dest);
    return { branch, reused: true, foreign: foreignCommits(dest, branch, defaultBranch) };
  }

  if (!fetchRemoteBranch(dest, branch)) {
    createBranch(dest, branch);
    return { branch, reused: false, foreign: [] };
  }

  let sequence = 2;
  let freshBranch;
  do {
    freshBranch = `${branch}-rerun-${sequence}`;
    sequence += 1;
  } while (fetchRemoteBranch(dest, freshBranch));

  createBranch(dest, freshBranch);
  return { branch: freshBranch, reused: false, foreign: [] };
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
 */
export function foreignCommits(dest, branch, defaultBranch = 'main') {
  try {
    if (git(['rev-parse', '--is-shallow-repository'], dest) === 'true') {
      git(['fetch', '--unshallow', 'origin', defaultBranch], dest);
      git(['fetch', 'origin', `${branch}:refs/remotes/origin/${branch}`], dest);
    }
    const log = git(['log', '--format=%h %an %s', `${defaultBranch}..${branch}`], dest);
    return log
      .split('\n')
      .filter(Boolean)
      .filter((line) => !line.slice(line.indexOf(' ') + 1).startsWith(`${COMMIT_NAME} `));
  } catch {
    return [];
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
