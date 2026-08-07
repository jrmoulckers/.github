<!-- markdownlint-disable MD041 -->

# `jrmoulckers/.github` — JRM Studio backbone

The single source of truth for **JRM Studio**: shared identity, community-health defaults, the
canonical (product-agnostic) AI layer, reusable CI/CD workflows, and the manifest that drives
cross-repo sync. Product repos (`jrm-recipes`, `score-king`, `finance`, and more) share DNA from
here plus `@jrm` npm packages.

> New to the studio? Start with **[`AGENTS.md`](AGENTS.md)** (base operating guide) and the
> **[studio profile](profile/README.md)**.

## What lives here

```
.
├─ profile/README.md          # JRM Studio account profile
├─ AGENTS.md                  # studio-wide base operating guide (product repos extend it)
├─ agency.toml                # shared MCP servers (context7, playwright, sequential-thinking, memory)
├─ studio.config.json         # manifest: members + per-repo opt-in canon (drives the sync tool)
├─ CONTRIBUTING.md            # ┐
├─ SECURITY.md                # ├─ default community-health files (inherited by member repos)
├─ CODE_OF_CONDUCT.md         # ┘
├─ agents/                    # 22 cross-cutting Copilot agents  (canonical source)
├─ skills/                    # 15 cross-cutting skills          (canonical source)
├─ prompts/                   # 7 reusable prompts               (canonical source)
├─ instructions/             # 5 path-scoped instructions       (canonical source)
├─ docs/sync.md               # design and operating model for cross-repo sync
└─ .github/
   ├─ ISSUE_TEMPLATE/         # bug · feature · task · spike · troubleshooting · config
   ├─ DISCUSSION_TEMPLATE/    # rfc · feature-proposal · question
   ├─ PULL_REQUEST_TEMPLATE.md
   └─ workflows/              # reusable-*.yml (called by product repos)
```

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
  copying. They're framework-parametric (Node + npm|pnpm; caller supplies commands):

  ```yaml
  # .github/workflows/ci.yml in a product repo
  jobs:
    lint:
      uses: jrmoulckers/.github/.github/workflows/reusable-ci-lint.yml@main
      with:
        package-manager: pnpm
        lint-command: pnpm lint
        format-check-command: pnpm format:check
    web:
      uses: jrmoulckers/.github/.github/workflows/reusable-ci-web.yml@main
      with:
        package-manager: pnpm
        build-command: pnpm build
        test-command: pnpm test
  ```

  | Workflow | Purpose |
  | --- | --- |
  | `reusable-ci-lint.yml` | ESLint/Prettier + semantic PR title |
  | `reusable-ci-web.yml` | install → typecheck → test → build |
  | `reusable-deploy-preview.yml` | build + PR preview (artifact or custom provider) |
  | `reusable-smoke-test.yml` | post-build web smoke check (`result` output) |
  | `reusable-perf-budget.yml` | bundle-size budget + optional Lighthouse CI |

### 2. Synced canon — distributed by the sync tool

Copilot **does not** auto-inherit `agents/`, `skills/`, `prompts/`, `instructions/`, `AGENTS.md`,
or `agency.toml` across repos. They are the **canonical source** that a scheduled sync tool copies
into each product repo's `.github/…`, based on what that repo opts into in
[`studio.config.json`](studio.config.json). See **[`docs/sync.md`](docs/sync.md)** for the intended
flow and **[`sync/README.md`](sync/README.md)** for the implemented engine.

| Canon | Count | Synced to (in product repo) |
| --- | --- | --- |
| `agents/*.agent.md` | 22 | `.github/agents/` |
| `skills/<name>/SKILL.md` | 15 | `.github/skills/` |
| `prompts/*.prompt.md` | 7 | `.github/prompts/` |
| `instructions/*.instructions.md` | 5 | `.github/instructions/` |
| `AGENTS.md`, `agency.toml` | — | repo root (product repos extend `AGENTS.md`) |

## The AI layer

- **Agents** are cross-cutting roles (architecture, backend, database, native app, web, design,
  DevOps, SRE, QA, security, accessibility, docs, product, release, performance, product data,
  AI ops, business, experimentation, localization, marketing, and compliance). Each is genericized
  so a product repo can keep concise stack/path/risk overlays without forking the shared persona.
- **Skills** are reusable playbooks (`trigger · inputs · method · safety · output`) for
  accessibility, design tokens, performance budgets, security review, UX testing, prompt
  engineering, issue/project/sprint management, i18n, onboarding, MCP tooling, go-to-market,
  monetization, and privacy compliance.
- **Prompts** drive multi-PR and sprint workflows; **instructions** attach path-scoped standards
  via `applyTo` globs.

Design principle: **decide it once, reuse it everywhere.** Proven practice becomes shared canon;
new products start with the studio's accumulated craft on day one.

## Contributing to the backbone

This repo is the canonical source — edits here propagate to the whole studio. Keep everything
**product-neutral and framework-agnostic**. Follow [`AGENTS.md`](AGENTS.md),
[`CONTRIBUTING.md`](CONTRIBUTING.md), and the authoring standards in
[`instructions/`](instructions/) (`skills.instructions.md`, `agents.instructions.md`). Conventional
commits; no secrets.
