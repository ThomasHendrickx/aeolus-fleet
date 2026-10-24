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
  shipCursorOf,
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
  it('answers each label by its id with its values and their ids, and its owner ship by id and name', () => {
    const label = { id: newId('label'), key: 'os', values: [{ id: newId('labelValue'), value: 'macos' }], owner: { kind: 'ship', id: newId('ship'), name: 'trierarch-plugin' } };

    expect(labelsOutputSchema.parse([label])).toEqual([label]);
  });

  it('answers the installation as the owner of a label it defined (decision 0031)', () => {
    const label = { id: newId('label'), key: 'group', values: [{ id: newId('labelValue'), value: 'sales' }], owner: { kind: 'installation' } };

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

  it('takes the cursor the last page answered and the page size (decision 4 of the performance design)', () => {
    const cursor = shipCursorOf({ isEmpty: false, value: 'crewed', name: 'scout', id: newId('ship') });

    expect(fleetListInputSchema.parse({ cursor, limit: 500 })).toMatchObject({ limit: 500 });
  });

  it('reads the cursor as the position of the ship the page starts after', () => {
    const position = { isEmpty: true, value: '', name: 'scout', id: newId('ship') };

    expect(fleetListInputSchema.parse({ cursor: shipCursorOf(position) })).toEqual({ cursor: position });
  });

  it('refuses a cursor fleet.list did not answer', () => {
    expect(fleetListInputSchema.safeParse({ cursor: newId('ship') }).success).toBe(false);
  });

  it('takes a sort: a column and a direction', () => {
    expect(fleetListInputSchema.parse({ sort: { column: 'seen', direction: 'descending' } })).toEqual({ sort: { column: 'seen', direction: 'descending' } });
    expect(fleetListInputSchema.safeParse({ sort: { column: 'colour', direction: 'ascending' } }).success).toBe(false);
  });

  it("takes the ships by id, the agent kinds and the ships the console's plugins run as", () => {
    const filters = { shipIds: [newId('ship')], kind: ['console', 'claudeCode', 'codex', 'trierarch', 'plugin', 'other'], pluginShipIds: [newId('ship')] };

    expect(fleetListInputSchema.parse(filters)).toEqual(filters);
  });

  it('refuses a page over the maximum size', () => {
    expect(fleetListInputSchema.safeParse({ limit: 501 }).success).toBe(false);
  });

  it('takes what the overview filters: search text, statuses, types and where the crew request stands', () => {
    const filters = { query: 'build', status: ['crewed', 'retired'], type: ['implementer'], crewRequest: ['none', 'needsCrew', 'crewedByHand', 'crashed'] };

    expect(fleetListInputSchema.parse(filters)).toEqual(filters);
  });

  it('refuses a crew request stage it does not know', () => {
    expect(fleetListInputSchema.safeParse({ crewRequest: ['lost'] }).success).toBe(false);
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

describe("fleet.list's sort", () => {
  it.each(['ship', 'status', 'report', 'runsOn', 'seen'])('sorts by %s', (column) => {
    expect(fleetListInputSchema.safeParse({ sort: { column, direction: 'ascending' } }).success).toBe(true);
  });

  it('refuses to sort by the labels: the column shows them, the label filter selects by them', () => {
    expect(fleetListInputSchema.safeParse({ sort: { column: 'labels', direction: 'ascending' } }).success).toBe(false);
  });
});
