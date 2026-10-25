import { accountIdSchema, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { AccountCaller, ShipCaller } from '../shared/caller.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argo: ShipCaller;
let manager: AccountCaller;

const MATHILDE = accountIdSchema.parse('acc-mathilde');

beforeEach(async () => {
  core = createInMemoryCore('2026-10-25T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  manager = { kind: 'account', accountId: MATHILDE, fleetId, scopes: ['scopes:define'], groupValues: [], personShipId: null, throughShipId: null };
  unwrap(await registry.defineScope(manager, { scope: 'crm:admin', description: 'Administer the CRM' }));
  unwrap(await registry.defineScope(manager, { scope: 'crm:read-leads', description: 'Read leads' }));
  core.state.events.length = 0;
});

/** The ship holds the scope, as a grant would leave it. */
function holds(shipId: ShipId, scope: string): void {
  core.state.ships = core.state.ships.map((held) => (held.id === shipId ? { ...held, scopes: [...held.scopes, scope] } : held));
}

describe("removing one of the fleet's scopes (design gateway-scopes, 4.1)", () => {
  it('removes the scope, keeping the others', async () => {
    await expect(registry.removeScope(manager, { scope: 'crm:admin' })).resolves.toEqual({ isOk: true, value: null });

    expect(core.state.definedScopes).toEqual([{ fleetId, scope: 'crm:read-leads', description: 'Read leads' }]);
  });

  it('writes ScopeRemoved, caused by the actor, naming the scope', async () => {
    unwrap(await registry.removeScope(manager, { scope: 'crm:admin' }));

    expect(core.state.events).toEqual([
      expect.objectContaining({ type: 'ScopeRemoved', occurredAt: core.clock.now(), actor: { kind: 'account', accountId: MATHILDE, throughShipId: null }, details: { scope: 'crm:admin' } }),
    ]);
  });

  it('refuses while active ships hold it, naming how many, and keeps it', async () => {
    const scout = await shipWithScopes({ registry, argo }, { name: 'scout', type: 'scout', scopes: [] });
    const clerk = await shipWithScopes({ registry, argo }, { name: 'clerk', type: 'clerk', scopes: [] });
    holds(scout.shipId, 'crm:admin');
    holds(clerk.shipId, 'crm:admin');
    core.state.events.length = 0;

    expect(refusalOf(await registry.removeScope(manager, { scope: 'crm:admin' }))).toEqual({
      kind: 'SCOPE_HELD',
      message: '2 ships hold crm:admin: revoke it from them first',
    });
    expect(core.state.definedScopes).toHaveLength(2);
    expect(core.state.events).toEqual([]);
  });

  it('says one ship in the singular', async () => {
    const scout = await shipWithScopes({ registry, argo }, { name: 'scout', type: 'scout', scopes: [] });
    holds(scout.shipId, 'crm:admin');

    expect(refusalOf(await registry.removeScope(manager, { scope: 'crm:admin' })).message).toBe('1 ship holds crm:admin: revoke it from it first');
  });

  it('removes a scope only a retired ship held', async () => {
    const scout = await shipWithScopes({ registry, argo }, { name: 'scout', type: 'scout', scopes: [] });
    holds(scout.shipId, 'crm:admin');
    core.state.ships = core.state.ships.map((held) => (held.id === scout.shipId ? { ...held, retiredAt: core.clock.now() } : held));

    await expect(registry.removeScope(manager, { scope: 'crm:admin' })).resolves.toMatchObject({ isOk: true });
  });

  it('refuses a scope the fleet does not have, by name', async () => {
    expect(refusalOf(await registry.removeScope(manager, { scope: 'crm:write-leads' }))).toEqual({ kind: 'SCOPE_NOT_DEFINED', message: 'The fleet has no scope crm:write-leads' });
  });
});
