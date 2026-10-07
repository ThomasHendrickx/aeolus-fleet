import {
  LABEL_HANDLE_MAX_LENGTH,
  LABEL_HANDLE_PATTERN,
  LABEL_VALUES_MAX,
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
