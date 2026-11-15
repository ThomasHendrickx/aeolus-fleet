# Scale plan tests

Use `seedScaleFleet(core)` once in `beforeAll` on a fresh `createPostgresCore()` database, then `assertIndexedPlan(core.prisma, statement)` in the scenario:

```ts
const { fleetId } = await seedScaleFleet(core);
await assertIndexedPlan(core.prisma, firstDeliveriesStatement(fleetId, [messageId]));
```

The fixture creates 3,000 ships including argo, 120,000 messages, one delivery per message and their acceptance/dismissal events. Argo sends to the other ships in rotation. The first 115,000 messages are dismissed and 90 days old; the last 5,000 are pending and 30 minutes old, relative to the test clock. IDs use the entity prefix and a 26-digit sequence starting at 1. Events start above sequence 1,000,000; the returned `firstSeq` and `lastSeq` bound that history. The fleet's last event sequence is updated and PostgreSQL statistics are analysed. This is synthetic plan data, not a replay of sends or a fixture for rollup counts.

Add scenario-specific rows afterwards, using distinct IDs, then run `ANALYZE` again. For a different history distribution, pass a `messages` count and a parameterised `rows` SELECT: the SELECT returns `i` (unique integer starting at 1), `recipient` (a seeded ship ID), `sent_at` (timestamptz) and `waiting` (boolean). The catch-up test shows an hourly distribution. The shared inserts and ship population stay the same; use at least the default history size for scale proofs.

`assertIndexedPlan` runs EXPLAIN, never EXPLAIN ANALYZE. It rejects sequential scans of messages, deliveries or events anywhere in the JSON plan, including parallel nodes, and returns the JSON text for stricter index assertions. Pass parameterised `Prisma.Sql`, or `{ query, params }` captured from `createPrismaClientTellingStatements` when the adapter builds its SQL internally. The latter accepts only this test client's SQL and JSON parameters, never external input. Planner settings stay at PostgreSQL defaults in query tests; the helper's rejection scenarios disable indexes locally to prove the guard.

Run only the changed integration files with `npm run test:integration -- --maxWorkers=1 --reporter=verbose <paths>`.
