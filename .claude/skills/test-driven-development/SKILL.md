---
name: test-driven-development
description: MANDATORY for every code change in Aeolus. Strict test-driven development (red, green, refactor) for core and adapters, test layers, naming, fakes versus mocks, Testcontainers, guarantee tests, Playwright, and how the red step shows in the commit history. Load before writing the first line of production code.
---

# Test-driven development in Aeolus

Test-driven development is strict (decision 0014). No production code in `packages/server` or `packages/common` is written without a failing test that demands it. In `packages/web`, tests are written alongside the code.

## The loop

1. **Red.** Write one test for the next behaviour. Run it and see it fail for the expected reason (not a syntax or import error). Paste nothing; just be sure of the reason.
2. **Green.** Write the least production code that makes it pass. Run it and see it pass by name.
3. **Refactor.** Clean up production and test code with the tests green. Run them again.
4. Repeat with the next behaviour. Small steps: one behaviour per loop.

## Evidence in the history

Each behaviour lands as a red commit followed by a green commit:

- `test(registry): argo cannot be retired (red)`: only the new failing test.
- `feat(registry): refuse to retire argo`: the production code that makes it pass, plus any refactor.

A red commit is the one exception to "green before every commit". Push only when the branch head is green, so CI never runs a red head. Several related behaviours may be batched as one red commit and one green commit when they are one small rule.

## Test layers

| Layer | What | Where | Tools |
| --- | --- | --- | --- |
| Unit | Value objects, aggregates, use cases | Next to the file: `ship.test.ts` | Vitest, in-memory ports |
| Integration | Adapters against real Postgres: repositories, raw SQL, locking, NOTIFY, the tRPC procedures through the real composition | `packages/server/test/*.integration.test.ts` | Vitest, Testcontainers Postgres 16 |
| Guarantee | The delivery promises: concurrency, rollback, restart | `packages/server/test/` | Testcontainers, real concurrent clients |
| End to end | A few critical console journeys | `packages/web/e2e/` | Playwright |

Many unit tests, fewer integration tests, very few end-to-end tests. A variation of a flow becomes a unit test, not another end-to-end test.

## Writing good tests

- Test behaviour through the public function, never private helpers or internal state. Renaming an internal variable must not break a test.
- Name tests as the rule they prove, in the ubiquitous language: `it('refuses a second claim while a lease is held')`. The `describe` names the unit.
- Arrange, act, assert. One outcome per test.
- Build inputs with small named factories (`aShip({ name: 'reviewer-01' })`), not copied object literals.
- Control time and ids: inject `Clock` and `IdGenerator`; never call `Date.now()` or random in core.
- Use hand-written in-memory fakes of ports (as in `core/shared/ping.test.ts`), not mocking libraries. A fake behaves like the real thing; a mock only checks calls. Assert on outcomes and stored state, not on which port method was called.
- Every rule gets its happy path, each failure path, and its boundaries (empty, one, maximum, 64 KB exactly and one byte over).
- Every invariant in the blueprint's "Aggregates and invariants" table has at least one unit test that fails if the rule is removed.

## Guarantee tests

A delivery guarantee without a test does not exist (CLAUDE.md). For each guarantee, write the test that would catch its violation:

- Concurrency: many receivers race for the same deliveries; assert no delivery is returned twice.
- Rollback: force a failure mid-transaction; assert nothing was stored and nobody was woken.
- Restart: stop and restart the server between steps; assert nothing was lost.

## End-to-end tests

Interact through `data-testid` attributes (`{area}-{element}`, for example `sign-in-secret`, `sign-in-submit`). Assert what the user sees with `getByRole` or `getByText`.

## Before you say done

Run `npm run typecheck`, `npm run lint` and `npm test`. Report a test as passing only after you saw it run by name. A test file outside the Vitest projects never runs; check that your new test appears in the output.
