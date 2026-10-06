import type { FleetId, IdGenerator, ShipId } from '@aeolus-fleet/common';

import { operatorEmail } from '../identity/public.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { SecretHasher } from '../shared/secrets.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { fleetName } from './fleet.js';
import { foundFleet, type FoundFleetTx } from './found-fleet.js';
import { installationRequestText } from './installation-request.js';
import type { InstallationRequestRepository, InstallationSettingsRepository } from './ports.js';

export interface CreateFleetTx extends FoundFleetTx {
  installationRequests: InstallationRequestRepository;
  installationSettings: InstallationSettingsRepository;
}

export interface FleetCreated {
  fleetId: FleetId;
  operatorShipId: ShipId;
}

export type CreateFleetRefusal = DomainError<'INVALID_FLEET_NAME' | 'INVALID_EMAIL' | 'OPERATOR_EMAIL_TAKEN' | 'IDEMPOTENCY_KEY_REUSED' | 'FLEET_LIMIT_REACHED'>;

export type CreateFleet = (input: {
  requestId: string;
  name: string;
  operatorEmail: string;
  /** Whether the fleet gets a viewer ship, its read-only door into the console (decision 0022). */
  hasViewer?: boolean;
}) => Promise<Result<FleetCreated, CreateFleetRefusal>>;

/**
 * Use case: the installation creates a fleet (docs/blueprint.md,
 * "Installation"), with its argo and its operator account, who has no
 * password: a password sign-in for that operator fails like a wrong password.
 * Unlike fleet:init it creates a fleet beside others. The operator email stays
 * unique across the installation. Asked for, the viewer ship comes with it
 * (decision 0022). Under its request id it runs once: a replay
 * answers the same fleet, and a different create under that id is refused.
 */
export function createCreateFleet(deps: { uow: UnitOfWork<CreateFleetTx>; clock: Clock; ids: IdGenerator; hasher: SecretHasher }): CreateFleet {
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
    const hasViewer = input.hasViewer === true;
    const requestHash = deps.hasher.hash(installationRequestText(hasViewer ? ['createFleet', name, email.value, 'viewer'] : ['createFleet', name, email.value]));

    return deps.uow.run(async (tx): Promise<Result<FleetCreated, CreateFleetRefusal>> => {
      await tx.installationRequests.lock(input.requestId);
      const earlier = await tx.installationRequests.find(input.requestId);
      if (earlier) {
        return earlier.kind === 'createFleet' && earlier.requestHash === requestHash
          ? ok({ fleetId: earlier.fleetId, operatorShipId: earlier.operatorShipId })
          : refuse('IDEMPOTENCY_KEY_REUSED', 'This request id was used for another request: use a new one for every request');
      }

      const { fleetCap } = await tx.installationSettings.read();
      if (fleetCap !== null) {
        // Counted under the installation-wide lock, held until the fleet is stored: creates at the cap never overshoot it.
        await tx.fleets.lockInitialisation();
        if ((await tx.fleets.count()) >= fleetCap) {
          return refuse('FLEET_LIMIT_REACHED', `The installation is at its cap of ${String(fleetCap)} fleets, so it creates no new one.`);
        }
      }

      await tx.operatorAccounts.lockEmail(email.value);
      if (await tx.operatorAccounts.findByEmailForUpdate(email.value)) {
        return refuse('OPERATOR_EMAIL_TAKEN', `An operator already signs in with ${email.value}`);
      }

      const at = deps.clock.now();
      const { fleetId, operatorShipId } = await foundFleet({ tx, ids: deps.ids }, { name, email: email.value, passwordHash: null, at, hasViewer });
      await tx.installationRequests.record({ requestId: input.requestId, at, requestHash, kind: 'createFleet', fleetId, operatorShipId });
      return ok({ fleetId, operatorShipId });
    });
  };
}
