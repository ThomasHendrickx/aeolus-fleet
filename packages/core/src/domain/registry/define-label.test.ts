import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { hostedFleet, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { refusalOf, unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argo: Caller;
let plugin: Caller;
let pluginId: ShipId;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-07T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  plugin = await shipWithScopes({ registry, argo }, { name: 'trierarch-plugin', type: 'trierarch-plugin', scopes: ['fleet:read', 'labels:define', 'labels:assign'] });
  pluginId = plugin.shipId;
  core.state.events.length = 0;
});

describe('defining a label', () => {
  it('keeps the key with its values, owned by the ship that defined it, each with its own id', async () => {
    const defined = unwrap(await registry.defineLabel(plugin, { key: 'os', values: ['macos', 'linux'] }));

    expect(core.state.labels).toEqual([
      {
        fleetId,
        id: defined.labelId,
        key: 'os',
        values: [
          { id: defined.values[0]?.id, value: 'macos' },
          { id: defined.values[1]?.id, value: 'linux' },
        ],
        ownerShipId: pluginId,
      },
    ]);
  });

  it('answers the label id and the id of each value, prefixed lbl_ and lbv_', async () => {
    const defined = unwrap(await registry.defineLabel(plugin, { key: 'os', values: ['macos', 'linux'] }));

    expect(defined.labelId).toMatch(/^lbl_/);
    expect(defined.values.map((value) => value.value)).toEqual(['macos', 'linux']);
    expect(defined.values.every((value) => value.id.startsWith('lbv_'))).toBe(true);
    expect(new Set(defined.values.map((value) => value.id)).size).toBe(2);
  });

  it('writes LabelDefined, caused by its owner and naming it, with the label and its values, ids and text', async () => {
    const defined = unwrap(await registry.defineLabel(plugin, { key: 'os', values: ['macos', 'linux'] }));

    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'LabelDefined',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: pluginId },
        shipId: pluginId,
        details: { labelId: defined.labelId, key: 'os', values: 'macos,linux', valueIds: defined.values.map((value) => value.id).join(',') },
      }),
    ]);
  });

  it('refuses a key the fleet has, naming its owner, and stores nothing', async () => {
    unwrap(await registry.defineLabel(plugin, { key: 'os', values: ['macos'] }));
    core.state.events.length = 0;

    const refused = await registry.defineLabel(argo, { key: 'os', values: ['linux'] });

    expect(refusalOf(refused)).toMatchObject({ kind: 'LABEL_KEY_TAKEN', message: 'The fleet has the label os already, owned by trierarch-plugin' });
    expect(core.state.labels.map((label) => [label.key, label.values.map((value) => value.value), label.ownerShipId])).toEqual([['os', ['macos'], pluginId]]);
    expect(core.state.events).toEqual([]);
  });

  it('takes the same key in another fleet: a key is unique in its fleet', async () => {
    unwrap(await registry.defineLabel(plugin, { key: 'os', values: ['macos'] }));
    const other = await hostedFleet(core);
    const otherArgo: Caller = { ...argo, fleetId: other.fleetId, shipId: other.operatorShipId };

    await expect(registry.defineLabel(otherArgo, { key: 'os', values: ['linux'] })).resolves.toMatchObject({ isOk: true });
  });

  it('takes a key and a value of exactly 63 characters', async () => {
    const longest = 'a'.repeat(63);

    await expect(registry.defineLabel(plugin, { key: longest, values: [longest] })).resolves.toMatchObject({ isOk: true });
  });

  it.each([
    ['one over 63 characters', 'a'.repeat(64)],
    ['empty', ''],
    ['uppercase', 'OS'],
    ['an underscore', 'project_name'],
    ['a dot', 'aeolus.os'],
    ['a space', 'o s'],
  ])('refuses a key that is %s, naming the limits decision', async (_case, key) => {
    const refused = refusalOf(await registry.defineLabel(plugin, { key, values: ['macos'] }));

    expect(refused.kind).toBe('INVALID_LABEL_KEY');
    expect(refused.message).toContain('decision 0031');
    expect(core.state.labels).toEqual([]);
  });

  it.each([
    ['one over 63 characters', 'a'.repeat(64)],
    ['empty', ''],
    ['uppercase', 'MacOS'],
    ['a colon', 'mac:os'],
  ])('refuses a value that is %s, naming the limits decision', async (_case, value) => {
    const refused = refusalOf(await registry.defineLabel(plugin, { key: 'os', values: ['linux', value] }));

    expect(refused.kind).toBe('INVALID_LABEL_VALUE');
    expect(refused.message).toContain('decision 0031');
    expect(core.state.labels).toEqual([]);
  });

  it('takes digits and hyphens in keys and values', async () => {
    await expect(registry.defineLabel(plugin, { key: 'mac-mini-2', values: ['m4-pro', '2026'] })).resolves.toMatchObject({ isOk: true });
  });

  it('takes exactly 50 values', async () => {
    const values = Array.from({ length: 50 }, (_, index) => `v${String(index)}`);

    await expect(registry.defineLabel(plugin, { key: 'project', values })).resolves.toMatchObject({ isOk: true });
  });

  it('refuses 51 values, naming the limits decision', async () => {
    const values = Array.from({ length: 51 }, (_, index) => `v${String(index)}`);

    const refused = refusalOf(await registry.defineLabel(plugin, { key: 'project', values }));

    expect(refused.kind).toBe('INVALID_LABEL_VALUES');
    expect(refused.message).toContain('decision 0031');
  });

  it('refuses a label without values', async () => {
    await expect(registry.defineLabel(plugin, { key: 'os', values: [] })).resolves.toMatchObject({ isOk: false, error: { kind: 'INVALID_LABEL_VALUES' } });
  });

  it('refuses a value given twice', async () => {
    await expect(registry.defineLabel(plugin, { key: 'os', values: ['macos', 'macos'] })).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'INVALID_LABEL_VALUES' },
    });
  });
});
