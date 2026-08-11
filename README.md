<!-- markdownlint-disable MD041 -->

# `jrmoulckers/.github` — JRM Studio backbone

The single source of truth for **JRM Studio**: shared identity, community-health defaults, the
canonical (product-agnostic) AI layer, reusable CI/CD workflows, and the manifest that drives
cross-repo sync. Product repos (`jrm-recipes`, `score-king`, `finance`, and more) share DNA from
here plus `@jrm` npm packages.

> New to the studio? Start with **[`AGENTS.md`](AGENTS.md)** (base operating guide) and the
> **[studio profile](profile/README.md)**. GitHub-owned Draft policy lives in
> **[`principles/`](principles/README.md)**.

## What lives here

```
.
├─ profile/README.md          # JRM Studio account profile
├─ AGENTS.md                  # studio-wide base operating guide (product repos extend it)
├─ agency.toml                # pinned MCP servers + reviewed optional browser/memory profiles
├─ copilot-instructions.md    # Copilot-surface orientation → .github/copilot-instructions.md
├─ principles/                # Draft GitHub governance and Actions principles
├─ studio.config.json         # manifest: members + per-repo opt-in canon (drives the sync tool)
├─ CONTRIBUTING.md            # ┐
├─ SECURITY.md                # ├─ default community-health files (inherited by member repos)
├─ CODE_OF_CONDUCT.md         # ┘
├─ agents/                    # 22 cross-cutting Copilot agents  (canonical source)
├─ skills/                    # 17 cross-cutting skills          (canonical source)
├─ prompts/                   # 8 reusable prompts               (canonical source)
├─ instructions/             # 6 path-scoped instructions       (canonical source)
├─ docs/sync.md               # design and operating model for cross-repo sync
└─ .github/
   ├─ ISSUE_TEMPLATE/         # bug · feature · task · spike · troubleshooting · config
   ├─ DISCUSSION_TEMPLATE/    # rfc · feature-proposal · question
   ├─ PULL_REQUEST_TEMPLATE.md
   └─ workflows/              # reusable-*.yml (called by product repos)
```

## Authority map

**Non-normative index.** [ADR-0003](docs/architecture/0003-four-authority-topology.md) is the
canonical source for this topology. This summary helps readers find the four authorities without
turning operational placement into source ownership:

| Authority | Canonical domain |
| --- | --- |
| **Studio** | Design and user-facing UI principles and implementations |
| **Engineering** | Engineering principles, mechanisms, evidence, configurations, and libraries |
| **Product** | Product and operations obligations, outcomes, decisions, and implementations |
| **`.github`** | GitHub governance and Actions; Copilot and AI assets; fleet sync and provenance |

Product defines the obligation and outcome, Engineering defines the mechanism and evidence, Studio
defines the user-facing expression, and `.github` automates checks and distribution. Operational
reading or distribution does not transfer source ownership. See
[ADR-0003](docs/architecture/0003-four-authority-topology.md) for the normative dependency
directions and ownership boundaries.

> **Profile note.** `jrmoulckers` is a GitHub **User**, not an Org, so `profile/README.md` does
> **not** render on the account page (that's an Org-only mechanism). It's authored here as the
> canonical, self-contained studio identity; a separate `jrmoulckers/jrmoulckers` repo mirrors it
> to `README.md` so the profile actually displays. See [`docs/sync.md`](docs/sync.md).

## Two ways product repos consume this repo

### 1. Native inheritance — nothing to install

- **Community-health files.** GitHub automatically applies the `CONTRIBUTING`, `SECURITY`,
  `CODE_OF_CONDUCT`, issue/PR/discussion templates here as **defaults** for every repo owned by
  `jrmoulckers` that doesn't define its own. Override in a product repo simply by adding that
  file locally.
- **Reusable workflows.** Product repos call the `reusable-*.yml` workflows by reference — no
  copying. Pin a reviewed full commit SHA; branches and tags are not immutable enough for executable
  CI. Configure consumer automation to propose SHA update PRs, then review the upstream diff and
  release notes before merging. The workflows are framework-parametric (Node + npm|pnpm; trusted
  repository configuration supplies commands):

  ```yaml
  # .github/workflows/ci.yml in a product repo
  jobs:
    lint:
      uses: jrmoulckers/.github/.github/workflows/reusable-ci-lint.yml@<reviewed-commit-sha>
      with:
        package-manager: pnpm
        lint-command: pnpm lint
        format-check-command: pnpm format:check
    web:
      uses: jrmoulckers/.github/.github/workflows/reusable-ci-web.yml@<reviewed-commit-sha>
      with:
        package-manager: pnpm
        build-command: pnpm build
        test-command: pnpm test
  ```

  | Workflow | Purpose |
  | --- | --- |
  | `reusable-caller-permissions.yml` | pre-merge caller permission-ceiling lint with whole-file blast radius |
  | `reusable-ci-lint.yml` | ESLint/Prettier + semantic PR title |
  | `reusable-ci-web.yml` | install → typecheck → test → build |
  | `reusable-change-detection.yml` | immutable base/head diff with validated literal path groups |
  | `reusable-deploy-pages.yml` | production Pages build/artifact/deploy with split authority |
  | `reusable-deploy-preview.yml` | private preview artifact build or same-run artifact verification |
  | `reusable-perf-budget.yml` | bundle budget + optional private-by-default Lighthouse reports |
  | `reusable-security-ci.yml` | package audit + secret scan + PR dependency review |
  | `reusable-smoke-test.yml` | standalone or artifact-based release/HTTP smoke check |

  `reusable-ci-web` can upload a named build artifact. Preview, performance, and smoke jobs can
  consume that artifact in the same workflow run when the caller declares `needs`; otherwise each
  retains a frozen-install standalone mode. Artifacts from untrusted PRs never enter a job with
  deployment secrets or write authority.

  Consumer workflows own CI concurrency so parallel reusable jobs do not cancel sibling calls.
  Production Pages is the exception: canon serializes repository deployments without cancelling an
  in-progress deploy.

  **Breaking preview change:** `provider`, `preview-command`, `DEPLOY_TOKEN`, and `preview-url` were
  removed. Preview canon is artifact-only. Provider deployments belong in reviewed,
  environment-gated consumer jobs that do not execute PR-controlled shell with credentials.

### 2. Synced canon — distributed by the sync tool

Copilot **does not** auto-inherit `agents/`, `skills/`, `prompts/`, `instructions/`, `AGENTS.md`,
`agency.toml`, or `copilot-instructions.md` across repos. They are the **canonical source** that a
scheduled sync tool copies into each product repo's `.github/…`, based on what that repo opts into in
[`studio.config.json`](studio.config.json). See **[`docs/sync.md`](docs/sync.md)** for the intended
flow and **[`sync/README.md`](sync/README.md)** for the implemented engine.

| Canon | Count | Synced to (in product repo) |
| --- | --- | --- |
| `agents/*.agent.md` | 22 | `.github/agents/` |
| `skills/<name>/SKILL.md` | 17 | `.github/skills/` |
| `prompts/*.prompt.md` | 8 | `.github/prompts/` |
| `instructions/*.instructions.md` | 6 | `.github/instructions/` |
| `AGENTS.md` | — | repo root — managed region; members extend it around the markers |
| `agency.toml` | — | repo root — whole-file copy |
| `copilot-instructions.md` | — | `.github/copilot-instructions.md` — managed region |
| `.gitattributes` | — | repo root — managed region; canonical LF normalization, members keep their own binary/LFS rules |

`AGENTS.md`, `agency.toml`, `copilot-instructions.md`, and `.gitattributes` are selected by four
**independent** booleans (`base`, `runtime`, `copilot`, `attributes`), so declining the studio
operating guide does not also decline MCP policy, Copilot orientation, or LF normalization — see
[ADR-0006](docs/architecture/0006-runtime-and-copilot-canon-kinds.md) and
[ADR-0009](docs/architecture/0009-canonical-line-ending-normalization.md).

## The AI layer

- **Agents** are cross-cutting roles (architecture, backend, database, native app, web, design,
  DevOps, SRE, QA, security, accessibility, docs, product, release, performance, product data,
  AI ops, business, experimentation, localization, marketing, and compliance). Each is genericized
  so a product repo can keep concise stack/path/risk overlays without forking the shared persona.
- **Skills** are reusable playbooks (`trigger · inputs · method · safety · output`) for
  accessibility, design tokens, performance budgets, security review, UX testing, prompt
  engineering, issue/project/sprint management, i18n, onboarding, MCP tooling, go-to-market,
  monetization, and privacy compliance.
- **Prompts** drive bounded backlog, bug-bash, cleanup, CI repair, rebase, review, sprint, and team
  workflows; **instructions** attach path-scoped standards via `applyTo` globs.

### MCP runtime policy

`agency.toml` pins every npm package and uses explicit per-server tool names. Context7
(`@upstash/context7-mcp@4.0.0`) and sequential-thinking
(`@modelcontextprotocol/server-sequential-thinking@2026.7.4`) are enabled because their published
servers expose only the bounded documented tools listed in the file.

Playwright (`@playwright/mcp@0.0.79`) and memory
(`@modelcontextprotocol/server-memory@2026.7.4`) remain pinned, commented opt-in examples.
`agency.toml` tool-filter enforcement is not documented for the consuming host, so enabling a
browser-control or persistent-memory server requires a local runtime policy and evidence that the
host exposes exactly the reviewed allowlist. Never enable wildcard tools or Playwright's unsafe code
execution/evaluation tools.

### Prompt runtime contract

The canonical prompt roster is `backlog`, `bug-bash`, `cleanup`, `fix-ci`, `rebase-all`, `review`,
`sprint`, and `team`. Prompt frontmatter declares typed parameters, interpolation bounds, Copilot
App/CLI built-ins, and required canonical agents. The zero-dependency integrity validator rejects
roster drift, invalid defaults/bounds, unresolved interpolation placeholders, unsupported
`gh pr checks` fields, unknown agent references, and member selections that omit a required role.

`parameters` and `{{ parameter }}` interpolation are Copilot App/CLI prompt contracts. Likewise,
`task` and `code-review`, agent polling (`read_agent` / `list_agents`), and SQL todos are runtime
built-ins; they are not custom-agent slugs from `.github/agents/`. A runtime that cannot provide a
declared capability or interpolation must fail before dispatch or mutation rather than silently
degrading. Dynamic team/sprint roles still require the product's root/scoped routing authority;
discovery of an agent file alone does not make a role applicable.

Design principle: **decide it once, reuse it everywhere.** Proven practice becomes shared canon;
new products start with the studio's accumulated craft on day one.

## Contributing to the backbone

This repo is the canonical source — edits here propagate to the whole studio. Keep everything
**product-neutral and framework-agnostic**. Follow [`AGENTS.md`](AGENTS.md),
[`CONTRIBUTING.md`](CONTRIBUTING.md), and the authoring standards in
[`instructions/`](instructions/) (`skills.instructions.md`, `agents.instructions.md`). Conventional
commits; no secrets.
