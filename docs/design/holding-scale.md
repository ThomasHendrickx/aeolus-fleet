# Holding scale

Stage 1 design for [#1130](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1130) in core 0.40.0: purpose, lessons and questions, no detailed decisions. Status: purpose proposed, not agreed.

[Performance at scale](performance/performance.md) is the first design for #1130. Thomas decided it, and its slices S2 to S7 are on main. Its decisions stand and are not reopened here. This design asks what #1130 still needs before it can close, and how the fleet stays at scale as new features land.

## 1. Purpose (proposed)

Every read and every start of core stays within its budget at the target scale (10,000,000 messages and 3,000 ships in one fleet: p95 under 100 ms, p99 under 500 ms, errors under 1%), not only on the day the performance design's slices land, but for every feature after them. A read that would scan a fleet's history is found before it reaches staging, and #1130 closes on numbers, not on merged slices.

The outcomes:
1. One measured run at the target, on capped staging, reports every read against its budget: the "after" of the performance design, against S1's baseline.
2. A new or changed read on a fleet table proves before merge that it reads no fleet's whole history, the way #1834 and #1835 did.
3. History that only grows is kept as a rollup or snapshot with its rule written down, never replayed per call (performance design, outcome 4), for every read, not only health and storage.
4. A migration or start of core takes a bounded time at the target, so an upgrade does not hold the fleet down.

Not the purpose:
- Reopening any decision of the performance design, 0041 or 0042.
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
- **CLAUDE.md:** every query scoped by `fleet_id`; every state change writes its event in the same transaction; new rules, checks and process steps come only from Thomas, so this design proposes them.

## 3. Questions

Each with options and a pick. None is decided.

### Q1 What closes #1130?

1. Close it now: S2 to S7 are on main; later regressions are issues of their own.
2. **Close it on one measured run:** every read of the performance design on capped staging at the target, reported against its budget beside S1's baseline; reads over budget become issues, and #1130 closes with the report.
3. Keep it open as the umbrella for every scale issue.

**Pick: 2.** The performance design promised numbers (decision 11: "a before and after on each slice"), and the five fixes above show the slices alone did not hold the target. 3 leaves an issue that never closes.

### Q2 How does a new read prove it holds scale before merge?

1. As today: the performance skill asks for scale to be stated and measured once the work is finished.
2. **A plan test for every new or changed query on a fleet table that a request, the pass or a start runs:** on the repo's scale fixture (3,000 ships, 120,000 messages), its EXPLAIN shows no sequential scan of messages, deliveries or events, as #1834 and #1835 do. One shared fixture and helper so a test is a few lines.
3. A staging performance run on every PR that touches a query.

**Pick: 2.** Each fix above is a plan test that would have failed before its feature merged; it runs in CI in seconds, needs no staging, and does not flake (#1822). 3 is slow and blocks on staging. This is a new check, so it is Thomas's to make.

### Q3 Where does the release-level measurement run?

1. **Each candidate's staging walk reports every read against its budget** (decision 11 as written), never refusing it.
2. On demand only, once a piece of work is finished (the performance skill today).
3. Both: on demand while building, and the walker's report per candidate.

**Pick: 3.** They answer different questions: on demand tells a builder their change holds; the candidate report catches what no builder measured, as the seed caught #1301 and #1197. Whether the walker's report is built is the fact to check first (lessons, "The measurement").

### Q4 Which reads still replay a growing history?

1. **An audit:** list every query on a request path, in the pass and at start that reads messages, deliveries or events, each with its plan on the fixture; what scans becomes an issue with a rollup or snapshot to fix it.
2. Fix them as staging finds them.

**Pick: 1.** Staging finds one at a time, each a walk late; an audit with Q2's helper finds them together and leaves the plan tests behind as guards.

### Q5 Do migrations and starts hold a budget?

1. **Yes: a migration that backfills or rewrites a fleet table runs on the scale fixture in its test, by plan and batched, and a backfill at the target runs in batches after start, not inside the migration that holds start.**
2. No budget; rehearse each migration on production's data (`rehearse-migration.sh`), as today.

**Pick: 1.** Production is small (8,160 messages at #1197), so a rehearsal there proves nothing at the target; #1197 held the server unhealthy and every service waiting on it.

### Q6 Is the header part of this design?

1. **No:** decision 6 is built in pagasae (pagasae#122: the header asks for a fleet's name once and keeps it); a gap there is a pagasae issue.
2. Yes: measure the header's path on every app as one of the reads of Q1.

**Pick: 1, with the header's one call measured in Q1's run.** The header's reads are pagasae's, but a run that leaves out what every page loads is not a full picture.
