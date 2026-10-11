import {
  LABEL_HANDLE_MAX_LENGTH,
  LABEL_HANDLE_PATTERN,
  LABEL_VALUES_MAX,
  SHIP_LABELS_MAX,
  type FleetId,
  type LabelId,
  type LabelValueId,
  type ShipId,
} from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import type { Actor, NewEvent } from '../shared/events.js';
import { ok, type Result } from '../shared/result.js';
import type { Ship } from './ship.js';

/** One value of a label: its own id, and its text for people. */
export interface LabelValue {
  id: LabelValueId;
  value: string;
}

/**
 * A label (docs/blueprint.md, "Label"; decision 0031): a key with a defined
 * set of values, each with its own id, owned by the ship that defined it.
 * Ids are for machines, key and value texts for people. Only its owner
 * changes its values and assigns them, to any ship, its own included. It
 * retires with its owner.
 */
export interface Label {
  fleetId: FleetId;
  id: LabelId;
  /** Unique among the fleet's labels. */
  key: string;
  /** In the order the owner gave them, each once. */
  values: readonly LabelValue[];
  ownerShipId: ShipId;
}

/** A label as the fleet lists it: its id, key and values, and its owner by id and name. */
export interface ListedLabel {
  id: LabelId;
  key: string;
  values: readonly LabelValue[];
  owner: { id: ShipId; name: string };
}

/** One value a ship carries, with its label: ids and texts. */
export interface CarriedLabel {
  labelId: LabelId;
  key: string;
  valueId: LabelValueId;
  value: string;
}

/** One value a ship carries. A ship holds a set of values, of one label or several. */
export interface ShipLabel {
  fleetId: FleetId;
  shipId: ShipId;
  labelId: LabelId;
  valueId: LabelValueId;
}

/** A value text as a definition or a change gives it, with the id it gets if the label does not have it yet. */
export interface NewLabelValue {
  value: string;
  newId: LabelValueId;
}

/**
 * Whether a ship carries every value of the selector: exact matches by id,
 * combined with AND (decision 0031). No selector, or an empty one, selects
 * every ship.
 */
export function carriesEvery(carried: readonly CarriedLabel[], valueIds: readonly LabelValueId[] | undefined): boolean {
  return (valueIds ?? []).every((valueId) => carried.some((label) => label.valueId === valueId));
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

/** A label's value texts: one to the most a label may define, each once, each within the limits. */
function checkValueTexts(values: readonly string[]): Result<void, InvalidValue | InvalidValues> {
  if (values.length === 0 || values.length > LABEL_VALUES_MAX) {
    return refuse('INVALID_LABEL_VALUES', `A label has 1 to ${String(LABEL_VALUES_MAX)} values (decision 0031)`);
  }
  if (values.some((value) => !isLabelHandle(value))) {
    return refuse('INVALID_LABEL_VALUE', `A label value is ${LIMITS}`);
  }
  if (new Set(values).size !== values.length) {
    return refuse('INVALID_LABEL_VALUES', 'A label names each of its values once');
  }
  return ok(undefined);
}

/** Each value with the id the label has for its text, or its new id. */
function withIds(values: readonly NewLabelValue[], kept: readonly LabelValue[]): LabelValue[] {
  return values.map(({ value, newId }) => ({
    id: kept.find((held) => held.value === value)?.id ?? newId,
    value,
  }));
}

function labelEvent(
  label: Label,
  change: Pick<NewEvent, 'type'> & {
    at: Date;
    actor: Actor;
    details?: Record<string, string>;
  },
): NewEvent {
  return {
    fleetId: label.fleetId,
    occurredAt: change.at,
    actor: change.actor,
    shipId: label.ownerShipId,
    type: change.type,
    details: { labelId: label.id, key: label.key, ...change.details },
  };
}

/** The values as an event's details carry them: flat texts, comma separated, since neither a value nor an id holds a comma. */
function valuesDetails(values: readonly LabelValue[]): Record<string, string> {
  return {
    values: values.map((value) => value.value).join(','),
    valueIds: values.map((value) => value.id).join(','),
  };
}

export type DefineLabelRefusal = InvalidKey | InvalidValue | InvalidValues | DomainError<'LABEL_KEY_TAKEN'>;

/**
 * A ship defines a label, owning it: a key unique in the fleet and its values,
 * the label and each value with its new id. A key the fleet has is refused,
 * naming its owner. LabelDefined names the owner, with the label and its
 * values.
 */
export function defineLabel(
  {
    owner,
    existing,
  }: {
    owner: Pick<Ship, 'fleetId' | 'id'>;
    existing: { label: Label; ownerName: string } | undefined;
  },
  input: {
    id: LabelId;
    key: string;
    values: readonly NewLabelValue[];
    at: Date;
    actor: Actor;
  },
): Result<{ label: Label; events: NewEvent[] }, DefineLabelRefusal> {
  const key = labelKey(input.key);
  if (!key.isOk) {
    return key;
  }
  const texts = checkValueTexts(input.values.map(({ value }) => value));
  if (!texts.isOk) {
    return texts;
  }
  if (existing) {
    return refuse('LABEL_KEY_TAKEN', `The fleet has the label ${key.value} already, owned by ${existing.ownerName}`);
  }
  const label: Label = {
    fleetId: owner.fleetId,
    id: input.id,
    key: key.value,
    values: withIds(input.values, []),
    ownerShipId: owner.id,
  };
  return ok({
    label,
    events: [
      labelEvent(label, {
        at: input.at,
        actor: input.actor,
        type: 'LabelDefined',
        details: valuesDetails(label.values),
      }),
    ],
  });
}

type NotTheOwner = DomainError<'NOT_THE_LABEL_OWNER'>;

/** Only a label's owner changes it or assigns it. */
function checkOwner(
  { label, ownerName }: { label: Label; ownerName: string },
  caller: {
    shipId: ShipId;
    act: 'changes' | 'assigns' | 'unassigns' | 'deletes';
  },
): Result<void, NotTheOwner> {
  return label.ownerShipId === caller.shipId
    ? ok(undefined)
    : refuse('NOT_THE_LABEL_OWNER', `The label ${label.key} is owned by ${ownerName}: only its owner ${caller.act} it`);
}

export type ChangeLabelValuesRefusal = NotTheOwner | InvalidValue | InvalidValues | DomainError<'LABEL_VALUE_CARRIED'>;

/**
 * The owner gives its label the values it has from now on, adding and
 * removing at once: a value it has keeps its id, a new one gets its new id.
 * A value ships carry is never removed: the refusal names them. The values
 * it has already, in any order, change nothing.
 */
export function changeLabelValues(
  {
    label,
    ownerName,
    carriers,
  }: {
    label: Label;
    ownerName: string;
    carriers: readonly { valueId: LabelValueId; shipName: string }[];
  },
  input: {
    callerShipId: ShipId;
    values: readonly NewLabelValue[];
    at: Date;
    actor: Actor;
  },
): Result<{ label: Label; events: NewEvent[] }, ChangeLabelValuesRefusal> {
  const owned = checkOwner({ label, ownerName }, { shipId: input.callerShipId, act: 'changes' });
  if (!owned.isOk) {
    return owned;
  }
  const texts = input.values.map(({ value }) => value);
  const checked = checkValueTexts(texts);
  if (!checked.isOk) {
    return checked;
  }
  const removed = label.values.filter((value) => !texts.includes(value.value));
  const carried = removed
    .map((value) => ({
      value,
      ships: carriers.filter((carrier) => carrier.valueId === value.id).map((carrier) => carrier.shipName),
    }))
    .filter(({ ships }) => ships.length > 0);
  if (carried.length > 0) {
    const named = carried.map(({ value, ships }) => `${label.key}=${value.value}: ${ships.join(', ')}`).join('; ');
    return refuse('LABEL_VALUE_CARRIED', `Ships carry ${named}`);
  }
  if (removed.length === 0 && texts.length === label.values.length) {
    return ok({ label, events: [] });
  }
  const changed: Label = {
    ...label,
    values: withIds(input.values, label.values),
  };
  return ok({
    label: changed,
    events: [
      labelEvent(changed, {
        at: input.at,
        actor: input.actor,
        type: 'LabelValuesChanged',
        details: valuesDetails(changed.values),
      }),
    ],
  });
}

export type DeleteLabelRefusal = NotTheOwner | DomainError<'LABEL_CARRIED'>;

/**
 * The owner deletes its label with its values, freeing its key. A label any
 * ship carries a value of is never deleted: the refusal names the ships.
 * LabelDeleted names the owner, with the label.
 */
export function deleteLabel(
  { label, ownerName, carrierNames }: { label: Label; ownerName: string; carrierNames: readonly string[] },
  input: { callerShipId: ShipId; at: Date; actor: Actor },
): Result<{ events: NewEvent[] }, DeleteLabelRefusal> {
  const owned = checkOwner({ label, ownerName }, { shipId: input.callerShipId, act: 'deletes' });
  if (!owned.isOk) {
    return owned;
  }
  if (carrierNames.length > 0) {
    return refuse('LABEL_CARRIED', `Ships carry the label ${label.key}: ${[...new Set(carrierNames)].join(', ')}`);
  }
  return ok({ events: [labelEvent(label, { at: input.at, actor: input.actor, type: 'LabelDeleted' })] });
}

function assignmentEvent(
  { label, assignment }: { label: Label; assignment: ShipLabel },
  change: { type: 'LabelAssigned' | 'LabelUnassigned'; at: Date; actor: Actor },
): NewEvent {
  return {
    fleetId: assignment.fleetId,
    occurredAt: change.at,
    actor: change.actor,
    shipId: assignment.shipId,
    type: change.type,
    details: {
      labelId: label.id,
      key: label.key,
      valueId: assignment.valueId,
      value: label.values.find((value) => value.id === assignment.valueId)?.value ?? '',
    },
  };
}

export type AssignLabelRefusal = NotTheOwner | DomainError<'SHIP_ALREADY_RETIRED' | 'SHIP_LABEL_LIMIT_REACHED'>;

/**
 * The owner gives a ship one of its label's values, by its id: the ship
 * holds a set of values, so it may carry several of one label. A value it
 * carries changes nothing. Any ship, the owner's own included, but never a
 * retired ship; argo and the viewer ship as any other (decision 0016). A ship
 * carries at most 20 values. LabelAssigned names the ship, with the label and the value.
 */
export function assignLabel(
  {
    label,
    ownerName,
    ship,
    carried,
  }: {
    label: Label;
    ownerName: string;
    ship: Ship;
    carried: readonly ShipLabel[];
  },
  input: {
    callerShipId: ShipId;
    valueId: LabelValueId;
    at: Date;
    actor: Actor;
  },
): Result<{ assignment: ShipLabel | undefined; events: NewEvent[] }, AssignLabelRefusal> {
  const owned = checkOwner({ label, ownerName }, { shipId: input.callerShipId, act: 'assigns' });
  if (!owned.isOk) {
    return owned;
  }
  if (ship.retiredAt !== null) {
    return refuse('SHIP_ALREADY_RETIRED', `${ship.name} is retired`);
  }
  if (carried.some((each) => each.valueId === input.valueId)) {
    return ok({ assignment: undefined, events: [] });
  }
  if (carried.length >= SHIP_LABELS_MAX) {
    return refuse('SHIP_LABEL_LIMIT_REACHED', `${ship.name} carries ${String(SHIP_LABELS_MAX)} labels, the most a ship carries (decision 0031)`);
  }
  const assignment: ShipLabel = {
    fleetId: ship.fleetId,
    shipId: ship.id,
    labelId: label.id,
    valueId: input.valueId,
  };
  return ok({
    assignment,
    events: [assignmentEvent({ label, assignment }, { type: 'LabelAssigned', at: input.at, actor: input.actor })],
  });
}

export type UnassignLabelRefusal = NotTheOwner;

/**
 * The owner takes one value of its label off a ship. A ship that does not
 * carry it changes nothing. LabelUnassigned names the ship, with the label
 * and the value it carried.
 */
export function unassignLabel(
  {
    label,
    ownerName,
    carried,
  }: {
    label: Label;
    ownerName: string;
    carried: readonly ShipLabel[];
  },
  input: {
    callerShipId: ShipId;
    valueId: LabelValueId;
    at: Date;
    actor: Actor;
  },
): Result<{ unassigned: ShipLabel | undefined; events: NewEvent[] }, UnassignLabelRefusal> {
  const owned = checkOwner({ label, ownerName }, { shipId: input.callerShipId, act: 'unassigns' });
  if (!owned.isOk) {
    return owned;
  }
  const current = carried.find((each) => each.valueId === input.valueId);
  if (!current) {
    return ok({ unassigned: undefined, events: [] });
  }
  return ok({
    unassigned: current,
    events: [assignmentEvent({ label: label, assignment: current }, { type: 'LabelUnassigned', at: input.at, actor: input.actor })],
  });
}

/**
 * A ship is retired: the labels it owns retire with it (their meaning
 * retires with their owner), each after every assignment of it goes, and
 * the values it carries go. LabelUnassigned for every assignment that goes,
 * LabelRetired for every label.
 */
export function retireLabelsWith(
  {
    owned,
    carried,
  }: {
    owned: readonly { label: Label; carriers: readonly ShipLabel[] }[];
    carried: readonly { label: Label; assignment: ShipLabel }[];
  },
  input: { at: Date; actor: Actor },
): { unassigned: ShipLabel[]; retired: Label[]; events: NewEvent[] } {
  const unassigned: ShipLabel[] = [];
  const events: NewEvent[] = [];
  const unassign = (label: Label, assignment: ShipLabel) => {
    unassigned.push(assignment);
    events.push(assignmentEvent({ label, assignment }, { type: 'LabelUnassigned', ...input }));
  };
  for (const { label, carriers } of owned) {
    for (const assignment of carriers) {
      unassign(label, assignment);
    }
    events.push(labelEvent(label, { ...input, type: 'LabelRetired' }));
  }
  for (const { label, assignment } of carried) {
    unassign(label, assignment);
  }
  return { unassigned, retired: owned.map(({ label }) => label), events };
}
