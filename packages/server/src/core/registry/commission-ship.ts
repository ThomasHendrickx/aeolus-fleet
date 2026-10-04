import { FLEET_SCOPES, type FleetScope, type IdGenerator, type ShipId } from '@aeolus-fleet/common';

import type { SecretTools } from '../identity/public.js';
import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, shipActor } from '../shared/events.js';
import { idempotencyKey } from '../shared/idempotency-key.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { ShipRepository } from './ports.js';
import { commissionAgentShip, type CommissionRefusal } from './ship.js';
import { issueStartingPrompt, type StartingPromptTx } from './starting-prompt.js';

export interface CommissionShipTx extends StartingPromptTx {
  ships: ShipRepository;
}

export interface CommissionShipInput {
  name: string;
  type: string;
  note?: string;
  fleetScopes?: readonly FleetScope[];
  /** The caller's own key for this commission, so a retry never commissions twice. */
  idempotencyKey: string;
}

/**
 * The commissioned ship. On the first commission, the secret of its starting
 * prompt, shown once; on a repeat under the same key, none (the secret exists
 * in plain text only once), and the state of its starting prompt.
 */
export interface CommissionedShip {
  shipId: ShipId;
  secret: string | null;
  /** When its valid secret was issued and whether a session claimed it; null when it has none. */
  startingPrompt: { issuedAt: Date; isClaimed: boolean } | null;
}

export type CommissionShipRefusal = CommissionRefusal | DomainError<'INVALID_IDEMPOTENCY_KEY' | 'IDEMPOTENCY_KEY_REUSED'>;

export type CommissionShip = (caller: Caller, input: CommissionShipInput) => Promise<Result<CommissionedShip, CommissionShipRefusal>>;

/** The request as one text, so a repeat is known by its hash: the fleet scopes in a fixed order, each once. */
function commissionRequestText(input: CommissionShipInput): string {
  const fleetScopes = FLEET_SCOPES.filter((scope) => input.fleetScopes?.includes(scope));
  return JSON.stringify({ name: input.name, type: input.type, note: input.note ?? null, fleetScopes });
}

/**
 * Use case: the caller commissions an agent ship in its own fleet. The ship
 * awaits crew and gets its first starting prompt, all in one transaction. The
 * caller's scope (fleet:manage) is checked before this runs. The ship gets
 * the agent scopes and any fleet scopes asked for; any caller with
 * fleet:manage may give them (ADR 0016). The caller's idempotency key makes
 * a retry safe: the same key with the same request answers the ship it
 * commissioned, with no secret, and changes nothing; the same key with another
 * request is refused.
 */
export function createCommissionShip(deps: {
  uow: UnitOfWork<CommissionShipTx>;
  clock: Clock;
  ids: IdGenerator;
  secrets: Omit<SecretTools, 'ids'>;
}): CommissionShip {
  return (caller, input) =>
    deps.uow.run(async (tx): Promise<Result<CommissionedShip, CommissionShipRefusal>> => {
      const { fleetId } = caller;
      const actor = shipActor(caller.shipId);
      const at = deps.clock.now();
      const key = idempotencyKey(input.idempotencyKey);
      if (!key.isOk) {
        return key;
      }
      const requestHash = deps.secrets.hasher.hash(commissionRequestText(input));
      const commissionKey = { fleetId, by: caller.shipId, idempotencyKey: key.value };

      await tx.ships.lockCommissionKey(commissionKey);
      const original = await tx.ships.findByCommissionKey(commissionKey);
      if (original) {
        if (original.commission?.requestHash !== requestHash) {
          return refuse('IDEMPOTENCY_KEY_REUSED', 'This idempotency key was already used for another commission: commission with a new key');
        }
        const secret = await tx.credentials.findValidForShipForUpdate(fleetId, original.id);
        return ok({
          shipId: original.id,
          secret: null,
          startingPrompt: secret ? { issuedAt: secret.issuedAt, isClaimed: secret.claimedAt !== null } : null,
        });
      }

      await tx.ships.lockName(fleetId, input.name);
      const commissioned = commissionAgentShip(
        { ...input, id: deps.ids('ship'), fleetId, at, actor, commission: { by: caller.shipId, idempotencyKey: key.value, requestHash } },
        { activeShipNamed: await tx.ships.findActiveByName(fleetId, input.name) },
      );
      if (!commissioned.isOk) {
        return commissioned;
      }
      const { ship, events } = commissioned.value;

      await tx.ships.create(ship);
      for (const event of events) {
        await recordEvent({ events: tx.events, ids: deps.ids }, event);
      }
      const issued = await issueStartingPrompt(
        { tx, secrets: { ...deps.secrets, ids: deps.ids } },
        { fleetId, shipId: ship.id, actor, at },
      );
      return ok({ ...issued, startingPrompt: { issuedAt: at, isClaimed: false } });
    });
}
