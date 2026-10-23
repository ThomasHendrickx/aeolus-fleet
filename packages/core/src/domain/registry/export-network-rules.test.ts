import type { FleetId, LabelValueId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { applyNetworkRules, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { valueIdOf } from '../../../test/support/label-fixtures.js';
import { unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argo: ShipCaller;
let networking: ShipCaller;
let crmApp: ShipCaller;
let user: LabelValueId;
let app: LabelValueId;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-23T14:02:11.000Z');
  const fleet = await initialiseFleet(core, 'staging');
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  networking = await shipWithScopes({ registry, argo }, { name: 'networking', type: 'networking', scopes: ['fleet:network'] });
  crmApp = await shipWithScopes({ registry, argo }, { name: 'crm-app', type: 'crm', scopes: ['labels:define'] });
  unwrap(await registry.defineLabel(crmApp, { key: 'crm', values: ['app', 'user'] }));
  unwrap(await registry.defineLabel(crmApp, { key: 'os', values: ['linux'] }));
  [app, user] = [valueIdOf(core, { key: 'crm', value: 'app' }), valueIdOf(core, { key: 'crm', value: 'user' })];
});

describe('exporting the network rules (design network-io, section 4)', () => {
  it('writes the applied rules by name with the labels they use, their definers, and the fleet and settings version', async () => {
    await applyNetworkRules(registry, { by: networking, rules: [{ verb: 'send', from: [user], to: [app] }, { verb: 'manage', from: [{ owner: crmApp.shipId }], to: [{ owner: '*' }] }] });

    expect(unwrap(await registry.exportNetworkRules(networking)).file).toEqual({
      format: 'aeolus.network-rules',
      version: 1,
      exportedAt: '2026-10-23T14:02:11.000Z',
      fleet: { id: fleetId, name: 'staging' },
      rulesVersion: 1,
      labels: [{ key: 'crm', values: ['app', 'user'], definer: 'crm-app' }],
      rules: [
        { verb: 'send', from: [{ label: 'crm', value: 'user' }], to: [{ label: 'crm', value: 'app' }] },
        { verb: 'manage', from: [{ owner: 'crm-app' }], to: [{ owner: '*' }] },
      ],
    });
  });

  it('writes the applied rules, never the draft (Q2)', async () => {
    await applyNetworkRules(registry, { by: networking, rules: [] });
    unwrap(await registry.saveNetworkRulesDraft(networking, { rules: [{ verb: 'send', from: [user], to: [] }] }));

    expect(unwrap(await registry.exportNetworkRules(networking)).file).toMatchObject({ rulesVersion: 1, labels: [], rules: [] });
  });

  it('writes no rules for a fleet with none applied, all-to-all', async () => {
    expect(unwrap(await registry.exportNetworkRules(networking)).file).toMatchObject({ rulesVersion: 0, labels: [], rules: null });
  });

  it('says which applied rule it left out: one on a label its definer deleted', async () => {
    const gone = unwrap(await registry.defineLabel(crmApp, { key: 'gone', values: ['soon'] }));
    await applyNetworkRules(registry, { by: networking, rules: [{ verb: 'send', from: [user], to: [app] }, { verb: 'send', from: [{ labelId: gone.labelId, value: '*' }], to: [] }] });
    unwrap(await registry.deleteLabel(crmApp, { labelId: gone.labelId }));

    const { file, leftOut } = unwrap(await registry.exportNetworkRules(networking));

    expect(file.rules).toHaveLength(1);
    expect(leftOut).toEqual([{ rule: 2, reason: 'uses a label that no longer exists (its definer retired or deleted it)' }]);
  });

  it('changes nothing and writes no event', async () => {
    await applyNetworkRules(registry, { by: networking, rules: [{ verb: 'send', from: [user], to: [app] }] });
    core.state.events.length = 0;

    unwrap(await registry.exportNetworkRules(networking));

    expect(core.state.events).toEqual([]);
  });
});
