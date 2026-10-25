import { accountIdSchema, SCOPE_DESCRIPTION_MAX_LENGTH, type FleetId } from '@aeolus-fleet/common';
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
const READ_LEADS = { scope: 'crm:read-leads', description: 'Read leads in the CRM' };

beforeEach(async () => {
  core = createInMemoryCore('2026-10-25T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  manager = { kind: 'account', accountId: MATHILDE, fleetId, scopes: ['scopes:define'], groupValues: [], personShipId: null, throughShipId: null };
  core.state.events.length = 0;
});

describe("defining the fleet's scopes (design gateway-scopes, 4.1)", () => {
  it("keeps the scope with its description as the fleet's own", async () => {
    await expect(registry.defineScope(manager, READ_LEADS)).resolves.toEqual({ isOk: true, value: READ_LEADS });

    expect(core.state.definedScopes).toEqual([{ fleetId, ...READ_LEADS }]);
  });

  it('writes ScopeDefined, caused by the defining actor, naming the scope and its description', async () => {
    unwrap(await registry.defineScope(manager, READ_LEADS));

    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'ScopeDefined',
        occurredAt: core.clock.now(),
        actor: { kind: 'account', accountId: MATHILDE, throughShipId: null },
        details: { scope: 'crm:read-leads', description: 'Read leads in the CRM' },
      }),
    ]);
  });

  it('lets a ship define one too', async () => {
    const steward = await shipWithScopes({ registry, argo }, { name: 'steward', type: 'steward', scopes: ['scopes:define'] });

    await expect(registry.defineScope(steward, READ_LEADS)).resolves.toMatchObject({ isOk: true });
  });

  it('defines more than 20 scopes in one namespace: the fleet has no cap', async () => {
    for (const at of Array.from({ length: 21 }, (_, index) => index)) {
      unwrap(await registry.defineScope(manager, { scope: `crm:action-${String(at)}`, description: 'One of many' }));
    }

    expect(core.state.definedScopes).toHaveLength(21);
  });

  it(`takes a description of ${String(SCOPE_DESCRIPTION_MAX_LENGTH)} characters, the longest`, async () => {
    await expect(registry.defineScope(manager, { scope: 'crm:read-leads', description: 'd'.repeat(SCOPE_DESCRIPTION_MAX_LENGTH) })).resolves.toMatchObject({ isOk: true });
  });

  it.each([
    ['an upper case letter', 'CRM:read-leads'],
    ['no action', 'crm'],
    ['an empty action', 'crm:'],
    ['two colons', 'crm:read:leads'],
    ['a namespace of 33 characters', `${'n'.repeat(33)}:read`],
  ])('refuses a scope with %s, and stores nothing', async (_what, scope) => {
    expect(refusalOf(await registry.defineScope(manager, { scope, description: 'Read' }))).toMatchObject({ kind: 'INVALID_SCOPE' });
    expect(core.state.definedScopes).toEqual([]);
    expect(core.state.events).toEqual([]);
  });

  it.each([
    ['an empty description', ''],
    ['a description on two lines', 'Read leads\nin the CRM'],
    [`a description over ${String(SCOPE_DESCRIPTION_MAX_LENGTH)} characters`, 'd'.repeat(SCOPE_DESCRIPTION_MAX_LENGTH + 1)],
  ])('refuses %s, and stores nothing', async (_what, description) => {
    expect(refusalOf(await registry.defineScope(manager, { scope: 'crm:read-leads', description }))).toMatchObject({ kind: 'INVALID_SCOPE_DESCRIPTION' });
    expect(core.state.definedScopes).toEqual([]);
  });

  it.each(['messages', 'fleet', 'crew', 'labels', 'scopes', 'meetings'])('refuses the core namespace %s, by name', async (namespace) => {
    expect(refusalOf(await registry.defineScope(manager, { scope: `${namespace}:read-leads`, description: 'Read' }))).toEqual({
      kind: 'CORE_NAMESPACE',
      message: `${namespace} is a core namespace: core alone defines its scopes`,
    });
    expect(core.state.definedScopes).toEqual([]);
  });

  it.each(['gateway', 'squadrons', 'trierarch'])('refuses the reserved namespace %s, by name, though no plugin declared it yet', async (namespace) => {
    expect(refusalOf(await registry.defineScope(manager, { scope: `${namespace}:read`, description: 'Read' }))).toEqual({
      kind: 'RESERVED_NAMESPACE',
      message: `${namespace} is reserved for a plugin Aeolus knows: pick another namespace`,
    });
    expect(core.state.definedScopes).toEqual([]);
  });

  it("refuses a namespace a plugin declared, naming the plugin's ship", async () => {
    const vault = await shipWithScopes({ registry, argo }, { name: 'vault', type: 'vault', scopes: ['scopes:declare'] });
    unwrap(await registry.declareScopes(vault, { namespace: 'vault', scopes: [] }));
    core.state.events.length = 0;

    expect(refusalOf(await registry.defineScope(manager, { scope: 'vault:write', description: 'Write notes' }))).toEqual({
      kind: 'NAMESPACE_TAKEN',
      message: 'The namespace vault is taken, by vault',
    });
    expect(core.state.definedScopes).toEqual([]);
    expect(core.state.events).toEqual([]);
  });

  it('refuses a scope the fleet has, and keeps its description', async () => {
    unwrap(await registry.defineScope(manager, READ_LEADS));
    core.state.events.length = 0;

    expect(refusalOf(await registry.defineScope(manager, { scope: 'crm:read-leads', description: 'Something else' }))).toEqual({
      kind: 'SCOPE_DEFINED',
      message: 'The fleet has crm:read-leads already: change its description instead',
    });
    expect(core.state.definedScopes).toEqual([{ fleetId, ...READ_LEADS }]);
    expect(core.state.events).toEqual([]);
  });
});
