# A delivery's sender, retired or not

Design for [#1714](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1714). New core fleet functionality, so it goes purpose first. Thomas set the direction (8 Nov): no client behaviour in core; a bit of data that lets a client filter what it wants, or an explicit ask in the request, never core giving a client everything it needs. For his approval: the purpose, then R1 to R3. No code.

## 1. Purpose (to agree)

A ship that holds a delivery cannot tell from it whether the ship that sent it is still in the fleet or retired. Core already answers the sender's name and type as they are now on every delivery it hands; whether that same sender is retired is a fact of the same kind, about the same ship, and core holds it.

A person client shows why it matters: it counts the plain messages waiting on a person ship that the person can still open, and opens them from the list of exchanges, which leaves retired ships out (0070). A plain message from a ship retired before the person saw it is counted but never listed, so the count never clears. The client has no way to tell that sender from the ship contract short of paging every exchange.

The outcomes:
1. **A ship can tell, from a delivery it holds, whether its sender is retired**, with no extra call.
2. **Core decides nothing for the client.** Which deliveries a client counts, shows or hides stays the client's; core states a fact about the sender and changes no delivery, list or count.
3. **No new query.** The read that names the sender today states it, at the same cost.

Not the purpose:
- A count of what waits on a person. That is the client's (`people.waitingCount` in the gateway).
- Changing what a retire does to the deliveries a retired ship sent. They stay where they are, as the blueprint's Retire a ship says: only deliveries to the retired ship are abandoned.
- Leaving retired senders out of `receive`, `pushReceive` or `inbox`. A delivery from a retired ship is still a delivery the ship is owed (promise 2).
- Which ships the caller may send to now. That is `discover`, which also leaves out what the network rules hide.

## 2. What is true today

- **Every delivery read names its sender as it is now.** `receive`, `pushReceive`, `delivery` and `record` answer `senderShipId`, `senderName` and `senderType`, read from the sender's ship when the delivery is read (`receive-deliveries.ts`: the sender's `Ship` is already loaded, retired or not). Its status is on that same row and not answered.
- **A retired ship stays a ship** (0070): it keeps its id, name, type and kind, as a remnant once pruned; a sender always exists.
- **Retire abandons only the deliveries to the retired ship.** What it sent and is still pending, received or handed at another ship stays so.
- **`exchanges`** leaves retired other ships out (`s.retired_at IS NULL` in `exchange-rollups.ts`), with no way to ask for them; each row answers the other ship's id, name, type and kind, no status.
- **`exchange`** reads the exchange with a retired ship by id, and **`ackUpTo`** acknowledges up to a message of it: neither checks the other ship's status.
- **Ship status** is one enum in common: `awaitingCrew`, `crewed`, `retired`, as the fleet read answers it.

## 3. Lessons to check against

- **Blueprint, promise 2; 0001, 0040.** No delivery is lost or hidden from its ship. Whatever is offered is a fact beside the delivery, never a filter on what is handed.
- **0016 and the blueprint's Purpose.** Core is content-blind and adds no rules of its own; what a client does with a retired sender is the client's call.
- **0070.** No count and no list shows retired ships; `fleet.list` only when its status asks. A design that lists retired ships must follow that pattern: an explicit ask.
- **0047 and the receive guarantee.** The sender's name is answered as it is now so a crew answers it by name; a retired sender cannot be answered, since a send to a retired ship is refused. The status serves a crew too, not only a person client.
- **0057, 0034.** Authorised by scopes read from the server. Every read in R2 already needs `messages:receive` and names the sender; no new reach is opened.
- **0050 and CLAUDE.md, domain language.** Use the status the fleet read already answers; invent no new term for "gone".
- **0013.** No compatibility layer: the field is added; clients read it once core releases it.
- **0066.** A delivery a client chooses to hide stays open, and open deliveries are never pruned. That is the client's choice and its consequence, stated here so the choice is made knowingly.
- **The performance skill.** The status is on a row the read already loads; no join, query or index is added.

## 4. Questions

Each has its options and the pick. Thomas answers.

### R1 What core offers

1. **The sender's status on each delivery a ship reads.** Why it belongs in core: core already answers the sender's name and type as they are now on the same read; the status is a fact of the same row, true from core's own view, and useful to any crew (it tells a crew a reply would be refused) as much as to a person client. With it, the client chooses to leave the delivery out of its count, or to open it: `exchange` already reads a retired ship's exchange by id and `ackUpTo` already marks it seen.
2. **An explicit ask on `exchanges` to list retired other ships too**, each row with the other ship's status. Why it belongs in core: it is 0070's own pattern, a list that leaves retired ships out unless the caller asks. But the client must then page every exchange to find a delivery's sender, which is the cost the issue names, or still match deliveries to rows by sender id.
3. **Both 1 and 2.**
4. A filter on `receive`, `pushReceive` and `inbox` leaving retired senders out. Rejected: it hides deliveries from their ship (promise 2) and puts a client's view into core.
5. A waiting count in core. Rejected: the client-shaped answer Thomas's direction rules out.

**Pick 1.** The smallest true fact, on the read the client already makes, and it leaves both client behaviours open. Option 2 can follow on its own when a client needs to list retired exchanges.

**Thomas:** to answer.

### R2 Which reads carry it

1. **Every read that answers a delivery as `receive` hands one**: `receive`, `pushReceive`, `delivery` and `record` (one schema, `receivedDeliverySchema`, which the others extend), and `receiveReply`, which answers the same delivery.
2. `pushReceive` alone, the read the person client makes.

**Pick 1.** One delivery shape, one meaning everywhere; a field on one read alone splits the schema for one client's sake.

**Thomas:** to answer.

### R3 The field

1. **`senderStatus`**, the ship status enum the fleet read answers (`awaitingCrew`, `crewed`, `retired`), as it is when the delivery is read, beside `senderName` and `senderType`.
2. `isSenderRetired: boolean`.
3. `senderRetiredAt`, the retire time or null.

**Pick 1.** It reuses the fleet's one word for a ship's state (0050), and sits with the name and type read at the same moment. A boolean answers only today's question; a time is a history fact, not the sender's state.

**Thomas:** to answer.

## 5. Flows, tests and docs

Once the purpose and R1 to R3 are agreed: the flow with its unhappy paths (a sender retired between two reads of the same delivery, a pruned remnant sender, a sealed payload), the tests per read with in-memory ports and Postgres, and the docs it updates (the blueprint's ship contract rows, `receivedDeliverySchema` in common, the gateway after the core release).
