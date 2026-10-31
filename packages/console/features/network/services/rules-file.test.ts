import type { FileRule, NetworkRulesDifference, NetworkRulesFile } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { checkLineOf, exportFileNameOf, isEveryDifferenceResolved, resolutionOf, ruleLinesOf, ruleTextOf, waysOf, type ResolutionChoice } from './rules-file';

const aFile: NetworkRulesFile = {
  format: 'aeolus.network-rules',
  version: 1,
  exportedAt: '2026-10-23T14:02:11.000Z',
  fleet: { id: 'flt_01m3tb1zgr5h2ffee12xnch8sv', name: 'Home Fleet' },
  rulesVersion: 42,
  labels: [],
  rules: [],
};

const definer: NetworkRulesDifference = { kind: 'definer', key: 'crm', fileDefiner: 'argo', fleetDefiner: 'crm-app', ways: ['useExisting', 'dropRules'] };
const values: NetworkRulesDifference = { kind: 'values', key: 'crm', fileValues: ['app', 'user'], fleetValues: ['app'], missingValues: ['user'], ways: ['dropRules'] };
const ship: NetworkRulesDifference = { kind: 'ship', name: 'thomas', ways: ['pickShip', 'dropRules'] };

describe('the exported file’s name', () => {
  it('names the fleet and the rules version, so two files tell apart', () => {
    expect(exportFileNameOf(aFile)).toBe('network-rules-home-fleet-v42.json');
  });
});

describe('a rule as the import overview shows it', () => {
  it('names its verb and each side’s terms by name, an empty side as every ship', () => {
    expect(ruleTextOf({ verb: 'send', from: [{ label: 'crm', value: 'user' }, { owner: 'thomas' }], to: [] })).toEqual({ verb: 'send', from: ['crm=user', 'owner=thomas'], to: ['every ship'] });
  });
});

describe('the rules as the overview lists them', () => {
  it('give each rule one line, by its place in the file', () => {
    expect(ruleLinesOf([{ verb: 'read', from: [{ owner: '*' }], to: [{ label: 'os', value: '#' }] }, { verb: 'send', from: [], to: [] }])).toEqual([
      { place: 1, line: 'read: owner=* → os=#' },
      { place: 2, line: 'send: every ship → every ship' },
    ]);
  });
});

describe('the ways a difference offers', () => {
  it('words each way for the difference it resolves', () => {
    expect([waysOf(definer), waysOf(values), waysOf(ship)]).toEqual([
      [
        { way: 'useExisting', text: 'Use the label crm as it is, defined by crm-app' },
        { way: 'dropRules', text: 'Drop the rules on crm' },
      ],
      [{ way: 'dropRules', text: 'Drop the rules naming crm=user' }],
      [
        { way: 'pickShip', text: 'Pick an active ship for thomas' },
        { way: 'dropRules', text: 'Drop the rules naming owner=thomas' },
      ],
    ]);
  });
});

describe('resolving the differences', () => {
  it('is complete once every difference has a way, and a picked ship for a pick', () => {
    const choices: ResolutionChoice[] = [
      { difference: definer, way: 'useExisting' },
      { difference: values, way: 'dropRules' },
      { difference: ship, way: 'pickShip', shipId: 'shp_01m5m1s80kqtcvby5jgb4ab4d6' },
    ];
    expect(isEveryDifferenceResolved([definer, values, ship], choices)).toBe(true);
  });

  it('is not complete with a pick naming no ship yet', () => {
    expect(isEveryDifferenceResolved([ship], [{ difference: ship, way: 'pickShip' }])).toBe(false);
  });

  it('is not complete with a difference left open', () => {
    expect(isEveryDifferenceResolved([definer, ship], [{ difference: definer, way: 'dropRules' }])).toBe(false);
  });

  it('turns each choice into the resolution the import takes', () => {
    expect([
      resolutionOf({ difference: definer, way: 'useExisting' }),
      resolutionOf({ difference: ship, way: 'pickShip', shipId: 'shp_01m5m1s80kqtcvby5jgb4ab4d6' }),
      resolutionOf({ difference: ship, way: 'dropRules' }),
    ]).toEqual([
      { kind: 'definer', key: 'crm', way: 'useExisting' },
      { kind: 'ship', name: 'thomas', way: 'pickShip', shipId: 'shp_01m5m1s80kqtcvby5jgb4ab4d6' },
      { kind: 'ship', name: 'thomas', way: 'dropRules' },
    ]);
  });
});

describe('the import Check line', () => {
  const fileOf = (rules: NetworkRulesFile['rules'], labelCount: number): NetworkRulesFile => ({
    ...aFile,
    exportedAt: new Date(2026, 9, 23, 14, 2).toISOString(),
    rules,
    labels: Array.from({ length: labelCount }, (_, index) => ({ key: `k${String(index)}`, values: ['v'], definer: 'argo' })),
  });
  const rule: FileRule = { verb: 'send', from: [], to: [] };

  it('uses the singular for one rule and one label', () => {
    expect(checkLineOf(fileOf([rule], 1))).toBe('The file checks: 1 rule and 1 label, from Home Fleet at rules version 42, exported 23 Oct, 14:02.');
  });

  it('uses the plural for several, and words the export time in the console’s date format', () => {
    expect(checkLineOf(fileOf([rule, rule], 2))).toContain('2 rules and 2 labels');
  });

  it('says all-to-all when the file holds no rule list', () => {
    expect(checkLineOf({ ...fileOf([], 0), rules: null })).toContain('all-to-all, no rules and 0 labels');
  });
});
