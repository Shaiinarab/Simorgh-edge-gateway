# Security policy

## Supported version

Security fixes are applied to the latest commit on the `main` branch. This project is an early-stage Cloudflare Worker and does not publish versioned support windows yet.

## Reporting a vulnerability

Please do **not** include vulnerability details, API keys, access tokens, request payloads containing personal data, or proof-of-concept exploit code in a public issue.

Use a private GitHub security advisory for this repository when possible: <https://github.com/Shaiinarab/Simorgh-edge-gateway/security/advisories/new>. Include a concise impact description, affected route or dependency, steps to reproduce using redacted data, and any mitigation you have verified. If private reporting is unavailable, contact the repository owner through GitHub without sharing secrets in the initial message.

## Current security baseline

The repository verifies the following controls locally and in GitHub Actions:

- Locked dependency installation with `npm ci`.
- A production-dependency audit that fails on high- and critical-severity findings: `npm run security:check`.
- Strict TypeScript validation and a Cloudflare Worker build dry-run: `npm run check`.
- A read-only CI workflow that contains no deployment step, credentials, or secrets.

This baseline is intentionally limited. It does **not** configure GitHub Dependabot, deploy a Worker, enable scheduled automation, or establish an authentication, authorization, rate-limiting, or restrictive CORS policy for the API. Those decisions require dedicated threat-model and product stories.

## Credential handling

Provider credentials belong in Cloudflare Worker secrets and must never be committed to this repository, pasted into issues, or included in logs, screenshots, test fixtures, or documentation. The gateway must remain functional with optional provider adapters dormant when their keys are absent.
