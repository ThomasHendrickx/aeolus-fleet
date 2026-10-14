import {
  OVERDUE_CLOCKS,
  type ComputerSide,
  type CrewStatus,
  type DeliveryHolder,
  type DeliveryState,
  type LeaseEndReason,
  type OverdueClock,
  type ShipId,
  type TurnState,
} from '@aeolus-fleet/common';

import type { Location } from '../registry/public.js';
import type { SequencedEvent } from './events.js';
import { isDeliveryChangeType, type DeliveryChange, type HistoryParty } from './history.js';

/**
 * A message's way through (decision 0040, #756): who holds its delivery, the
 * part each step was taken by, and the clocks that speak for it. Read models
 * only, from the event log and the leases its steps name.
 */

/** What the history reads of a lease on a delivery's way. */
export interface WayLease {
  location: Location;
  harness: string | null;
  /** The ship other than argo whose starting prompt its crew claimed with: its trierarch; null crewed by hand. */
  trierarch: HistoryParty | null;
  /** From its first push receive until it ends. */
  isPushed: boolean;
  isEnded: boolean;
  /** Why it ended, as its LeaseRevoked says; null while open. */
  endReason: LeaseEndReason | null;
  /** Its session's turn as its hooks last reported it; null until they report. */
  turn: { state: TurnState; at: Date } | null;
}

/** An overdue clock argo was told of that still stands: the delivery is still in the state it was told in, on that open lease. */
export interface StandingOverdue {
  clock: OverdueClock;
  minutes: number;
  toldAt: Date;
}

/** How a trierarch says the crew of a ship stands, from its crew request. */
export interface WayCrew {
  status: CrewStatus;
  attempt: number;
  startedAt: Date | null;
}

/** Where a delivery stands on its way. */
export interface DeliveryWay {
  holder: DeliveryHolder | null;
  /** When it entered its state. */
  since: Date;
  /** A plain receive handed it last, with no hand-over number. */
  isPulled: boolean;
  overdue: StandingOverdue | null;
  /** The lease that holds it, or a pending delivery to one ship waits for. */
  lease: { by: ComputerSide | null; isEnded: boolean; turn: WayLease['turn'] } | null;
  /** The crew the lease's trierarch runs; none for a session crewed by hand. */
  crew: WayCrew | null;
}

/**
 * The part that receives and hands over for a pushed lease's session: its
 * trierarch, or else the plugin watcher of a session crewed by hand. A pull
 * lease has none: its agent receives itself.
 */
export function computerSideOf(lease: Pick<WayLease, 'isPushed' | 'trierarch'>): ComputerSide | null {
  if (!lease.isPushed) {
    return null;
  }
  return lease.trierarch ? { kind: 'trierarch', trierarch: lease.trierarch } : { kind: 'pluginWatcher' };
}

function isOverdueClock(value: unknown): value is OverdueClock {
  return OVERDUE_CLOCKS.some((clock) => clock === value);
}

/**
 * One step of a delivery's way from its event: the ship it names, where a
 * hand-over's session ran, the computer side that received it or handed it
 * over, and what the event's details say of it. No step for an event that is
 * no delivery change.
 */
export function deliveryStepOf(
  event: SequencedEvent,
  read: { party: (id: ShipId) => HistoryParty; leases: ReadonlyMap<string, WayLease> },
): DeliveryChange[] {
  const { type, details } = event;
  if (!isDeliveryChangeType(type)) {
    return [];
  }
  const lease = typeof details.leaseId === 'string' ? read.leases.get(details.leaseId) : undefined;
  const isTakenBySession = type === 'DeliveryReceived' || type === 'DeliveryHanded';
  const { attempts, handOverNumber, clock, minutes } = details;
  return [
    {
      seq: event.seq,
      type,
      occurredAt: event.occurredAt,
      ship: type === 'MessageAccepted' || event.shipId === undefined ? null : read.party(event.shipId),
      location: type === 'DeliveryHanded' && lease ? lease.location : null,
      harness: type === 'DeliveryHanded' && lease ? lease.harness : null,
      attempts: typeof attempts === 'number' ? attempts : null,
      by: isTakenBySession && lease ? computerSideOf(lease) : null,
      handOverNumber: typeof handOverNumber === 'number' ? handOverNumber : null,
      isAgain: details.again === true,
      isOnceMore: details.onceMore === true,
      overdue: type === 'DeliveryOverdue' && isOverdueClock(clock) && typeof minutes === 'number' ? { clock, minutes } : null,
      leaseEnd: type === 'DeliveryReturned' ? (lease?.endReason ?? null) : null,
    },
  ];
}

/** Who holds a delivery in its state: the fleet while pending, the computer side while received, the agent once handed. */
function holderOf(state: DeliveryState, lease: WayLease | null): DeliveryHolder | null {
  switch (state) {
    case 'pending':
      return { kind: 'fleet' };
    case 'received':
      return lease ? computerSideOf(lease) : null;
    case 'handed':
    case 'acknowledged':
      return { kind: 'agent' };
    case 'handled':
    case 'notHandled':
    case 'undeliverable':
    case 'dismissed':
    case 'abandoned':
      return null;
  }
}

/** Whether a step changed the delivery's state: an overdue clock, a receive again and a hand-over once more do not. */
function isStateChange(step: DeliveryChange): boolean {
  return step.type !== 'DeliveryOverdue' && !step.isAgain && !step.isOnceMore;
}

/**
 * Where a delivery stands on its way, from its state, its steps newest first,
 * the lease that holds it or that it waits for, the overdue clock that stands
 * and the crew request of that lease's ship.
 */
export function deliveryWayOf(read: {
  state: DeliveryState;
  history: readonly DeliveryChange[];
  lease: WayLease | null;
  overdue: StandingOverdue | null;
  crew: WayCrew | null;
}): DeliveryWay {
  const { state, history, lease, overdue, crew } = read;
  const entered = history.find(isStateChange);
  const lastHandOver = history.find((step) => step.type === 'DeliveryHanded');
  return {
    holder: holderOf(state, lease),
    since: entered?.occurredAt ?? history.at(-1)?.occurredAt ?? new Date(0),
    isPulled: lastHandOver?.handOverNumber === null && !lastHandOver.isOnceMore,
    overdue,
    lease: lease && { by: computerSideOf(lease), isEnded: lease.isEnded, turn: lease.turn },
    crew: lease?.trierarch ? crew : null,
  };
}
