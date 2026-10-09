import { createIdGenerator, SHIP_LABELS_MAX, type ListedLabel, type ListedShip } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { activeShipCount, assignKeysOf, carriesEvery, labelLimitOf, listed, retiredLabelsOf, retireLabelLines, chipsOf, filterGroupsOf, labelContextOf, labelRowsOf, labelTextProblem, matchesLabelQuery, pickedChips, rowChips } from './labels';

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

function valueId(label: ListedLabel, index: number): ListedShip['labels'][number]['valueId'] {
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

describe('labelRowsOf', () => {
  const rows = labelRowsOf(labelContextOf(LABELS, { ships: SHIPS, isOperator: true }));

  it('lists yours first, then each owner’s by name, each by key', () => {
    expect(rows.map((row) => [row.key, row.owner.name, row.owner.isYours])).toEqual([
      ['area', 'argo', true],
      ['project', 'argo', true],
      ['cost', 'orchestrator', false],
      ['blueprint', 'squadrons', false],
      ['os', 'trierarch-plugin', false],
    ]);
  });

  it('counts the ships that carry each value, and any value of the label, leaving retired ships out', () => {
    expect(rows.find((row) => row.key === 'project')).toMatchObject({
      shipCount: 2,
      values: [
        { value: 'aeolus', shipCount: 1 },
        { value: 'hemma', shipCount: 1 },
      ],
    });
  });

  it('counts the ships that are not retired', () => {
    expect(activeShipCount({ ships: SHIPS })).toBe(6);
  });
});

describe('matchesLabelQuery', () => {
  const row = { key: 'project', values: [{ valueId: valueId(PROJECT, 1), value: 'hemma', shipCount: 1 }] };

  it('matches the key or a value, ignoring case', () => {
    expect([matchesLabelQuery(row, 'PROJ'), matchesLabelQuery(row, 'hem'), matchesLabelQuery(row, ' ')]).toEqual([true, true, true]);
  });

  it('misses text in neither', () => {
    expect(matchesLabelQuery(row, 'aeolus')).toBe(false);
  });
});

describe('labelTextProblem', () => {
  it('names the field and the rule for capitals or spaces', () => {
    expect(labelTextProblem('Project X', 'Key')).toBe('Key: use lowercase letters, digits and - only, at most 63 characters (decision 0031).');
  });

  it('refuses one character over the most', () => {
    expect([labelTextProblem('a'.repeat(63), 'Value'), labelTextProblem('a'.repeat(64), 'Value')]).toEqual([
      undefined,
      'Value: use lowercase letters, digits and - only, at most 63 characters (decision 0031).',
    ]);
  });

  it('says nothing while the field is empty', () => {
    expect(labelTextProblem('', 'Key')).toBeUndefined();
  });
});

describe('labelLimitOf', () => {
  const carrying = (count: number) => ({ labels: Array.from({ length: count }, () => carried(PROJECT, 0)) });

  it('counts nothing below 15 labels', () => {
    expect(labelLimitOf(carrying(14), SHIP_LABELS_MAX)).toEqual({ isAtLimit: false });
  });

  it('counts from 15 labels', () => {
    expect(labelLimitOf(carrying(15), SHIP_LABELS_MAX)).toEqual({ count: '15 of 20', isAtLimit: false });
  });

  it('is at the limit at 20 labels', () => {
    expect(labelLimitOf(carrying(20), SHIP_LABELS_MAX)).toEqual({ count: '20 of 20', isAtLimit: true });
  });
});

describe('assignKeysOf', () => {
  it('offers your keys only, marking the values the ship carries', () => {
    const keys = assignKeysOf(BUILDER, labelContextOf(LABELS, { ships: SHIPS, isOperator: true }));

    expect(keys.map((key) => [key.key, key.carriedValueIds])).toEqual([
      ['area', [valueId(AREA, 0)]],
      ['project', [valueId(PROJECT, 1)]],
    ]);
  });
});

describe('listed', () => {
  it('joins words with commas and a last and', () => {
    expect([listed([]), listed(['a']), listed(['a', 'b']), listed(['a', 'b', 'c'])]).toEqual(['', 'a', 'a and b', 'a, b and c']);
  });
});

describe('retiredLabelsOf', () => {
  const context = labelContextOf(LABELS, { ships: SHIPS, isOperator: true });

  it('names the values a ship carries', () => {
    expect(retiredLabelsOf(BUILDER, context)).toEqual({ carried: ['os=macos', 'project=hemma', 'area=backend'] });
  });

  it('names the labels an owner owns and the ships that carry them, leaving retired ships out', () => {
    expect(retiredLabelsOf(ARGO, context)).toEqual({ carried: [], owned: { keys: ['project', 'area'], carriers: ['builder', 'writer'] } });
  });
});

describe('retireLabelLines', () => {
  it('names the values a ship carries', () => {
    expect(retireLabelLines({ carried: ['project=aeolus', 'area=review', 'cost=low'] })).toEqual(['Its 3 labels are removed with it: project=aeolus, area=review, cost=low.']);
  });

  it('names an owner’s labels and the ships that lose them', () => {
    expect(retireLabelLines({ carried: [], owned: { keys: ['os', 'arch', 'site'], carriers: ['trierarch-mac', 'trierarch-hetzner'] } })).toEqual([
      'Its 3 labels retire with it: os, arch and site. Nobody can assign them again.',
      'They are removed from the 2 ships that carry them: trierarch-mac and trierarch-hetzner.',
    ]);
  });

  it('says one label in the singular, carried by no ship', () => {
    expect(retireLabelLines({ carried: ['os=macos'], owned: { keys: ['site'], carriers: [] } })).toEqual([
      'Its label is removed with it: os=macos.',
      'Its label retires with it: site. Nobody can assign it again.',
    ]);
  });

  it('has nothing to say without labels', () => {
    expect(retireLabelLines({ carried: [] })).toEqual([]);
  });
});
