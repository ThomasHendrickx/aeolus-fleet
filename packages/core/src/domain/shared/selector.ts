import type { ShipId } from '@aeolus-fleet/common';

/**
 * Who a message is for, as its sender addressed it (docs/blueprint.md,
 * "Selector"): one ship, by id or by name, or any ship of a type. Group and
 * fleet come later.
 */
export type Selector = { kind: 'ship'; shipId: ShipId } | { kind: 'ship'; name: string } | { kind: 'type'; type: string };

/**
 * Who a selector resolves to at send time: one ship by its id, never its
 * name, so a rename or a reused name never redirects a sent message; or the
 * queue of a type, which the first ship of that type to receive the delivery
 * claims. A message keeps it as its selector; its delivery goes to it.
 */
export type Recipient = { kind: 'ship'; shipId: ShipId } | { kind: 'type'; type: string };
