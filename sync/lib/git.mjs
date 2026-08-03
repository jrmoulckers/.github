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
 * Check out the sync branch, **reusing the remote branch when it already exists**.
 *
 * A same-day re-run must never discard work that landed on the sync branch after the previous
 * run — a reviewer's fixup commit, for example. Branching off the default branch and
 * force-pushing would do exactly that, so instead the existing remote branch is fetched and
 * becomes the base: the new sync commit is stacked on top and pushed as a fast-forward.
 *
 * @returns {{ reused: boolean, foreign: string[] }} `foreign` lists short descriptions of
 *   commits on the reused branch that the engine did not author (reviewer work being preserved).
 */
export function prepareSyncBranch(dest, branch) {
  if (!fetchRemoteBranch(dest, branch)) {
    createBranch(dest, branch);
    return { reused: false, foreign: [] };
  }
  git(['checkout', '-B', branch, `refs/remotes/origin/${branch}`], dest);
  return { reused: true, foreign: foreignCommits(dest, branch) };
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
 * Commits reachable from the (shallow) sync branch that were not authored by the sync engine.
 * Used to report preserved reviewer work; never used to gate the push.
 */
export function foreignCommits(dest, branch) {
  try {
    const log = git(['log', '--format=%h %an %s', branch], dest);
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

/** URL of an existing open PR whose head is `branch`, or null. */
export function findOpenPr(repo, branch, token) {
  try {
    const json = gh(['pr', 'list', '--repo', repo, '--head', branch, '--state', 'open', '--json', 'url'], token);
    const list = JSON.parse(json || '[]');
    return list.length ? list[0].url : null;
  } catch {
    return null;
  }
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
