import type { FleetId, IdGenerator, ShipId } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { err, ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { Recipient } from '../shared/selector.js';
import type { CarriedLabel } from './label.js';
import { allowsReach, isNetworkPluginResponding, rulesInForce, type NetworkSettings, type ReachingShip, type RulesInForce } from './network-settings.js';
import type { LabelRepository, LeaseRepository, NetworkSettingsRepository, ReachRefusalRepository, ShipRepository } from './ports.js';
import type { RefusedShip } from './reach-refusal.js';
import type { Ship } from './ship.js';

/** The ports a send's reach check reads and writes, inside the send's unit of work. */
export interface CheckReachTx {
  networkSettings: Pick<NetworkSettingsRepository, 'findForShare'>;
  ships: Pick<ShipRepository, 'find' | 'listActiveOfType'>;
  labels: Pick<LabelRepository, 'carriedBy' | 'find'>;
  reachRefusals: ReachRefusalRepository;
  leases: Pick<LeaseRepository, 'findLastSeen'>;
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
 * claim the delivery, fixed here; none of them refuses the send. With open
 * on for send, or from argo, who reaches every ship, any ship of the type
 * may.
 *
 * A refusal is recorded here, in the send's unit of work, with the ships and
 * the label values they carry now and the settings version: the send stores
 * nothing else, so its caller commits only the record. `isAnswerToSender` says
 * the send answers the sender of a message the sending ship received.
 *
 * While the fleet's networking plugin is not responding, what it declared
 * applies instead of its rules (decision 0035), and a refusal says so.
 */
export async function checkReach(
  deps: { tx: CheckReachTx; ids: IdGenerator },
  send: { fleetId: FleetId; senderShipId: ShipId; recipient: Recipient; isAnswerToSender: boolean; at: Date },
): Promise<Result<Reach, NotReachable>> {
  const { tx, ids } = deps;
  const { fleetId, recipient } = send;
  const settings = await tx.networkSettings.findForShare(fleetId);
  const inForce = await rulesInForceAt(tx, { settings, now: send.at });
  const senderShip = await tx.ships.find(fleetId, send.senderShipId);
  if (inForce.builtIns.open.send || !senderShip || senderShip.kind === 'operator') {
    return ok({});
  }
  const sender = await shipAsItIs(tx, senderShip);
  const allows = (to: ShipAsItIs) => allowsReach(inForce, { verb: 'send', sender: reaching(sender), recipient: reaching(to), isAnswerToSender: send.isAnswerToSender });
  const refusal = { fleetId, at: send.at, sender: refused(sender), verb: 'send' as const, settingsVersion: settings.version, whilePluginUnavailable: inForce.whilePluginUnavailable };

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

/** The ports a read's reach check reads and writes, inside the read's unit of work. */
export type CheckReadTx = Omit<CheckReachTx, 'ships'> & { ships: Pick<ShipRepository, 'find'> };

/**
 * Whether the read rules let the reader read one ship now, for a read that
 * a ship outside read reach refuses rather than filters (decision 0034). A
 * ship always reads itself. A refusal is recorded here, in the read's unit of
 * work, as a send's is, with the verb read: its caller commits only the record.
 */
export async function checkRead(
  deps: { tx: CheckReadTx; ids: IdGenerator },
  read: { fleetId: FleetId; readerShipId: ShipId; shipId: ShipId; at: Date },
): Promise<Result<undefined, NotReachable>> {
  const { tx, ids } = deps;
  const { fleetId, at } = read;
  const settings = await tx.networkSettings.findForShare(fleetId);
  const inForce = await rulesInForceAt(tx, { settings, now: at });
  const readerShip = await tx.ships.find(fleetId, read.readerShipId);
  const readShip = await tx.ships.find(fleetId, read.shipId);
  if (!readerShip || !readShip || readerShip.id === readShip.id) {
    return ok(undefined);
  }
  const reader = await shipAsItIs(tx, readerShip);
  const ship = await shipAsItIs(tx, readShip);
  if (allowsReach(inForce, { verb: 'read', sender: reaching(reader), recipient: reaching(ship), isAnswerToSender: false })) {
    return ok(undefined);
  }
  await tx.reachRefusals.record({
    fleetId,
    id: ids('reachRefusal'),
    at,
    sender: refused(reader),
    recipient: { kind: 'ship', ship: refused(ship) },
    verb: 'read',
    settingsVersion: settings.version,
    whilePluginUnavailable: inForce.whilePluginUnavailable,
  });
  return refuse('NOT_REACHABLE', 'The network rules do not allow this read');
}

/** The ports a manage call's reach check reads and writes, inside the call's unit of work. */
export type CheckManageTx = CheckReadTx;

/**
 * Whether the manage rules let the manager manage the ship now (decision
 * 0034): every fleet:manage call is checked on its target ship, argo
 * reaching every ship and an owner's ship the ships it owns. A refusal is
 * recorded here, in the call's unit of work, with the verb manage: its caller
 * commits only the record. A call that already holds the fleet's network
 * settings for update hands them in, so the check takes no second lock on
 * them.
 */
export async function checkManage(
  deps: { tx: CheckManageTx; ids: IdGenerator },
  manage: { fleetId: FleetId; managerShipId: ShipId; shipId: ShipId; at: Date; settings?: NetworkSettings },
): Promise<Result<undefined, NotReachable>> {
  const { tx, ids } = deps;
  const { fleetId, at } = manage;
  const settings = manage.settings ?? (await tx.networkSettings.findForShare(fleetId));
  const inForce = await rulesInForceAt(tx, { settings, now: at });
  const managerShip = await tx.ships.find(fleetId, manage.managerShipId);
  const managedShip = await tx.ships.find(fleetId, manage.shipId);
  if (!managerShip || !managedShip) {
    return ok(undefined);
  }
  const manager = await shipAsItIs(tx, managerShip);
  const ship = await shipAsItIs(tx, managedShip);
  if (allowsReach(inForce, { verb: 'manage', sender: reaching(manager), recipient: reaching(ship), isAnswerToSender: false })) {
    return ok(undefined);
  }
  await tx.reachRefusals.record({
    fleetId,
    id: ids('reachRefusal'),
    at,
    sender: refused(manager),
    recipient: { kind: 'ship', ship: refused(ship) },
    verb: 'manage',
    settingsVersion: settings.version,
    whilePluginUnavailable: inForce.whilePluginUnavailable,
  });
  return refuse('NOT_REACHABLE', 'The network rules do not allow this manage');
}

/** Whether a refusal is the reach check's: its record commits, though the call is refused. */
function isNotReachable(error: { kind: string }): error is NotReachable {
  return error.kind === 'NOT_REACHABLE';
}

/**
 * Runs a call in one unit of work that commits the record of a reach
 * refusal: refused by the network rules, the call stores nothing but that
 * record and answers the refusal; any other refusal rolls everything back.
 */
export async function keepingReachRefusal<Tx, T, E extends { kind: string }>(
  uow: UnitOfWork<Tx>,
  work: (tx: Tx) => Promise<Result<T, E | NotReachable>>,
): Promise<Result<T, E | NotReachable>> {
  const outcome = await uow.run(async (tx): Promise<Result<{ done: T } | { prevented: NotReachable }, E | NotReachable>> => {
    const done = await work(tx);
    if (done.isOk) {
      return ok({ done: done.value });
    }
    return isNotReachable(done.error) ? ok({ prevented: done.error }) : err(done.error);
  });
  if (!outcome.isOk) {
    return outcome;
  }
  return 'prevented' in outcome.value ? err(outcome.value.prevented) : ok(outcome.value.done);
}

/** The rules in force at the send: the plugin's crew last seen, read without a lock, says whether it responds. */
export async function rulesInForceAt(tx: Pick<CheckReachTx, 'leases'>, at: { settings: NetworkSettings; now: Date }): Promise<RulesInForce> {
  const { settings, now } = at;
  const { plugin } = settings;
  if (plugin === null) {
    return rulesInForce(settings, false);
  }
  const lastSeenAt = await tx.leases.findLastSeen(settings.fleetId, plugin.shipId);
  return rulesInForce(settings, isNetworkPluginResponding(plugin, { lastSeenAt, now }));
}

export interface ShipAsItIs {
  ship: Ship;
  labels: CarriedLabel[];
  /** Its owner's ship by id and name, none for argo and the viewer (decision 0045). */
  owner: { id: ShipId; name: string } | null;
}

/** The ship with the label values it carries now, by key then value, with their texts, and its owner. */
export async function shipAsItIs(tx: { labels: CheckReachTx['labels']; ships: Pick<ShipRepository, 'find'> }, ship: Ship): Promise<ShipAsItIs> {
  const labels: CarriedLabel[] = [];
  for (const carried of await tx.labels.carriedBy(ship.fleetId, ship.id)) {
    const label = await tx.labels.find(ship.fleetId, carried.labelId);
    const value = label?.values.find((held) => held.id === carried.valueId);
    if (label && value) {
      labels.push({ labelId: label.id, key: label.key, valueId: value.id, value: value.value });
    }
  }
  labels.sort((first, second) => first.key.localeCompare(second.key) || first.value.localeCompare(second.value));
  const owner = ship.owner === null ? undefined : await tx.ships.find(ship.fleetId, ship.owner);
  return { ship, labels, owner: owner ? { id: owner.id, name: owner.name } : null };
}

export function reaching({ ship, labels }: ShipAsItIs): ReachingShip {
  return { id: ship.id, owner: ship.owner, kind: ship.kind, labels: labels.map(({ labelId, valueId }) => ({ labelId, valueId })) };
}

function refused({ ship, labels, owner }: ShipAsItIs): RefusedShip {
  return { id: ship.id, name: ship.name, labels, owner };
}
