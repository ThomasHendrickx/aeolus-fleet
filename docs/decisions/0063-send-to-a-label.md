# 0063 Send to a label

A ship sends one message to the ships a label selection names (`{ kind: 'label', valueIds }`); each ship of it gets its own delivery. The rules are R1 to R11 of [the selector design](../design/selector/selector.md).

- One-way: each recipient answers the sender alone, by the answer rule, as to any send.
- The selection is value ids, exact and AND (0031), resolved at send into the ships carrying every value that are not retired, never the sender or the viewer. No ship refuses the send `UNRESOLVABLE_SELECTOR`.
- Reach to every ship, or nothing: one ship of the list out of the sender's send reach refuses the whole send `NOT_REACHABLE`, recorded as any refusal (0034).
- `messages:send` is enough; the daily message limit counts the message once. A schedule may send to a label, checked as a send at each send time (0062).
- One message, one pending delivery and one `MessageAccepted` per ship, in one transaction; each delivery lives on its own, and a resend goes to its ship alone.

Why: telling a set of ships the same thing was one send per ship, after the sender found out who is in the set (#976).

Rejected: a selector named `group` (pagasae's, 0052); a whole-fleet send (a fleet labels its ships); a send to the reachable part of the list; a scope of its own; richer selections (0031).
