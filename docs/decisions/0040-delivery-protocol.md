# 0040 Delivery protocol

The fleet's promise ends when the agent has confirmed it received the message. A ship with a computer side (the trierarch, or the aeolus plugin's watcher and hooks) is pushed; any other ship pulls.

- **Push receive** (`pushReceive`): the computer side takes up to `max` deliveries. A pending one becomes `received`, in flight with the crew's ship and lease, with no attempt counted and `DeliveryReceived`. Its own received or handed ones come back first, changing nothing, with `DeliveryReceived` marked `again`, so a restart or a lost answer loses nothing.
- **Pushed lease**: a lease is pushed from its first push receive, marked once with `LeasePushed`, until it ends; a new lease pulls until its own first push receive. On a pushed lease the agent's plain `receive` answers nothing and claims nothing, pending deliveries included.
- **Hand-over** (`handed`): the computer side reports each hand-over to the agent with its hand-over number. A number higher than the last counts one attempt and writes `DeliveryHanded`; the same or a lower one is a lost answer and changes nothing, also once acknowledged. The fifth attempt is answered undeliverable and nothing is handed.
- **Attempts**: one per hand-over on a pushed ship, one per plain receive on a pull ship; a push receive counts none.
- **Confirmation**: the hook's `ack` on a received or handed delivery is the agent's confirmation (0001); a received one is taken too, so a lost answer to `handed` never blocks it.
- **Lease end** returns received and handed deliveries to pending, their claim and hand-over number cleared and their attempts kept; a retire abandons those to the ship.

Why: the computer side is a third party between the fleet and the agent. Its steps get states of their own instead of being hacked into the pull protocol, and the fleet, the one source of truth, holds every step.

Rejected: the computer side acking for the agent (the promise would end before the agent has the message); counting an attempt per push receive (a restart would spend attempts); a plain receive on a pushed lease taking deliveries (the agent would see a message twice).
