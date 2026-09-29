import type { FleetId, IdGenerator, ShipId } from '@aeolus-fleet/common';

import { issueShipSecret, type CredentialTx, type SecretTools } from '../identity/index.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, SYSTEM, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { fleetName } from './fleet.js';
import type { FleetRepository, ShipRepository } from './ports.js';
import { operatorShip } from './ship.js';

export interface InitialiseFleetTx extends CredentialTx {
  fleets: FleetRepository;
  ships: ShipRepository;
  events: EventLog;
}

export interface FleetInitialised {
  fleetId: FleetId;
  operatorShipId: ShipId;
  /** `argo`'s secret, in plain text only here. */
  secret: string;
}

export type InitialiseFleet = (input: {
  name: string;
}) => Promise<Result<FleetInitialised, DomainError<'INVALID_FLEET_NAME' | 'FLEET_ALREADY_EXISTS'>>>;

/**
 * Use case: creates the fleet and its operator ship `argo`, and issues argo's
 * secret, in one transaction. Runs once per installation: it refuses when any
 * fleet exists. A server command, never a public page (ADR 0012).
 */
export function createInitialiseFleet(deps: {
  uow: UnitOfWork<InitialiseFleetTx>;
  clock: Clock;
  ids: IdGenerator;
  secrets: Omit<SecretTools, 'ids'>;
}): InitialiseFleet {
  return async (input) => {
    const named = fleetName(input.name);
    if (!named.isOk) {
      return named;
    }
    const name = named.value;

    return deps.uow.run(async (tx) => {
      await tx.fleets.lockInitialisation();
      if ((await tx.fleets.count()) > 0) {
        return refuse('FLEET_ALREADY_EXISTS', 'A fleet already exists: a fleet is initialised only once');
      }

      const at = deps.clock.now();
      const fleetId = deps.ids('fleet');
      await tx.fleets.create({ id: fleetId, name, createdAt: at });

      const argo = operatorShip({ id: deps.ids('ship'), fleetId, createdAt: at });
      await tx.ships.create(argo);

      const secret = await issueShipSecret(
        { tx, ...deps.secrets, ids: deps.ids },
        { fleetId, shipId: argo.id, at },
      );

      await recordEvent({ events: tx.events, ids: deps.ids }, {
        fleetId,
        type: 'FleetInitialised',
        occurredAt: at,
        actor: SYSTEM,
        details: { name },
      });
      await recordEvent({ events: tx.events, ids: deps.ids }, {
        fleetId,
        type: 'ShipCommissioned',
        occurredAt: at,
        actor: SYSTEM,
        shipId: argo.id,
        details: { name: argo.name, type: argo.type, kind: argo.kind },
      });

      return ok({ fleetId, operatorShipId: argo.id, secret });
    });
  };
}
