import { SCOPE_DESCRIPTION_MAX_LENGTH, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { hostedFleet, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argo: ShipCaller;
let squadrons: ShipCaller;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-18T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  squadrons = await shipWithScopes({ registry, argo }, { name: 'squadrons', type: 'squadrons', scopes: ['fleet:read'] });
  core.state.events.length = 0;
});

const FORM = { scope: 'squadrons:form', description: 'Form a squadron by message' };
const SCALE = { scope: 'squadrons:scale', description: 'Add and remove members' };

/** The ship holds the scope, as a grant would leave it. */
function holds(shipId: ShipId, scope: string): void {
  core.state.ships = core.state.ships.map((held) => (held.id === shipId ? { ...held, scopes: [...held.scopes, scope] } : held));
}

describe('declaring scopes (decision 0046)', () => {
  it('takes up the namespace for the declaring ship, with its scopes and their descriptions', async () => {
    await expect(registry.declareScopes(squadrons, { namespace: 'squadrons', scopes: [FORM, SCALE] })).resolves.toEqual({ isOk: true, value: { namespace: 'squadrons', scopes: [FORM, SCALE] } });

    expect(core.state.scopeNamespaces).toEqual([{ fleetId, namespace: 'squadrons', declaredBy: squadrons.shipId, scopes: [FORM, SCALE] }]);
  });

  it('writes ScopesDeclared on the declaring ship, caused by it, naming the namespace and how many scopes', async () => {
    unwrap(await registry.declareScopes(squadrons, { namespace: 'squadrons', scopes: [FORM, SCALE] }));

    expect(core.state.events).toEqual([
      expect.objectContaining({ type: 'ScopesDeclared', occurredAt: core.clock.now(), actor: { kind: 'ship', shipId: squadrons.shipId }, shipId: squadrons.shipId, details: { namespace: 'squadrons', scopes: 2 } }),
    ]);
  });

  it('takes a namespace with no scopes yet, and 20 scopes, the most', async () => {
    const twenty = Array.from({ length: 20 }, (_, at) => ({ scope: `squadrons:scope-${String(at)}`, description: 'One of many' }));

    await expect(registry.declareScopes(squadrons, { namespace: 'squadrons', scopes: [] })).resolves.toMatchObject({ isOk: true });
    await expect(registry.declareScopes(squadrons, { namespace: 'squadrons', scopes: twenty })).resolves.toMatchObject({ isOk: true });
  });

  it('refuses 21 scopes, and stores nothing', async () => {
    const twentyOne = Array.from({ length: 21 }, (_, at) => ({ scope: `squadrons:scope-${String(at)}`, description: 'One of many' }));

    expect(refusalOf(await registry.declareScopes(squadrons, { namespace: 'squadrons', scopes: twentyOne }))).toMatchObject({ kind: 'TOO_MANY_SCOPES' });
    expect(core.state.scopeNamespaces).toEqual([]);
    expect(core.state.events).toEqual([]);
  });

  it.each([
    ['a malformed namespace', { namespace: 'Squadrons', scopes: [] }],
    ['a malformed scope', { namespace: 'squadrons', scopes: [{ scope: 'squadrons:Form', description: 'Form' }] }],
    ['a scope with no action', { namespace: 'squadrons', scopes: [{ scope: 'squadrons', description: 'Form' }] }],
    ['a scope of another namespace', { namespace: 'squadrons', scopes: [{ scope: 'fleets:form', description: 'Form' }] }],
    ['a scope twice', { namespace: 'squadrons', scopes: [FORM, FORM] }],
  ])('refuses %s, and stores nothing', async (_what, input) => {
    expect(refusalOf(await registry.declareScopes(squadrons, input))).toMatchObject({ kind: 'INVALID_SCOPE' });
    expect(core.state.scopeNamespaces).toEqual([]);
    expect(core.state.events).toEqual([]);
  });

  it.each([
    ['an empty description', ''],
    ['a description on two lines', 'Form a squadron\nby message'],
    [`a description over ${String(SCOPE_DESCRIPTION_MAX_LENGTH)} characters`, 'd'.repeat(SCOPE_DESCRIPTION_MAX_LENGTH + 1)],
  ])('refuses %s, and stores nothing', async (_what, description) => {
    expect(refusalOf(await registry.declareScopes(squadrons, { namespace: 'squadrons', scopes: [{ scope: 'squadrons:form', description }] }))).toMatchObject({
      kind: 'INVALID_SCOPE_DESCRIPTION',
    });
    expect(core.state.scopeNamespaces).toEqual([]);
  });

  it(`takes a description of exactly ${String(SCOPE_DESCRIPTION_MAX_LENGTH)} characters`, async () => {
    await expect(registry.declareScopes(squadrons, { namespace: 'squadrons', scopes: [{ scope: 'squadrons:form', description: 'd'.repeat(SCOPE_DESCRIPTION_MAX_LENGTH) }] })).resolves.toMatchObject({
      isOk: true,
    });
  });

  it.each(['messages', 'fleet', 'crew', 'labels', 'scopes'])('refuses the core namespace %s, and stores nothing', async (namespace) => {
    expect(refusalOf(await registry.declareScopes(squadrons, { namespace, scopes: [] }))).toMatchObject({ kind: 'CORE_NAMESPACE' });
    expect(core.state.scopeNamespaces).toEqual([]);
  });

  it('refuses a namespace another ship took, naming that ship, and stores nothing', async () => {
    unwrap(await registry.declareScopes(squadrons, { namespace: 'squadrons', scopes: [FORM] }));
    const other = await shipWithScopes({ registry, argo }, { name: 'rival', type: 'plugin', scopes: [] });
    core.state.events.length = 0;

    expect(refusalOf(await registry.declareScopes(other, { namespace: 'squadrons', scopes: [SCALE] }))).toMatchObject({
      kind: 'NAMESPACE_TAKEN',
      message: 'The namespace squadrons is taken, by squadrons',
    });
    expect(core.state.scopeNamespaces).toEqual([{ fleetId, namespace: 'squadrons', declaredBy: squadrons.shipId, scopes: [FORM] }]);
    expect(core.state.events).toEqual([]);
  });

  it("refuses a namespace the fleet uses for its own scopes, by the fleet, and stores nothing (design gateway-scopes, 4.1)", async () => {
    const vault = await shipWithScopes({ registry, argo }, { name: 'vault', type: 'vault', scopes: ['fleet:read'] });
    unwrap(await registry.defineScope(argo, { scope: 'vault:write', description: 'Write notes' }));
    core.state.events.length = 0;

    expect(refusalOf(await registry.declareScopes(vault, { namespace: 'vault', scopes: [] }))).toEqual({
      kind: 'NAMESPACE_TAKEN',
      message: 'The namespace vault is taken, by the fleet',
    });
    expect(core.state.scopeNamespaces).toEqual([]);
    expect(core.state.events).toEqual([]);
  });

  it("takes a namespace once the fleet removed its last scope there (design gateway-scopes, 4.1)", async () => {
    const vault = await shipWithScopes({ registry, argo }, { name: 'vault', type: 'vault', scopes: ['fleet:read'] });
    unwrap(await registry.defineScope(argo, { scope: 'vault:write', description: 'Write notes' }));
    unwrap(await registry.removeScope(argo, { scope: 'vault:write' }));

    await expect(registry.declareScopes(vault, { namespace: 'vault', scopes: [] })).resolves.toMatchObject({ isOk: true });
  });

  it('refuses a second namespace to a ship that declared one, and stores nothing', async () => {
    unwrap(await registry.declareScopes(squadrons, { namespace: 'squadrons', scopes: [FORM] }));
    core.state.events.length = 0;

    expect(refusalOf(await registry.declareScopes(squadrons, { namespace: 'fleets', scopes: [] }))).toMatchObject({ kind: 'SECOND_NAMESPACE' });
    expect(core.state.scopeNamespaces.map(({ namespace }) => namespace)).toEqual(['squadrons']);
    expect(core.state.events).toEqual([]);
  });

  it('declares its whole list again: a new scope, a new description, a scope no ship holds removed, with ScopesDeclared again', async () => {
    unwrap(await registry.declareScopes(squadrons, { namespace: 'squadrons', scopes: [FORM, SCALE] }));
    core.state.events.length = 0;
    const reworded = { scope: 'squadrons:form', description: 'Form a squadron' };
    const stand = { scope: 'squadrons:stand-down', description: 'Stand a squadron down' };

    unwrap(await registry.declareScopes(squadrons, { namespace: 'squadrons', scopes: [reworded, stand] }));

    expect(core.state.scopeNamespaces).toEqual([{ fleetId, namespace: 'squadrons', declaredBy: squadrons.shipId, scopes: [reworded, stand] }]);
    expect(core.state.events).toEqual([expect.objectContaining({ type: 'ScopesDeclared', details: { namespace: 'squadrons', scopes: 2 } })]);
  });

  it('refuses to remove a scope an active ship holds, naming it, and stores nothing', async () => {
    unwrap(await registry.declareScopes(squadrons, { namespace: 'squadrons', scopes: [FORM, SCALE] }));
    const scout = await shipWithScopes({ registry, argo }, { name: 'scout', type: 'reviewer', scopes: [] });
    holds(scout.shipId, 'squadrons:scale');
    core.state.events.length = 0;

    expect(refusalOf(await registry.declareScopes(squadrons, { namespace: 'squadrons', scopes: [FORM] }))).toMatchObject({
      kind: 'SCOPE_HELD',
      message: 'Ships hold squadrons:scale: revoke it from them first',
    });
    expect(core.state.scopeNamespaces).toEqual([{ fleetId, namespace: 'squadrons', declaredBy: squadrons.shipId, scopes: [FORM, SCALE] }]);
    expect(core.state.events).toEqual([]);
  });

  it('removes a scope only a retired ship holds', async () => {
    unwrap(await registry.declareScopes(squadrons, { namespace: 'squadrons', scopes: [FORM, SCALE] }));
    const scout = await shipWithScopes({ registry, argo }, { name: 'scout', type: 'reviewer', scopes: [] });
    holds(scout.shipId, 'squadrons:scale');
    unwrap(await registry.retireShip(argo, { shipId: scout.shipId }));

    await expect(registry.declareScopes(squadrons, { namespace: 'squadrons', scopes: [FORM] })).resolves.toMatchObject({ isOk: true });
  });

  it('takes the same namespace in another fleet: a namespace is unique in its fleet', async () => {
    unwrap(await registry.declareScopes(squadrons, { namespace: 'squadrons', scopes: [FORM] }));
    const other = await hostedFleet(core);
    const otherArgo: ShipCaller = { ...argo, fleetId: other.fleetId, shipId: other.operatorShipId };

    await expect(registry.declareScopes(otherArgo, { namespace: 'squadrons', scopes: [FORM] })).resolves.toMatchObject({ isOk: true });
  });
});
