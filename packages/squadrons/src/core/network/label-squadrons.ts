import { LABEL_VALUES_MAX, type FleetId, type LabelValueId, type ShipId } from '@aeolus-fleet/common';

import type { FleetDoor, FleetRefusal, ManagementCrew, ManagementCrewStore } from '../management/ports.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { OperatorNotices, SquadronRepository } from '../squadron/ports.js';
import type { LabelledShip, ListedLabel, NetworkDoor } from './ports.js';

/** The label that names each squadron's ships by its id, for reach within the squadron (#573). Membership stays the ship type. */
export const SQUADRON_LABEL = 'squadron';

/** The label that names the flagships and squadrons' own ship, for reach between them and nothing more (#573). */
export const SQUADRON_ROLE_LABEL = { key: 'squadron-role', flagship: 'flagship', squadrons: 'squadrons' } as const;

/** What a pass did: the labels it defined, the value changes, the values it put on and took off ships, the squadrons it could not label; why it labelled nothing, when it did not. */
export interface LabelOutcome {
  defined: number;
  valuesChanged: number;
  assigned: number;
  unassigned: number;
  unlabelled: string[];
  skipped?: string;
}

export type LabelSquadrons = (fleetId: FleetId) => Promise<Result<LabelOutcome, DomainError<'NOT_CONNECTED' | 'FLEET_UNAVAILABLE'>>>;

/** The values a ship carries of squadrons' labels, by key; a key it carries none of is absent. */
type Wanted = Partial<Record<string, string>>;

const LABEL_SCOPES = ['labels:define', 'labels:assign'];

/** The refusals that mean the fleet changed since it was read (a key taken, a ship or value gone): read again on the next pass. */
const CHANGED = new Set(['CONFLICT', 'NOT_FOUND']);

const NO_LABEL_SCOPES = 'its management ship holds no label scopes, and scopes never change: retire it and connect squadrons again to label squadrons';

/**
 * Use case: one pass of squadron labels for a fleet (docs/squadrons.md,
 * "Labels and reach"). squadrons defines squadron, with a value per squadron
 * that is not disbanded, and squadron-role, which it owns. Each such
 * squadron's flagship carries squadron=<id> and squadron-role=flagship, each
 * member that serves squadron=<id>, and squadrons' own ship
 * squadron-role=squadrons. The wanted value goes on first, then any other
 * value of the label comes off. A value no ship carries any more and no
 * squadron needs is removed; a squadron the 50 values leave out is not
 * labelled, and argo is told once. A key another ship owns is left alone.
 * Without the label scopes it labels nothing and says why.
 */
export function createLabelSquadrons(deps: {
  door: NetworkDoor;
  fleetDoor: Pick<FleetDoor, 'getShip'>;
  management: Pick<ManagementCrewStore, 'find'>;
  squadrons: Pick<SquadronRepository, 'list'>;
  operator: OperatorNotices;
}): LabelSquadrons {
  const unavailable = (refusal: FleetRefusal) => refuse('FLEET_UNAVAILABLE', `The fleet did not answer the squadron labels: ${refusal.message}`);
  return async (fleetId) => {
    const crew = await deps.management.find(fleetId);
    if (!crew) {
      return refuse('NOT_CONNECTED', 'squadrons is not connected to this fleet: connect it in the console');
    }
    const own = await deps.fleetDoor.getShip(crew.crewToken, { shipId: crew.shipId });
    if (!own.isOk) {
      return unavailable(own.error);
    }
    if (!LABEL_SCOPES.every((scope) => own.value.scopes.includes(scope))) {
      return ok({ defined: 0, valuesChanged: 0, assigned: 0, unassigned: 0, unlabelled: [], skipped: NO_LABEL_SCOPES });
    }
    const serving = (await deps.squadrons.list(fleetId)).filter((squadron) => squadron.state !== 'disbanded');
    const wanted = new Map<ShipId, Wanted>([[crew.shipId, { [SQUADRON_ROLE_LABEL.key]: SQUADRON_ROLE_LABEL.squadrons }]]);
    for (const squadron of serving) {
      wanted.set(squadron.flagship.shipId, { [SQUADRON_LABEL]: squadron.id, [SQUADRON_ROLE_LABEL.key]: SQUADRON_ROLE_LABEL.flagship });
      for (const member of squadron.members.filter((each) => each.retiredAt === null)) {
        wanted.set(member.shipId, { [SQUADRON_LABEL]: squadron.id });
      }
    }
    const done = await labelPass(deps.door, { crew, wanted, squadronIds: serving.map((squadron) => squadron.id) });
    if (!done.isOk) {
      return unavailable(done.error);
    }
    for (const squadronId of done.value.unlabelled) {
      await deps.operator.tell({
        fleetId,
        text:
          `The squadron ${squadronId} carries no squadron label: the label holds at most ${String(LABEL_VALUES_MAX)} values, one per squadron. ` +
          'Once network rules are in force its ships do not reach each other by squadrons\' declared rules; a value frees once a disbanded squadron\'s ships are retired.',
        // One key per squadron tells argo once, across restarts too.
        key: `unlabelled-${squadronId}`,
      });
    }
    return done;
  };
}

/** A call's answer; undefined when the fleet changed since it was read, which the next pass reads again. */
type Settled<T> = Result<T | undefined, FleetRefusal>;

async function settle<T>(done: Promise<Result<T, FleetRefusal>>): Promise<Settled<T>> {
  const result = await done;
  return result.isOk || !CHANGED.has(result.error.code) ? result : ok(undefined);
}

async function labelPass(door: NetworkDoor, pass: { crew: ManagementCrew; wanted: Map<ShipId, Wanted>; squadronIds: string[] }): Promise<Result<LabelOutcome, FleetRefusal>> {
  const { crew, wanted, squadronIds } = pass;
  const outcome: LabelOutcome = { defined: 0, valuesChanged: 0, assigned: 0, unassigned: 0, unlabelled: [] };
  const listed = await settle(door.listLabels(crew.crewToken));
  if (!listed.isOk) {
    return listed;
  }
  const ships = await settle(door.listLabelledShips(crew.crewToken));
  if (!ships.isOk) {
    return ships;
  }
  const fleetShips = ships.value ?? [];
  const labels: ListedLabel[] = [];

  const role = await ownedLabel(door, { crew, listed: listed.value ?? [], key: SQUADRON_ROLE_LABEL.key, values: () => [SQUADRON_ROLE_LABEL.flagship, SQUADRON_ROLE_LABEL.squadrons] });
  if (!role.isOk) {
    return role;
  }
  if (role.value !== undefined) {
    labels.push(role.value.label);
    outcome.defined += role.value.isDefined ? 1 : 0;
  }

  const squadron = await ownedLabel(door, { crew, listed: listed.value ?? [], key: SQUADRON_LABEL, values: (existing) => squadronValues({ label: existing, squadronIds, ships: fleetShips }) });
  if (!squadron.isOk) {
    return squadron;
  }
  if (squadron.value !== undefined) {
    labels.push(squadron.value.label);
    outcome.defined += squadron.value.isDefined ? 1 : 0;
    outcome.valuesChanged += squadron.value.isChanged ? 1 : 0;
  }
  const labelled = squadron.value?.label.values.map((value) => value.value) ?? [];
  // A key another ship owns leaves every squadron unlabelled by its own choice, not by the limit.
  outcome.unlabelled = squadron.value === undefined && listed.value?.some((each) => each.key === SQUADRON_LABEL) === true ? [] : squadronIds.filter((id) => !labelled.includes(id));

  for (const ship of fleetShips) {
    const values = wanted.get(ship.shipId);
    if (values === undefined) {
      continue;
    }
    for (const label of labels) {
      const relabelled = await relabel(door, {
        crewToken: crew.crewToken,
        shipId: ship.shipId,
        wanted: label.values.find((each) => each.value === values[label.key])?.valueId,
        carried: ship.labels.filter((each) => each.labelId === label.labelId).map((each) => each.valueId),
      });
      if (!relabelled.isOk) {
        return relabelled;
      }
      outcome.assigned += relabelled.value.assigned;
      outcome.unassigned += relabelled.value.unassigned;
    }
  }
  return ok(outcome);
}

/**
 * The squadron label's values from now on: those it has that a ship carries
 * or a squadron needs, in their order, then a value for each new squadron,
 * oldest first, up to the limit. A carried value is never removed, so only
 * new squadrons are left out.
 */
function squadronValues(of: { label: ListedLabel | undefined; squadronIds: string[]; ships: LabelledShip[] }): string[] {
  const existing = of.label?.values ?? [];
  const isCarried = (valueId: LabelValueId): boolean => of.ships.some((ship) => ship.labels.some((each) => each.valueId === valueId));
  const kept = existing.filter((value) => of.squadronIds.includes(value.value) || isCarried(value.valueId)).map((value) => value.value);
  const added = of.squadronIds.filter((id) => !existing.some((value) => value.value === id));
  return [...kept, ...added].slice(0, LABEL_VALUES_MAX);
}

/**
 * The label of this key the management ship owns, defined with its values
 * when the fleet has none, its values changed when they differ; undefined
 * when another ship owns the key, when it has no value to define it with, or
 * when the fleet changed since it was read.
 */
async function ownedLabel(
  door: NetworkDoor,
  of: { crew: ManagementCrew; listed: ListedLabel[]; key: string; values: (existing: ListedLabel | undefined) => string[] },
): Promise<Result<{ label: ListedLabel; isDefined: boolean; isChanged: boolean } | undefined, FleetRefusal>> {
  const { crew, listed, key } = of;
  const label = listed.find((each) => each.key === key);
  if (label !== undefined && label.ownerShipId !== crew.shipId) {
    return ok(undefined);
  }
  const values = of.values(label);
  if (values.length === 0) {
    return ok(label && { label, isDefined: false, isChanged: false });
  }
  if (label === undefined) {
    const defined = await settle(door.defineLabel(crew.crewToken, { key, values }));
    if (!defined.isOk) {
      return defined;
    }
    return ok(defined.value && { label: { ...defined.value, key, ownerShipId: crew.shipId }, isDefined: true, isChanged: false });
  }
  const isSame = values.length === label.values.length && values.every((value) => label.values.some((each) => each.value === value));
  if (isSame) {
    return ok({ label, isDefined: false, isChanged: false });
  }
  const changed = await settle(door.changeLabelValues(crew.crewToken, { labelId: label.labelId, values }));
  if (!changed.isOk) {
    return changed;
  }
  return ok(changed.value && { label: { ...label, values: changed.value.values }, isDefined: false, isChanged: true });
}

/** Puts the wanted value on first, so the ship is never without the label while it changes; then takes every other value of the label off. */
async function relabel(
  door: NetworkDoor,
  change: { crewToken: string; shipId: ShipId; wanted: LabelValueId | undefined; carried: LabelValueId[] },
): Promise<Result<{ assigned: number; unassigned: number }, FleetRefusal>> {
  const { crewToken, shipId, wanted, carried } = change;
  const counted = { assigned: 0, unassigned: 0 };
  if (wanted !== undefined && !carried.includes(wanted)) {
    const assigned = await door.assignLabel(crewToken, { shipId, valueId: wanted });
    if (!assigned.isOk && !CHANGED.has(assigned.error.code)) {
      return assigned;
    }
    counted.assigned += assigned.isOk ? 1 : 0;
  }
  for (const valueId of carried.filter((each) => each !== wanted)) {
    const unassigned = await door.unassignLabel(crewToken, { shipId, valueId });
    if (!unassigned.isOk && !CHANGED.has(unassigned.error.code)) {
      return unassigned;
    }
    counted.unassigned += unassigned.isOk ? 1 : 0;
  }
  return ok(counted);
}
