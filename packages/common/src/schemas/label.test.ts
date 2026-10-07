import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import { listedShipSchema } from './fleet.js';
import {
  LABEL_HANDLE_MAX_LENGTH,
  LABEL_VALUES_MAX,
  SHIP_LABELS_MAX,
  assignLabelInputSchema,
  changeLabelValuesInputSchema,
  changeLabelValuesOutputSchema,
  defineLabelInputSchema,
  defineLabelOutputSchema,
  deleteLabelInputSchema,
  findLabelValueInputSchema,
  findLabelValueOutputSchema,
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

describe('defineLabelInputSchema', () => {
  it('takes a key and its values, leaving the limits to the server, which names their decision', () => {
    const input = { key: 'OS', values: ['macos', 'x'.repeat(64)] };

    expect(defineLabelInputSchema.parse(input)).toEqual(input);
  });

  it('refuses values that are not a list of text', () => {
    expect(defineLabelInputSchema.safeParse({ key: 'os', values: 'macos' }).success).toBe(false);
  });
});

describe('defineLabelOutputSchema and changeLabelValuesOutputSchema', () => {
  it('answer the label id and each value with its id', () => {
    const values = [{ id: newId('labelValue'), value: 'macos' }];
    const labelId = newId('label');

    expect(defineLabelOutputSchema.parse({ labelId, values })).toEqual({ labelId, values });
    expect(changeLabelValuesOutputSchema.parse({ values })).toEqual({ values });
  });
});

describe('changeLabelValuesInputSchema', () => {
  it('takes the label by its id and every value it has from now on', () => {
    const input = { labelId: newId('label'), values: ['macos'] };

    expect(changeLabelValuesInputSchema.parse(input)).toEqual(input);
  });

  it('refuses a label id that is not one', () => {
    expect(changeLabelValuesInputSchema.safeParse({ labelId: 'os', values: ['macos'] }).success).toBe(false);
  });
});

describe('assignLabelInputSchema and unassignLabelInputSchema', () => {
  it('take the ship and the value, by their ids', () => {
    const input = { shipId: newId('ship'), valueId: newId('labelValue') };

    expect(assignLabelInputSchema.parse(input)).toEqual(input);
    expect(unassignLabelInputSchema.parse(input)).toEqual(input);
  });

  it('refuse a value given by its text', () => {
    expect(assignLabelInputSchema.safeParse({ shipId: newId('ship'), valueId: 'macos' }).success).toBe(false);
  });
});

describe('labelsOutputSchema', () => {
  it('answers each label by its id with its values and their ids, and its owner', () => {
    const label = { id: newId('label'), key: 'os', values: [{ id: newId('labelValue'), value: 'macos' }], owner: { id: newId('ship'), name: 'trierarch-plugin' } };

    expect(labelsOutputSchema.parse([label])).toEqual([label]);
  });
});

describe('fleetListInputSchema', () => {
  it('takes nothing, or the value ids to select ships by', () => {
    const valueIds = [newId('labelValue'), newId('labelValue')];

    expect(fleetListInputSchema.parse(undefined)).toBeUndefined();
    expect(fleetListInputSchema.parse({})).toEqual({});
    expect(fleetListInputSchema.parse({ valueIds })).toEqual({ valueIds });
  });

  it('refuses a value given by its text', () => {
    expect(fleetListInputSchema.safeParse({ valueIds: ['macos'] }).success).toBe(false);
  });
});

describe('listedShipSchema', () => {
  it('carries the labels the ship carries, each value with its label, ids and text', () => {
    const carried = [{ labelId: newId('label'), key: 'os', valueId: newId('labelValue'), value: 'macos' }];

    expect(listedShipSchema.shape.labels.parse(carried)).toEqual(carried);
  });
});

describe('deleteLabelInputSchema', () => {
  it('takes the label by its id', () => {
    const input = { labelId: newId('label') };

    expect(deleteLabelInputSchema.parse(input)).toEqual(input);
    expect(deleteLabelInputSchema.safeParse({ labelId: 'os' }).success).toBe(false);
  });
});

describe('findLabelValueInputSchema and findLabelValueOutputSchema', () => {
  it('take a key and a value as text, and answer the label id and the value id', () => {
    const found = { labelId: newId('label'), valueId: newId('labelValue') };

    expect(findLabelValueInputSchema.parse({ key: 'OS', value: 'macos' })).toEqual({ key: 'OS', value: 'macos' });
    expect(findLabelValueOutputSchema.parse(found)).toEqual(found);
  });
});
