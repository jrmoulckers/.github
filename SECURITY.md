# Security Policy

JRM Studio takes security seriously across its open-source and product repositories. We appreciate responsible reports that help keep projects and their users safe.

## Supported Versions

Unless a product repository documents a different policy, security fixes are applied to the default branch and the latest actively maintained release line.

| Version or branch | Supported |
| --- | --- |
| Default branch | :white_check_mark: Active |
| Latest release line | :white_check_mark: Active, when releases exist |
| Older releases | :x: Upgrade to a supported version |

## Reporting a Vulnerability

> **Do not open a public GitHub issue, pull request, or discussion for security vulnerabilities.**
>
> Public disclosure before a fix is available can put users and projects at risk.

### Preferred: GitHub Private Vulnerability Reporting

If the affected repository has GitHub Private Vulnerability Reporting enabled:

1. Open the repository's **Security** tab.
2. Go to **Advisories**.
3. Choose **Report a vulnerability**.
4. Include the details listed below.

### Alternative: Private Contact Placeholder

If private vulnerability reporting is unavailable, contact the maintainer privately through the repository owner's GitHub profile or use the repository's documented security contact.

Placeholder contact, if a repository chooses to enable one later: `security@example.com` (replace before use).

Use the subject line:

```text
[SECURITY] <repository> ? <brief description>
```

Do not send secrets, exploit code against third-party systems, or real user data in an initial message. Request a secure channel if sensitive details are required.

## What to Include

Please include enough information for maintainers to understand and reproduce the issue:

- **Summary** ? clear description of the vulnerability
- **Affected component** ? package, service, workflow, API, page, or feature
- **Reproduction steps** ? minimal steps to demonstrate the issue
- **Proof of concept** ? snippets, screenshots, or logs with sensitive data redacted
- **Impact** ? what an attacker could achieve
- **Severity estimate** ? Critical, High, Medium, or Low
- **Environment** ? OS, browser, runtime, dependency versions, or deployment context when relevant
- **Suggested fix** ? optional, but appreciated

## Severity Guide

| Severity | Examples |
| --- | --- |
| **Critical** | Remote code execution, authentication bypass, secret extraction, broad unauthorized data access |
| **High** | Privilege escalation, stored cross-site scripting, exploitable injection, sensitive data exposure |
| **Medium** | Limited data exposure, cross-site request forgery with user interaction, insecure defaults with realistic exploit path |
| **Low** | Minor information disclosure, hardening gaps, security-relevant misconfiguration with limited impact |

## What Not to Do

- Do not publicly disclose details before a fix or advisory is available.
- Do not exploit beyond the minimum necessary to demonstrate impact.
- Do not access, modify, delete, or exfiltrate data that is not yours.
- Do not attack third-party services, production systems, CI infrastructure, or other users.
- Do not perform denial-of-service testing.
- Do not share vulnerability details with third parties before coordination is complete.

## Response Timeline

JRM Studio is maintained as an independent open-source effort. These are target timelines, not guarantees:

| Stage | Target |
| --- | --- |
| Acknowledgment | Within 48 hours |
| Initial assessment | Within 1 week |
| Critical or High fix plan | As soon as practical after confirmation |
| Medium or Low fix plan | Next appropriate maintenance cycle |

Maintainers will follow up through the same private channel used for the report.

## Coordinated Disclosure

We follow coordinated disclosure:

1. Validate the report and scope.
2. Develop and test a fix.
3. Publish a security advisory or release notes when appropriate.
4. Credit the reporter unless anonymity is requested.

Please allow up to 90 days from the initial report before public disclosure unless maintainers agree to a different timeline.

## Scope

In-scope reports generally include:

- Authentication or authorization bypasses
- Injection vulnerabilities
- Cross-site scripting or request forgery with meaningful impact
- Secret exposure or insecure credential handling
- Insecure cryptography or key management
- Sensitive data exposure in logs, artifacts, builds, or APIs
- Dependency or supply-chain vulnerabilities exploitable in the repository's usage
- CI/CD or release workflow vulnerabilities that could alter trusted outputs

Out-of-scope reports generally include:

- Social engineering of users or maintainers
- Denial-of-service against local development, CI, or hosted services
- Issues only affecting unsupported versions
- Best-practice suggestions without a demonstrated exploit path
- UI/UX bugs without security impact
- Vulnerabilities in upstream dependencies with no repository-specific exploitability
- Attacks requiring physical access to an unlocked, authenticated device
- Self-XSS requiring a user to paste code into their own console

## Safe Harbor

JRM Studio supports good-faith security research. We will not pursue legal action against researchers who:

- Follow this policy and report through private channels
- Avoid privacy violations, data destruction, and service disruption
- Access only systems and data they are authorized to use
- Give maintainers reasonable time to fix before disclosure

If you are unsure whether research is in scope, contact maintainers privately before proceeding.

---

_This policy is a default for JRM Studio repositories. Product repositories may add stricter project-specific guidance._
