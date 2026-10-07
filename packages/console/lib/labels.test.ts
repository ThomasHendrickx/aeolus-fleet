import { createIdGenerator, type ListedLabel, type ListedShip } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { carriesEvery, chipsOf, filterGroupsOf, labelContextOf, pickedChips, rowChips } from './labels';

const newId = createIdGenerator();

function aShip(name: string, overrides: Partial<ListedShip> = {}): ListedShip {
  return {
    id: newId('ship'), name, type: 'implementer', kind: 'agent', status: 'crewed', startingPrompt: null, location: null, lastSeenAt: null, ping: null,
    scopes: ['messages:send', 'messages:receive'], labels: [], report: null, harness: null, model: null, awaitingCrewSince: null, crewRequest: null, retiredAt: null,
    ...overrides,
  };
}

const ARGO = aShip('argo', { kind: 'operator' });
const PLUGIN = aShip('trierarch-plugin', { type: 'trierarch-plugin' });
const SQUADRONS = aShip('squadrons', { type: 'squadrons' });
const ORCHESTRATOR = aShip('orchestrator', { type: 'orchestrator' });

function aLabel(definition: { key: string; values: string[] }, owner: ListedShip): ListedLabel {
  return { id: newId('label'), key: definition.key, values: definition.values.map((value) => ({ id: newId('labelValue'), value })), owner: { id: owner.id, name: owner.name } };
}

const PROJECT = aLabel({ key: 'project', values: ['aeolus', 'hemma'] }, ARGO);
const AREA = aLabel({ key: 'area', values: ['backend', 'docs'] }, ARGO);
const OS = aLabel({ key: 'os', values: ['macos', 'linux'] }, PLUGIN);
const BLUEPRINT = aLabel({ key: 'blueprint', values: ['hemma-feature'] }, SQUADRONS);
const COST = aLabel({ key: 'cost', values: ['low'] }, ORCHESTRATOR);
const LABELS = [PROJECT, AREA, OS, BLUEPRINT, COST];

function carried(label: ListedLabel, index: number): ListedShip['labels'][number] {
  const value = label.values[index];
  if (value === undefined) {
    throw new RangeError(`${label.key} has no value ${String(index)}`);
  }
  return { labelId: label.id, key: label.key, valueId: value.id, value: value.value };
}

function valueId(label: ListedLabel, index: number): string {
  return carried(label, index).valueId;
}

const BUILDER = aShip('builder', { labels: [carried(OS, 0), carried(PROJECT, 1), carried(AREA, 0)] });
const WRITER = aShip('writer', { labels: [carried(PROJECT, 0), carried(AREA, 1), carried(BLUEPRINT, 0)] });
const RETIRED = aShip('old', { status: 'retired', labels: [carried(PROJECT, 1)] });
const SHIPS = [ARGO, PLUGIN, SQUADRONS, ORCHESTRATOR, BUILDER, WRITER, RETIRED];

describe('chipsOf', () => {
  it('shows a ship’s labels yours first, then others’, each by key, marked by who owns the label', () => {
    const context = labelContextOf(LABELS, { ships: SHIPS, isOperator: true });

    expect(chipsOf(BUILDER, context).map((chip) => [`${chip.key}=${chip.value}`, chip.mark])).toEqual([
      ['area=backend', 'none'],
      ['project=hemma', 'none'],
      ['os=macos', 'trierarch-plugin'],
    ]);
  });

  it('marks squadrons’ labels with their own mark and any other owner’s with the ship mark', () => {
    const context = labelContextOf(LABELS, { ships: SHIPS, isOperator: true });

    expect(chipsOf(aShip('mixed', { labels: [carried(BLUEPRINT, 0), carried(COST, 0)] }), context).map((chip) => chip.mark)).toEqual(['squadrons', 'ship']);
  });

  it('marks argo’s labels for a viewer, who owns none', () => {
    const context = labelContextOf(LABELS, { ships: SHIPS, isOperator: false });

    expect(chipsOf(aShip('one', { labels: [carried(PROJECT, 0)] }), context)).toEqual([{ labelId: PROJECT.id, valueId: valueId(PROJECT, 0), key: 'project', value: 'aeolus', mark: 'ship', ownerName: 'argo' }]);
  });
});

describe('rowChips', () => {
  const context = labelContextOf(LABELS, { ships: SHIPS, isOperator: true });
  const chips = chipsOf(WRITER, context);

  it('shows as many chips as fit the width, folding the rest', () => {
    expect(rowChips(chips, 24)).toMatchObject({ shown: [{ key: 'area' }, { key: 'project' }], folded: [{ key: 'blueprint' }] });
  });

  it('always shows the first chip, however long', () => {
    expect(rowChips(chips, 3).shown.map((chip) => chip.key)).toEqual(['area']);
  });

  it('folds nothing when all fit', () => {
    expect(rowChips(chips, 100).folded).toEqual([]);
  });
});

describe('carriesEvery', () => {
  it('holds when the ship carries every value picked', () => {
    expect(carriesEvery(BUILDER, [valueId(PROJECT, 1), valueId(AREA, 0)])).toBe(true);
  });

  it('fails when one value picked is missing: every one must hold', () => {
    expect(carriesEvery(BUILDER, [valueId(PROJECT, 1), valueId(AREA, 1)])).toBe(false);
  });

  it('holds with nothing picked', () => {
    expect(carriesEvery(aShip('plain'), [])).toBe(true);
  });
});

describe('filterGroupsOf', () => {
  it('groups every owner’s keys, yours first, then by owner name, each key in order', () => {
    const groups = filterGroupsOf(labelContextOf(LABELS, { ships: SHIPS, isOperator: true }));

    expect(groups.map((group) => [group.title, group.keys.map((key) => key.key)])).toEqual([
      ['Yours', ['area', 'project']],
      ['By orchestrator', ['cost']],
      ['By squadrons', ['blueprint']],
      ['By trierarch-plugin', ['os']],
    ]);
  });

  it('counts the ships that carry each value, leaving retired ships out', () => {
    const [yours] = filterGroupsOf(labelContextOf(LABELS, { ships: SHIPS, isOperator: true }));

    expect(yours?.keys.find((key) => key.key === 'project')?.values.map((value) => [value.value, value.shipCount])).toEqual([
      ['aeolus', 1],
      ['hemma', 1],
    ]);
  });

  it('has no Yours group for a viewer', () => {
    expect(filterGroupsOf(labelContextOf(LABELS, { ships: SHIPS, isOperator: false })).map((group) => group.title)).toEqual([
      'By argo',
      'By orchestrator',
      'By squadrons',
      'By trierarch-plugin',
    ]);
  });
});

describe('pickedChips', () => {
  it('names each value picked, in the order picked', () => {
    const context = labelContextOf(LABELS, { ships: SHIPS, isOperator: true });

    expect(pickedChips([valueId(PROJECT, 1), valueId(AREA, 0)], context).map((chip) => `${chip.key}=${chip.value}`)).toEqual(['project=hemma', 'area=backend']);
  });

  it('leaves out a value no label has any more', () => {
    const context = labelContextOf(LABELS, { ships: SHIPS, isOperator: true });

    expect(pickedChips([newId('labelValue')], context)).toEqual([]);
  });
});
