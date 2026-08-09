# ADR-0007: Optional private-registry authentication in Node-installing reusable workflows

## Status

Accepted. Amends ADR-0005.

## Context

`jrmoulckers/engineering` publishes shared toolchain packages to GitHub Packages under the
`@jrmoulckers` scope. Product repos consuming them cannot install dependencies through the
backbone's reusable workflows: `actions/setup-node` was called without `registry-url` or `scope`,
the install steps received no `NODE_AUTH_TOKEN`, and `workflow_call` declared no secrets. Any scoped
private dependency fails with a 401.

ADR-0005 decided that reusable workflows "never receive secrets in untrusted build jobs", and
removed `DEPLOY_TOKEN` from preview precisely because a deployment credential must not sit on the
same runner as pull-request-controlled code. That reasoning is about *write* authority. A registry
*read* token is a different risk class, but the blanket phrasing left no room for it, so the
exception has to be stated rather than assumed.

## Decision

1. `reusable-ci-lint`, `reusable-ci-web`, `reusable-deploy-pages`, `reusable-deploy-preview`,
   `reusable-perf-budget`, and `reusable-smoke-test` accept two optional `workflow_call` inputs,
   `registry-url` and `registry-scope`, both defaulting to empty.
2. The same six accept one optional `workflow_call` secret, `NODE_AUTH_TOKEN`. It is the **only**
   secret any canonical reusable workflow may declare; integrity validation enforces that allowlist,
   and `secrets: inherit` remains forbidden. `DEPLOY_TOKEN` and provider deployment stay removed.
3. Both new inputs are validated in the existing `Validate inputs` step and reach the shell through
   environment variables. `registry-url` must be a credential-free HTTPS URL with no whitespace;
   `registry-scope` must be a lowercase npm scope. A scope without a URL is an error; a URL without a
   scope warns, because it replaces the default registry for every package.
4. The job that installs declares `packages: read`, which `GITHUB_TOKEN` requires to read a GitHub
   Packages package at all. The explicit per-job permission style and the validator's exact-match
   permission ceilings are preserved.
5. Empty inputs are a genuine no-op: `actions/setup-node` guards its auth configuration behind
   `if (registryUrl)`, so an empty `registry-url` writes no `.npmrc` and exports nothing. A caller
   that adopts none of the new surface produces the run it produced before.
6. `NODE_AUTH_TOKEN` resolves as
   `${{ inputs.registry-url != '' && (secrets.NODE_AUTH_TOKEN || github.token) || '' }}`. The
   `secrets.X || github.token` fallback makes GitHub Packages zero-config: a caller that has granted
   package access via **Manage Actions access** passes no secret, which is the path GitHub
   recommends over storing a PAT. An explicit secret still wins, so a third-party registry or a
   PAT-based flow is unaffected. This was verified with a live three-scenario workflow run: with the
   `secrets:` block omitted and with `secrets: inherit`, `secrets.NODE_AUTH_TOKEN` is the empty
   string and the fallback yields `github.token`; with an explicit value, that value is used.
7. The `inputs.registry-url != ''` guard is deliberate. Without it, every caller — including the
   majority that use no private registry — would place a `GITHUB_TOKEN` in the environment of a step
   that executes arbitrary dependency lifecycle scripts. Gating on `registry-url` confines the token
   to runs that opted into a registry and keeps the default path's environment byte-identical.
8. `reusable-security-ci` is deliberately **not** changed. Its `npm audit` / `pnpm audit` step sends
   the bulk advisory request to the default registry only (`@npmcli/arborist` uses
   `options.auditRegistry || options.registry`, never a per-scope registry), so a private scoped
   package in the lockfile does not cause a `401`. Verified empirically for both package managers.

## Consequences

- **Callers with an explicit `permissions:` block must add `packages: read` when they re-pin.** A
  called workflow cannot hold a scope its caller lacks, so omitting it produces a bare
  `startup_failure` with no readable log. Callers that omit `permissions:` entirely are unaffected.
- The npmrc that `setup-node` writes is **user**-level (`$RUNNER_TEMP/.npmrc`, exported through
  `NPM_CONFIG_USERCONFIG`). A repo's committed `.npmrc` is **project**-level and outranks it on every
  key it sets, in both npm and pnpm. A project `.npmrc` that points the same scope at a different
  registry silently wins and the install still fails.
- pnpm needs nothing extra: its config layer reads `npm_config_*` environment variables, honours
  `NPM_CONFIG_USERCONFIG` as the trusted user config, and expands `${NODE_AUTH_TOKEN}` the same way
  npm does. `setup-node` always exports `NODE_AUTH_TOKEN`, including a placeholder when the secret is
  absent, which keeps pnpm's env expansion from erroring.
- The token is a read credential scoped to package download. It does not widen what pull-request code
  can write, and the untrusted-artifact and deployment-isolation boundaries of ADR-0005 are unchanged.

## Rejected alternatives

**Write `.npmrc` by hand in a run step.** Rejected because it puts a credential into generated shell
source, which is exactly the interpolation boundary the existing validation posture forbids.

**Gate the `setup-node` inputs behind a conditional step.** Rejected as unnecessary duplication: the
action already treats an empty `registry-url` as a no-op, so a single step keeps the default path
byte-for-byte identical without a second copy to drift.

**Make the registry inputs required, or infer them.** Rejected because most callers install only
public packages, and a required input would break every existing caller.

**Hardcode `registry-url: https://npm.pkg.github.com` and `scope: '@jrmoulckers'`.** Rejected. The
backbone must not encode a sibling authority's package scope; ADR-0003 keeps those authorities
separable, and hardcoding would make these workflows unusable for any caller consuming a different
private registry. Inputs cost nothing and preserve both properties.

**Fall back to `github.token` unconditionally, without the `registry-url` guard.** Rejected. It
would hand a `GITHUB_TOKEN` to dependency lifecycle scripts on every run, including the majority
that configure no registry, in exchange for no benefit those runs can use.
