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

**[db]** Reproduced deterministically: the queue order is set on a held settings lock and confirmed in `pg_locks`, `rule-match-concurrency.integration.test.ts` "a declaration and an assignment of its label race, assign first / declare first". Each run ends with stored matches equal to a fresh computation, and the person ship discovers the target. Mutation evidence: without the writer's shared lock, both cases fail on the queue check (the writer no longer waits). No run observed a skewed result directly: the tests show the lock is taken and that the result is fresh when it is, not a stale recomputation when it is not.

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

## 6. Recommended hierarchy: the settings lock first, on every path that takes it

Neither option above is deadlock-free as written: option 1 keeps a commission against retirement cycle (section 3), and the literal order keeps the send against retirement cycle (section 2). This section recommends one hierarchy and states exactly what it proves and what it does not.

### Rule

- **H1.** Every unit of work that can take the fleet's network settings lock in any mode takes it before its first other lock: before any row lock (`FOR SHARE`, `FOR NO KEY UPDATE`, `FOR UPDATE`, claims) and before any other advisory lock (idempotency, commission, opener and creator keys, names, label keys, namespaces, ship count, verified-facts writer). A path that takes the lock only on some branches (for example `checkManage` for a `labels:any` caller) takes it first, every time.
- **H2.** It takes the strongest mode it can need, once: exclusive for `retireShip`, `declareNetworkRules`, `applyNetworkRules`, `setBuiltInRule` and the rule-match build; shared for every other path. No path upgrades from shared to exclusive. Taking the lock again in the same transaction is granted immediately, so the existing `checkManage`, `checkReach` and `keepRuleMatches*` calls stay as they are.
- **H3.** Ownership stays as today. Writers and sends hold a transaction-level lock (`pg_advisory_xact_lock[_shared]`), released at commit or rollback. Person reads hold a session-level shared lock taken before `BEGIN ... REPEATABLE READ READ ONLY` and released after `ROLLBACK`, so their lock-before-snapshot behaviour is unchanged. No other pre-transaction lock is involved: sealing key unwrapping runs before the unit of work and holds no database lock.
- **H4.** Every unit takes the lock of one fleet only, as today.

### Why it removes every cycle through the settings lock [code]

Under H1, a unit waiting for the settings lock holds no other database lock: a person read holds none before `BEGIN`, and every other unit has not yet taken anything. A wait-for cycle that passes through the settings lock needs its waiter to hold a lock another member waits for, so no such cycle can form. That holds whatever each path locks after the settings lock, including FIFO queueing behind a waiting exclusive request. The three cycles found so far all pass through the settings lock and are removed: send against retire (section 2), commission against a namespace declarer's retire, and assign, setOwner or grantScopes on a namespace holder against that declarer's retire (section 3).

**Not claimed.** Cycles that never touch the settings lock, among row and advisory locks of paths that take no settings lock (receive, acknowledge, meeting contribution, lease and crew paths that do not reach `checkManage`), are unchanged from the baseline and were not inventoried. This hierarchy says nothing about them.

### Rule matches under H [code]

A writer of rules holds the exclusive lock for its whole transaction, and a writer of values or owners holds the shared lock for its whole transaction, authoritative write included. So a rule writer and a value writer never overlap, and the second recomputes from the first's committed change. Two value writers on one ship still serialize on the ship row. Stale recomputation would need a rule writer and a value writer to overlap, which H excludes. The prototype's recompute placement (after the authoritative write, under the lock) carries over unchanged.

### Affected paths: a finite inventory from the current code

Each row gives the locks taken before the settings lock today, in order, and the change H requires: move the settings acquisition in front of them. Line numbers are at the prototype head. Paths whose lock is already first need no change.

| Path | Locks before the settings lock today | Mode |
| --- | --- | --- |
| `sendWithin` (send, `send-message.ts:217-241`), also via `replyToMessage`, `pingShip`, `sendDueSchedules` | idempotency key; recipient ship `FOR SHARE`; reply: delivery `FOR UPDATE` first (`reply-to-message.ts:48`); scheduler: schedule claim first (`send-due-schedules.ts:62,112`); ping: `checkManage` | shared |
| `sendToLabelWithin`, `scheduleMessage` (`checkReachToEach`) | idempotency or creator key (`schedule-message.ts:102`) | shared |
| `resendDelivery` | delivery `FOR UPDATE`, idempotency key, recipient `FOR SHARE` (`resend-delivery.ts:92-140`) | shared |
| `openMeeting`, `addToMeeting`, `changeMeeting` | opener key (`open-meeting.ts:111`); meeting `FOR UPDATE` (`add-to-meeting.ts:57`, `change-meeting.ts:38`) | shared |
| `cancelSchedule`, `pauseSchedule`, `listSchedules` (`scheduleAccess`) | schedule `FOR UPDATE` (`cancel-schedule.ts:36`, `pause-schedule.ts:35`) | shared |
| `assignLabel`, `unassignLabel` | ship `FOR NO KEY UPDATE`, label `FOR SHARE` | shared |
| `setOwner` | owner, ship `FOR NO KEY UPDATE` | shared |
| `commissionShip` (with the prototype's recompute) | commission key, ship count, owner `FOR SHARE`, name, namespaces, value labels `FOR SHARE` | shared |
| `grantScopes`, `renameShip`, `recrewShip`, `releaseShip`, `getStartingPrompt`, `requestCrew`, `removeCrewRequest`, `requestWorktreeClear`, `setExpectations`, `setVerifiedFacts`, `checkManage` use case | ship `FOR NO KEY UPDATE` (trierarch ship for worktree clear); rename also name | shared |
| `raiseAlert`, `clearAlert`, `readShipWay` reads (`checkRead`) | ship `FOR NO KEY UPDATE`, alert `FOR UPDATE` (clear) | shared |
| `importNetworkRules` | definer ship `FOR SHARE`, label keys (`import-network-rules.ts:51-63`) | shared |
| `discover`, `readReach`, `explainReach`, `exportNetworkRules`, `readNetworkRules`, `readNetworkRulesDraftChanges`, `readBuiltInRules`, `saveNetworkRulesDraft` | none: already first | shared |
| Person reads (`person-read-unit-of-work.ts:29`) | none: session lock before `BEGIN` | shared, session |
| `declareNetworkRules` | value labels `FOR SHARE` (`:39`) | exclusive |
| `retireShip` | meetings, schedules, ship, lease, owned ships, owned labels (`:113-185`), all before the lock at `:204` | exclusive |
| `applyNetworkRules`, `setBuiltInRule`, rule-match build | none: already first | exclusive |

### What it costs

- **Scope widening.** About 40 existing use cases change lock order, sends, replies, the scheduler, meetings and schedules included: more than the three new reads. The order among the locks after the settings lock does not change.
- **Waiting.** An exclusive writer now holds the lock for its whole transaction, retirement's meeting, schedule, label and namespace work included. Every lock-taking call in that fleet (sends, reads, managed writes) waits for all of it. How long is unmeasured. The approved writer and send-wait gates (p95 < 100 ms, p99 < 500 ms at 3,000 carriers) would measure it.
- **Reads.** Unchanged: the shared session lock, then one snapshot.

### The rows-first alternative is not supported by this inventory

Keeping rows first needs the opposite guarantee: no unit, while holding the settings lock in any mode, waits for a lock that a unit waiting for the settings lock can hold. Shared holders count too, because a shared request queues behind a waiting exclusive one. Retirement could move its holder-ship and namespace locks in front of its settings lock, and that would remove both namespace cycles. Proving the rest needs an inventory of every lock taken after the settings lock on all of the paths above (event-sequence row, delivery, lease and alert rows, verified-facts writer, FK key-share locks). I have not made that inventory, so I cannot claim this alternative deadlock-free.

## Evidence

The prototype's stages 0 to 4 ran on option 1, which is a deviation from the approved order. They are evidence for this question, not acceptance of the approved structure.

Prototype head and logs are as reported to the orchestrator. The concurrency test is `packages/core/test/rule-match-concurrency.integration.test.ts`, run green at `a489b6542`, with its mutation run recorded. These concurrency runs and the stage 7 build scenarios ran before the hold. No measurement of reads, writers or sends has run. The read, writer and build harnesses are committed but have not been run.
