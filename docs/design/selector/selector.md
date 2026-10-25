# Selector: one message to a set of ships

Design for [#976](https://github.com/ThomasHendrickx/aeolus-fleet/issues/976), Aeolus 0.32.0. Docs only. Stage 1: purpose, lessons, questions. No decisions until Thomas agrees the purpose.

## 1. Purpose (for Thomas to agree)

A ship sends one message to a set of ships, named by their labels, and each ship of the set gets its own delivery under the delivery promise. Today a ship reaches one ship (`ship`), one claiming ship of a type (`type`), or the participants of a meeting (`meeting`). Telling a set of ships the same thing means one send per ship, and the sender must first find out who is in the set.

For whom: a ship that coordinates others. A chief of staff telling every head the plan for the day; an orchestrator telling every ship labelled `team=frontend` that main is red; a person ship telling the ships it owns to stop. No conversation follows: each recipient acknowledges and, if it answers, answers the sender alone.

The outcomes:
1. One send, one message, one delivery per ship of the set, stored in one transaction; OK only once every delivery is stored.
2. Each delivery has its own state: one ship's pending, undeliverable or stuck delivery never touches another's.
3. The set is resolved at send, from labels the sender can see; who received it is readable afterwards.
4. Who may send to a set, and to which ships, is scope and reach, visible like every other rule.

Not the purpose: a conversation where everyone hears every answer (that is a meeting, and the room next); a type's one claimed delivery; reading payloads; sending across fleets.

## 2. Lessons to check against

| # | Lesson | Source |
| --- | --- | --- |
| L1 | `group` is taken: pagasae's group of accounts, a value of the label `group` in a fleet. Rejected there: "groups in core; a selector by group" | 0052; #976 body |
| L2 | Thomas on #976: "Maybe call by label?" Labels are "an owned vocabulary for selecting ships" | #976 (24 Oct); #102 purpose (6 Oct) |
| L3 | A label selection is exact and AND, by value ids; an unknown id selects no ship; richer selectors (in, not, exists) rejected "before anyone needs them" | 0031 |
| L4 | Meetings already resolve a label selection into a list of ships at invite, and refuse the whole open when the owner does not reach one invitee | 0061; meetings design M5, M6 |
| L5 | One message to many deliveries in one transaction exists: a contribution, with rollback tests on a fan-out failing midway | 0061; Meetings S1 (#1186), `meetings.integration.test.ts` |
| L6 | A type is one claimed delivery, never a fan-out; with network rules, only the type's ships the sender reaches may claim it, and none reachable refuses the send | 0034; 0061 rejected list |
| L7 | Reach is checked at send; a refusal stores nothing and says only "No rule matches" (Thomas: "it works or doesnt"); a stored message is delivered whatever the rules become | 0034 |
| L8 | An unresolvable selector is rejected; a contribution whose other participants all retired is refused `UNRESOLVABLE_SELECTOR` | blueprint, Send; #1186 review |
| L9 | Everyone reading everything costs the square; floods come from many recipients answering | meetings design L1, L2; #1168 |
| L10 | A label owner spamming labels was closed by limiting who assigns (`labels:assign` on its own and commissioned ships) and an event per assignment | #600, #918 |
| L11 | The blueprint defers "Group and fleet-wide addressing (n-to-n)", hook "Selector with a kind, one delivery row per recipient"; its Selector row says "`group` and `fleet` later" | blueprint, Deferred on purpose and Messages |
| L12 | Type is metadata that can become a label; rules never select by type | #412; 0034 |
| L13 | No hidden behaviour, scope says what and reach says where, no policy of Aeolus's own, pre-1.0 with no compatibility work | blueprint Principles; 0013, 0016, 0034, 0046 |

## 3. Questions for Thomas

### Q1. Does a send to a set still earn its place beside meetings and rooms?

Meetings invite by label and give n-to-n inside; the room (next minor) is a lasting conversation with no mic. A send to a set is one-way: the recipients do not hear each other's answers.

1. **Yes, a one-way send to a set.** One message, one delivery each, answers go to the sender alone. Cheap: no `meetings:open`, no lifecycle, no square cost (L9).
2. **No, close #976.** Meetings and rooms cover n-to-n; strike `group` and `fleet` from the blueprint's later kinds. One fewer way to address, but telling ten ships one thing means opening a room for a message nobody discusses.

Pick: **1.** Most coordination is "tell these ships"; a room would make every answer reach every ship, the flood L9 warns of.

### Q2. What names the set?

1. **A label selection, kind `label`.** The same exact-and-AND selection by value ids as meeting invites (L3, L4). The label value is the name, owned and assigned under existing rules (L10). Nothing new to keep.
2. **A label selection plus a list of ships, as meeting invites take (M6).** One input shape across meeting invites and sends; covers "these three ships" without a label.
3. **A stored, named list of ships.** A new thing with its own lifecycle and a new term, kept apart from labels.

Pick: **1.** Thomas's own suggestion (L2), no new term, and a label is already the fleet's way to select ships. A list of named ships stays a few sends, or a label.

### Q3. What about the whole fleet (`fleet` later)?

1. **Drop it.** An empty selection is refused; a fleet that wants "every ship" labels them. No broadcast flood path.
2. **An empty selection means every ship the sender reaches.** Broadcast for free, and the easiest way to wake every session in a fleet by mistake.
3. **Keep `fleet` as its own later kind**, decided when someone needs it.

Pick: **1.** Smallest surface; anyone who needs it gets it from a label, and the blueprint's later list shrinks to what is designed.

### Q4. Some ships of the set are out of the sender's reach

1. **Refuse the whole send, nothing stored**, as a meeting open does (L4, L7). OK means every ship of the set got its delivery; the sender narrows the selection. In a fleet with rules, one unreachable ship in a label blocks every send to it.
2. **The set is the ships of the selection the sender reaches**, as a type's claimants are (L6); none reachable refuses. Never blocked, but the sender cannot tell who was left out.
3. **As 2, and the answer names the ships left out.** Nothing hidden, but a send answers a partial result, a new shape for OK, and it tells the sender about ships it cannot reach.

Pick: **1.** It keeps "it works or doesnt" and the meeting's rule; the network rules design (#1154) is where reach gets easier, not the selector.

### Q5. Who may send to a set?

1. **`messages:send`, with reach to every ship of the set.** Scope says what, reach says where (L13); the daily message limit counts the message once.
2. **As 1, and the daily limit counts each delivery.** A send to fifty ships spends fifty; harder to flood, but a limit now means two things.
3. **A scope of its own beyond `messages:send`**, as meetings have `meetings:open`. An organisation can keep fan-out to a few, at the cost of one more scope to grant.

Pick: **1.** Reach already bounds who a ship can tell; a second gate is policy nobody has asked for yet (0016).
