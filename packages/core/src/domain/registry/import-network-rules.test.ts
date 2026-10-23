import type { FleetId, NetworkRulesFile, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyNetworkRules, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { labelIdOf, valueIdOf } from '../../../test/support/label-fixtures.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argo: ShipCaller;
let importer: ShipCaller;
let thomasId: ShipId;

const file: NetworkRulesFile = {
  format: 'aeolus.network-rules',
  version: 1,
  exportedAt: '2026-10-23T14:02:11.000Z',
  fleet: { id: 'flt_01m3tb1zgr5h2ffee12xnch8sv', name: 'staging' },
  rulesVersion: 42,
  labels: [{ key: 'crm', values: ['app', 'user'], definer: 'argo' }],
  rules: [
    { verb: 'send', from: [{ label: 'crm', value: 'user' }], to: [{ label: 'crm', value: 'app' }] },
    { verb: 'manage', from: [{ owner: 'thomas' }], to: [{ label: 'crm', value: '*' }] },
  ],
};

const text = JSON.stringify(file);

beforeEach(async () => {
  core = createInMemoryCore('2026-10-23T15:00:00.000Z');
  const fleet = await initialiseFleet(core, 'production');
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  importer = await shipWithScopes({ registry, argo }, { name: 'importer', type: 'networking', scopes: ['fleet:network', 'labels:define'] });
  ({ shipId: thomasId } = await shipWithScopes({ registry, argo }, { name: 'thomas', type: 'person', scopes: [] }));
  core.state.events.length = 0;
});

describe('importing network rules (design network-io, section 5)', () => {
  it('defines the labels the fleet lacks, defined by argo, and saves the rules by ids as the draft, applying nothing', async () => {
    expect(unwrap(await registry.importNetworkRules(importer, { file: text, resolutions: [] }))).toEqual({ savedAgainstVersion: 0, definedLabels: ['crm'] });

    expect(core.state.labels.map(({ key, owner }) => ({ key, owner }))).toEqual([{ key: 'crm', owner: { kind: 'ship', shipId: argo.shipId } }]);
    const [user, app, crm] = [valueIdOf(core, { key: 'crm', value: 'user' }), valueIdOf(core, { key: 'crm', value: 'app' }), labelIdOf(core, 'crm')];
    expect(core.state.networkRulesDrafts).toEqual([
      {
        fleetId,
        rules: [
          { verb: 'send', from: [user], to: [app] },
          { verb: 'manage', from: [{ owner: thomasId }], to: [{ labelId: crm, value: '*' }] },
        ],
        savedAt: core.clock.now(),
        savedAgainstVersion: 0,
      },
    ]);
    expect(core.state.networkSettings).toEqual([]);
  });

  it('writes LabelDefined naming the definer, caused by the importer, and NetworkRulesDraftSaved, in one unit of work', async () => {
    unwrap(await registry.importNetworkRules(importer, { file: text, resolutions: [] }));

    expect(core.state.events.map(({ type, shipId, actor }) => ({ type, shipId, actor }))).toEqual([
      { type: 'LabelDefined', shipId: argo.shipId, actor: { kind: 'ship', shipId: importer.shipId } },
      { type: 'NetworkRulesDraftSaved', shipId: undefined, actor: { kind: 'ship', shipId: importer.shipId } },
    ]);
  });

  it('brings a fleet back to the rules it exported: backup and restore', async () => {
    unwrap(await registry.importNetworkRules(importer, { file: text, resolutions: [] }));
    const version = unwrap(await registry.applyNetworkRules(importer, { version: 0 })).version;
    const exported = JSON.stringify(unwrap(await registry.exportNetworkRules(importer)));
    const applied = core.state.networkSettings[0]?.rules;
    await applyNetworkRules(registry, { by: importer, rules: [] });

    expect(unwrap(await registry.importNetworkRules(importer, { file: exported, resolutions: [] }))).toEqual({ savedAgainstVersion: version + 1, definedLabels: [] });
    expect(core.state.networkRulesDrafts[0]?.rules).toEqual(applied);
  });

  it('defines the labels for the picked definer within the importer\'s manage reach (Q6, Q10)', async () => {
    const definer = await shipWithScopes({ registry, argo }, { name: 'crm-app', type: 'crm', scopes: [] });

    unwrap(await registry.importNetworkRules(importer, { file: text, definerShipId: definer.shipId, resolutions: [] }));

    expect(core.state.labels.map(({ owner }) => owner)).toEqual([{ kind: 'ship', shipId: definer.shipId }]);
  });

  it('refuses a definer outside the importer\'s manage reach, defining nothing and keeping the refusal', async () => {
    const definer = await shipWithScopes({ registry, argo }, { name: 'crm-app', type: 'crm', scopes: [] });
    await applyNetworkRules(registry, { by: importer, rules: [] });
    core.state.events.length = 0;

    expect(refusalOf(await registry.importNetworkRules(importer, { file: text, definerShipId: definer.shipId, resolutions: [] })).kind).toBe('NOT_REACHABLE');
    expect([core.state.labels, core.state.networkRulesDrafts, core.state.events]).toEqual([[], [], []]);
    expect(core.state.reachRefusals).toHaveLength(1);
  });

  it('refuses a definer that is no active ship', async () => {
    const definer = await shipWithScopes({ registry, argo }, { name: 'crm-app', type: 'crm', scopes: [] });
    unwrap(await registry.retireShip(argo, { shipId: definer.shipId }));

    expect(refusalOf(await registry.importNetworkRules(importer, { file: text, definerShipId: definer.shipId, resolutions: [] })).kind).toBe('SHIP_NOT_FOUND');
  });

  it('refuses a difference left unresolved, writing nothing (the fleet changed since the check)', async () => {
    unwrap(await registry.retireShip(argo, { shipId: thomasId }));
    core.state.events.length = 0;

    expect(refusalOf(await registry.importNetworkRules(importer, { file: text, resolutions: [] })).kind).toBe('LABEL_DIFFERENCES');
    expect([core.state.labels, core.state.networkRulesDrafts, core.state.events]).toEqual([[], [], []]);
  });

  it('names a ship the person picked for an owner name no active ship has', async () => {
    unwrap(await registry.retireShip(argo, { shipId: thomasId }));
    const ana = await shipWithScopes({ registry, argo }, { name: 'ana', type: 'person', scopes: [] });

    unwrap(await registry.importNetworkRules(importer, { file: text, resolutions: [{ kind: 'ship', name: 'thomas', way: 'pickShip', shipId: ana.shipId }] }));

    expect(core.state.networkRulesDrafts[0]?.rules?.[1]?.from).toEqual([{ owner: ana.shipId }]);
  });

  it('refuses a picked ship that is no active ship', async () => {
    unwrap(await registry.retireShip(argo, { shipId: thomasId }));

    expect(refusalOf(await registry.importNetworkRules(importer, { file: text, resolutions: [{ kind: 'ship', name: 'thomas', way: 'pickShip', shipId: thomasId }] })).kind).toBe('SHIP_NOT_FOUND');
  });

  it('uses a label the fleet has with another definer, defining nothing', async () => {
    const crmApp = await shipWithScopes({ registry, argo }, { name: 'crm-app', type: 'crm', scopes: ['labels:define'] });
    unwrap(await registry.defineLabel(crmApp, { key: 'crm', values: ['user', 'app'] }));

    expect(unwrap(await registry.importNetworkRules(importer, { file: text, resolutions: [{ kind: 'definer', key: 'crm', way: 'useExisting' }] })).definedLabels).toEqual([]);
    expect(core.state.networkRulesDrafts[0]?.rules?.[0]).toEqual({ verb: 'send', from: [valueIdOf(core, { key: 'crm', value: 'user' })], to: [valueIdOf(core, { key: 'crm', value: 'app' })] });
  });

  it('refuses a file that breaks', async () => {
    expect(refusalOf(await registry.importNetworkRules(importer, { file: '{', resolutions: [] })).kind).toBe('INVALID_NETWORK_RULES_FILE');
  });
});
