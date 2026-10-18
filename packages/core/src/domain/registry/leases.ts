import type { FleetId, IdGenerator, LeaseId, LeaseWaker, ShipId, ShipKind } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, shipActor, type Actor, type EventLog } from '../shared/events.js';
import type { Notifier } from '../shared/notifier.js';
import { ok, type Result } from '../shared/result.js';
import { refuseEndedLease, type LeaseEnded, type LeaseEndReason, type Location } from './lease.js';
import type { InFlightDeliveries, LeaseRepository, ShipRepository } from './ports.js';
import type { Ship } from './ship.js';

/** The ports the lease operations need, inside the caller's unit of work. */
export interface LeaseTx {
  leases: LeaseRepository;
  inFlightDeliveries: InFlightDeliveries;
  events: EventLog;
  notifier: Notifier;
}

/** What the lease operations work with: the caller's unit of work and its id generator. */
export interface LeaseDeps {
  tx: LeaseTx;
  ids: IdGenerator;
}

/**
 * Starts a new lease on the operator ship, ending the one it holds. Only `argo`
 * is taken over this way; any other ship fails a second claim instead
 * (ADR 0010). Writes LeaseRevoked for the old lease and ShipClaimed for the new.
 */
export async function takeOverOperatorLease(
  deps: LeaseDeps,
  input: { fleetId: FleetId; shipId: ShipId; kind: ShipKind; location: Location; actor: Actor; at: Date },
): Promise<Result<LeaseId, DomainError<'NOT_THE_OPERATOR_SHIP'>>> {
  const { tx, ids } = deps;
  const { fleetId, shipId, location, actor, at } = input;
  if (input.kind !== 'operator') {
    return refuse('NOT_THE_OPERATOR_SHIP', 'Only the operator ship can be taken over');
  }

  const held = await tx.leases.findOpenForUpdate(fleetId, shipId);
  if (held) {
    await endLease(deps, { fleetId, leaseId: held.id, actor, at, reason: 'takenOver' });
  }

  const leaseId = ids('lease');
  await tx.leases.open({ id: leaseId, fleetId, shipId, location, harness: null, crewTokenHash: null, startedAt: at, endedAt: null });
  await recordEvent({ events: tx.events, ids }, {
    fleetId,
    type: 'ShipClaimed',
    occurredAt: at,
    actor,
    shipId,
    details: { leaseId, location: location.kind, locationDescription: location.description, harness: null },
  });
  return ok(leaseId);
}

/**
 * Ends a lease if it is still open, and with it the crew token it holds: the
 * ship awaits a new crew, and the deliveries the lease held in flight return
 * to pending, to the ship's inbox or its type's queue, their attempts kept.
 * Writes LeaseRevoked, then DeliveryReturned for each returned delivery, all
 * caused by whoever ended the lease, and wakes whoever waits for each, as a
 * send does: another ship of the type takes a returned type delivery at once.
 * The wake-up reaches them only once the unit of work commits. Returns false
 * when the lease had already ended.
 */
export async function endLease(
  deps: LeaseDeps,
  input: { fleetId: FleetId; leaseId: LeaseId; actor: Actor; at: Date; reason: LeaseEndReason },
): Promise<boolean> {
  const { tx, ids } = deps;
  const { fleetId, leaseId, actor, at, reason } = input;

  const ended = await tx.leases.end({ fleetId, leaseId, endedAt: at });
  if (!ended) {
    return false;
  }

  const returned = await tx.inFlightDeliveries.returnToPending(fleetId, leaseId);
  const concerns = { fleetId, occurredAt: at, actor, shipId: ended.shipId };
  await recordEvent({ events: tx.events, ids }, {
    ...concerns,
    type: 'LeaseRevoked',
    details: { leaseId, reason, returnedDeliveries: returned.length },
  });
  for (const { deliveryId, messageId, recipient, attempts } of returned) {
    await recordEvent({ events: tx.events, ids }, {
      ...concerns,
      type: 'DeliveryReturned',
      messageId,
      deliveryId,
      details: { leaseId, attempts },
    });
    await tx.notifier.deliveryPending({ fleetId, deliveryId, recipient });
  }
  return true;
}

/** The ports holding a crew's lease reads, inside the caller's unit of work. */
export interface HoldLeaseTx {
  leases: Pick<LeaseRepository, 'findOpenByIdForShare'>;
  ships: Pick<ShipRepository, 'find'>;
}

/**
 * Holds a crew's lease open until the unit of work ends and returns the ship
 * it crews: Messaging's question when a crew receives. A release or a takeover
 * ending the lease meanwhile waits, then returns to pending whatever the unit
 * of work claimed, so nothing stays claimed by an ended lease. Refused when
 * the lease has already ended.
 */
export async function holdLease(
  tx: HoldLeaseTx,
  crew: { fleetId: FleetId; leaseId: LeaseId },
): Promise<Result<Ship, LeaseEnded>> {
  const lease = await tx.leases.findOpenByIdForShare(crew.fleetId, crew.leaseId);
  const ship = lease && (await tx.ships.find(crew.fleetId, lease.shipId));
  return ship ? ok(ship) : refuseEndedLease();
}

/**
 * Marks the crew's lease pushed (decision 0040): from its first push receive
 * until it ends, the computer side takes its deliveries and the agent's plain
 * receive answers nothing. The first mark writes LeasePushed, caused by the
 * crew's ship, with what wakes the ship when the push receive states it
 * (interop 5.1); a lease already pushed, or one that has ended, stays as it
 * was, its waker included. Call it first in the unit of work, before the
 * lease is held.
 */
export async function markLeasePushed(
  deps: { tx: { leases: Pick<LeaseRepository, 'markPushed'>; events: EventLog }; ids: IdGenerator },
  crew: { fleetId: FleetId; shipId: ShipId; leaseId: LeaseId; at: Date; waker?: LeaseWaker },
): Promise<void> {
  const { tx, ids } = deps;
  const { fleetId, shipId, leaseId, at, waker } = crew;
  if (await tx.leases.markPushed({ fleetId, leaseId, at, waker: waker ?? null })) {
    await recordEvent({ events: tx.events, ids }, {
      fleetId,
      type: 'LeasePushed',
      occurredAt: at,
      actor: shipActor(shipId),
      shipId,
      details: { leaseId, ...(waker === undefined ? {} : { waker }) },
    });
  }
}

/** Whether the crew's lease is pushed: a push receive has marked it. */
export async function isLeasePushed(
  tx: { leases: Pick<LeaseRepository, 'isPushed'> },
  crew: { fleetId: FleetId; leaseId: LeaseId },
): Promise<boolean> {
  return tx.leases.isPushed(crew.fleetId, crew.leaseId);
}
