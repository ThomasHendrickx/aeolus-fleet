import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import { PAYLOAD_MAX_BYTES } from '../rules/payload.js';
import {
  NETWORK_RULES_FILE_FORMAT,
  NETWORK_RULES_FILE_VERSION,
  checkNetworkRulesFileInputSchema,
  checkNetworkRulesFileOutputSchema,
  importNetworkRulesInputSchema,
  importNetworkRulesOutputSchema,
  networkRulesFileSchema,
} from './network-rules-file.js';

const newId = createIdGenerator();

const aFile = {
  format: 'aeolus.network-rules',
  version: 1,
  exportedAt: '2026-10-23T14:02:11Z',
  fleet: { id: newId('fleet'), name: 'staging' },
  rulesVersion: 42,
  labels: [{ key: 'crm', values: ['app', 'user'], definer: 'argo' }],
  rules: [
    { verb: 'send', from: [{ label: 'crm', value: 'user' }], to: [{ label: 'crm', value: 'app' }] },
    { verb: 'manage', from: [{ owner: 'thomas' }], to: [{ owner: '#' }] },
  ],
};

describe('the network rules file (design network-io, section 4)', () => {
  it('is the format aeolus.network-rules at version 1', () => {
    expect([NETWORK_RULES_FILE_FORMAT, NETWORK_RULES_FILE_VERSION]).toEqual(['aeolus.network-rules', 1]);
  });

  it('holds the labels the rules use and the rules, both by name, with the metadata to tell two files apart', () => {
    expect(networkRulesFileSchema.parse(aFile)).toEqual(aFile);
  });

  it('holds no rules for a fleet with none applied, all-to-all', () => {
    expect(networkRulesFileSchema.safeParse({ ...aFile, labels: [], rules: null }).success).toBe(true);
  });

  it('takes a term by a label key with a value text, any or the same value, or by an owner ship name, any or the same owner', () => {
    const rule = { verb: 'read', from: [{ label: 'crm', value: '*' }, { owner: '*' }], to: [{ label: 'crm', value: '#' }, { owner: 'thomas' }] };
    expect(networkRulesFileSchema.safeParse({ ...aFile, rules: [rule] }).success).toBe(true);
  });

  it('refuses a term by id', () => {
    expect(networkRulesFileSchema.safeParse({ ...aFile, rules: [{ verb: 'send', from: [newId('labelValue')], to: [] }] }).success).toBe(false);
  });
});

describe('checkNetworkRulesFileInputSchema', () => {
  it('takes the file as its text, as attached or pasted, of at most 64 KB', () => {
    expect(checkNetworkRulesFileInputSchema.safeParse({ file: 'a'.repeat(PAYLOAD_MAX_BYTES) }).success).toBe(true);
  });

  it('refuses a file over 64 KB', () => {
    expect(checkNetworkRulesFileInputSchema.safeParse({ file: 'a'.repeat(PAYLOAD_MAX_BYTES + 1) }).success).toBe(false);
  });
});

describe('checkNetworkRulesFileOutputSchema', () => {
  it('answers the file, the labels import defines and every difference with the ways to resolve it', () => {
    const checked = {
      file: aFile,
      newLabels: ['os'],
      differences: [
        { kind: 'definer', key: 'crm', fileDefiner: 'argo', fleetDefiner: 'crm-app', ways: ['useExisting', 'dropRules'] },
        { kind: 'values', key: 'crm', fileValues: ['app', 'user'], fleetValues: ['app'], missingValues: ['user'], ways: ['dropRules'] },
        { kind: 'ship', name: 'thomas', ways: ['pickShip', 'dropRules'] },
      ],
    };
    expect(checkNetworkRulesFileOutputSchema.parse(checked)).toEqual(checked);
  });
});

describe('importNetworkRulesInputSchema', () => {
  it('takes the file, the definer of the labels it defines and a resolution of each difference', () => {
    const input = {
      file: JSON.stringify(aFile),
      definerShipId: newId('ship'),
      resolutions: [
        { kind: 'definer', key: 'crm', way: 'useExisting' },
        { kind: 'values', key: 'crm', way: 'dropRules' },
        { kind: 'ship', name: 'thomas', way: 'pickShip', shipId: newId('ship') },
        { kind: 'ship', name: 'ana', way: 'dropRules' },
      ],
    };
    expect(importNetworkRulesInputSchema.parse(input)).toEqual(input);
  });

  it('takes no definer, for argo', () => {
    expect(importNetworkRulesInputSchema.safeParse({ file: '{}', resolutions: [] }).success).toBe(true);
  });

  it('refuses picking a ship without naming it', () => {
    expect(importNetworkRulesInputSchema.safeParse({ file: '{}', resolutions: [{ kind: 'ship', name: 'thomas', way: 'pickShip' }] }).success).toBe(false);
  });
});

describe('importNetworkRulesOutputSchema', () => {
  it('answers the version the draft was saved against and the labels it defined', () => {
    expect(importNetworkRulesOutputSchema.parse({ savedAgainstVersion: 3, definedLabels: ['os'] })).toEqual({ savedAgainstVersion: 3, definedLabels: ['os'] });
  });
});
