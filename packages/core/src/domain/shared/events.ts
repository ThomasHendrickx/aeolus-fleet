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
export async function recordEvent(deps: { events: EventLog; ids: IdGenerator }, event: NewEvent): Promise<void> {
  await deps.events.append({ ...event, id: deps.ids('event'), details: event.details ?? {} });
}

/** That a fleet's events up to `seq` have committed: a hint to read them, never their content. */
export interface FleetEventNotice {
  fleetId: FleetId;
  seq: number;
}

/** A committed event and its place in its fleet's stream: commit order, without gaps. */
export interface SequencedEvent extends FleetEvent {
  seq: number;
}

/**
 * Outbound port: wakes a waiting follow when its fleet has a new event. A
 * wake-up is a hint to read again, never the event itself.
 */
export interface FleetEventWakeups {
  /** Starts watching the fleet. A wake-up that comes before the next wait is kept for it. */
  watch(fleetId: FleetId): FleetNewsWatch;
}

export interface FleetNewsWatch {
  /** Settles when the fleet has news, or once `waitMs` has passed. */
  next(waitMs: number): Promise<'woken' | 'timedOut'>;
  stop(): void;
}

/**
 * Outbound port: reads a fleet's committed events by their place in its
 * stream, for live subscriptions to resume without missing one.
 */
export interface FleetEventFeed {
  /** The number of the fleet's last committed event; 0 before its first. */
  lastSeq(fleetId: FleetId): Promise<number>;
  /** Up to `limit` events numbered after `seq`, lowest first. */
  after(fleetId: FleetId, position: { seq: number; limit: number }): Promise<SequencedEvent[]>;
}
