# JRM Studio

**A family of small, independent products that share one backbone.**

JRM Studio builds focused apps that each live in their own repository and ship on their own
schedule — but they're cut from the same cloth. Shared work practice, a common AI agent/skill
layer, community-health defaults, and reusable CI all come from one place: the
[`jrmoulckers/.github`](https://github.com/jrmoulckers/.github) backbone repo. Shared packages
publish under the **`@jrm`** npm scope.

## The product family

| Product | What it is |
| --- | --- |
| **jrm-recipes** | A recipe app for cooking and meal planning. |
| **score-king** | A game-night scoring companion with per-game personality. |
| **finance** | A privacy-first, edge-first personal finance tracker. |
| _…more to come_ | New products join the family and inherit the same DNA. |

## Shared DNA (Option A: independent repos, common backbone)

Each product repo stays independent and owns its stack. What they share flows from the backbone:

- **A canonical AI layer** — product-agnostic Copilot agents, skills, prompts, and instructions,
  plus a base `AGENTS.md` operating guide and a shared MCP `agency.toml`. Product repos adopt the
  cross-cutting roles and extend them with product-specific ones.
- **Community-health defaults** — one set of `CONTRIBUTING`, `SECURITY`, `CODE_OF_CONDUCT`, issue
  and PR templates, and discussion templates, inherited across the studio.
- **Reusable workflows** — framework-parametric CI/CD building blocks (lint, web CI, preview
  deploys, smoke tests, performance budgets) that any product calls by reference.

The philosophy: **decide it once, reuse it everywhere.** A practice proven in one product becomes
shared canon; new products start with the studio's accumulated craft on day one.

## How it fits together

- **Native inheritance** — health files and reusable workflows propagate through GitHub directly.
- **Synced canon** — the AI layer is distributed to each product repo by a cross-repo sync tool,
  driven by a manifest of which product opts into which assets.

Curious how it's wired? See the backbone repo's
[README](https://github.com/jrmoulckers/.github#readme).
