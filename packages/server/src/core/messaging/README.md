# Messaging

Bounded context for messages and deliveries: send, receive and acknowledge; resend and dismiss come later. Asks Registry who a selector resolves to (`resolveSelector`) and holds a crew's lease while it receives (`holdLease`), only through `registry/public.ts`.

A send stores the message, its one delivery, `MessageAccepted` and the notice that wakes receivers in one unit of work, so the sender gets the message's id only once all of it is committed. The payload is opaque text of at most 64 KB in UTF-8; the sender's idempotency key makes a repeat return the original message.

A receive claims up to `max` deliveries for a crew in one unit of work under its lease: the crew's own in flight first, then the oldest pending for its ship or its type, each with `DeliveryClaimed`; the fifth claim makes a delivery undeliverable instead (`DeliveryUndeliverable`). With nothing there it waits for a wake-up for its ship or type. An ack moves a delivery the ship holds in flight to acknowledged (`DeliveryAcknowledged`).
