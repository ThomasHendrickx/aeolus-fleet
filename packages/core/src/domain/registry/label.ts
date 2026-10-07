import {
  LABEL_HANDLE_MAX_LENGTH,
  LABEL_HANDLE_PATTERN,
  LABEL_VALUES_MAX,
  SHIP_LABELS_MAX,
  type FleetId,
  type ShipId,
} from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import type { Actor, NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { Ship } from './ship.js';

/**
 * A label (docs/blueprint.md, "Label"; decision 0031): a key with a defined
 * set of values, owned by the ship that defined it. Only its owner changes
 * its values and assigns it, never to itself. It retires with its owner.
 */
export interface Label {
  fleetId: FleetId;
  /** Unique among the fleet's labels. */
  key: string;
  /** In the order the owner gave them, each once. */
  values: readonly string[];
  ownerShipId: ShipId;
}

/** One label a ship carries: at most one value per key. */
export interface ShipLabel {
  fleetId: FleetId;
  shipId: ShipId;
  key: string;
  value: string;
}

type InvalidKey = DomainError<'INVALID_LABEL_KEY'>;
type InvalidValue = DomainError<'INVALID_LABEL_VALUE'>;
type InvalidValues = DomainError<'INVALID_LABEL_VALUES'>;

const LIMITS = `lowercase a-z, 0-9 and -, at most ${String(LABEL_HANDLE_MAX_LENGTH)} characters (decision 0031)`;

function isLabelHandle(text: string): boolean {
  return text.length <= LABEL_HANDLE_MAX_LENGTH && LABEL_HANDLE_PATTERN.test(text);
}

/** A label's key, checked against the limits. */
export function labelKey(key: string): Result<string, InvalidKey> {
  return isLabelHandle(key) ? ok(key) : refuse('INVALID_LABEL_KEY', `A label key is ${LIMITS}`);
}

/** A label's values: one to the most a label may define, each once, each within the limits. */
export function labelValues(values: readonly string[]): Result<readonly string[], InvalidValue | InvalidValues> {
  if (values.length === 0 || values.length > LABEL_VALUES_MAX) {
    return refuse('INVALID_LABEL_VALUES', `A label has 1 to ${String(LABEL_VALUES_MAX)} values (decision 0031)`);
  }
  const invalid = values.find((value) => !isLabelHandle(value));
  if (invalid !== undefined) {
    return refuse('INVALID_LABEL_VALUE', `A label value is ${LIMITS}`);
  }
  if (new Set(values).size !== values.length) {
    return refuse('INVALID_LABEL_VALUES', 'A label names each of its values once');
  }
  return ok(values);
}

function labelEvent(label: Pick<Label, 'fleetId' | 'ownerShipId'>, change: Pick<NewEvent, 'type' | 'details'> & { at: Date; actor: Actor }): NewEvent {
  const { at, actor, ...what } = change;
  return { fleetId: label.fleetId, occurredAt: at, actor, shipId: label.ownerShipId, ...what };
}

/** The values as an event's details carry them: one flat text, comma separated, since a value never holds a comma. */
function valuesDetail(values: readonly string[]): string {
  return values.join(',');
}

export type DefineLabelRefusal = InvalidKey | InvalidValue | InvalidValues | DomainError<'LABEL_KEY_TAKEN'>;

/**
 * A ship defines a label, owning it: a key unique in the fleet and its values.
 * A key the fleet has is refused, naming its owner. LabelDefined names the
 * owner, with the key and the values.
 */
export function defineLabel(
  { owner, existing }: { owner: Pick<Ship, 'fleetId' | 'id'>; existing: { label: Label; ownerName: string } | undefined },
  input: { key: string; values: readonly string[]; at: Date; actor: Actor },
): Result<{ label: Label; events: NewEvent[] }, DefineLabelRefusal> {
  const key = labelKey(input.key);
  if (!key.isOk) {
    return key;
  }
  const values = labelValues(input.values);
  if (!values.isOk) {
    return values;
  }
  if (existing) {
    return refuse('LABEL_KEY_TAKEN', `The fleet has the label ${key.value} already, owned by ${existing.ownerName}`);
  }
  const label: Label = { fleetId: owner.fleetId, key: key.value, values: values.value, ownerShipId: owner.id };
  return ok({
    label,
    events: [labelEvent(label, { at: input.at, actor: input.actor, type: 'LabelDefined', details: { key: label.key, values: valuesDetail(label.values) } })],
  });
}

type NotTheOwner = DomainError<'NOT_THE_LABEL_OWNER'>;

/** Only a label's owner changes it or assigns it. */
function checkOwner(
  { label, ownerName }: { label: Label; ownerName: string },
  caller: { shipId: ShipId; act: 'changes' | 'assigns' | 'unassigns' },
): Result<void, NotTheOwner> {
  return label.ownerShipId === caller.shipId
    ? ok(undefined)
    : refuse('NOT_THE_LABEL_OWNER', `The label ${label.key} is owned by ${ownerName}: only its owner ${caller.act} it`);
}

export type ChangeLabelValuesRefusal = NotTheOwner | InvalidValue | InvalidValues | DomainError<'LABEL_VALUE_CARRIED'>;

/**
 * The owner gives its label the values it has from now on, adding and
 * removing at once. A value ships carry is never removed: the refusal names
 * them. The values it has already, in any order, change nothing.
 */
export function changeLabelValues(
  { label, ownerName, carriers }: { label: Label; ownerName: string; carriers: readonly { value: string; shipName: string }[] },
  input: { callerShipId: ShipId; values: readonly string[]; at: Date; actor: Actor },
): Result<{ label: Label; events: NewEvent[] }, ChangeLabelValuesRefusal> {
  const owned = checkOwner({ label, ownerName }, { shipId: input.callerShipId, act: 'changes' });
  if (!owned.isOk) {
    return owned;
  }
  const values = labelValues(input.values);
  if (!values.isOk) {
    return values;
  }
  const removed = label.values.filter((value) => !values.value.includes(value));
  const carried = removed
    .map((value) => ({ value, ships: carriers.filter((carrier) => carrier.value === value).map((carrier) => carrier.shipName) }))
    .filter(({ ships }) => ships.length > 0);
  if (carried.length > 0) {
    const named = carried.map(({ value, ships }) => `${label.key}=${value}: ${ships.join(', ')}`).join('; ');
    return refuse('LABEL_VALUE_CARRIED', `Ships carry ${named}`);
  }
  if (removed.length === 0 && values.value.length === label.values.length) {
    return ok({ label, events: [] });
  }
  const changed: Label = { ...label, values: values.value };
  return ok({
    label: changed,
    events: [
      labelEvent(changed, { at: input.at, actor: input.actor, type: 'LabelValuesChanged', details: { key: changed.key, values: valuesDetail(changed.values) } }),
    ],
  });
}

function assignmentEvent(assignment: ShipLabel, change: { type: 'LabelAssigned' | 'LabelUnassigned'; at: Date; actor: Actor }): NewEvent {
  return {
    fleetId: assignment.fleetId,
    occurredAt: change.at,
    actor: change.actor,
    shipId: assignment.shipId,
    type: change.type,
    details: { key: assignment.key, value: assignment.value },
  };
}

type OwnShip = DomainError<'LABEL_ON_OWN_SHIP'>;

/** No ship labels itself: that would let it enforce a plugin's policy on its own (decision 0031). */
function checkNotOwnShip(label: Label, ship: Ship): Result<void, OwnShip> {
  return ship.id === label.ownerShipId ? refuse('LABEL_ON_OWN_SHIP', `No ship labels itself: ${label.key} is your own ship's label`) : ok(undefined);
}

export type AssignLabelRefusal =
  | NotTheOwner
  | OwnShip
  | DomainError<'SHIP_ALREADY_RETIRED' | 'LABEL_VALUE_NOT_DEFINED' | 'SHIP_LABEL_LIMIT_REACHED'>;

/**
 * The owner gives a ship one of its label's values, in place of the value of
 * it the ship carries; the value it carries changes nothing. Never the
 * owner's own ship or a retired ship; argo and the viewer ship as any other
 * (decision 0016). A ship carries at most 20 labels. LabelAssigned names the
 * ship, with the key and the value.
 */
export function assignLabel(
  { label, ownerName, ship, carried }: { label: Label; ownerName: string; ship: Ship; carried: readonly ShipLabel[] },
  input: { callerShipId: ShipId; value: string; at: Date; actor: Actor },
): Result<{ assignment: ShipLabel | undefined; events: NewEvent[] }, AssignLabelRefusal> {
  const owned = checkOwner({ label, ownerName }, { shipId: input.callerShipId, act: 'assigns' });
  if (!owned.isOk) {
    return owned;
  }
  const notOwn = checkNotOwnShip(label, ship);
  if (!notOwn.isOk) {
    return notOwn;
  }
  if (ship.retiredAt !== null) {
    return refuse('SHIP_ALREADY_RETIRED', `${ship.name} is retired`);
  }
  if (!label.values.includes(input.value)) {
    return refuse('LABEL_VALUE_NOT_DEFINED', `The label ${label.key} has no value ${input.value}: its values are ${label.values.join(', ')}`);
  }
  const current = carried.find((each) => each.key === label.key);
  if (current?.value === input.value) {
    return ok({ assignment: undefined, events: [] });
  }
  if (!current && carried.length >= SHIP_LABELS_MAX) {
    return refuse('SHIP_LABEL_LIMIT_REACHED', `${ship.name} carries ${String(SHIP_LABELS_MAX)} labels, the most a ship carries (decision 0031)`);
  }
  const assignment: ShipLabel = { fleetId: ship.fleetId, shipId: ship.id, key: label.key, value: input.value };
  return ok({ assignment, events: [assignmentEvent(assignment, { type: 'LabelAssigned', at: input.at, actor: input.actor })] });
}

export type UnassignLabelRefusal = NotTheOwner | OwnShip;

/**
 * The owner takes its label off a ship. A ship that does not carry it
 * changes nothing. LabelUnassigned names the ship, with the key and the
 * value it carried.
 */
export function unassignLabel(
  { label, ownerName, ship, carried }: { label: Label; ownerName: string; ship: Ship; carried: readonly ShipLabel[] },
  input: { callerShipId: ShipId; at: Date; actor: Actor },
): Result<{ unassigned: ShipLabel | undefined; events: NewEvent[] }, UnassignLabelRefusal> {
  const owned = checkOwner({ label, ownerName }, { shipId: input.callerShipId, act: 'unassigns' });
  if (!owned.isOk) {
    return owned;
  }
  const notOwn = checkNotOwnShip(label, ship);
  if (!notOwn.isOk) {
    return notOwn;
  }
  const current = carried.find((each) => each.key === label.key);
  if (!current) {
    return ok({ unassigned: undefined, events: [] });
  }
  return ok({ unassigned: current, events: [assignmentEvent(current, { type: 'LabelUnassigned', at: input.at, actor: input.actor })] });
}

/**
 * A ship is retired: the labels it owns retire with it (their meaning
 * retires with their owner), each after every assignment of it goes, and
 * the labels it carries go. LabelUnassigned for every assignment that goes,
 * LabelRetired for every label.
 */
export function retireLabelsWith(
  { owned, carried }: { owned: readonly { label: Label; carriers: readonly ShipLabel[] }[]; carried: readonly ShipLabel[] },
  input: { at: Date; actor: Actor },
): { unassigned: ShipLabel[]; retired: Label[]; events: NewEvent[] } {
  const unassigned: ShipLabel[] = [];
  const events: NewEvent[] = [];
  const unassign = (assignment: ShipLabel) => {
    unassigned.push(assignment);
    events.push(assignmentEvent(assignment, { type: 'LabelUnassigned', ...input }));
  };
  for (const { label, carriers } of owned) {
    carriers.forEach(unassign);
    events.push(labelEvent(label, { ...input, type: 'LabelRetired', details: { key: label.key } }));
  }
  carried.forEach(unassign);
  return { unassigned, retired: owned.map(({ label }) => label), events };
}
