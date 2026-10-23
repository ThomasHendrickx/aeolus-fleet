import { createIdGenerator, type FileRule, type LabelId, type NetworkRulesFile, type ShipId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { refusalOf, unwrap } from '../../testing/result.js';
import type { Label } from './label.js';
import { differencesOf, exportedFile, readNetworkRulesFile, resolvedRules, rulesByIds } from './network-rules-file.js';

const ids = createIdGenerator();
const fleetId = ids('fleet');
const argoId = ids('ship');

function aLabel(key: string, values: readonly string[]): Label {
  return { fleetId, id: ids('label'), key, values: values.map((value) => ({ id: ids('labelValue'), value })), owner: { kind: 'ship', shipId: argoId } };
}

function aFile(change: Partial<NetworkRulesFile> = {}): NetworkRulesFile {
  return {
    format: 'aeolus.network-rules',
    version: 1,
    exportedAt: '2026-10-23T14:02:11.000Z',
    fleet: { id: fleetId, name: 'staging' },
    rulesVersion: 42,
    labels: [{ key: 'crm', values: ['app', 'user'], definer: 'argo' }],
    rules: [{ verb: 'send', from: [{ label: 'crm', value: 'user' }], to: [{ label: 'crm', value: 'app' }] }],
    ...change,
  };
}

function textOf(file: unknown): string {
  return JSON.stringify(file);
}

describe('reading a network rules file (design network-io, section 5)', () => {
  it('reads a file of the format at version 1', () => {
    expect(unwrap(readNetworkRulesFile(textOf(aFile())))).toEqual(aFile());
  });

  it('refuses a text that is not JSON', () => {
    expect(refusalOf(readNetworkRulesFile('{ rules'))).toEqual({ kind: 'INVALID_NETWORK_RULES_FILE', message: 'The file is not JSON' });
  });

  it('refuses a file of another format', () => {
    expect(refusalOf(readNetworkRulesFile(textOf({ ...aFile(), format: 'other' }))).message).toBe('The file is not an aeolus.network-rules file');
  });

  it('refuses a file of another version, naming it, never migrating it (decision 0013)', () => {
    expect(refusalOf(readNetworkRulesFile(textOf({ ...aFile(), version: 2 }))).message).toBe('The file is version 2; this fleet reads version 1 only (decision 0013)');
  });

  it('names each break of the shape', () => {
    const { message } = refusalOf(readNetworkRulesFile(textOf({ ...aFile(), rulesVersion: -1, labels: 'crm' })));
    expect(message).toMatch(/^The file breaks: /);
    expect(message).toMatch(/rulesVersion/);
    expect(message).toMatch(/labels/);
  });

  it('names each break of the limits: a key, a value, a term twice and a label the file does not hold (decisions 0031, 0034)', () => {
    const file = aFile({
      labels: [{ key: 'CRM', values: ['app', 'app'], definer: 'argo' }],
      rules: [
        { verb: 'send', from: [{ owner: '*' }, { owner: '*' }], to: [] },
        { verb: 'send', from: [{ label: 'os', value: 'linux' }], to: [] },
      ],
    });
    expect(refusalOf(readNetworkRulesFile(textOf(file))).message).toBe(
      [
        'The file breaks:',
        'label CRM: A label key is lowercase a-z, 0-9 and -, at most 63 characters (decision 0031);',
        'label CRM: A label names each of its values once;',
        'rule 1: A selector holds each term once: owner=* twice (decision 0034);',
        'rule 2: os is a label the file does not hold',
      ].join(' '),
    );
  });

  it('refuses a value of a label the file does not give it', () => {
    const file = aFile({ rules: [{ verb: 'send', from: [{ label: 'crm', value: 'admin' }], to: [] }] });
    expect(refusalOf(readNetworkRulesFile(textOf(file))).message).toBe('The file breaks: rule 1: crm=admin is a value the file does not give the label crm');
  });

  it('refuses a same value on one side only (decision 0034)', () => {
    const file = aFile({ rules: [{ verb: 'send', from: [{ label: 'crm', value: '#' }], to: [] }] });
    expect(refusalOf(readNetworkRulesFile(textOf(file))).message).toBe(
      'The file breaks: rule 1: A term of the same value binds its label on both sides: crm=# is on one side only (decision 0034)',
    );
  });

  it('refuses a label twice', () => {
    const file = aFile({ labels: [...aFile().labels, { key: 'crm', values: ['app'], definer: 'argo' }] });
    expect(refusalOf(readNetworkRulesFile(textOf(file))).message).toBe('The file breaks: label crm: the file holds it twice');
  });

  it('holds exactly 200 rules and refuses one more (decision 0037)', () => {
    const rule: FileRule = { verb: 'send', from: [], to: [] };
    expect(readNetworkRulesFile(textOf(aFile({ rules: Array.from({ length: 200 }, () => rule) }))).isOk).toBe(true);
    expect(refusalOf(readNetworkRulesFile(textOf(aFile({ rules: Array.from({ length: 201 }, () => rule) })))).message).toMatch(/at most 200 network rules/);
  });
});

describe('exporting the applied rules (design network-io, section 4)', () => {
  const crm = aLabel('crm', ['app', 'user', 'admin']);
  const thomasId: ShipId = ids('ship');
  const [app, user] = [crm.values[0], crm.values[1]];

  it('writes every id as its name, with the labels the rules use, their values and definers, and the metadata', () => {
    const { file } = exportedFile({
      fleet: { id: fleetId, name: 'staging' },
      applied: {
        version: 42,
        rules: [
          { verb: 'send', from: [user?.id ?? ids('labelValue')], to: [app?.id ?? ids('labelValue')] },
          { verb: 'manage', from: [{ owner: thomasId }], to: [{ owner: '#' }, { labelId: crm.id, value: '*' }] },
        ],
      },
      labels: [{ label: crm, definer: 'argo' }],
      shipNames: new Map([[thomasId, 'thomas']]),
      at: new Date('2026-10-23T14:02:11Z'),
    });
    expect(file).toEqual({
      format: 'aeolus.network-rules',
      version: 1,
      exportedAt: '2026-10-23T14:02:11.000Z',
      fleet: { id: fleetId, name: 'staging' },
      rulesVersion: 42,
      labels: [{ key: 'crm', values: ['app', 'user', 'admin'], definer: 'argo' }],
      rules: [
        { verb: 'send', from: [{ label: 'crm', value: 'user' }], to: [{ label: 'crm', value: 'app' }] },
        { verb: 'manage', from: [{ owner: 'thomas' }], to: [{ owner: '#' }, { label: 'crm', value: '*' }] },
      ],
    });
  });

  it('writes no rules for none applied, all-to-all', () => {
    const { file } = exportedFile({ fleet: { id: fleetId, name: 'staging' }, applied: { version: 0, rules: null }, labels: [], shipNames: new Map(), at: new Date('2026-10-23T14:02:11Z') });
    expect([file.labels, file.rules]).toEqual([[], null]);
  });

  it('leaves out a rule on a label or a ship the fleet no longer has, as it matches no ship, and says which and why', () => {
    const gone: LabelId = ids('label');
    const exported = exportedFile({
      fleet: { id: fleetId, name: 'staging' },
      applied: {
        version: 3,
        rules: [
          { verb: 'read', from: [{ labelId: gone, value: '*' }], to: [] },
          { verb: 'read', from: [ids('labelValue')], to: [] },
          { verb: 'send', from: [], to: [] },
          { verb: 'manage', from: [{ owner: ids('ship') }], to: [] },
        ],
      },
      labels: [],
      shipNames: new Map(),
      at: new Date('2026-10-23T14:02:11Z'),
    });
    expect(exported.file.rules).toEqual([{ verb: 'send', from: [], to: [] }]);
    expect(exported.leftOut).toEqual([
      { rule: 1, reason: 'uses a label that no longer exists (its definer retired or deleted it)' },
      { rule: 2, reason: 'uses a label that no longer exists (its definer retired or deleted it)' },
      { rule: 4, reason: 'names a ship that no longer exists' },
    ]);
  });

  it('leaves out nothing when every name is found', () => {
    expect(exportedFile({ fleet: { id: fleetId, name: 'staging' }, applied: { version: 1, rules: [{ verb: 'send', from: [], to: [] }] }, labels: [], shipNames: new Map(), at: new Date('2026-10-23T14:02:11Z') }).leftOut).toEqual([]);
  });
});

describe('the differences between a file and the fleet (design network-io, Q3, Q9)', () => {
  const file = aFile({
    labels: [
      { key: 'crm', values: ['app', 'user'], definer: 'argo' },
      { key: 'os', values: ['linux'], definer: 'argo' },
    ],
    rules: [
      { verb: 'send', from: [{ label: 'crm', value: 'user' }], to: [{ owner: 'thomas' }] },
      { verb: 'read', from: [{ owner: '*' }], to: [{ label: 'os', value: '*' }] },
    ],
  });

  it('finds none in the fleet the file came from: the backup comes back as it was', () => {
    const fleet = { labels: [{ key: 'crm', values: ['app', 'user'], definer: 'argo' }, { key: 'os', values: ['linux'], definer: 'argo' }], activeShipNames: ['thomas'] };
    expect(differencesOf(file, fleet)).toEqual({ newLabels: [], differences: [] });
  });

  it('names the labels the fleet lacks as the ones import defines', () => {
    expect(differencesOf(file, { labels: [], activeShipNames: ['thomas'] })).toEqual({ newLabels: ['crm', 'os'], differences: [] });
  });

  it('finds a key with another definer, offering to use the existing label or drop the rules on it', () => {
    const fleet = { labels: [{ key: 'crm', values: ['app', 'user'], definer: 'crm-app' }], activeShipNames: ['thomas'] };
    expect(differencesOf(file, fleet).differences).toEqual([{ kind: 'definer', key: 'crm', fileDefiner: 'argo', fleetDefiner: 'crm-app', ways: ['useExisting', 'dropRules'] }]);
  });

  it('finds a key with other values that has every value the rules name, offering to use it', () => {
    const fleet = { labels: [{ key: 'crm', values: ['user', 'admin'], definer: 'argo' }], activeShipNames: ['thomas'] };
    expect(differencesOf(file, fleet).differences).toEqual([
      { kind: 'values', key: 'crm', fileValues: ['app', 'user'], fleetValues: ['user', 'admin'], missingValues: [], ways: ['useExisting'] },
    ]);
  });

  it('finds a key lacking a value the rules name, offering to drop the rules naming it', () => {
    const fleet = { labels: [{ key: 'crm', values: ['app'], definer: 'argo' }], activeShipNames: ['thomas'] };
    expect(differencesOf(file, fleet).differences).toEqual([
      { kind: 'values', key: 'crm', fileValues: ['app', 'user'], fleetValues: ['app'], missingValues: ['user'], ways: ['dropRules'] },
    ]);
  });

  it('finds the same values in another order no difference', () => {
    const fleet = { labels: [{ key: 'crm', values: ['user', 'app'], definer: 'argo' }], activeShipNames: ['thomas'] };
    expect(differencesOf(file, fleet).differences).toEqual([]);
  });

  it('finds an owner ship name no active ship has, offering to pick one or drop the rules naming it', () => {
    expect(differencesOf(file, { labels: [], activeShipNames: [] }).differences).toEqual([{ kind: 'ship', name: 'thomas', ways: ['pickShip', 'dropRules'] }]);
  });
});

describe('resolving the differences (design network-io, Q9)', () => {
  const rules: FileRule[] = [
    { verb: 'send', from: [{ label: 'crm', value: 'user' }], to: [{ owner: 'thomas' }] },
    { verb: 'send', from: [{ label: 'crm', value: 'app' }], to: [] },
    { verb: 'read', from: [{ owner: 'thomas' }], to: [{ label: 'os', value: '*' }] },
  ];
  const file = aFile({ labels: [{ key: 'crm', values: ['app', 'user'], definer: 'argo' }, { key: 'os', values: ['linux'], definer: 'argo' }], rules });

  it('keeps every rule with no difference', () => {
    expect(unwrap(resolvedRules(file, { differences: [], resolutions: [] }))).toEqual(rules);
  });

  it('drops the rules on a label of another definer', () => {
    const differences = [{ kind: 'definer' as const, key: 'os', fileDefiner: 'argo', fleetDefiner: 'os-app', ways: ['useExisting' as const, 'dropRules' as const] }];
    expect(unwrap(resolvedRules(file, { differences, resolutions: [{ kind: 'definer', key: 'os', way: 'dropRules' }] }))).toEqual([rules[0], rules[1]]);
  });

  it('keeps the rules on a label of another definer used as it is', () => {
    const differences = [{ kind: 'definer' as const, key: 'os', fileDefiner: 'argo', fleetDefiner: 'os-app', ways: ['useExisting' as const, 'dropRules' as const] }];
    expect(unwrap(resolvedRules(file, { differences, resolutions: [{ kind: 'definer', key: 'os', way: 'useExisting' }] }))).toEqual(rules);
  });

  it('drops only the rules naming a value the fleet lacks', () => {
    const differences = [{ kind: 'values' as const, key: 'crm', fileValues: ['app', 'user'], fleetValues: ['app'], missingValues: ['user'], ways: ['dropRules' as const] }];
    expect(unwrap(resolvedRules(file, { differences, resolutions: [{ kind: 'values', key: 'crm', way: 'dropRules' }] }))).toEqual([rules[1], rules[2]]);
  });

  it('drops the rules naming a ship no active ship has', () => {
    const differences = [{ kind: 'ship' as const, name: 'thomas', ways: ['pickShip' as const, 'dropRules' as const] }];
    expect(unwrap(resolvedRules(file, { differences, resolutions: [{ kind: 'ship', name: 'thomas', way: 'dropRules' }] }))).toEqual([rules[1]]);
  });

  it('refuses a difference left unresolved, naming it', () => {
    const differences = [{ kind: 'ship' as const, name: 'thomas', ways: ['pickShip' as const, 'dropRules' as const] }];
    expect(refusalOf(resolvedRules(file, { differences, resolutions: [] }))).toEqual({
      kind: 'LABEL_DIFFERENCES',
      message: 'The fleet differs from the file, unresolved: the ship thomas. Check the file again and resolve every difference',
    });
  });

  it('refuses a way the difference does not offer', () => {
    const differences = [{ kind: 'values' as const, key: 'crm', fileValues: ['app', 'user'], fleetValues: ['app'], missingValues: ['user'], ways: ['dropRules' as const] }];
    expect(refusalOf(resolvedRules(file, { differences, resolutions: [{ kind: 'values', key: 'crm', way: 'useExisting' }] })).kind).toBe('LABEL_DIFFERENCES');
  });

  it('keeps none, all-to-all, as none', () => {
    expect(unwrap(resolvedRules(aFile({ labels: [], rules: null }), { differences: [], resolutions: [] }))).toBeNull();
  });
});

describe('turning names into ids', () => {
  it('turns a value into its id, a label into its id and an owner name into its ship', () => {
    const crm = aLabel('crm', ['app', 'user']);
    const thomasId: ShipId = ids('ship');
    const rules: FileRule[] = [{ verb: 'send', from: [{ label: 'crm', value: 'user' }, { owner: 'thomas' }], to: [{ label: 'crm', value: '#' }, { owner: '#' }] }];
    expect(unwrap(rulesByIds(rules, { labels: [crm], ships: new Map([['thomas', thomasId]]) }))).toEqual([
      { verb: 'send', from: [crm.values[1]?.id, { owner: thomasId }], to: [{ labelId: crm.id, value: '#' }, { owner: '#' }] },
    ]);
  });

  it('refuses a name it finds no id for, as the fleet changed since the check', () => {
    const rules: FileRule[] = [{ verb: 'send', from: [{ owner: 'thomas' }], to: [] }];
    expect(refusalOf(rulesByIds(rules, { labels: [], ships: new Map() })).kind).toBe('LABEL_DIFFERENCES');
  });
});
