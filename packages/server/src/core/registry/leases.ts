import type { FleetId, IdGenerator, LeaseId, ShipId, ShipKind } from '@aeolus-fleet/common';

import { DomainError } from '../shared/errors.js';
import { recordEvent, type Actor, type EventLog } from '../shared/events.js';
import type { LeaseEndReason, Location } from './lease.js';
import type { InFlightDeliveries, LeaseRepository } from './ports.js';

/** The ports the lease operations need, inside the caller's unit of work. */
export interface LeaseTx {
  leases: LeaseRepository;
  inFlightDeliveries: InFlightDeliveries;
  events: EventLog;
}

/**
 * Starts a new lease on the operator ship, ending the one it holds. Only `argo`
 * is taken over this way; any other ship fails a second claim instead
 * (ADR 0010). Writes LeaseRevoked for the old lease and ShipClaimed for the new.
 */
export async function takeOverOperatorLease(
  tx: LeaseTx,
  ids: IdGenerator,
  input: { fleetId: FleetId; shipId: ShipId; kind: ShipKind; location: Location; actor: Actor; at: Date },
): Promise<LeaseId> {
  const { fleetId, shipId, location, actor, at } = input;
  if (input.kind !== 'operator') {
    throw new DomainError('NOT_THE_OPERATOR_SHIP', 'Only the operator ship can be taken over');
  }

  const held = await tx.leases.findOpenForUpdate(fleetId, shipId);
  if (held) {
    await endLease(tx, ids, { fleetId, leaseId: held.id, actor, at, reason: 'takenOver' });
  }

  const leaseId = ids('lease');
  await tx.leases.open({ id: leaseId, fleetId, shipId, location, startedAt: at, endedAt: null });
  await recordEvent(tx.events, ids, {
    fleetId,
    type: 'ShipClaimed',
    occurredAt: at,
    actor,
    shipId,
    details: { leaseId, location: location.kind, locationDescription: location.description },
  });
  return leaseId;
}

/**
 * Ends a lease if it is still open: the ship awaits a new crew and its
 * deliveries in flight return to pending. Writes LeaseRevoked. Returns false
 * when the lease had already ended.
 */
export async function endLease(
  tx: LeaseTx,
  ids: IdGenerator,
  input: { fleetId: FleetId; leaseId: LeaseId; actor: Actor; at: Date; reason: LeaseEndReason },
): Promise<boolean> {
  const { fleetId, leaseId, actor, at, reason } = input;

  const ended = await tx.leases.end(fleetId, leaseId, at);
  if (!ended) {
    return false;
  }

  const returnedDeliveries = await tx.inFlightDeliveries.returnToPending(fleetId, ended.shipId);
  await recordEvent(tx.events, ids, {
    fleetId,
    type: 'LeaseRevoked',
    occurredAt: at,
    actor,
    shipId: ended.shipId,
    details: { leaseId, reason, returnedDeliveries },
  });
  return true;
}
