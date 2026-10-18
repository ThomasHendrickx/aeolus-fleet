import type { EventType, ShipId } from '@aeolus-fleet/common';

import type { Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { ok, type Result } from '../shared/result.js';
import type { Recipient } from '../shared/selector.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { rulesInForceAt, type CheckReachTx } from './check-reach.js';
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
  labels: Pick<CheckReachTx['labels'], 'carriedBy'>;
  leases: CheckReachTx['leases'];
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
 * Works out what a caller reads now, as a send is checked: the rules in
 * force, what the networking plugin declared while it does not respond, the
 * built-in rules, read rules only. A ship always reads itself. argo reads
 * every ship, as does every ship while open is on for read and the viewer
 * while its reading is on; otherwise each ship of the fleet, retired ones
 * too, is read when a rule lets the caller read it.
 */
export function createReadReachOf(deps: { uow: UnitOfWork<ReadReachTx>; clock: Clock }): ReadReachOf {
  return async (caller) => {
    const worked = await deps.uow.run(async (tx): Promise<Result<ReadReach, never>> => {
      if (caller.kind === 'operator') {
        return ok(EVERY);
      }
      const { fleetId } = caller;
      const settings = await tx.networkSettings.findForShare(fleetId);
      const inForce = await rulesInForceAt(tx, { settings, now: deps.clock.now() });
      if (inForce.builtIns.open.read || (caller.kind === 'viewer' && inForce.builtIns.isViewerReadOn)) {
        return ok(EVERY);
      }
      const readerShip = await tx.ships.find(fleetId, caller.shipId);
      const reader = readerShip && (await reachingOf(tx, readerShip));
      const read: Ship[] = [];
      for (const ship of await tx.ships.list(fleetId)) {
        if (ship.id === caller.shipId || (reader && allowsReach(inForce, { verb: 'read', sender: reader, recipient: await reachingOf(tx, ship), isAnswerToSender: false }))) {
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
    return worked.isOk ? worked.value : { kind: 'some', shipIds: new Set([caller.shipId]), types: new Set() };
  };
}

async function reachingOf(tx: Pick<ReadReachTx, 'labels'>, ship: Ship): Promise<ReachingShip> {
  const labels = (await tx.labels.carriedBy(ship.fleetId, ship.id)).map(({ labelId, valueId }) => ({ labelId, valueId }));
  return { id: ship.id, owner: ship.owner, kind: ship.kind, labels };
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
const RULES_EVENTS: ReadonlySet<EventType> = new Set(['NetworkRulesDeclared', 'NetworkRulesSet', 'BuiltInRuleChanged']);

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
