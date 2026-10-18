import { SCOPES } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { hostedFleet, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller } from '../shared/caller.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let argo: Caller;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-18T09:00:00.000Z');
  argo = operatorCaller(await initialiseFleet(core));
  registry = registryUseCases(core);
});

describe("listing the fleet's scopes (decision 0046)", () => {
  it('lists the core namespaces first, each with its scopes in catalogue order, declared by no ship', async () => {
    const listed = await registry.listScopes(argo);

    expect(listed.map(({ namespace, declaredBy }) => [namespace, declaredBy])).toEqual([
      ['messages', null],
      ['fleet', null],
      ['crew', null],
      ['labels', null],
      ['scopes', null],
    ]);
    expect(listed.flatMap(({ scopes }) => scopes.map(({ scope }) => scope))).toEqual(SCOPES.toSorted((first, second) => namespaceOrder(first) - namespaceOrder(second)));
  });

  it('describes every core scope on one line', async () => {
    const descriptions = (await registry.listScopes(argo)).flatMap(({ scopes }) => scopes.map(({ description }) => description));

    expect(descriptions.filter((description) => description.trim() === '' || description.includes('\n'))).toEqual([]);
  });

  it('lists each plugin namespace after them, by namespace, with its declarer by id and name and its scopes as declared', async () => {
    const squadrons = await shipWithScopes({ registry, argo }, { name: 'squadrons', type: 'squadrons', scopes: [] });
    const builders = await shipWithScopes({ registry, argo }, { name: 'builders', type: 'plugin', scopes: [] });
    unwrap(await registry.declareScopes(squadrons, { namespace: 'squadrons', scopes: [{ scope: 'squadrons:form', description: 'Form a squadron' }] }));
    unwrap(await registry.declareScopes(builders, { namespace: 'builds', scopes: [] }));

    const plugins = (await registry.listScopes(argo)).slice(5);

    expect(plugins).toEqual([
      { namespace: 'builds', declaredBy: { id: builders.shipId, name: 'builders' }, scopes: [] },
      { namespace: 'squadrons', declaredBy: { id: squadrons.shipId, name: 'squadrons' }, scopes: [{ scope: 'squadrons:form', description: 'Form a squadron' }] },
    ]);
  });

  it("lists no other fleet's namespaces", async () => {
    const other = await hostedFleet(core);
    const otherArgo: Caller = { ...argo, fleetId: other.fleetId, shipId: other.operatorShipId };
    unwrap(await registry.declareScopes(otherArgo, { namespace: 'squadrons', scopes: [] }));

    await expect(registry.listScopes(argo)).resolves.toHaveLength(5);
  });
});

/** Where a scope's namespace stands among the core namespaces. */
function namespaceOrder(scope: string): number {
  return ['messages', 'fleet', 'crew', 'labels', 'scopes'].indexOf(scope.slice(0, scope.indexOf(':')));
}
