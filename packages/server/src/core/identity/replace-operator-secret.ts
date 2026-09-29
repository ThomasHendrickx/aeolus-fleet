import type { FleetId, IdGenerator, ShipId } from '@aeolus-fleet/common';

import { endLease, findOperatorShip, type LeaseTx, type ShipTx } from '../registry/index.js';
import type { Clock } from '../shared/clock.js';
import { recordEvent, SYSTEM } from '../shared/events.js';
import type { RandomTokens, SecretHasher } from '../shared/secrets.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { issueShipSecret, type CredentialTx } from './credential.js';
import type { ConsoleSessionRepository } from './ports.js';

export interface ReplaceOperatorSecretTx extends CredentialTx, LeaseTx, ShipTx {
  consoleSessions: ConsoleSessionRepository;
}

export interface OperatorSecretReplaced {
  shipId: ShipId;
  /** The new secret, in plain text only here. */
  secret: string;
}

export type ReplaceOperatorSecret = (input: { fleetId: FleetId }) => Promise<OperatorSecretReplaced>;

/**
 * Use case: a lost `argo` secret is replaced from the server (ADR 0012). The old
 * secret stops working, every console session ends, and so does the lease on
 * argo the session held. A server command: the system is the actor.
 */
export function createReplaceOperatorSecret(deps: {
  uow: UnitOfWork<ReplaceOperatorSecretTx>;
  clock: Clock;
  ids: IdGenerator;
  hasher: SecretHasher;
  random: RandomTokens;
}): ReplaceOperatorSecret {
  return ({ fleetId }) =>
    deps.uow.run(async (tx) => {
      const at = deps.clock.now();
      const argo = await findOperatorShip(tx, fleetId);

      const old = await tx.credentials.findValidForShipForUpdate(fleetId, argo.id);
      if (old) {
        await tx.credentials.invalidate(fleetId, old.id, at);
        await recordEvent(tx.events, deps.ids, {
          fleetId,
          type: 'CredentialRevoked',
          occurredAt: at,
          actor: SYSTEM,
          shipId: argo.id,
          details: { credentialId: old.id },
        });
      }

      for (const session of await tx.consoleSessions.endAll(fleetId, at)) {
        await endLease(tx, deps.ids, { fleetId, leaseId: session.leaseId, actor: SYSTEM, at, reason: 'secretReplaced' });
      }

      const secret = await issueShipSecret(tx, deps, { fleetId, shipId: argo.id, at });
      return { shipId: argo.id, secret };
    });
}
