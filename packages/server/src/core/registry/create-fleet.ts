import type { FleetId, IdGenerator, ShipId } from '@aeolus-fleet/common';

import { operatorEmail } from '../identity/public.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { fleetName } from './fleet.js';
import { foundFleet, type FoundFleetTx } from './found-fleet.js';
import type { InstallationRequestRepository } from './ports.js';

export interface CreateFleetTx extends FoundFleetTx {
  installationRequests: InstallationRequestRepository;
}

export interface FleetCreated {
  fleetId: FleetId;
  operatorShipId: ShipId;
}

export type CreateFleetRefusal = DomainError<'INVALID_FLEET_NAME' | 'INVALID_EMAIL' | 'OPERATOR_EMAIL_TAKEN' | 'IDEMPOTENCY_KEY_REUSED'>;

export type CreateFleet = (input: { requestId: string; name: string; operatorEmail: string }) => Promise<Result<FleetCreated, CreateFleetRefusal>>;

/**
 * Use case: the installation creates a fleet (docs/blueprint.md,
 * "Installation"), with its argo and its operator account, who has no
 * password: a password sign-in for that operator fails like a wrong password.
 * Unlike fleet:init it creates a fleet beside others. The operator email stays
 * unique across the installation. Under its request id it runs once: a replay
 * answers the same fleet, and a different create under that id is refused.
 */
export function createCreateFleet(deps: { uow: UnitOfWork<CreateFleetTx>; clock: Clock; ids: IdGenerator }): CreateFleet {
  return async (input) => {
    const named = fleetName(input.name);
    if (!named.isOk) {
      return named;
    }
    const email = operatorEmail(input.operatorEmail);
    if (!email.isOk) {
      return email;
    }
    const name = named.value;

    return deps.uow.run(async (tx): Promise<Result<FleetCreated, CreateFleetRefusal>> => {
      await tx.installationRequests.lock(input.requestId);
      const earlier = await tx.installationRequests.find(input.requestId);
      if (earlier) {
        return earlier.kind === 'createFleet' && earlier.name === name && earlier.operatorEmail === email.value
          ? ok({ fleetId: earlier.fleetId, operatorShipId: earlier.operatorShipId })
          : refuse('IDEMPOTENCY_KEY_REUSED', 'This request id was used for another request: use a new one for every request');
      }

      await tx.operatorAccounts.lockEmail(email.value);
      if (await tx.operatorAccounts.findByEmailForUpdate(email.value)) {
        return refuse('OPERATOR_EMAIL_TAKEN', `An operator already signs in with ${email.value}`);
      }

      const at = deps.clock.now();
      const { fleetId, operatorShipId } = await foundFleet({ tx, ids: deps.ids }, { name, email: email.value, passwordHash: null, at });
      await tx.installationRequests.record({ requestId: input.requestId, at, kind: 'createFleet', fleetId, name, operatorEmail: email.value, operatorShipId });
      return ok({ fleetId, operatorShipId });
    });
  };
}
