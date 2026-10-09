import { createIdGenerator, SHIP_LABELS_MAX, type CrewSettings, type ListedLabel, type ListedShip } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { labelContextOf } from './labels';
import { machineLabelGroupsOf, machineLabelIdsOf, machineLabelsInputOf, machineLabelsText, machineMatchOf, noMatchWords } from './machine-labels';

const newId = createIdGenerator();

function aShip(name: string, overrides: Partial<ListedShip> = {}): ListedShip {
  return {
    id: newId('ship'), name, type: 'trierarch', kind: 'agent', status: 'crewed', startingPrompt: null, location: null, lastSeenAt: null, ping: null,
    scopes: ['messages:send', 'messages:receive'], labels: [], report: null, harness: null, model: null, awaitingCrewSince: null, crewRequest: null, retiredAt: null,
    ...overrides,
  };
}

const ARGO = aShip('argo', { kind: 'operator', type: 'operator' });
const PLUGIN = aShip('trierarch-plugin', { type: 'trierarch-plugin' });

function aLabel(definition: { key: string; values: string[] }, owner: ListedShip): ListedLabel {
  return { id: newId('label'), key: definition.key, values: definition.values.map((value) => ({ id: newId('labelValue'), value })), owner: { id: owner.id, name: owner.name } };
}

const OS = aLabel({ key: 'os', values: ['macos', 'linux', 'windows'] }, PLUGIN);
const ARCH = aLabel({ key: 'arch', values: ['arm64', 'amd64'] }, PLUGIN);
const PROJECT = aLabel({ key: 'project', values: ['aeolus', 'hemma'] }, ARGO);

function value(label: ListedLabel, text: string) {
  const found = label.values.find((each) => each.value === text);
  if (found === undefined) {
    throw new RangeError(`${label.key} has no value ${text}`);
  }
  return found;
}

function carried(label: ListedLabel, text: string): ListedShip['labels'][number] {
  const found = value(label, text);
  return { labelId: label.id, key: label.key, valueId: found.id, value: found.value };
}

const MAC = aShip('trierarch-mac', { labels: [carried(OS, 'macos'), carried(ARCH, 'arm64')] });
const MACBOOK = aShip('trierarch-macbook', { labels: [carried(OS, 'macos'), carried(ARCH, 'arm64')] });
const HETZNER = aShip('trierarch-hetzner', { labels: [carried(OS, 'linux'), carried(ARCH, 'amd64')] });
const BUILDER = aShip('builder', { type: 'implementer', labels: [carried(PROJECT, 'hemma'), carried(OS, 'linux')] });
const CONTEXT = labelContextOf([OS, ARCH, PROJECT], { ships: [ARGO, PLUGIN, MAC, MACBOOK, HETZNER, BUILDER], isOperator: true });
const MACHINES = [MAC, MACBOOK, HETZNER].map((ship) => ({ shipId: ship.id, name: ship.name }));

describe('machineMatchOf', () => {
  it('names the machines that carry every label picked, of all the machines', () => {
    expect(machineMatchOf(CONTEXT, { machines: MACHINES, valueIds: [value(OS, 'macos').id, value(ARCH, 'arm64').id] })).toEqual({
      matching: ['trierarch-mac', 'trierarch-macbook'],
      total: 3,
    });
  });

  it('matches no machine when none carries them all: exact matches, combined with AND', () => {
    expect(machineMatchOf(CONTEXT, { machines: MACHINES, valueIds: [value(OS, 'linux').id, value(ARCH, 'arm64').id] })).toEqual({ matching: [], total: 3 });
  });

  it('matches every machine with no label picked: any machine', () => {
    expect(machineMatchOf(CONTEXT, { machines: MACHINES, valueIds: [] }).matching).toHaveLength(3);
  });

  it('reads a ship’s labels on other ships than machines not at all: a label only a ship carries matches no machine', () => {
    expect(machineMatchOf(CONTEXT, { machines: MACHINES, valueIds: [value(PROJECT, 'hemma').id] }).matching).toEqual([]);
  });
});

describe('machineLabelGroupsOf', () => {
  it('offers the keys on machines first, each value with how many machines carry it, then the keys on no machine yet', () => {
    const groups = machineLabelGroupsOf(CONTEXT, MACHINES);

    expect(groups.map((group) => [group.title, group.keys.map((key) => key.key)])).toEqual([
      ['On machines', ['arch', 'os']],
      ['On no machine yet', ['project']],
    ]);
    expect(groups[0]?.keys.find((key) => key.key === 'os')?.values.map((each) => [each.value, each.shipCount])).toEqual([
      ['macos', 2],
      ['linux', 1],
      ['windows', 0],
    ]);
  });

  it('leaves out a group with no keys', () => {
    expect(machineLabelGroupsOf(labelContextOf([OS], { ships: [PLUGIN, MAC], isOperator: true }), [{ shipId: MAC.id, name: MAC.name }]).map((group) => group.title)).toEqual(['On machines']);
  });
});

describe('noMatchWords', () => {
  it('words the labels no machine carries by how many there are', () => {
    expect([1, 2, 3].map(noMatchWords)).toEqual([
      { these: 'this label', carries: 'carries it' },
      { these: 'both', carries: 'carries both' },
      { these: 'these labels', carries: 'carries them all' },
    ]);
  });
});

describe('machineLabelsInputOf', () => {
  it('gives the form the values picked as chips, in the order picked, and which machines carry them', () => {
    const input = machineLabelsInputOf(CONTEXT, { machines: MACHINES, shipLabelsMax: SHIP_LABELS_MAX });
    const picked = [value(ARCH, 'amd64').id, value(OS, 'linux').id];

    expect(input.chipsOf(picked).map((chip) => `${chip.key}=${chip.value}`)).toEqual(['arch=amd64', 'os=linux']);
    expect(input.matchOf(picked)).toEqual({ matching: ['trierarch-hetzner'], total: 3 });
  });
});

describe('machineLabelIdsOf', () => {
  it('reads the machine labels a request asks for, and none from settings without them or no crew settings', () => {
    const settings: CrewSettings = { harness: 'claude-code', workspace: { kind: 'folder', name: 'notes' }, options: {} };

    expect(machineLabelIdsOf({ ...settings, machineLabels: [value(OS, 'linux').id] })).toEqual([value(OS, 'linux').id]);
    expect(machineLabelIdsOf(settings)).toEqual([]);
    expect(machineLabelIdsOf(null)).toEqual([]);
  });
});

describe('machineLabelsText', () => {
  it('joins two with and, and more with commas then and', () => {
    const chips = [{ key: 'os', value: 'linux' }, { key: 'arch', value: 'arm64' }, { key: 'site', value: 'home' }];

    expect(machineLabelsText(chips.slice(0, 1))).toBe('os=linux');
    expect(machineLabelsText(chips.slice(0, 2))).toBe('os=linux and arch=arm64');
    expect(machineLabelsText(chips)).toBe('os=linux, arch=arm64 and site=home');
  });
});
