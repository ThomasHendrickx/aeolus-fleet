import type { FleetId, IdGenerator, OperatorId, ShipId } from '@aeolus-fleet/common';

import type { OperatorAccountRepository } from '../identity/public.js';
import { recordEvent, SYSTEM, type EventLog } from '../shared/events.js';
import type { FleetRepository, ShipRepository } from './ports.js';
import { operatorShip } from './ship.js';

export interface FoundFleetTx {
  fleets: FleetRepository;
  ships: ShipRepository;
  operatorAccounts: OperatorAccountRepository;
  events: EventLog;
}

export interface FleetFounded {
  fleetId: FleetId;
  operatorShipId: ShipId;
  operatorId: OperatorId;
}

/**
 * Writes a new fleet, its operator ship `argo` and the operator account, with
 * FleetInitialised and ShipCommissioned, in the caller's unit of work. argo
 * gets no secret: the operator's sign-in is the only way to crew it (ADR
 * 0012). The caller has validated the name and email.
 */
export async function foundFleet(
  deps: { tx: FoundFleetTx; ids: IdGenerator },
  input: { name: string; email: string; passwordHash: string | null; at: Date },
): Promise<FleetFounded> {
  const { tx, ids } = deps;
  const { name, email, passwordHash, at } = input;

  const fleetId = ids('fleet');
  await tx.fleets.create({ id: fleetId, name, createdAt: at });

  const argo = operatorShip({ id: ids('ship'), fleetId, createdAt: at });
  await tx.ships.create(argo);

  const operatorId = ids('operator');
  await tx.operatorAccounts.create({ id: operatorId, fleetId, email, passwordHash, theme: 'system', createdAt: at });

  await recordEvent({ events: tx.events, ids }, { fleetId, type: 'FleetInitialised', occurredAt: at, actor: SYSTEM, details: { name, operatorId } });
  await recordEvent({ events: tx.events, ids }, {
    fleetId,
    type: 'ShipCommissioned',
    occurredAt: at,
    actor: SYSTEM,
    shipId: argo.id,
    details: { name: argo.name, type: argo.type, kind: argo.kind },
  });
  return { fleetId, operatorShipId: argo.id, operatorId };
}
