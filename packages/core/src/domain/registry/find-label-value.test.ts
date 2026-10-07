import type { LabelId, LabelValueId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { refusalOf, unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let argo: Caller;
let osId: LabelId;
let linux: LabelValueId;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-07T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  const plugin = await shipWithScopes({ registry, argo }, { name: 'trierarch-plugin', type: 'trierarch-plugin', scopes: ['fleet:read', 'labels:define'] });
  const defined = unwrap(await registry.defineLabel(plugin, { key: 'os', values: ['macos', 'linux'] }));
  osId = defined.labelId;
  linux = defined.values[1]?.id ?? core.ids('labelValue');
});

describe('finding a label value', () => {
  it('answers the ids of the label and of its value, by key and value text', async () => {
    await expect(registry.findLabelValue(argo, { key: 'os', value: 'linux' })).resolves.toEqual({ isOk: true, value: { labelId: osId, valueId: linux } });
  });

  it('matches after lowercasing both texts', async () => {
    await expect(registry.findLabelValue(argo, { key: 'OS', value: 'Linux' })).resolves.toEqual({ isOk: true, value: { labelId: osId, valueId: linux } });
  });

  it.each([
    { label: 'a key the fleet does not have', input: { key: 'region', value: 'linux' } },
    { label: 'a value the label does not have', input: { key: 'os', value: 'windows' } },
    { label: 'a value only part of one', input: { key: 'os', value: 'lin' } },
  ])('refuses $label', async ({ input }) => {
    expect(refusalOf(await registry.findLabelValue(argo, input))).toEqual({
      kind: 'LABEL_VALUE_NOT_FOUND',
      message: `The fleet has no label value ${input.key}=${input.value}`,
    });
  });

  it('writes no event: it only reads', async () => {
    core.state.events.length = 0;

    unwrap(await registry.findLabelValue(argo, { key: 'os', value: 'linux' }));

    expect(core.state.events).toEqual([]);
  });
});
