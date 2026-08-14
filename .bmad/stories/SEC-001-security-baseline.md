---
id: SEC-001
title: Establish a non-deploying security and CI baseline
status: in-progress
priority: P1
owner: Engineering
scope: Simorgh-edge-gateway
created: 2026-08-14
---

# SEC-001: Establish a non-deploying security and CI baseline

## Outcome

Make the repository's current security posture continuously observable without changing deployed Worker behavior, enabling provider credentials, or widening the product surface. This story deliberately excludes deployment, Cloudflare account changes, Dependabot activation, scheduled automation, and API authorization redesign.

## Evidence and rationale

The default branch currently has no GitHub Actions workflow, while GitHub reports that Dependabot alerts are disabled. The existing `package.json` already defines `typecheck` and a non-deploying `check` command (`tsgo --noEmit` plus `wrangler deploy --dry-run`), so the smallest valuable loop is to make these checks and a production-dependency audit repeatable in local development and continuous integration.

## Acceptance criteria

| ID | Criterion | Validation sensor |
|---|---|---|
| AC-1 | A workflow runs on pull requests and pushes to `main` without deployment permissions or secrets. | Workflow file inspection and GitHub Actions result. |
| AC-2 | The workflow installs exact locked dependencies and fails on high or critical production dependency advisories. | `npm ci` and `npm run security:check`. |
| AC-3 | The workflow runs the existing strict TypeScript check and Worker dry-run. | `npm run check`. |
| AC-4 | The repository documents the security checks, responsible disclosure channel, and the explicit non-goals of this baseline. | Markdown review against this story. |
| AC-5 | The change introduces no credentials, secret values, scheduled workflows, or deployment commands. | Diff review and secret-pattern scan. |

## Implementation plan

1. Add a `security:check` script that audits production dependencies at the high-severity threshold.
2. Add a least-privilege GitHub Actions workflow with read-only permissions that runs dependency installation, security audit, and non-deploying checks.
3. Add a `SECURITY.md` policy and a short README section that accurately describe the baseline and its limits.
4. Verify locally, run an independent diff review, then commit and push the narrow change.

## Risks and decision notes

The repository currently exposes API routes with permissive CORS and does not provide a user-authentication boundary. That is a separate product and threat-model decision, not a safe incidental change in this baseline. Dependabot is also intentionally left unchanged because enabling it is a repository-security setting change that needs a separate approved decision.

## Definition of done

All acceptance criteria pass locally and in GitHub Actions, with the final commit and workflow URL recorded in the loop handoff.

## Deferred findings

- Restore or locate the shared BMad workspace and its sprint ledger before claiming a complete BMad Loop preflight.
- Decide whether to enable Dependabot alerts after confirming notification ownership and repository-security policy.
- Create a threat-model story for API access control, CORS policy, rate limits, and public retrieval of context or user-log routes.

## Validation record

| Check | Result | Evidence |
|---|---|---|
| Locked dependency installation | Passed | `npm ci` completed against the updated `package-lock.json`. |
| Production dependency audit | Passed | `npm run security:check` reported zero vulnerabilities at the high/critical threshold. |
| Strict TypeScript check | Passed | `npm run typecheck` completed successfully. |
| Worker build dry-run | Passed | `npm run check` completed successfully with `wrangler deploy --dry-run`; no Worker was deployed. |
| Diff whitespace check | Passed | `git diff --check` reported no errors. |

## Residual risk

`npm ci` still reports four high-severity advisories in the development-only Wrangler/Miniflare dependency chain. The available automated remediation moves Miniflare to an alpha release, so it is deferred rather than applied blindly. The production dependency graph is clean at this story's high/critical audit threshold after updating Hono to `^4.13.2`.

## Handoff

The next action is an independent diff and secret-exposure review, followed by a small commit, push, and GitHub Actions verification if that review passes.
