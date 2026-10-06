# Messaging

Bounded context for messages and deliveries: send, receive and acknowledge, and the operator's resend and dismiss of an undeliverable delivery. Asks Registry who a selector resolves to (`resolveSelector`), holds a crew's lease while it receives (`holdLease`) and asks who sent a delivery (`findShip`), only through `registry/public.ts`.

A send stores the message, its one delivery, `MessageAccepted` and the notice that wakes receivers in one unit of work, so the sender gets the message's id only once all of it is committed. The payload is opaque text of at most 64 KB in UTF-8; the sender's idempotency key makes a repeat return the original message.

A receive claims up to `max` deliveries for a crew in one unit of work under its lease: the crew's own in flight first, then the oldest pending for its ship or its type, each with `DeliveryClaimed` and its sender's current name and type; the fifth claim makes a delivery undeliverable instead (`DeliveryUndeliverable`). With nothing there it waits for a wake-up for its ship or type. An ack moves a delivery the ship holds in flight to acknowledged (`DeliveryAcknowledged`).

The operator dismisses an undeliverable delivery (`DeliveryDismissed`), or resends it: a new message from the original sender to the same selector that names the original (`resendOfMessageId`), stored with the original's dismissal in one unit of work; the operator is the actor of both events. The resend's idempotency key is the original sender's `resend-<delivery id>`, so a second resend answers the first one's message.

argo's inbox: argo marks a message to it read or unread (the delivery's read date, no event), marks it done (claimed and acknowledged at once under its console session's lease, since the console never receives) or replies to it (a send to the sender and the message done, in one unit of work). Any other ship is refused: it receives and acknowledges.
