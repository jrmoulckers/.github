# Studio sync engine

Distributes the canonical AI layer from the backbone repo (`jrmoulckers/.github`) to the
member repos declared in [`studio.config.json`](../studio.config.json). One-way only:
backbone → members. See [`docs/sync.md`](../docs/sync.md) for the design and rationale.

Zero runtime dependencies — Node.js **≥ 24**, built-ins only (`node:fs`, `node:path`,
`node:crypto`, `node:child_process`, …).

## Usage

```bash
node sync/index.mjs [options]
```

| Flag | Effect |
| --- | --- |
| `--dry-run` | Plan only. Prints the resolved file set per member. **No writes, git, or network.** |
| `--members <a,b>` | Restrict to these member repos (`owner/name` or bare `name`). |
| `--check` | CI gate. Exit non-zero if any member is out of date or has drift. |
| `--force` | Overwrite locally-modified (drift) targets instead of skipping them. |
| `--work-dir <path>` | Apply/inspect against a local checkout (one `--members`); no clone/push/PR. |
| `--date <YYYY-MM-DD>` | Override the date used for branch/commit naming. |
| `--help` | Show help. |

Examples:

```bash
# See exactly what each member would receive.
node sync/index.mjs --dry-run

# Real sync of a single member (opens a PR).
STUDIO_SYNC_TOKEN=ghp_… node sync/index.mjs --members jrmoulckers/jrm-recipes

# CI freshness gate across all members.
STUDIO_SYNC_TOKEN=ghp_… node sync/index.mjs --check
```

## What gets synced

Resolution follows each member's `optIn` in the manifest:

- `"*"` → the full canon of that kind, an array → those names, `false`/omitted → opt out.
- `base` and `health` are booleans.

| Kind | Shape | Target | Notes |
| --- | --- | --- | --- |
| `base` | `AGENTS.md`, `agency.toml` | member root | `AGENTS.md` is **merged** (see below); `agency.toml` copied wholesale. |
| `agents` | `*.agent.md` files | `.github/agents/` | |
| `prompts` | `*.prompt.md` files | `.github/prompts/` | |
| `instructions` | `*.instructions.md` files | `.github/instructions/` | |
| `skills` | `<name>/` directories | `.github/skills/` | Whole folder: `SKILL.md` + any checklists. |
| `health` | community-health files | — | **Native** — GitHub inherits these from the backbone `.github` repo. Not written. |
| `workflows` | reusable workflows | — | **Native** — called via `uses: jrmoulckers/.github/.github/workflows/*@main`. Not written. |
| `profile` | `profile/README.md` | `jrmoulckers/jrmoulckers` `README.md` | Mirrored to the user profile repo. |

Every synced file carries a provenance header
(`synced from jrmoulckers/.github — canonical source; do not edit here`): an HTML comment
after the YAML frontmatter (or at the top of plain Markdown), or a leading `#` line for
`.toml`/`.yml`.

### AGENTS.md base merge

Product repos keep their own extending `AGENTS.md`. The tool manages only a marked region:

```markdown
<!-- studio:base:start -->
…canonical base guide…
<!-- studio:base:end -->
```

Everything outside the markers is product-local and never touched. Editing inside the block
is treated as drift; editing outside it is ignored. If a member has no `AGENTS.md`, one is
created containing just the managed block.

## Idempotency & drift — `.studio-sync.lock.json`

Each member repo carries a lockfile at its root:

```json
{
  "version": 1,
  "backbone": "jrmoulckers/.github",
  "generatedAt": "…",
  "entries": {
    ".github/agents/architect.agent.md": {
      "sourceSha256": "…",
      "targetSha256": "…",
      "syncedAt": "…"
    }
  }
}
```

- `sourceSha256` detects **upstream** changes (canon moved) → the target is rewritten.
- `targetSha256` is the hash of the exact bytes last written; if the member's current file no
  longer matches it, the file was **locally modified** → flagged `⚠️ locally modified` in the
  PR body and **left untouched** (unless `--force`). A pre-existing, unrecorded file that
  differs from canon is treated the same way, so member-authored files are never clobbered.

Re-running with no upstream change writes nothing and opens no PR. Hashes are computed on
LF-normalized content, so line-ending differences don't cause spurious churn.

## PR flow

For each member with changes the tool clones (shallow), creates `studio-sync/<YYYY-MM-DD>`,
commits `chore(sync): update studio canon (<date>)`, pushes, and opens a PR against the
member's **default** branch. It never pushes to the default branch, and skips members with
no changes.

## Authentication

Set `STUDIO_SYNC_TOKEN` to a PAT that can push and open PRs on the member repos (and on
`jrmoulckers/jrmoulckers` for the profile mirror). The default `GITHUB_TOKEN` is scoped to the
backbone repo only and **cannot** operate cross-repo. `--dry-run` needs no token.

## Scheduled runs

[`.github/workflows/studio-sync.yml`](../.github/workflows/studio-sync.yml) runs weekly and on
`workflow_dispatch` (with `members` and `dry_run` inputs), using the `STUDIO_SYNC_TOKEN` secret.

## Profile mirror caveat

`jrmoulckers` is a GitHub **user**, so a `.github` repo's `profile/README.md` does not render
on the account page — it must live in the special `jrmoulckers/jrmoulckers` repo. The tool
mirrors it there. If that repo doesn't exist yet, the run logs a **warning** and continues
(it never fails the whole sync).
