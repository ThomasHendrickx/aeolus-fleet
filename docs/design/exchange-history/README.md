# Where an exchange's history ends

Design for [#1723](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1723). New core fleet functionality, so it goes purpose first. Thomas's direction from [#1714](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1714) (8 Nov) holds: no client behaviour in core; the smallest fact core holds that is true from its own point of view. For Thomas's approval: the purpose, then H1 to H4. No code, and no detailed decisions before the purpose is agreed.

## 1. Purpose (to agree)

A ship reading its exchange with another ship cannot tell, at the oldest message it gets, whether that is where the exchange began or where pruning (0066) took the older messages. Core pruned them; only core knows it did. Retention promises that nothing goes silently and that a timeline says where its history begins (the retention design, outcome 3 and R10). For an exchange it says nothing.

A person client shows why it matters: at the top of a chat it shows either that this is where the chat began or that older messages are no longer kept, and today it cannot choose.

The outcomes:
1. **A ship can tell, from the exchange read, whether pruning removed messages of that exchange, and up to where.** At the oldest end it tells the true start from a pruned edge.
2. **Core decides nothing for the client.** Core states what it removed; what a client shows, and where, stays the client's.
3. **True for every exchange and every reader**, whichever kind of ship reads it, and true when an older unfinished message survives a pruned stretch.
4. **No cost on the send path.** The fact is written where pruning already works, and read in the same call as the page.

Not the purpose:
- Bringing pruned messages back, or keeping them longer (0066, #1230).
- The fleet-wide `keptFrom` (`fleet.limits`): it stays as it is.
- Where the gateway's `people.exchange` passes it on, and what a person client shows: the gateway's train and the client's.
- A message count or a first-message read for its own sake.

## 2. What is true today

- **`exchange` answers `olderCursor` null both at the true start and at a pruned edge.** A cursor is a delivery id, so a page goes on from it even once its message is pruned.
- **The `exchanges` rollup** (`exchanges` table) is kept for person ships only (exchange read, E4): per other ship, the newest message and the count not yet acknowledged. No first message, start time or count. When pruning removes an exchange's newest message, the row points at the newest kept one, or goes when nothing of the exchange is kept (E10, `history-pruner.ts`).
- **Pruning is by message, not by exchange.** A finished message older than the cutoff goes; an unfinished one stays whatever its age (retention design R2). An old exchange can keep an unfinished message older than messages that went: a hole, not an edge.
- **Pruning records one `HistoryPruned` per batch**, with counts for the whole fleet, and moves the fleet's `kept_from` once a pass finishes. Nothing marks an exchange.
- **`kept_from` cannot decide it per exchange**: an exchange begun after it was never pruned; an old exchange with an unfinished survivor holds a message older than it.
- **A pruning batch already reads each pruned message's exchange deliveries** (`is_in_exchange`, sender and reached ship) to keep the rollup true.

## 3. Lessons to check against

- **0066 and the retention design, outcome 3 and R10.** Nothing goes silently; where history begins is shown. This is R10 for one exchange, so it is retention's fact, not a client's.
- **0016 and the blueprint's Purpose.** Core is content-blind and adds no rules of its own; it states what it did, never what to show.
- **#1714 and its design.** The smallest true fact on the read the client already makes; an explicit ask or a bit of data, never a client-shaped answer.
- **The exchange read, E1 to E4 and E10.** An exchange is every message one ship sent that reached the other; `exchange` serves every ship with `messages:receive`, the rollup only person ships. A fact kept on the rollup alone would be true for one kind of ship.
- **The retention design R8, R14 and R16.** A batch is one transaction; what goes is chosen as one set and goes in one step. A new write belongs in that batch, proven by the same tests: rollback, concurrency, restart.
- **0070.** A removed ship is a remnant whose id stays, so an exchange with it still reads by id.
- **0007, 0005.** Every row carries `fleet_id`; ids are time-ordered, so "up to where" can be a message's id or sent time.
- **0020, L13 of the retention design.** A fleet's delete removes every row, children first: any new table joins that list.
- **CLAUDE.md.** Every state change writes its event in the same transaction: pruning writes `HistoryPruned`.
- **0013.** No compatibility layer; the field is added and clients read it once core releases it.
- **The performance skill.** The read stays one indexed query plus a key lookup; the write is bounded by the batch (a pruned label send to 3,000 ships touches up to 3,000 exchanges in one batch).

## 4. Questions

Each with its options and my pick.

### H1 What core keeps

1. **Per exchange, how far pruning went: the newest of its messages that pruning removed** (its id or sent time). Why it belongs in core: pruning is core's own act, and this is the per-exchange form of `kept_from`. It tells the start (nothing removed) from a pruned edge, and it places a hole: a kept message older than it is a survivor with gaps after it.
2. **Per exchange, whether pruning removed any message of it.** Core's fact too, and smaller, but with a surviving older message the client cannot tell where the gap lies: it would mark the oldest end, above a message that may be the true start.
3. **Per exchange, its first message**, kept past pruning (the issue's alternative). A fact of the exchange, but written on the send path for every pair, and when the first message survives a pruned stretch it says "start" while a gap lies after it.
4. A message count per exchange. Rejected: written on every send and prune, more than the purpose.
5. The fleet's `keptFrom` on the page. Rejected: it cannot decide per exchange (section 2).

**Pick 1.** The smallest fact that stays true with holes, written only where pruning already runs.

### H2 For which exchanges, and where

1. **Every exchange, one row per pair of ships, written only by the pruning batch** for each pair whose messages it removes. Why it belongs in core: `exchange` is a read every ship makes, so its fact must hold for every reader; the cost falls on the hourly pass, none on send.
2. **On the `exchanges` rollup row**, person ships only, the row kept once nothing of its exchange is (newest message none, left out of the list). Reuses a table, but an agent ship's exchange would answer nothing, or a false start: a contract true for one client's kind of ship.

**Pick 1.** One meaning for every reader; option 2 shapes core's read to one client.

### H3 Which read answers it

1. **`exchange` answers it on every page, as kept** (none when nothing was pruned); `olderCursor` keeps its meaning. Why it belongs in core: the read already answers the exchange, and this is a fact of it; one key lookup more. What to show at the oldest end stays the client's.
2. **`exchange` answers an end, `start` or `pruned`, on the page with no older cursor.** Core's statement about its own page, but it folds a hole into one word (wrong when the true start survives) and reads the client's question into core.
3. Option 1, and each `exchanges` row too. Also a core fact, but the list does not need it for the purpose.

**Pick 1.** The raw fact, on the read the client makes; it can widen to the list when a need comes.

### H4 Exchanges pruned before it ships

Pruning so far left no trace per exchange, so what was removed before release cannot be known exactly.

1. **Check production first** (read-only: whether any fleet's `HistoryPruned` counted messages). None: nothing to mark. Some: Thomas chooses between 2 and 3 for those fleets.
2. **Mark every existing exchange in a fleet with a `kept_from` as pruned up to it.** Never says "start" falsely, but says "pruned" for an exchange begun after the cutoff.
3. **Mark nothing.** Such exchanges read as begun at their oldest kept message, a false start, against "nothing goes silently".

**Pick 1.** Retention is new; the likely answer is that nothing needs marking, and the choice between two untruths is Thomas's only if it does.
