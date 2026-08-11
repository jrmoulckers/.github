# Contributing to JRM Studio

Thank you for contributing to a JRM Studio project! These shared guidelines apply across JRM Studio repositories and are inherited by product repos as default community-health files.

> **AI tools are not required to contribute.** GitHub Copilot and studio agents can help, but every contribution — from typo fixes to new features — is welcome with any editor and workflow you prefer.

## Code of Conduct

All contributors are expected to follow our [Code of Conduct](CODE_OF_CONDUCT.md). Please read it before participating.

## Quick Contributions

For small changes like fixing a typo, improving docs, or correcting a comment:

1. Fork the repository.
2. Create a branch for your change.
3. Make the smallest clear edit that solves the issue.
4. Open a pull request with a concise summary and testing notes.

Documentation-only changes usually do not need a full local build. If you are looking for a place to start, check issues labeled `good first issue` or `help wanted`.

## Issue-First Workflow

JRM Studio uses an issue-first, PR-always workflow:

1. Find or create a GitHub issue before starting work.
2. Work on a feature branch; do not commit directly to the default branch.
3. Use Conventional Commit messages with an issue reference: `type(scope): description (#N)`.
4. Push your branch and open a pull request against the default branch.
5. Include `Closes #N` in the PR body.
6. Run the repository's lint, format, test, type-check, and build commands as applicable.
7. Keep the PR focused, reviewable, and free of merge conflicts.

A change left only on a local branch is not complete.

## Getting Started

Each product repository defines its own stack, setup commands, and validation scripts. In general:

```bash
git clone https://github.com/jrmoulckers/<repository>.git
cd <repository>
git checkout -b <type>/<short-description>
```

Then read the repository's `README.md`, `AGENTS.md`, and any local setup documentation for product-specific requirements.

## Commit Messages

Use [Conventional Commits](https://www.conventionalcommits.org/):

```text
type(scope): description (#N)
```

Supported types:

- `feat` — new user-facing capability
- `fix` — bug fix
- `docs` — documentation-only change
- `style` — formatting or style-only change
- `refactor` — code change without behavior change
- `test` — tests or test infrastructure
- `chore` — maintenance
- `ci` — CI/CD changes
- `perf` — performance improvement

When AI agents create commits, include:

```text
Co-authored-by: Copilot <223556219+Copilot@users.noreply.github.com>
```

## Before Opening a PR

Run the checks documented by the repository you are changing. Typical gates include:

- Formatting and linting
- Type-checking or static analysis, where available
- Affected unit and integration tests
- Build or package validation, where available
- Documentation updates for changed behavior

If a check cannot be run locally, note why in the PR.

## Security, Privacy, and Accessibility

- Never commit secrets, credentials, access tokens, private keys, or real production data.
- Use placeholders in tracked examples and keep real values in git-ignored local files.
- Avoid logging sensitive data.
- Validate and sanitize external input.
- Follow the repository's accessibility expectations for user-facing changes.
- Document important design or architecture decisions in the repository's ADR location when applicable.

## Pull Requests

A good PR includes:

- A linked issue (`Closes #N`)
- A short summary of what changed and why
- Testing or validation performed
- Screenshots or recordings for UI changes, when useful
- Documentation updates, when behavior or setup changes
- Confirmation that no secrets or product-private data were added

## Need Help?

Use GitHub Discussions for questions and proposals, or open a focused issue when there is a clear task, bug, or feature request.
