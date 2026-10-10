---
name: test-driven-development
description: Use for every code change. Strict red-green-refactor, commit evidence, test layers and rules.
---

# Test-driven development

No production code without a failing test that demands it.

Loop per behaviour:
1. Red: one test, run it, see it fail for the right reason. Commit `test(<scope>): <rule> (red)` with only the test.
2. Green: least code to pass, run it by name. Commit `feat(<scope>): <rule>` (or `fix`).
3. Refactor with tests green, in the green commit or as its own `refactor(<scope>): ...` commit right after it.
Push green heads only. One tiny rule may batch several tests.

Layers:
- Unit (beside the file): value objects, aggregates, use cases with hand-written in-memory fakes. No mocking libraries; assert outcomes and stored state, not calls. Thin I/O adapters may use spies.
- Integration: adapters, raw SQL and the real composition against a real database in a container.
- End to end (few): interact via `data-testid="{area}-{element}"`, assert via role or text.

Rules:
- Name tests as the rule, in domain language: `refuses a second claim while a lease is held`.
- One outcome per test; inputs from named factories (`aShip(...)`); inject clock and id generator.
- Each rule: happy path, every failure, boundaries (exact limit and one over).
- Every invariant has a test that fails if the rule is removed. A guarantee without a test does not exist.
- Done: typecheck, lint and tests green; confirm new tests appear by name in the output.
