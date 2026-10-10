---
name: aeolus-fleet-testing
description: Mandatory with test-driven-development for every aeolus-fleet code change. Scope, paths, guarantees and what CI enforces.
---

# Testing in aeolus-fleet (decision 0014)

Load with `test-driven-development`.

- Strict for server and common; web: tests alongside.
- Commit scope is the context: `test(<context>): <rule> (red)`.
- Unit: Vitest. Integration: `packages/core/test/*.integration.test.ts`, Testcontainers Postgres 16. End to end: Playwright.
- Guarantees: concurrent receivers never share a delivery; a forced mid-transaction failure stores nothing and wakes nobody; a restart loses nothing.
- Names in blueprint language. Boundaries include the 64 KB payload, exact and one over.
- Done: `npm run typecheck`, `npm run lint`, `npm test`.

Enforced by lint/CI (`eslint.config.js`, `scripts/`): a `feat` or `fix` commit touching production code comes right after a `(red)` commit with only tests (every other commit type passes), a test beside every use case, every test in a Vitest project, no `vi.mock`, no `vi.fn` or `vi.spyOn` in core and common.
