import type {
  DeliveryId,
  EventId,
  EventType,
  FleetId,
  IdGenerator,
  MessageId,
  ShipId,
} from '@aeolus-fleet/common';

/** Who caused a state change: a ship (`argo` included) or the system, such as a server command. */
export type Actor = { kind: 'ship'; shipId: ShipId } | { kind: 'system' };

export const SYSTEM: Actor = { kind: 'system' };

export function shipActor(shipId: ShipId): Actor {
  return { kind: 'ship', shipId };
}

/** A small set of flat facts about the change. Never a payload or a secret. */
export type EventDetails = Readonly<Record<string, string | number | boolean | null>>;

/**
 * One state change in the append-only event log (docs/blueprint.md, "Domain
 * events"): its type and time, who caused it, which ship, message and delivery
 * it concerns, and a few details.
 */
export interface FleetEvent {
  id: EventId;
  fleetId: FleetId;
  type: EventType;
  occurredAt: Date;
  actor: Actor;
  shipId?: ShipId;
  messageId?: MessageId;
  deliveryId?: DeliveryId;
  details: EventDetails;
}

/** Outbound port: appends events in the caller's unit of work. Events are never changed. */
export interface EventLog {
  append(event: FleetEvent): Promise<void>;
}

export type NewEvent = Omit<FleetEvent, 'id' | 'details'> & { details?: EventDetails };

/** Gives the event its id and appends it. */
export async function recordEvent(events: EventLog, ids: IdGenerator, event: NewEvent): Promise<void> {
  await events.append({ ...event, id: ids('event'), details: event.details ?? {} });
}
