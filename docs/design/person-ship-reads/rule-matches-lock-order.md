# Rule matches: lock order addendum

Status: question for Thomas on [#1741](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1741), raised by the isolated prototype on branch `prototype/1741-rule-matches`. It changes nothing in the [approved structure](rule-matches.md) (approved at `3e3599f3`). It reports a conflict between that structure's lock order and today's code, and the evidence for each option. Atomicity, current rights, the read budgets and the writer and send-wait gates stay as approved.

Each claim is marked **[code]** when it is reasoning from the source at the prototype head, or **[db]** when a Testcontainers Postgres 16 run reproduced it. Nothing marked [code] has run against a database.

## 1. Lock acquisition order in the code today

Line numbers are at the prototype head. "Shared" and "exclusive" mean the fleet's network settings advisory lock, `hashtext(fleet), hashtext('network-settings')`: transaction level for writers and sends, session level for the person reads.

| Path | Order of acquisition |
| --- | --- |
| Send to a ship, `sendWithin` (`send-message.ts:217-241`) | idempotency key advisory lock, then the recipient ship `FOR SHARE` (`resolve-selector.ts:35`), then settings **shared** (`check-reach.ts:54`). The checkpoint does not change this. |
| Person reads (`person-read-unit-of-work.ts:29-30`) | settings **shared** (session level), then `BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY`. No row locks. Unchanged from the approved design. |
| `assignLabel`, `unassignLabel` | ship `FOR NO KEY UPDATE` (`:39`), label `FOR SHARE` (`:43`), settings **shared** inside `checkManage` only for a `labels:any` caller (`:51`, `check-reach.ts:154`), the `ship_labels` write, then **(prototype)** settings shared and the recompute (`:65`). |
| `setOwner` | owner, then ship `FOR NO KEY UPDATE` (`:37-38`), settings **shared** in `checkManage` (`:43`), the owner write, then **(prototype)** recompute (`:54`). |
| `commissionShip` | commission key, ship count, owner `FOR SHARE`, name and namespace advisory locks (`:298-345`), insert and assignments, then **(prototype)** settings **shared** and recompute (`:158`). The baseline takes no settings lock here. |
| `declareNetworkRules` | label `FOR SHARE` for the values it names (`:39`), settings **exclusive** (`:44`), declaration and settings writes, then **(prototype)** recompute of its source (`:51`). |
| `applyNetworkRules` | settings **exclusive** (`:35`), settings write, then **(prototype)** recompute of the fleet source (`:45`). |
| `retireShip` | meetings and schedules (`:113-114`), ship `FOR NO KEY UPDATE` (`:115`), lease, owned ships `FOR NO KEY UPDATE` (`:158`), owned labels `FOR UPDATE` (`:185`), assignment and label writes, settings **exclusive** (`:204`), declaration withdrawal, then **(prototype)** recompute (`:215-217`), then namespace holder ships `FOR NO KEY UPDATE` and the namespace advisory lock (`:225-227`), alerts, then the verified-facts writer lock (`:241-249`). |

Writers run READ COMMITTED (`unit-of-work.ts`, no isolation option), so each statement takes a new snapshot when it starts. **[code]**

The baseline already locks ship rows on both sides of the settings lock: rows before it in assign, setOwner and retire, and namespace holder ships after it in retire. **[code]**

## 2. The approved literal order deadlocks a send against retirement

rule-matches.md: every writer takes the settings lock first, and retirement moves to that order. Sends are not reordered.

| Step | T1: send to ship X | T2: retire ship X |
| --- | --- | --- |
| 1 | idempotency lock; `SELECT ... ships X FOR SHARE` granted | |
| 2 | | settings **exclusive** granted (literal order: first) |
| 3 | | `SELECT ... ships X FOR NO KEY UPDATE` waits on T1's `FOR SHARE` |
| 4 | settings **shared** waits on T2 | |

That is a cycle. Postgres detects it after `deadlock_timeout` and aborts one transaction with SQLSTATE 40P01, so a send or a retire fails. **[code]** Not reproduced: no experiment while the structure is on hold.

The same shape arises for any send whose recipient a settings-first writer later row-locks. **[code]**

## 3. Option 1 (prototype as built): rows first, settings last, recompute under the lock

Rule: every writer recomputes rule matches only while holding the settings lock: shared for writers of carried values and owners, exclusive for writers of rules and for retirement. It does this after its authoritative write and in the same transaction. Sends and reads are unchanged.

What makes it correct is mutual exclusion plus fresh statements, not READ COMMITTED alone. Two writers conflict only if one changes rules (exclusive) and the other changes a ship's values or owner (shared), or both write one ship. In the first case, the one whose lock is granted second starts its recompute statements after the other has committed, so its new snapshots include the other's change. In the second case, both hold the ship row `FOR NO KEY UPDATE` until commit, so they run one after the other. **[code]**

### Declaration against assignment by the label's owner (no `checkManage` lock)

| Order | Schedule | Result |
| --- | --- | --- |
| Declare first | D: settings exclusive. A: ship X, label share, insert `ship_labels` (uncommitted), waits shared. D: carriers statement does not see A's row; D writes its source's rows and commits. A: shared granted; its declarations and labels statements see D's committed declaration; A recomputes X from every source. | Fresh |
| Assign first | A: shared granted, recomputes X from the old declaration, commits. D: exclusive granted; its carriers statement sees A's committed value; replace-of-source rewrites X's row. | Fresh |

**[db]** Reproduced deterministically: the queue order is set on a held settings lock and confirmed in `pg_locks`, `rule-match-concurrency.integration.test.ts` "a declaration and an assignment of its label race, assign first / declare first". Each run ends with stored matches equal to a fresh computation, and the person ship discovers the target. Mutation evidence: without the writer's shared lock, both cases fail on the queue check.

### Apply against setOwner

setOwner takes settings shared inside `checkManage` before its owner write. Apply first: setOwner waits before writing, then recomputes from the applied rules. setOwner first: apply waits for setOwner's commit, then its fleet-wide recompute sees the new owner. **[code]** **[db]** "setting an owner and applying own rules race, set owner first / apply first" (deterministic, both fresh). Apply against assign is also reproduced in both orders.

### Retirement against send

The order is unchanged from the baseline (ship, then settings exclusive), and a send takes the ship `FOR SHARE`, then settings shared. Both take the ship before the settings, so there is no cycle between them. **[code]** **[db]** 15 repeats of two concurrent sends to a carrier, its retirement, a declaration and a third send: no 40P01, no rejection, matches fresh ("never deadlock a send to a ship against its retirement or a declaration"). This is a race, not a proof of every interleaving.

### Retirement against assignment, and shared writers together

Retirement's authoritative writes (unassignments, label removal, owner changes) come before its exclusive lock. A shared writer on a carrier Y does one of two things:

- It gets the shared lock first and recomputes from the retire's uncommitted state, which it cannot see. Retirement then recomputes Y under the exclusive lock, seeing Y's committed change and its own writes.
- It waits until retirement commits, then recomputes from the committed retirement.

Two shared writers on one ship serialize on its row lock. On different ships, each rewrites only its own ship's rows. **[code]** **[db]** 15 repeats of retire-declarer against an assignment of its value: retirement always succeeds, the assignment succeeds or finds the value gone, and the matches are fresh.

### Deadlock risks option 1 keeps or adds (code reasoning, none reproduced)

- **Added by the prototype: commission against retirement of a plugin namespace declarer.** Commission holds the namespace advisory lock (`commission-ship.ts:345`) and then waits for settings shared (`:158`). Retirement holds settings exclusive (`retire-ship.ts:204`) and then waits for that namespace lock (`:226`). That is a cycle (40P01). The baseline commission took no settings lock, so the prototype introduced this. A remedy inside option 1 would take the shared lock in commission before the namespace locks. That reorders an existing writer, so it is your decision. It is not built.
- **Present in the baseline, widened by the prototype: assign or setOwner against retirement of a namespace declarer whose holder is the same ship.** Assign holds ship X, then waits for settings shared; retirement holds settings exclusive, then waits for holder X (`:225`). The baseline has this cycle for `labels:any` callers and for setOwner, through `checkManage`. The prototype adds it for label owners assigning without `labels:any`.
- Reads hold no row locks and wait only on the settings lock, so they cannot join a cycle. **[code]**

## 4. Read lock and snapshot prerequisites

These are unchanged in both options:

- A person read takes the shared session lock, then one REPEATABLE READ READ ONLY snapshot for the whole call. That snapshot sees each writer's authoritative change and its matches together or not at all, because both commit in one transaction. **[code]** **[db]** "let a read see a declaration and its matches together or not at all": one read queued before the declaration saw neither, one queued after saw both.
- The lock before the snapshot keeps a read from starting a snapshot in the middle of an exclusive writer. Against shared writers, the read relies on atomicity alone, as the approved design does. **[code]**
- Sends keep `checkReach` over the authoritative tables and take no rule-match rows. Under option 1, send consistency does not depend on matches. **[code]**

## 5. What a consistent order needs

| | Option 1 (today's order) | Literal approved order |
| --- | --- | --- |
| Sends | Unchanged | Must take settings shared before the recipient row lock, or deadlock as in section 2. That widens scope to the send path. |
| Reads | Unchanged | Unchanged |
| Retirement | Unchanged order | Settings exclusive before ship and meetings, so the send, contribution and schedule orders have to follow. |
| Remaining cycles | Commission against retirement of a namespace declarer (added), and the baseline assign/setOwner holder cycle (widened). Both need a decision. | Removes those cycles, if every path takes settings first, sends included. |

Neither option requires changing the approved read behavior. Only the literal order requires changing sends.

## Evidence

Prototype head and logs are as reported to the orchestrator. The concurrency test is `packages/core/test/rule-match-concurrency.integration.test.ts`, run green at `a489b6542`, with its mutation run recorded. These concurrency runs and the stage 7 build scenarios ran before the hold. No measurement of reads, writers or sends has run. The read, writer and build harnesses are committed but have not been run.
