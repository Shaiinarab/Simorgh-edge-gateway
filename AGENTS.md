<!-- bmad:context -->
<!-- Verified 2026-08-14 against f2f2cec. Managed by BMad project context; edits inside this block are replaced on refresh. Keep anything that must be preserved outside the markers. -->

## Simorgh Edge Gateway

Cloudflare Worker gateway with provider-failover and Durable Object state. The README’s compliance boundary is part of the product behavior, not optional positioning.

## Policy

- Do not implement account rotation, scraped-key collection, or ban-evasion routing; use documented user keys, opt-in data sharing, honest backoff, or the local fallback instead.
- Keep provider adapters dormant when their key is absent; do not insert placeholder credentials to force a route active.

## Where things are

- Gateway entry and routes: `src/`; provider failover: `src/flock.ts`; worker bindings and deployment configuration: `wrangler.toml`.

## Running and verifying

- For deployment-affecting changes, use `npm run check`; it type-checks and runs `wrangler deploy --dry-run`. Do not treat `npm run deploy` as a validation command.

## Known pitfalls

- The provider catalog and Durable Object state encode routing and cooldown behavior; change either only with corresponding type-check and behavior review.

<!-- /bmad:context -->
