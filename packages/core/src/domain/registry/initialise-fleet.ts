import type { IdGenerator } from '@aeolus-fleet/common';

import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { fleetName } from './fleet.js';
import { foundFleet, type FleetFounded, type FoundFleetTx } from './found-fleet.js';

export type InitialiseFleetTx = FoundFleetTx;

export type FleetInitialised = FleetFounded;

export type InitialiseFleetRefusal = DomainError<'INVALID_FLEET_NAME' | 'FLEET_ALREADY_EXISTS'>;

export type InitialiseFleet = (input: { name: string }) => Promise<Result<FleetInitialised, InitialiseFleetRefusal>>;

/**
 * Use case: creates the fleet, its operator ship `argo` and argo's own
 * sign-in, with no email and no password, in one transaction: argo signs in
 * with a link from the terminal and sets both in Settings (accounts design,
 * A1). argo gets no secret: a console sign-in is the only way to crew it.
 * Runs once per installation: it refuses when any fleet exists. A server
 * command, never a public page (ADR 0012).
 */
export function createInitialiseFleet(deps: { uow: UnitOfWork<InitialiseFleetTx>; clock: Clock; ids: IdGenerator }): InitialiseFleet {
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

      return ok(await foundFleet({ tx, ids: deps.ids }, { name, email: null, passwordHash: null, at: deps.clock.now() }));
    });
  };
}
