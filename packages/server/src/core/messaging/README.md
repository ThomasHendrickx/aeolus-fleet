# Messaging

Bounded context for messages and deliveries: send now; receive, acknowledge and undeliverable come with later slices. Asks Registry who a selector resolves to only through `registry/public.ts` (`resolveSelector`).

A send stores the message, its one delivery, `MessageAccepted` and the notice that wakes receivers in one unit of work, so the sender gets the message's id only once all of it is committed. The payload is opaque text of at most 64 KB in UTF-8; the sender's idempotency key makes a repeat return the original message.
