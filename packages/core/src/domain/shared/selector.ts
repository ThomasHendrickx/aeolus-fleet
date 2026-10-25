import type { LabelValueId, MeetingId, ShipId } from '@aeolus-fleet/common';

/** A selector of one recipient: one ship, by id or by name, or any ship of a type. */
export type RecipientSelector = { kind: 'ship'; shipId: ShipId } | { kind: 'ship'; name: string } | { kind: 'type'; type: string };

/** Every other participant of a meeting (decision 0061). */
export interface MeetingSelector {
  kind: 'meeting';
  meetingId: MeetingId;
}

/**
 * Every ship carrying each of these label values but the sender (decision
 * 0065): a selection by value ids, kept as sent, each ship of it getting a
 * delivery of its own.
 */
export interface LabelSelector {
  kind: 'label';
  valueIds: readonly LabelValueId[];
}

/** Who a message is for, as its sender addressed it (docs/blueprint.md, "Selector"). */
export type Selector = RecipientSelector | MeetingSelector | LabelSelector;

/**
 * Who a recipient selector resolves to at send time: one ship by its id, never
 * its name, so a rename or a reused name never redirects a sent message; or
 * the queue of a type, which the first ship of that type to receive the
 * delivery claims. A delivery goes to it.
 */
export type Recipient = { kind: 'ship'; shipId: ShipId } | { kind: 'type'; type: string };

/**
 * Who a message went to, as its selector resolved: a recipient; a meeting,
 * whose every other participant got a delivery of its own; or a label
 * selection as sent, each ship of it at send time getting a delivery of its
 * own.
 */
export type Addressee = Recipient | MeetingSelector | LabelSelector;
