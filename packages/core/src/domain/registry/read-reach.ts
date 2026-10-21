import type { EventType, ShipId, ShipKind } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import { ok, type Result } from '../shared/result.js';
import type { Recipient } from '../shared/selector.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { actorAsItIs, rulesInForceOf, type CheckReachTx } from './check-reach.js';
import { allowsReach, type ReachingShip } from './network-settings.js';
import type { ShipRepository } from './ports.js';
import type { Ship } from './ship.js';

/**
 * The ships a caller reads (decision 0034): every ship, or some by id, with
 * the types of the active ones among them, by which an unclaimed message to a
 * type is read.
 */
export type ReadReach = { kind: 'every' } | { kind: 'some'; shipIds: ReadonlySet<ShipId>; types: ReadonlySet<string> };

/** The ports read reach is worked out from, in one unit of work so it reads one version of the rules. */
export interface ReadReachTx {
  networkSettings: CheckReachTx['networkSettings'];
  ships: Pick<ShipRepository, 'find' | 'list'>;
  labels: CheckReachTx['labels'];
  declaredNetworkRules: CheckReachTx['declaredNetworkRules'];
}

/** A message as read reach sees it: its sender, its recipient, and for a type the ship that claimed it, if one has. */
export interface MessageParties {
  senderId: ShipId;
  recipient: Recipient;
  claimedBy: ShipId | null;
}

export type ReadReachOf = (caller: Caller) => Promise<ReadReach>;

const EVERY: ReadReach = { kind: 'every' };

/**
 * Works out what a caller reads now, as a send is checked: the built-in
 * rules, the fleet's own and the declared ones, read rules only. A ship
 * always reads itself. argo reads every ship, as does every ship while open
 * is on and the viewer
 * while its reading is on; a plugin ship reads every ship by its
 * built-in rule; otherwise each ship of the fleet, retired ones
 * too, is read when a rule lets the caller read it.
 */
export function createReadReachOf(deps: { uow: UnitOfWork<ReadReachTx> }): ReadReachOf {
  return async (caller) => {
    const worked = await deps.uow.run(async (tx): Promise<Result<ReadReach, never>> => {
      if (caller.kind === 'operator') {
        return ok(EVERY);
      }
      const { fleetId } = caller;
      const settings = await tx.networkSettings.findForShare(fleetId);
      const inForce = await rulesInForceOf(tx, settings);
      if (inForce.isOpen || (caller.kind === 'viewer' && inForce.isViewerReadOn)) {
        return ok(EVERY);
      }
      const reader = await actorAsItIs(tx, caller);
      const readerShip = reader?.ship;
      if (readerShip?.kind === 'plugin') {
        return ok(EVERY);
      }
      const ships = await tx.ships.list(fleetId);
      const kinds = new Map(ships.map((ship) => [ship.id, ship.kind]));
      const read: Ship[] = [];
      for (const ship of ships) {
        const recipient = await reachingOf(tx, { ship, ownerKind: ship.owner === null ? undefined : kinds.get(ship.owner) });
        if (ship.id === readerShip?.id || (reader && allowsReach(inForce, { verb: 'read', sender: reader.reaching, recipient, isAnswerToSender: false }))) {
          read.push(ship);
        }
      }
      return ok({
        kind: 'some',
        shipIds: new Set(read.map((ship) => ship.id)),
        types: new Set(read.filter((ship) => ship.retiredAt === null && ship.kind !== 'viewer').map((ship) => ship.type)),
      });
    });
    // The work refuses nothing; were it to, the caller reads only itself.
    return worked.isOk ? worked.value : { kind: 'some', shipIds: new Set(caller.kind === 'account' || caller.kind === 'installation' ? [] : [caller.shipId]), types: new Set() };
  };
}

/** A ship as a read check sees it, its owner's kind taken from the fleet's list rather than read again. */
async function reachingOf(tx: Pick<ReadReachTx, 'labels'>, of: { ship: Ship; ownerKind: ShipKind | undefined }): Promise<ReachingShip> {
  const { ship, ownerKind } = of;
  const labels = (await tx.labels.carriedBy(ship.fleetId, ship.id)).map(({ labelId, valueId }) => ({ labelId, valueId }));
  return { id: ship.id, owner: ship.owner, kind: ship.kind, isOwnedByPerson: ownerKind === 'person', labels };
}

export function readsShip(reach: ReadReach, shipId: ShipId): boolean {
  return reach.kind === 'every' || reach.shipIds.has(shipId);
}

/**
 * Whether the reach reads the message: through its sender or its recipient.
 * A message to a type is read through the ship that claimed it, or while none
 * has, through any active ship of the type the reach reads.
 */
export function readsMessage(reach: ReadReach, message: MessageParties): boolean {
  if (reach.kind === 'every' || readsShip(reach, message.senderId)) {
    return true;
  }
  const { recipient, claimedBy } = message;
  if (recipient.kind === 'ship') {
    return readsShip(reach, recipient.shipId);
  }
  return claimedBy === null ? reach.types.has(recipient.type) : readsShip(reach, claimedBy);
}

/** The events about the rules: they concern no ship, whichever ship set or declared them, so every reader reads them. */
const RULES_EVENTS: ReadonlySet<EventType> = new Set(['NetworkRulesDeclared', 'NetworkRulesSet', 'NetworkRulesDraftSaved', 'NetworkRulesDraftDiscarded', 'BuiltInRuleChanged']);

/**
 * Whether the reach reads an event: through the message it concerns, else
 * through the ship it concerns. One that concerns neither, such as a label's,
 * or a rules event, every reader reads. Who caused it does not count.
 */
export function readsEvent(reach: ReadReach, event: { type: EventType; shipId: ShipId | null; message: MessageParties | null }): boolean {
  if (event.message !== null) {
    return readsMessage(reach, event.message);
  }
  return event.shipId === null || RULES_EVENTS.has(event.type) || readsShip(reach, event.shipId);
}
