# Holding scale

Design for [#1130](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1130) in core 0.40.0: purpose, lessons, decisions and build slices. Status: decided. Thomas agreed the purpose and all six picks, with pick 3 changed (decision 3).

[Performance at scale](performance/performance.md) is the first design for #1130. Thomas decided it, and its slices S2 to S7 are on main. Its decisions stand, except the per-candidate report of its decision 11, which decision 3 below replaces. This design asks what #1130 still needs before it can close, and how the fleet stays at scale as new features land.

## 1. Purpose (agreed)

Every read and every start of core stays within its budget at the target scale (10,000,000 messages and 3,000 ships in one fleet: p95 under 100 ms, p99 under 500 ms, errors under 1%), not only on the day the performance design's slices land, but for every feature after them. A read that would scan a fleet's history is found before it reaches staging, and #1130 closes on numbers, not on merged slices.

The outcomes:
1. One measured run at the target, on capped staging, reports every read against its budget: the "after" of the performance design, against S1's baseline. It runs when Thomas asks for it (decision 3).
2. A new or changed read on a fleet table proves before merge that it reads no fleet's whole history, the way #1834 and #1835 did.
3. History that only grows is kept as a rollup or snapshot with its rule written down, never replayed per call (performance design, outcome 4), for every read, not only health and storage.
4. A migration or start of core takes a bounded time at the target, so an upgrade does not hold the fleet down.

Not the purpose:
- Reopening any decision of the performance design, 0041 or 0042, beyond decision 3 below.
- The shared header: decision 6 of the performance design is pagasae's and is built (pagasae#122).
- New infrastructure: a cache product, a queue or a second database (0003).
- Changing what any page shows.

## 2. Lessons to check against

### What core 0.40.0 already fixed

| PR | What it fixed | How it proves it |
|---|---|---|
| [#1835](https://github.com/ThomasHendrickx/aeolus-fleet/pull/1835) (#1301) | Health replay joined new deliveries to messages and scanned the whole history on every event page; health reads, installation figures and the hourly snapshot close timed out | Indexed lookups by fleet and id; EXPLAIN on 3,000 ships, 120,000 messages, 5,000 sends after the checkpoint: no sequential scan |
| [#1833](https://github.com/ThomasHendrickx/aeolus-fleet/pull/1833) (#1302) | Retention pruned nothing at 10 M messages, because the snapshot close never finished | Test only: pruning after the close batches 500 at a time over 90 days of history, by plan |
| [#1834](https://github.com/ThomasHendrickx/aeolus-fleet/pull/1834) (#1276) | A send to a label reaches 3,000 ships; history and `ship.sentMessage` read every delivery of it | One indexed lookup per message; `ship.sentMessage` pages by cursor (breaking, decision 0013) |
| [#1827](https://github.com/ThomasHendrickx/aeolus-fleet/pull/1827) (#1202) | Possible owners read every active ship each minute (pagasae's reconcile) | Documents `fleet.list` with `shipKind`; a 3,000 ship paging test and plans |
| [#1824](https://github.com/ThomasHendrickx/aeolus-fleet/pull/1824) (#1823, open) | Unseen plain messages per exchange, for the gateway and app counts | Kept in the exchange rollup in the delivery's transaction, read from the existing index; plan test, no history scan |

With [#1822](https://github.com/ThomasHendrickx/aeolus-fleet/pull/1822) the scale tests assert query plans, not elapsed time: timers flaked under a loaded run.

### What the record shows

- **Every one of these was found after the performance design was built.** #1301, #1302 and #1197 were found by the staging seed at 10 M messages while walking a candidate; #1276 and #1202 by reading code. Each came from a feature built after S2 to S7 (label sends, retention, the snapshot itself, a reconcile in pagasae). The slices fixed the reads that existed; nothing stopped a new one.
- **One failure cascades.** The snapshot close timing out (#1301) stopped retention (#1302), which kept the history growing, which made every replay slower.
- **Plan tests work at the repo's fixture size.** 3,000 ships and 120,000 messages show the plan that 10 M messages would use; the plan, not the clock, is the proof (#1822). They are written per PR today, by choice, not by rule.
- **Starts and migrations are reads too.** The `message_days` backfill held core's start for minutes at 10 M messages (#1197); the first `installation.fleets.get` on a new fleet hung after its plugins were enabled (#1523, open, not reproduced).
- **The measurement.** The performance skill measures a finished piece of work on demand with the staging performance run (#1160). Decision 11 of the performance design has the walker report each read against its budget on every candidate; no budget appears in `scripts/staging-walk-gate.ts`, so that report lives outside this repository (aeolus-fleet-infra) or is not built. Not checked here.

### Decisions this checks against

- **Performance design, decisions 1 to 11:** the budgets (5), staging at the target with capped containers (7), the walker reports and never refuses (11), every list paged (4), reads cut per requirement (2).
- **0041, 0042:** health from the hourly stuck snapshot.
- **0003:** Postgres is the one system; rollups and snapshots live in it.
- **0011:** every candidate is walked on staging.
- **0013:** no compatibility layers before 1.0.0.
- **CLAUDE.md:** every query scoped by `fleet_id`; every state change writes its event in the same transaction; new rules, checks and process steps come only from Thomas, who made the ones below.

## 3. Decisions

Thomas answered option 1 on the purpose and every pick. His note on the measurement, verbatim: "But the performance measurement of the whole setup only happens when I ask for it. It can be proposed on a new release (minor not hotfix). Reason is that this takes an hour so halting every change for this to happen slows everything down drastically".

1. **#1130 closes on one measured run:** every read of the performance design on capped staging at the target, reported against its budget beside S1's baseline. A read over budget becomes an issue of its own, and #1130 closes with the report. The run happens when Thomas asks for it (decision 3).
2. **A plan test for every new or changed query on a fleet table, before merge.** Every query on a fleet table that a request, the pass or a start runs, new or changed, has a plan test: on the repo's scale fixture (3,000 ships, 120,000 messages), its EXPLAIN shows no sequential scan of messages, deliveries or events, as #1834 and #1835 do. One shared fixture and helper make a test a few lines. A CI check refuses a PR that adds or changes such a query without one. It runs in CI in seconds, needs no staging and does not flake (#1822).
3. **The whole-setup measurement runs only when Thomas asks for it.** It takes about an hour, so no change, slice or candidate waits for it. The orchestrator may propose it to Thomas for a minor release, never for a hotfix. There is no per-candidate walker report: this replaces the per-candidate report of the performance design's decision 11 (and the walker measuring in `staging-walk` of its decision 7). The performance skill's on-demand run for a finished piece of work stays as it is.
4. **A one-off audit of the reads that replay a growing history:** every query on a request path, in the pass and at start that reads messages, deliveries or events, listed with its plan on the fixture. Each that scans becomes an issue with a rollup or snapshot to fix it; the plan tests the audit writes stay as guards.
5. **Migrations and starts hold a budget:** a migration that backfills or rewrites a fleet table runs on the scale fixture in its test, by plan and batched. A backfill at the target runs in batches after start, never inside the migration that holds start. Production is too small for `rehearse-migration.sh` to prove anything at the target (#1197).
6. **The header is not part of this design:** decision 6 of the performance design is built in pagasae (pagasae#122), and a gap there is a pagasae issue. The header's one call is measured in decision 1's run.

## 4. Build slices

Thin, one PR each, in this order. Each is an issue referencing this design; Thomas sets the release labels.

| Slice | What it builds | Done when |
|---|---|---|
| H1 | The shared scale fixture and plan-test helper (decision 2) | One fixture (3,000 ships, 120,000 messages) and one helper that asserts a query's EXPLAIN holds no sequential scan of messages, deliveries or events; the existing plan tests of #1834 and #1835 use it |
| H2 | The CI check (decision 2) | CI refuses a PR that adds or changes a query on a fleet table without a plan test using H1's helper; the performance and testing skills name the rule |
| H3 | The one-off audit (decisions 4 and 5) | Every query on a request path, in the pass and at start reading messages, deliveries or events has a plan test on H1's fixture; each that scans, and each migration or start that does not hold decision 5, is an issue of its own |
| H4 | The measured run tooling (decisions 1 and 3) | One command, run when Thomas asks, measures every read of the performance design on capped staging at the target and reports each against its budget beside S1's baseline; no candidate or walk waits for it |
