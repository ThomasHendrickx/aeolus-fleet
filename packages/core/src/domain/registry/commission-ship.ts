import type { CommissionedShipKind, FleetId, IdGenerator, ShipId } from '@aeolus-fleet/common';

import type { SecretTools } from '../identity/public.js';
import { actorOf, isShipCaller, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent } from '../shared/events.js';
import { idempotencyKey } from '../shared/idempotency-key.js';
import { ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { appliedLimits, type AppliedLimitsTx } from './applied-limits.js';
import { lockNamedNamespaces, type NamedNamespacesTx } from './named-namespaces.js';
import type { ShipRepository } from './ports.js';
import { commissionShip, type Commissioner, type CommissioningActor, type CommissionRefusal, type Ship } from './ship.js';
import { issueStartingPrompt, type StartingPromptTx } from './starting-prompt.js';

export interface CommissionShipTx extends StartingPromptTx, AppliedLimitsTx, NamedNamespacesTx {
  ships: ShipRepository;
}

export interface CommissionShipInput {
  name: string;
  type: string;
  /** An agent when left out; a person ship needs fleet:person, an app ship fleet:on-behalf too (decisions 0044, 0053). */
  kind?: CommissionedShipKind;
  note?: string;
  scopes?: readonly string[];
  /** The ship that asked the caller, a plugin's ship holding fleet:on-behalf, for this one: the new ship gets its owner (decision 0045). */
  ownerOf?: ShipId;
  /** The owner argo picked for an app ship that a ship holding fleet:on-behalf, the gateway, commissions (decision 0045). */
  owner?: ShipId;
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

export type CommissionShipRefusal =
  | CommissionRefusal
  | DomainError<'INVALID_IDEMPOTENCY_KEY' | 'IDEMPOTENCY_KEY_REUSED' | 'SHIP_LIMIT_REACHED' | 'SHIP_NOT_FOUND'>;

export type CommissionShip = (caller: Caller, input: CommissionShipInput) => Promise<Result<CommissionedShip, CommissionShipRefusal>>;

/** The request as one text, so a repeat is known by its hash: the scopes in a fixed order, each once. */
function commissionRequestText(input: CommissionShipInput): string {
  const scopes = [...new Set(input.scopes)].toSorted();
  return JSON.stringify({
    name: input.name,
    type: input.type,
    kind: input.kind ?? 'agent',
    note: input.note ?? null,
    scopes,
    ownerOf: input.ownerOf ?? null,
    owner: input.owner ?? null,
  });
}

/**
 * The ship, read again once its owner is held FOR SHARE, so the owner the new
 * ship gets is never a retired one. A retire locks the owner first: one that
 * committed before has moved the ship to argo, so the owner read changed and
 * its new owner is held instead; one after waits for this commission and finds
 * the new ship among those it hands to argo.
 */
async function findWithOwnerHeld(tx: CommissionShipTx, ref: { fleetId: FleetId; shipId: ShipId }): Promise<Ship | undefined> {
  let ship = await tx.ships.find(ref.fleetId, ref.shipId);
  while (ship?.owner) {
    const owner = ship.owner;
    await tx.ships.findForShare(ref.fleetId, owner);
    ship = await tx.ships.find(ref.fleetId, ref.shipId);
    if (ship?.owner === owner) {
      return ship;
    }
  }
  return ship;
}

/** The actor a commission is kept under, with its idempotency keys: an account by its id only. */
function commissionerOf(caller: Caller): Commissioner {
  if (isShipCaller(caller)) {
    return { kind: 'ship', shipId: caller.shipId };
  }
  return caller.kind === 'account' ? { kind: 'account', accountId: caller.accountId } : { kind: 'installation' };
}

/**
 * The commissioning actor as the commission checks it: a ship read again with
 * its owner held, its scopes from the server; an account with its person
 * ship held FOR SHARE, so a retire of it waits; the installation as it is.
 */
async function commissioningActorOf(tx: CommissionShipTx, caller: Caller): Promise<CommissioningActor | undefined> {
  if (isShipCaller(caller)) {
    const ship = await findWithOwnerHeld(tx, { fleetId: caller.fleetId, shipId: caller.shipId });
    return ship && { kind: 'ship', ship };
  }
  if (caller.kind === 'account') {
    const personShip = caller.personShipId === null ? undefined : await tx.ships.findForShare(caller.fleetId, caller.personShipId);
    return { kind: 'account', scopes: caller.scopes, personShip };
  }
  return { kind: 'installation', scopes: caller.scopes };
}

/**
 * Use case: an actor, a ship, an account or the installation, commissions a
 * ship in its own fleet (decision 0053), an agent unless
 * it states another kind and holds the scope for it, read from the server
 * (fleet:commission for an agent, with fleet:on-behalf for an app ship,
 * fleet:person for a person ship, which owns itself). The ship
 * awaits crew and gets its first starting prompt, all in one transaction. The ship gets
 * the agent scopes and the scopes asked for, each one the caller may grant:
 * a ship's read from the server (decision 0046); each plugin namespace they
 * name is locked after the name. Its owner is the caller's owner, the caller
 * when it is a person ship, or an account's person ship; a caller
 * holding fleet:on-behalf may name the ship that asked it instead, whose owner
 * it gets, or for an app ship the owner argo picked (decision 0045). The
 * caller's idempotency key, its own apart from every other actor's, makes
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
      const actor = actorOf(caller);
      const at = deps.clock.now();
      const key = idempotencyKey(input.idempotencyKey);
      if (!key.isOk) {
        return key;
      }
      const requestHash = deps.secrets.hasher.hash(commissionRequestText(input));
      const commissionKey = { fleetId, by: commissionerOf(caller), idempotencyKey: key.value };

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

      const { ships: shipLimit } = await appliedLimits(tx, fleetId);
      if (shipLimit !== null) {
        // Counted under the fleet's lock, held until the ship is stored: commissions at the limit never overshoot it.
        await tx.ships.lockShipCount(fleetId);
        if ((await tx.ships.countActive(fleetId)) >= shipLimit) {
          return refuse('SHIP_LIMIT_REACHED', `The fleet is at its limit of ${String(shipLimit)} ships, so it takes no new one.`);
        }
      }

      const commissioner = await commissioningActorOf(tx, caller);
      const argo = await tx.ships.findOperatorShip(fleetId);
      if (!commissioner || !argo) {
        return refuse('SHIP_NOT_FOUND', "The commissioning ship or its fleet's argo does not exist");
      }
      const askingShip = input.ownerOf === undefined ? undefined : await findWithOwnerHeld(tx, { fleetId, shipId: input.ownerOf });
      if (input.ownerOf !== undefined && askingShip === undefined) {
        return refuse('SHIP_NOT_FOUND', `Ship ${input.ownerOf}, named as the ship that asked, does not exist`);
      }
      // Held FOR SHARE, as an asking ship's owner is: a retire of the named owner waits, so the new ship never keeps a retired owner.
      const namedOwner = input.owner === undefined ? undefined : await tx.ships.findForShare(fleetId, input.owner);
      await tx.ships.lockName(fleetId, input.name);
      const namespaces = await lockNamedNamespaces(tx, { fleetId, scopes: input.scopes ?? [] });
      const commissioned = commissionShip(
        { ...input, id: deps.ids('ship'), fleetId, commissioner, argoShipId: argo.id, askingShip, namedOwner, at, actor, commission: { by: commissionKey.by, idempotencyKey: key.value, requestHash } },
        { activeShipNamed: await tx.ships.findActiveByName(fleetId, input.name), namespaces },
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
