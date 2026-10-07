import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import { listedShipSchema } from './fleet.js';
import {
  LABEL_HANDLE_MAX_LENGTH,
  LABEL_VALUES_MAX,
  SHIP_LABELS_MAX,
  assignLabelInputSchema,
  changeLabelValuesInputSchema,
  defineLabelInputSchema,
  fleetListInputSchema,
  labelsOutputSchema,
  unassignLabelInputSchema,
} from './label.js';

const newId = createIdGenerator();

describe('the label limits (decision 0031)', () => {
  it('are 63 characters a key or value, 50 values a label, 20 labels a ship', () => {
    expect([LABEL_HANDLE_MAX_LENGTH, LABEL_VALUES_MAX, SHIP_LABELS_MAX]).toEqual([63, 50, 20]);
  });
});

describe('defineLabelInputSchema and changeLabelValuesInputSchema', () => {
  it('take a key and its values, leaving the limits to the server, which names their decision', () => {
    const input = { key: 'OS', values: ['macos', 'x'.repeat(64)] };

    expect(defineLabelInputSchema.parse(input)).toEqual(input);
    expect(changeLabelValuesInputSchema.parse(input)).toEqual(input);
  });

  it('refuse values that are not a list of text', () => {
    expect(defineLabelInputSchema.safeParse({ key: 'os', values: 'macos' }).success).toBe(false);
  });
});

describe('assignLabelInputSchema and unassignLabelInputSchema', () => {
  it('take the ship, the key and, to assign, the value', () => {
    const shipId = newId('ship');

    expect(assignLabelInputSchema.parse({ shipId, key: 'os', value: 'macos' })).toEqual({ shipId, key: 'os', value: 'macos' });
    expect(unassignLabelInputSchema.parse({ shipId, key: 'os' })).toEqual({ shipId, key: 'os' });
  });

  it('refuse a ship id that is not one', () => {
    expect(assignLabelInputSchema.safeParse({ shipId: 'scout', key: 'os', value: 'macos' }).success).toBe(false);
  });
});

describe('labelsOutputSchema', () => {
  it('answers each label with its values and its owner', () => {
    const owner = { id: newId('ship'), name: 'trierarch-plugin' };

    expect(labelsOutputSchema.parse([{ key: 'os', values: ['macos'], owner }])).toEqual([{ key: 'os', values: ['macos'], owner }]);
  });
});

describe('fleetListInputSchema', () => {
  it('takes nothing, or the labels to select ships by, value by key', () => {
    expect(fleetListInputSchema.parse(undefined)).toBeUndefined();
    expect(fleetListInputSchema.parse({})).toEqual({});
    expect(fleetListInputSchema.parse({ labels: { os: 'macos', project: 'hemma' } })).toEqual({ labels: { os: 'macos', project: 'hemma' } });
  });

  it('refuses a label value that is not text', () => {
    expect(fleetListInputSchema.safeParse({ labels: { os: ['macos'] } }).success).toBe(false);
  });
});

describe('listedShipSchema', () => {
  it('carries the labels the ship carries, value by key', () => {
    const shape = listedShipSchema.shape.labels;

    expect(shape.parse({ os: 'macos' })).toEqual({ os: 'macos' });
  });
});
