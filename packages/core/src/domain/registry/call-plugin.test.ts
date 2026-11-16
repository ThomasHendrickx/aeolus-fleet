import { describe, expect, it } from 'vitest';

import { readReachScenario } from '../../../test/support/read-reach-scenario.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import { createCallPlugin } from './call-plugin.js';

describe('plugin actor contract slice 1: admission', () => {
  it('dispatches the actual actor and scopes without requiring fleet:manage or messages:send', async () => {
    // Given a connected plugin and a caller holding only its plugin scope.
    const fleet = await readReachScenario();
    const { shipId } = unwrap(await fleet.registry.commissionShip(fleet.argo, { name: 'sample-plugin', type: 'sample', kind: 'plugin', idempotencyKey: newKey() }));
    const dispatches: unknown[] = [];
    const call = createCallPlugin({ ...fleet.core, requestId: () => 'f473fb19-52cd-445f-906b-7d6ef5e4b01f', transport: { dispatch: (context) => { dispatches.push(context); return Promise.resolve({ isOk: true, value: { accepted: true } }); } } });
    const caller = { ...fleet.reader, scopes: ['sample:change'] };

    // When the actor calls an arbitrary plugin operation.
    const answer = await call(caller, { pluginShipId: shipId, procedure: 'widgets.change', input: { value: 1 } });

    // Then the plugin receives only the verified context, not its own authority.
    expect(answer).toEqual({ isOk: true, value: { accepted: true } });
    expect(dispatches).toEqual([expect.objectContaining({ fleetId: fleet.fleetId, pluginShipId: shipId, actor: { kind: 'ship', shipId: caller.shipId }, scopes: ['sample:change'], procedure: 'widgets.change', input: { value: 1 }, expiresAt: '2026-10-18T09:00:30.000Z' })]);
  });

  it('never dispatches to a target outside the caller fleet or to a retired plugin', async () => {
    // Given another fleet's plugin.
    const fleet = await readReachScenario();
    const other = await readReachScenario();
    const { shipId } = unwrap(await other.registry.commissionShip(other.argo, { name: 'other-plugin', type: 'sample', kind: 'plugin', idempotencyKey: newKey() }));
    const dispatches: unknown[] = [];
    const call = createCallPlugin({ ...fleet.core, requestId: () => 'f473fb19-52cd-445f-906b-7d6ef5e4b01f', transport: { dispatch: (context) => { dispatches.push(context); return Promise.resolve({ isOk: true, value: {} }); } } });

    // When that target is called from this fleet.
    const answer = await call(fleet.reader, { pluginShipId: shipId, procedure: 'widgets.list', input: {} });

    // Then no server dispatch occurs.
    expect(answer).toEqual({ isOk: false, error: { kind: 'PLUGIN_NOT_FOUND', message: 'Target is not a connected plugin in this fleet' } });
    expect(dispatches).toEqual([]);
  });
});
