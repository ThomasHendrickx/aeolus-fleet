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
  ships: Pick<ShipRepository, 'find'>;
  labels: Pick<LabelRepository, 'carriedBy' | 'find'>;
  reachRefusals: ReachRefusalRepository;
}

/** One fixed message, so a refused sender learns nothing about the rules (decision 0033). */
export type NotReachable = DomainError<'NOT_REACHABLE'>;

/**
 * Whether the fleet's network rules let the sender reach the recipient a
 * selector resolved to, at send time: Messaging's question to Registry before
 * it stores a message (decision 0033). The settings stay held shared until
 * the unit of work ends, so a change of rules waits for the send, and a send
 * that comes after it is checked against the new version.
 *
 * A refusal is recorded here, in the send's unit of work, with both ships and
 * the label values they carry now and the settings version: the send stores
 * nothing else, so its caller commits only the record. `isAnswerToSender` says
 * the send answers the sender of a message the sending ship received.
 */
export async function checkReach(
  deps: { tx: CheckReachTx; ids: IdGenerator },
  send: { fleetId: FleetId; senderShipId: ShipId; recipient: Recipient; isAnswerToSender: boolean; at: Date },
): Promise<Result<void, NotReachable>> {
  const { tx, ids } = deps;
  const { fleetId, recipient } = send;
  const settings = await tx.networkSettings.findForShare(fleetId);
  if (settings.rules === null || recipient.kind === 'type') {
    return ok(undefined);
  }
  const sender = await shipAsItIs(tx, { fleetId, shipId: send.senderShipId });
  const reached = await shipAsItIs(tx, { fleetId, shipId: recipient.shipId });
  if (!sender || !reached) {
    // resolveSelector found both in this unit of work: a ship is never deleted, only retired.
    return ok(undefined);
  }
  if (allowsReach(settings, { sender: reaching(sender), recipient: reaching(reached), isAnswerToSender: send.isAnswerToSender })) {
    return ok(undefined);
  }
  await tx.reachRefusals.record({
    fleetId,
    id: ids('reachRefusal'),
    at: send.at,
    sender: refused(sender),
    recipient: { kind: 'ship', ship: refused(reached) },
    settingsVersion: settings.version,
  });
  return refuse('NOT_REACHABLE', 'The network rules do not allow this send');
}

interface ShipAsItIs {
  ship: Ship;
  labels: CarriedLabel[];
}

/** The ship with the label values it carries now, by key then value, with their texts. */
async function shipAsItIs(tx: CheckReachTx, { fleetId, shipId }: { fleetId: FleetId; shipId: ShipId }): Promise<ShipAsItIs | undefined> {
  const ship = await tx.ships.find(fleetId, shipId);
  if (!ship) {
    return undefined;
  }
  const labels: CarriedLabel[] = [];
  for (const carried of await tx.labels.carriedBy(fleetId, shipId)) {
    const label = await tx.labels.find(fleetId, carried.labelId);
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
