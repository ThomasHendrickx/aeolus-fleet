import type { FleetId, IdGenerator, ShipId } from '@aeolus-fleet/common';

import type { AccountCaller, Caller } from '../shared/caller.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { err, ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import type { Recipient } from '../shared/selector.js';
import type { CarriedLabel } from './label.js';
import { allowsReach, rulesInForce, type NetworkSettings, type ReachingActor, type ReachingShip, type RulesInForce } from './network-settings.js';
import type { DeclaredNetworkRulesRepository, LabelRepository, NetworkSettingsRepository, ReachRefusalRepository, ShipRepository } from './ports.js';
import type { RefusedActor, RefusedShip } from './reach-refusal.js';
import type { Ship } from './ship.js';

/** The ports a send's reach check reads and writes, inside the send's unit of work. */
export interface CheckReachTx {
  networkSettings: Pick<NetworkSettingsRepository, 'findForShare'>;
  ships: Pick<ShipRepository, 'find' | 'listActiveOfType'>;
  labels: Pick<LabelRepository, 'carriedBy' | 'find' | 'findByKey'>;
  reachRefusals: ReachRefusalRepository;
  declaredNetworkRules: Pick<DeclaredNetworkRulesRepository, 'list'>;
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
 */
export async function checkReach(
  deps: { tx: CheckReachTx; ids: IdGenerator },
  send: { fleetId: FleetId; senderShipId: ShipId; recipient: Recipient; isAnswerToSender: boolean; at: Date },
): Promise<Result<Reach, NotReachable>> {
  const { tx, ids } = deps;
  const { fleetId, recipient } = send;
  const settings = await tx.networkSettings.findForShare(fleetId);
  const inForce = await rulesInForceOf(tx, settings);
  const senderShip = await tx.ships.find(fleetId, send.senderShipId);
  if (inForce.isOpen || !senderShip || senderShip.kind === 'operator') {
    return ok({});
  }
  const sender = await shipAsItIs(tx, senderShip);
  const allows = (to: ShipAsItIs) => allowsReach(inForce, { verb: 'send', sender: reaching(sender), recipient: reaching(to), isAnswerToSender: send.isAnswerToSender });
  const refusal = { fleetId, at: send.at, sender: { kind: 'ship' as const, ...refused(sender) }, askedBy: null, verb: 'send' as const, settingsVersion: settings.version };

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
 * ship always reads itself. The reader is any actor (decision 0057). A
 * refusal is recorded here, in the read's unit of work, as a send's is, with
 * the verb read: its caller commits only the record.
 */
export async function checkRead(
  deps: { tx: CheckReadTx; ids: IdGenerator },
  read: { reader: Caller; askedBy: ShipId | null; shipId: ShipId; at: Date },
): Promise<Result<undefined, NotReachable>> {
  const { tx, ids } = deps;
  const { reader: caller, at } = read;
  const { fleetId } = caller;
  const settings = await tx.networkSettings.findForShare(fleetId);
  const inForce = await rulesInForceOf(tx, settings);
  const reader = await actorAsItIs(tx, caller);
  const readShip = await tx.ships.find(fleetId, read.shipId);
  if (!reader || !readShip || reader.ship?.id === readShip.id) {
    return ok(undefined);
  }
  const ship = await shipAsItIs(tx, readShip);
  if (allowsReach(inForce, { verb: 'read', sender: reader.reaching, recipient: reaching(ship), isAnswerToSender: false })) {
    return ok(undefined);
  }
  const askedBy = read.askedBy === null ? undefined : await tx.ships.find(fleetId, read.askedBy);
  await tx.reachRefusals.record({
    fleetId,
    id: ids('reachRefusal'),
    at,
    sender: reader.refused,
    askedBy: askedBy ? refused(await shipAsItIs(tx, askedBy)) : null,
    recipient: { kind: 'ship', ship: refused(ship) },
    verb: 'read',
    settingsVersion: settings.version,
  });
  return refuse('NOT_REACHABLE', 'The network rules do not allow this read');
}

/** The ports a manage call's reach check reads and writes, inside the call's unit of work. */
export type CheckManageTx = CheckReadTx;

/**
 * Whether the manage rules let the manager manage the ship now (decision
 * 0034): every fleet:manage call is checked on its target ship, argo
 * reaching every ship, an owner's ship the ships it owns, and the
 * installation person ships and what they own. The manager is any actor
 * (decision 0057). A refusal is recorded here, in the call's unit of work,
 * with the verb manage: its caller commits only the record. A call that
 * already holds the fleet's network settings for update hands them in, so
 * the check takes no second lock on them.
 */
export async function checkManage(
  deps: { tx: CheckManageTx; ids: IdGenerator },
  manage: { manager: Caller; shipId: ShipId; at: Date; settings?: NetworkSettings },
): Promise<Result<undefined, NotReachable>> {
  const { tx, ids } = deps;
  const { manager: caller, at } = manage;
  const { fleetId } = caller;
  const settings = manage.settings ?? (await tx.networkSettings.findForShare(fleetId));
  const inForce = await rulesInForceOf(tx, settings);
  const manager = await actorAsItIs(tx, caller);
  const managedShip = await tx.ships.find(fleetId, manage.shipId);
  if (!manager || !managedShip) {
    return ok(undefined);
  }
  const ship = await shipAsItIs(tx, managedShip);
  if (allowsReach(inForce, { verb: 'manage', sender: manager.reaching, recipient: reaching(ship), isAnswerToSender: false })) {
    return ok(undefined);
  }
  await tx.reachRefusals.record({
    fleetId,
    id: ids('reachRefusal'),
    at,
    sender: manager.refused,
    askedBy: null,
    recipient: { kind: 'ship', ship: refused(ship) },
    verb: 'manage',
    settingsVersion: settings.version,
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

/**
 * The rules in force under the settings held: the fleet's own and every
 * declarer's, merged at check time (decision 0037). The declared ones change
 * only under the exclusive settings lock, so they belong to the version held.
 * While none are applied, open allows everything and they are not read.
 */
export async function rulesInForceOf(tx: Pick<CheckReachTx, 'declaredNetworkRules'>, settings: NetworkSettings): Promise<RulesInForce> {
  return rulesInForce(settings, settings.rules === null ? [] : await tx.declaredNetworkRules.list(settings.fleetId));
}

export interface ShipAsItIs {
  ship: Ship;
  labels: CarriedLabel[];
  /** Its owner's ship by id and name, none for argo and the viewer (decision 0045). */
  owner: { id: ShipId; name: string } | null;
  /** Whether its owner is a person ship: a person ship owns itself (decision 0045). */
  isOwnedByPerson: boolean;
}

/** The ship with the label values it carries now, by key then value, with their texts, and its owner. */
export async function shipAsItIs(
  tx: { labels: CheckReachTx['labels']; ships: Pick<ShipRepository, 'find'> },
  ship: Ship,
): Promise<ShipAsItIs> {
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
  return { ship, labels, owner: owner ? { id: owner.id, name: owner.name } : null, isOwnedByPerson: owner?.kind === 'person' };
}

export function reaching({ ship, labels, isOwnedByPerson }: ShipAsItIs): ReachingShip {
  return { id: ship.id, owner: ship.owner, kind: ship.kind, isOwnedByPerson, labels: labels.map(({ labelId, valueId }) => ({ labelId, valueId })) };
}

/** The label that carries an account's groups (decisions 0052, 0058): its token names the values by their texts. */
export const GROUP_LABEL_KEY = 'group';

/**
 * The actor as a check sees it and as a refusal records it (decision 0057):
 * a ship as it is now, undefined when it does not exist; an account with
 * the values of the fleet's label `group` its token names, a text the fleet
 * does not define matching nothing, and its person ship; or the
 * installation.
 */
export async function actorAsItIs(
  tx: { labels: CheckReachTx['labels']; ships: Pick<ShipRepository, 'find'> },
  caller: Caller,
): Promise<{ reaching: ReachingActor; refused: RefusedActor; ship?: Ship } | undefined> {
  if (caller.kind === 'installation') {
    return { reaching: { kind: 'installation' }, refused: { kind: 'installation' } };
  }
  if (caller.kind === 'account') {
    const labels = await groupLabelsOf(tx, caller);
    const personShip = caller.personShipId === null ? undefined : await tx.ships.find(caller.fleetId, caller.personShipId);
    return {
      reaching: { kind: 'account', personShipId: personShip?.id ?? null, labels: labels.map(({ labelId, valueId }) => ({ labelId, valueId })) },
      refused: { kind: 'account', accountId: caller.accountId, labels, personShip: personShip ? { id: personShip.id, name: personShip.name } : null },
    };
  }
  const ship = await tx.ships.find(caller.fleetId, caller.shipId);
  if (!ship) {
    return undefined;
  }
  const asItIs = await shipAsItIs(tx, ship);
  return { reaching: reaching(asItIs), refused: { kind: 'ship', ...refused(asItIs) }, ship };
}

async function groupLabelsOf(tx: { labels: CheckReachTx['labels'] }, account: AccountCaller): Promise<CarriedLabel[]> {
  const label = await tx.labels.findByKey(account.fleetId, GROUP_LABEL_KEY);
  if (!label) {
    return [];
  }
  return label.values
    .filter((value) => account.groupValues.includes(value.value))
    .map((value) => ({ labelId: label.id, key: label.key, valueId: value.id, value: value.value }))
    .sort((first, second) => first.value.localeCompare(second.value));
}

function refused({ ship, labels, owner }: ShipAsItIs): RefusedShip {
  return { id: ship.id, name: ship.name, labels, owner };
}
