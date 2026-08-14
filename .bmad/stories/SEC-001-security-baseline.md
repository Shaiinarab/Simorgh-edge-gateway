---
id: SEC-001
title: Establish a non-deploying security and CI baseline
status: done
priority: P1
owner: Engineering
scope: Simorgh-edge-gateway
created: 2026-08-14
completed: 2026-08-14
implementation_commit: 5170b57387ea43a2b945464485b1a4b107825bc6
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

- **Blocked: shared sprint ledger.** The expected workspace (`/home/ubuntu/github_bmad_workspace`) and its `sprint-status.yaml` are absent from this environment. This story is complete in-repository, but the shared ledger cannot be updated or treated as current until the workspace is restored or supplied.
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
| GitHub Actions security baseline | Passed | [Run 31821680796](https://github.com/Shaiinarab/Simorgh-edge-gateway/actions/runs/31821680796) completed successfully for commit `5170b57`. |

## Residual risk

`npm ci` still reports four high-severity advisories in the development-only Wrangler/Miniflare dependency chain. The available automated remediation moves Miniflare to an alpha release, so it is deferred rather than applied blindly. The production dependency graph is clean at this story's high/critical audit threshold after updating Hono to `^4.13.2`.

## Handoff

SEC-001 is complete. Its final documentation update will be committed and pushed, then the same read-only CI workflow will be verified once more. The recommended next engineering loop is to resolve the remaining high-severity development-toolchain advisories through a version-compatibility investigation rather than an unreviewed alpha upgrade.
