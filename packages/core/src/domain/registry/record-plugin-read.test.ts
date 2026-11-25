import type { ShipId } from '@aeolus-fleet/common';
import { beforeEach, expect, it } from 'vitest';

import { readReachScenario, type ReadReachScenario } from '../../../test/support/read-reach-scenario.js';
import { unwrap } from '../../testing/result.js';
import { createRecordPluginRead } from './record-plugin-read.js';

let fleet: ReadReachScenario;
let pluginShipId: ShipId;
let record: ReturnType<typeof createRecordPluginRead>;

const read = 'guard.get';
const firstAt = '2026-11-25T12:00:00.000Z';
const laterAt = '2026-11-25T12:01:00.000Z';
const firstFailure = { at: firstAt, read, reason: 'timeout' };

beforeEach(async () => {
  fleet = await readReachScenario();
  ({ shipId: pluginShipId } = unwrap(await fleet.registry.commissionShip(fleet.argo, {
    name: 'trierarch-plugin', type: 'trierarch-plugin', kind: 'plugin', idempotencyKey: 'plugin',
  })));
  fleet.core.state.events.length = 0;
  fleet.core.clock.set(firstAt);
  record = createRecordPluginRead({ ...fleet.core, countFailure: () => undefined });
});

function failRead() {
  return record(fleet.argo, { pluginShipId, read, outcome: 'failed', reason: 'timeout' });
}

it('first failure sets failingSince', async () => {
  unwrap(await failRead());

  const ship = unwrap(await fleet.registry.getShip(fleet.argo, { shipId: pluginShipId }));
  expect(ship).toMatchObject({ pluginReads: { failingSince: firstFailure, lastFailed: firstFailure, lastGood: null } });
  expect(fleet.core.state.events).toEqual([expect.objectContaining({
    type: 'PluginReadFailed', actor: { kind: 'ship', shipId: fleet.argo.shipId }, shipId: pluginShipId, details: { read, reason: 'timeout' },
  })]);
});

it('a second failure keeps failingSince', async () => {
  unwrap(await failRead());
  fleet.core.clock.set(laterAt);

  unwrap(await record(fleet.argo, { pluginShipId, read, outcome: 'failed', reason: 'no-answer' }));

  const ship = unwrap(await fleet.registry.getShip(fleet.argo, { shipId: pluginShipId }));
  expect(ship).toMatchObject({ pluginReads: { failingSince: firstFailure, lastFailed: { at: laterAt, read, reason: 'no-answer' }, lastGood: null } });
  expect(fleet.core.state.events.map(({ type }) => type)).toEqual(['PluginReadFailed']);
});

it('a good read clears failingSince', async () => {
  unwrap(await failRead());
  fleet.core.clock.advance(30_000);
  unwrap(await record(fleet.argo, { pluginShipId, read, outcome: 'failed', reason: 'no-answer' }));
  fleet.core.clock.set(laterAt);

  unwrap(await record(fleet.argo, { pluginShipId, read: 'other.get', outcome: 'good' }));

  const ship = unwrap(await fleet.registry.getShip(fleet.argo, { shipId: pluginShipId }));
  expect(ship).toMatchObject({ pluginReads: {
    failingSince: null, lastFailed: { read, reason: 'no-answer' }, lastGood: { at: laterAt, read: 'other.get' },
  } });
  expect(fleet.core.state.events.map(({ type, details }) => ({ type, details }))).toEqual([
    { type: 'PluginReadFailed', details: { read, reason: 'timeout' } },
    { type: 'PluginReadRecovered', details: { read: 'other.get', reason: 'timeout' } },
  ]);
});

it('a ship that is no plugin is refused', async () => {
  const result = await record(fleet.argo, { pluginShipId: fleet.near.shipId, read, outcome: 'good' });

  expect(result).toMatchObject({ isOk: false, error: { kind: 'PLUGIN_NOT_FOUND' } });
  expect(fleet.core.state.events).toEqual([]);
});
