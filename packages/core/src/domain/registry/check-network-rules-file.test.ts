import type { NetworkRulesFile } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let argo: ShipCaller;
let importer: ShipCaller;
let crmApp: ShipCaller;

const file: NetworkRulesFile = {
  format: 'aeolus.network-rules',
  version: 1,
  exportedAt: '2026-10-23T14:02:11.000Z',
  fleet: { id: 'flt_01m3tb1zgr5h2ffee12xnch8sv', name: 'staging' },
  rulesVersion: 42,
  labels: [
    { key: 'crm', values: ['app', 'user'], definer: 'argo' },
    { key: 'os', values: ['linux'], definer: 'argo' },
  ],
  rules: [
    { verb: 'send', from: [{ label: 'crm', value: 'user' }], to: [{ label: 'crm', value: 'app' }] },
    { verb: 'manage', from: [{ owner: 'thomas' }], to: [{ label: 'os', value: '*' }] },
  ],
};

beforeEach(async () => {
  core = createInMemoryCore('2026-10-23T15:00:00.000Z');
  const fleet = await initialiseFleet(core, 'production');
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  importer = await shipWithScopes({ registry, argo }, { name: 'importer', type: 'networking', scopes: ['fleet:network', 'labels:define'] });
  crmApp = await shipWithScopes({ registry, argo }, { name: 'crm-app', type: 'crm', scopes: ['labels:define'] });
  core.state.events.length = 0;
});

describe('checking a network rules file (design network-io, section 5)', () => {
  it('answers the file, the labels import defines and every difference with the fleet', async () => {
    unwrap(await registry.defineLabel(crmApp, { key: 'crm', values: ['app'] }));

    expect(unwrap(await registry.checkNetworkRulesFile(importer, { file: JSON.stringify(file) }))).toEqual({
      file,
      newLabels: ['os'],
      differences: [
        { kind: 'definer', key: 'crm', fileDefiner: 'argo', fleetDefiner: 'crm-app', ways: ['useExisting', 'dropRules'] },
        { kind: 'values', key: 'crm', fileValues: ['app', 'user'], fleetValues: ['app'], missingValues: ['user'], ways: ['dropRules'] },
        { kind: 'ship', name: 'thomas', ways: ['pickShip', 'dropRules'] },
      ],
    });
  });

  it('finds an owner ship name among the active ships', async () => {
    await shipWithScopes({ registry, argo }, { name: 'thomas', type: 'person', scopes: [] });

    expect(unwrap(await registry.checkNetworkRulesFile(importer, { file: JSON.stringify(file) })).differences).toEqual([]);
  });

  it('refuses a file that breaks, naming each break', async () => {
    const refusal = refusalOf(await registry.checkNetworkRulesFile(importer, { file: JSON.stringify({ ...file, version: 2 }) }));

    expect(refusal).toEqual({ kind: 'INVALID_NETWORK_RULES_FILE', message: 'The file is version 2; this fleet reads version 1 only (decision 0013)' });
  });

  it('changes nothing and writes no event', async () => {
    unwrap(await registry.checkNetworkRulesFile(importer, { file: JSON.stringify(file) }));

    expect([core.state.labels, core.state.networkRulesDrafts, core.state.events]).toEqual([[], [], []]);
  });
});
