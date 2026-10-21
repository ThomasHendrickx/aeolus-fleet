# A crew re-reads an acknowledged delivery

Design for [#1048](https://github.com/ThomasHendrickx/aeolus-fleet/issues/1048). New core fleet functionality, so it goes purpose first. The lessons and questions below are for review; nothing past the purpose is decided until Thomas agrees the purpose. No code.

## 1. Purpose (to agree)

A crew reads one of its ship's deliveries again, whole, while the delivery is acknowledged and not yet handled. The read changes nothing.

The need: a person opens a delivery in one MCP client, so the gateway, as the person ship's crew, acknowledges it (interop 5.1). The delivery must stay readable from another MCP client until the person answers it or is done with it (#1046). Thomas chose this over the gateway keeping a copy of the payload, on 21 Oct: "the re-read capability is long term best, the copy of messages sits bad and opens up a way to flood the gateway db which is on purpose small and performant."

The outcomes:
1. A person opens a message on their phone's chat, then opens it again from Claude Code on their laptop, and reads it whole.
2. Re-reading never hands, receives, counts or acknowledges anything. Each delivery's state, attempts and clocks stay as they were.
3. Once it is handled, a re-read says so and does not answer with the delivery again.

Not the purpose:
- A history of a ship's messages for its crew. That is a read under the network rules, `fleet.shipMessages` with `fleet:read`.
- A second way to receive, or to hand over again. Once more (0040) stays the one retry.
- The gateway storing payloads.

## 2. What is true today

- **`receive` and `pushReceive`** hand only pending deliveries and the crew's own received or handed ones (0040). An acknowledged delivery never comes back.
- **No ship call reads a payload by id.** `sentMessage` (interop 3.5) answers where a message the caller sent stands, with no payload. `fleet.message` reads one with its payload, but needs `fleet:read` and read reach, which a person ship does not hold.
- **The gateway** (`aeolus-fleet-gateway`, `src/core/people`):
  - `aeolus_inbox` push receives as the person ship's crew.
  - `aeolus_open` keeps the delivery's id, sender and title in its own database, then acks it.
  - `aeolus_answer` and `aeolus_done` report it handled, then forget it.

  After the ack, no call gives the payload again.
- **`handled`** takes only an acknowledged delivery that the crew's lease holds. An acknowledged delivery whose lease ended stays acknowledged, handled unknown. Later reports from its crew are refused as lease ended (0040).

## 3. Lessons to check against

- **0001, blueprint promise 2.** Acknowledged means received. Aeolus distributes and has no part in execution. A re-read is the crew reading what it already has, not a delivery.
- **0040.** The delivery states and their one-way moves, attempts counted only on a hand-over or a plain receive, clocks run from the states. 0040 rejected letting a plain receive on a pushed lease take deliveries, because the agent would see a message twice. A re-read is a separate, named call that the crew makes on purpose, so it does not reopen that rejection.
- **The receive contracts.** `inbox` counts what the next `receive` would hand. `receive` and `pushReceive` return in-flight deliveries again so a lost answer loses nothing. A re-read must leave all three as they are.
- **Leases (0010, 0040).** `handled` and `notHandled` hold the crew's lease. A lease that ends leaves its acknowledged deliveries handled unknown.
- **0034.** A message is read through its sender or recipient. The recipient's crew reading its own ship's delivery needs no rule.
- **0046.** `messages:receive` is the scope of every call on the crew's own deliveries: receive, ack, handed, handled.
- **0047 and `sentMessage`.** A read records nothing.
- **0006.** The payload is at most 64 KB, so one answer carries it whole.
- **0015.** One crew per lease. Two MCP clients reach the person ship through the gateway's one lease, so the crew is the same in both.

## 4. Questions

Each question has options and my pick. They follow once the purpose is agreed.

### R1 Which deliveries can be re-read?

1. **Acknowledged, not yet handled or not handled** (#1048's scope). This includes one handed once more, which stays acknowledged.
2. Option 1, plus received and handed. `pushReceive` already returns those.
3. Any state, as a read of the ship's history.

**Pick 1.** It is the gap: received and handed already come back, and history is a read under the rules.

### R2 Under which lease?

1. **The lease that holds it:** only the crew whose lease acknowledged it, as for `handled`.
2. Any lease of the ship, including a later crew reading what an ended lease acknowledged.

**Pick 1.** A re-read is for going on to answer or finish the delivery, and only that lease can report `handled`. Under option 2, a later crew could read a delivery it can never finish.

### R3 One delivery, or a list?

1. **One delivery by its id.**
2. A list of every acknowledged, not handled delivery, with payloads.
3. Both: a list without payloads, and one by id.

**Pick 1.** The gateway already keeps the opened ids and titles. One payload per answer keeps it within 64 KB. A list can follow when a crew needs one.

### R4 What the answer holds

1. **The same shape as a delivery from `receive`:** its message, payload and content type, `inReplyTo`, and the sender's id, current name and type. Add its state.
2. A shape of its own.

**Pick 1.** A crew parses one delivery shape.

### R5 What it records

1. **Nothing:** no event and no change. A read is like `inbox`, `discover` and `sentMessage`.
2. An event per re-read, such as `DeliveryReread`.

**Pick 1.** No state moves. An event per read would grow the timeline with every glance from a client.

### R6 A delivery past acknowledged, or not the crew's

1. **Two answers.**
   - A delivery of the crew's lease in any other state is refused with that state, e.g. "handled". The second client can then say "done elsewhere".
   - Anything else is refused as `DELIVERY_NOT_FOUND`: another ship's delivery, another lease's, or one the fleet does not have.
2. `DELIVERY_NOT_FOUND` for all of them.

**Pick 1.** The crew already knows its own deliveries' states. Another ship's deliveries stay unseen, as with `sentMessage`.

### R7 Pull leases too?

1. **Every lease.** On a pull lease an acknowledged delivery is never handled, so it stays re-readable while the lease lasts.
2. Pushed leases only, since `handled` exists only there.

**Pick 1.** It needs no rule of its own, and a pull crew re-reading what it holds harms nothing.

### R8 Name and scope

1. **`ship.delivery`** with `messages:receive`, a query on tRPC, REST and MCP like the other ship calls. It is a noun, like `sentMessage`.
2. `ship.reread` with `messages:receive`.

**Pick 1.**

## 5. Docs it would update

- **Decision 0040:** one line on re-reading an acknowledged delivery.
- **Blueprint:** the ship API table, with a `delivery` row.
- **Ship protocol and `ship-contract`:** the new call.
