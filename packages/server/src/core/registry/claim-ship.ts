import type { IdGenerator, LocationKind, ShipId } from '@aeolus-fleet/common';

import {
  findValidShipSecret,
  markShipSecretClaimed,
  type CredentialTx,
  type SecretTools,
} from '../identity/public.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { CREW_TOKEN_PREFIX, location } from './lease.js';
import type { LeaseRepository, ShipRepository } from './ports.js';
import { claimShip, type ClaimRefusal } from './ship.js';

export interface ClaimShipTx extends CredentialTx {
  /** Read only: a claim never locks the ship (see the lock order below). */
  ships: Pick<ShipRepository, 'find'>;
  leases: LeaseRepository;
  events: EventLog;
}

export interface ShipCrewed {
  /** The crew token every later ship call carries, in plain text only here (ADR 0015). */
  crewToken: string;
}

export type ClaimShipRefusal = DomainError<'INVALID_LOCATION' | 'WRONG_SHIP_ID_OR_SECRET'> | ClaimRefusal;

export type ClaimShip = (input: {
  shipId: ShipId;
  secret: string;
  location: { kind: LocationKind; description?: string };
}) => Promise<Result<ShipCrewed, ClaimShipRefusal>>;

/**
 * Use case: a session claims a ship with the id and secret from its starting
 * prompt (`register`), reports where it runs, and becomes the ship's crew. The
 * ship's own secret is the credential, so no caller is resolved first.
 *
 * Lock order: the secret first, then the lease. The ship is read, never locked:
 * a starting prompt holds it `FOR NO KEY UPDATE` while it waits for the same
 * secret, so the two serialise on the secret. A claim that holds it first
 * crews the ship, and the prompt then finds the lease and is refused; a prompt
 * that holds it first invalidates it, and the claim then finds no valid
 * secret. Two claims with one secret serialise the same way: the second finds
 * the first one's lease.
 */
export function createClaimShip(deps: {
  uow: UnitOfWork<ClaimShipTx>;
  clock: Clock;
  ids: IdGenerator;
  secrets: Omit<SecretTools, 'ids'>;
}): ClaimShip {
  const { hasher, random } = deps.secrets;
  return async (input) => {
    const reported = location(input.location.kind, input.location.description);
    if (!reported.isOk) {
      return reported;
    }

    return deps.uow.run(async (tx): Promise<Result<ShipCrewed, ClaimShipRefusal>> => {
      const secret = await findValidShipSecret({ tx, hasher }, { shipId: input.shipId, secret: input.secret });
      if (!secret.isOk) {
        return secret;
      }
      const { fleetId, shipId } = secret.value;
      const ship = await tx.ships.find(fleetId, shipId);
      if (!ship) {
        // A secret always belongs to a ship of its fleet; the foreign key keeps it so.
        return refuse('WRONG_SHIP_ID_OR_SECRET', 'Wrong ship id or secret');
      }
      const heldLease = await tx.leases.findOpenForUpdate(fleetId, shipId);

      const crewToken = CREW_TOKEN_PREFIX + random.next();
      const at = deps.clock.now();
      const claimed = claimShip(
        { ship, heldLease },
        { leaseId: deps.ids('lease'), location: reported.value, crewTokenHash: hasher.hash(crewToken), at },
      );
      if (!claimed.isOk) {
        return claimed;
      }

      await tx.leases.open(claimed.value.lease);
      await markShipSecretClaimed(tx, { credential: secret.value, at });
      for (const event of claimed.value.events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      return ok({ crewToken });
    });
  };
}
