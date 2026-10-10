import type { FleetId, IdGenerator, ShipId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { Recipient } from '../shared/selector.js';
import type { CarriedLabel } from './label.js';
import { allowsReach, type ReachingShip } from './network-settings.js';
import type { LabelRepository, NetworkSettingsRepository, ReachRefusalRepository, ShipRepository } from './ports.js';
import type { RefusedShip } from './reach-refusal.js';
import type { Ship } from './ship.js';

/** The ports a send's reach check reads and writes, inside the send's unit of work. */
export interface CheckReachTx {
  networkSettings: Pick<NetworkSettingsRepository, 'findForShare'>;
  ships: Pick<ShipRepository, 'find' | 'listActiveOfType'>;
  labels: Pick<LabelRepository, 'carriedBy' | 'find'>;
  reachRefusals: ReachRefusalRepository;
}

/** One fixed message, so a refused sender learns nothing about the rules (decision 0034). */
export type NotReachable = DomainError<'NOT_REACHABLE'>;

/** What a send may go on with: for a type, the ships of it the sender may reach, or none for any ship of it. */
export interface Reach {
  reachableShipIds?: readonly ShipId[];
}

/**
 * Whether the fleet's network rules let the sender reach the recipient a
 * selector resolved to, at send time: Messaging's question to Registry before
 * it stores a message (decision 0034). The settings stay held shared until
 * the unit of work ends, so a change of rules waits for the send, and a send
 * that comes after it is checked against the new version.
 *
 * For a type, the ships of it the sender may reach now are the ones that may
 * claim the delivery, fixed here; none of them refuses the send. With no
 * rules, or from argo, who reaches every ship, any ship of the type may.
 *
 * A refusal is recorded here, in the send's unit of work, with the ships and
 * the label values they carry now and the settings version: the send stores
 * nothing else, so its caller commits only the record. `isAnswerToSender` says
 * the send answers the sender of a message the sending ship received.
 */
export async function checkReach(
  deps: { tx: CheckReachTx; ids: IdGenerator },
  send: { fleetId: FleetId; senderShipId: ShipId; recipient: Recipient; isAnswerToSender: boolean; at: Date },
): Promise<Result<Reach, NotReachable>> {
  const { tx, ids } = deps;
  const { fleetId, recipient } = send;
  const settings = await tx.networkSettings.findForShare(fleetId);
  const senderShip = await tx.ships.find(fleetId, send.senderShipId);
  if (settings.rules === null || !senderShip || senderShip.kind === 'operator') {
    return ok({});
  }
  const sender = await shipAsItIs(tx, senderShip);
  const allows = (to: ShipAsItIs) => allowsReach(settings, { sender: reaching(sender), recipient: reaching(to), isAnswerToSender: send.isAnswerToSender });
  const refusal = { fleetId, at: send.at, sender: refused(sender), settingsVersion: settings.version };

  if (recipient.kind === 'type') {
    const ships: ShipAsItIs[] = [];
    for (const ship of await tx.ships.listActiveOfType(fleetId, recipient.type)) {
      ships.push(await shipAsItIs(tx, ship));
    }
    const reachable = ships.filter(allows);
    if (reachable.length > 0) {
      return ok({ reachableShipIds: reachable.map(({ ship }) => ship.id) });
    }
    await tx.reachRefusals.record({ ...refusal, id: ids('reachRefusal'), recipient: { kind: 'type', type: recipient.type, ships: ships.map(refused) } });
    return refuse('NOT_REACHABLE', NOT_REACHABLE_MESSAGE);
  }

  const reachedShip = await tx.ships.find(fleetId, recipient.shipId);
  if (!reachedShip) {
    // resolveSelector found it in this unit of work: a ship is never deleted, only retired.
    return ok({});
  }
  const reached = await shipAsItIs(tx, reachedShip);
  if (allows(reached)) {
    return ok({});
  }
  await tx.reachRefusals.record({ ...refusal, id: ids('reachRefusal'), recipient: { kind: 'ship', ship: refused(reached) } });
  return refuse('NOT_REACHABLE', NOT_REACHABLE_MESSAGE);
}

const NOT_REACHABLE_MESSAGE = 'The network rules do not allow this send';

interface ShipAsItIs {
  ship: Ship;
  labels: CarriedLabel[];
}

/** The ship with the label values it carries now, by key then value, with their texts. */
async function shipAsItIs(tx: CheckReachTx, ship: Ship): Promise<ShipAsItIs> {
  const labels: CarriedLabel[] = [];
  for (const carried of await tx.labels.carriedBy(ship.fleetId, ship.id)) {
    const label = await tx.labels.find(ship.fleetId, carried.labelId);
    const value = label?.values.find((held) => held.id === carried.valueId);
    if (label && value) {
      labels.push({ labelId: label.id, key: label.key, valueId: value.id, value: value.value });
    }
  }
  labels.sort((first, second) => first.key.localeCompare(second.key) || first.value.localeCompare(second.value));
  return { ship, labels };
}

function reaching({ ship, labels }: ShipAsItIs): ReachingShip {
  return { kind: ship.kind, labels: labels.map((label) => label.valueId) };
}

function refused({ ship, labels }: ShipAsItIs): RefusedShip {
  return { id: ship.id, name: ship.name, labels };
}
