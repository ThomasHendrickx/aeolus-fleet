---
name: test-driven-development
description: Mandatory for every code change. Strict red-green-refactor, commit evidence, test layers and rules.
---

# Test-driven development (decision 0014)

Server and common: no production code without a failing test that demands it. Web: tests alongside.

Loop per behaviour:
1. Red: one test, run it, see it fail for the right reason. Commit `test(<context>): <rule> (red)`.
2. Green: least code to pass, run it by name. Commit `feat(<context>): <rule>`.
3. Refactor with tests green, in the green commit or as its own `refactor(<context>): ...` commit right after it (no `(red)` needed; behaviour does not change).
Push green heads only. One tiny rule may batch several tests.

Layers:
- Unit (Vitest, beside the file): value objects, aggregates, use cases with hand-written in-memory fakes. No mocking libraries; assert outcomes and stored state, not calls. Adapters (CLI, I/O) may use `vi.fn`.
- Integration (`packages/core/test/*.integration.test.ts`, Testcontainers Postgres 16): adapters, raw SQL, procedures through the real composition.
- Guarantees: concurrent receivers never share a delivery; a forced mid-transaction failure stores nothing and wakes nobody; a restart loses nothing.
- End to end (Playwright, few): interact via `data-testid="{area}-{element}"`, assert via role or text.

Rules:
- Name tests as the rule, in blueprint language: `refuses a second claim while a lease is held`.
- One outcome per test; inputs from named factories (`aShip(...)`); inject `Clock` and `IdGenerator`.
- Each rule: happy path, every failure, boundaries (64 KB exact and one over).
- Every blueprint invariant has a test that fails if the rule is removed.
- Done: `npm run typecheck`, `npm run lint`, `npm test`; confirm new tests appear by name in the output.

Enforced by lint/CI (`eslint.config.js`, `scripts/`): a `feat` or `fix` commit touching production code comes right after a `(red)` commit with only tests (every other commit type passes), a test beside every use case, every test in a Vitest project, no `vi.mock`, no `vi.fn` or `vi.spyOn` in core and common.
