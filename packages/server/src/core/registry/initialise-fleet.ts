import type { FleetId, IdGenerator, OperatorId, ShipId } from '@aeolus-fleet/common';

import { operatorEmail, operatorPassword, type OperatorAccountRepository } from '../identity/public.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, SYSTEM, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { PasswordHasher } from '../shared/secrets.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { fleetName } from './fleet.js';
import type { FleetRepository, ShipRepository } from './ports.js';
import { operatorShip } from './ship.js';

export interface InitialiseFleetTx {
  fleets: FleetRepository;
  ships: ShipRepository;
  operatorAccounts: OperatorAccountRepository;
  events: EventLog;
}

export interface FleetInitialised {
  fleetId: FleetId;
  operatorShipId: ShipId;
  operatorId: OperatorId;
}

export type InitialiseFleetRefusal = DomainError<
  'INVALID_FLEET_NAME' | 'INVALID_EMAIL' | 'INVALID_PASSWORD' | 'FLEET_ALREADY_EXISTS'
>;

export type InitialiseFleet = (input: {
  name: string;
  email: string;
  password: string;
}) => Promise<Result<FleetInitialised, InitialiseFleetRefusal>>;

/**
 * Use case: creates the fleet, its operator ship `argo` and the operator
 * account the console signs in with, in one transaction. argo gets no secret:
 * that sign-in is the only way to crew it. Runs once per installation: it
 * refuses when any fleet exists. A server command, never a public page
 * (ADR 0012).
 */
export function createInitialiseFleet(deps: {
  uow: UnitOfWork<InitialiseFleetTx>;
  clock: Clock;
  ids: IdGenerator;
  passwords: PasswordHasher;
}): InitialiseFleet {
  return async (input) => {
    const named = fleetName(input.name);
    if (!named.isOk) {
      return named;
    }
    const email = operatorEmail(input.email);
    if (!email.isOk) {
      return email;
    }
    const password = operatorPassword(input.password);
    if (!password.isOk) {
      return password;
    }
    const name = named.value;
    // Hashed before the transaction: Argon2 takes its time on purpose.
    const passwordHash = await deps.passwords.hash(password.value);

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

      const operatorId = deps.ids('operator');
      await tx.operatorAccounts.create({ id: operatorId, fleetId, email: email.value, passwordHash, theme: 'system', createdAt: at });

      await recordEvent({ events: tx.events, ids: deps.ids }, {
        fleetId,
        type: 'FleetInitialised',
        occurredAt: at,
        actor: SYSTEM,
        details: { name, operatorId },
      });
      await recordEvent({ events: tx.events, ids: deps.ids }, {
        fleetId,
        type: 'ShipCommissioned',
        occurredAt: at,
        actor: SYSTEM,
        shipId: argo.id,
        details: { name: argo.name, type: argo.type, kind: argo.kind },
      });

      return ok({ fleetId, operatorShipId: argo.id, operatorId });
    });
  };
}
