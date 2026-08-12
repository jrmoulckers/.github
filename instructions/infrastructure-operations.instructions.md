---
applyTo: '**'
description: 'Infrastructure and operations practice. Use for runners, environments, deployment, secrets handling, spending limits, incident response, and runbooks.'
---

# Infrastructure Operations

This instruction is selected only for repositories whose local policy governs live systems,
devices, or infrastructure. It does not grant a canonical agent access to a host.

## Authority and Routing

- Root/local `AGENTS.md`, more-specific scoped instructions, local runbooks, and the human operator
  define the system of record, tools, confirmation protocol, and operational authority. The more
  specific local rule wins.
- Use only locally approved routing and tooling. Prefer a member's declared `localAgents` for live
  operations; discovery of a generic canonical agent does not authorize host access, remote shell,
  deployment, service control, secret access, or mutation.
- Never infer live authority from repository write access, an issue, a PR, or a canonical role.

## Operating Modes

**Repo-first is the default for durable change.**

1. Capture the intended state in the canonical repository source.
2. Validate syntax, policy, plan/diff, and rollback instructions before touching a host.
3. Obtain every confirmation required by local operator policy.
4. Apply through the repository's approved tool and verify service health and drift.

**Host-first is reserved for incident containment, recovery, or locally documented exceptions.**

1. Record the observed state, reason, operator, target, and start time before mutation when safe.
2. Preserve a last-known-good state and prepare rollback.
3. Make the smallest approved live correction.
4. Verify the immediate result, then reflect the exact live state back into canonical repository
   state through the required issue/PR flow before declaring the operation complete.
5. Run reconciliation or drift checks until repository and live state agree.

## Confirmation and Recovery Gates

- Obtain explicit, immediate human confirmation before an irreversible operation or one that can
  cause destructive data loss, lockout, external exposure, credential or firewall changes,
  destructive storage/network actions, restore/rebuild, or loss of management access.
- Before auth, network, firewall, reboot, storage, or remote-access changes, identify the
  last-known-good configuration, a tested rollback command or procedure, and an independent second
  access path. If any is unavailable, stop.
- Take or verify backups when local policy requires them; a backup claim is insufficient without the
  documented restore/health evidence appropriate to the system.
- Execute one bounded change at a time. Do not combine remediation, cleanup, upgrades, and policy
  changes into an unreviewable live batch.

## Validation, Reconciliation, and Logging

- Validate preconditions, the exact target, and the planned diff before execution.
- After execution, check command status, service health, expected external/internal reachability,
  logs/metrics, and configuration drift using repository-approved checks.
- Record an operations log with timestamp, operator/agent, mode, target, commands or automation
  invoked, confirmation evidence, before/after state, validation, rollback readiness, and outcome.
  Never record secrets.
- A failed validation triggers rollback or the local incident protocol; it never becomes a
  success-shaped fallback.
- Completion requires reconciled canonical state, a clean drift result or documented exception, and
  every local closeout step. Local operator authority decides whether and when the live change or
  its repository PR may proceed.
