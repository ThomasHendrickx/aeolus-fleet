import { accountIdSchema, SCOPE_DESCRIPTION_MAX_LENGTH, type FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { initialiseFleet, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { AccountCaller } from '../shared/caller.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let manager: AccountCaller;

const MATHILDE = accountIdSchema.parse('acc-mathilde');

beforeEach(async () => {
  core = createInMemoryCore('2026-10-25T09:00:00.000Z');
  ({ fleetId } = await initialiseFleet(core));
  registry = registryUseCases(core);
  manager = { kind: 'account', accountId: MATHILDE, fleetId, scopes: ['scopes:define'], groupValues: [], personShipId: null, throughShipId: null };
  unwrap(await registry.defineScope(manager, { scope: 'crm:read-leads', description: 'Read leads' }));
  core.state.events.length = 0;
});

describe("changing the description of one of the fleet's scopes (design gateway-scopes, 4.1)", () => {
  it('keeps the new description, under the same name', async () => {
    await expect(registry.describeScope(manager, { scope: 'crm:read-leads', description: 'Read leads in the CRM' })).resolves.toEqual({
      isOk: true,
      value: { scope: 'crm:read-leads', description: 'Read leads in the CRM' },
    });

    expect(core.state.definedScopes).toEqual([{ fleetId, scope: 'crm:read-leads', description: 'Read leads in the CRM' }]);
  });

  it('writes ScopeDescribed, caused by the actor, naming the scope and its new description', async () => {
    unwrap(await registry.describeScope(manager, { scope: 'crm:read-leads', description: 'Read leads in the CRM' }));

    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'ScopeDescribed',
        occurredAt: core.clock.now(),
        actor: { kind: 'account', accountId: MATHILDE, throughShipId: null },
        details: { scope: 'crm:read-leads', description: 'Read leads in the CRM' },
      }),
    ]);
  });

  it('writes nothing when the description is the one it has', async () => {
    unwrap(await registry.describeScope(manager, { scope: 'crm:read-leads', description: 'Read leads' }));

    expect(core.state.events).toEqual([]);
  });

  it('refuses a scope the fleet does not have, by name', async () => {
    expect(refusalOf(await registry.describeScope(manager, { scope: 'crm:write-leads', description: 'Write leads' }))).toEqual({
      kind: 'SCOPE_NOT_DEFINED',
      message: 'The fleet has no scope crm:write-leads',
    });
    expect(core.state.definedScopes).toEqual([{ fleetId, scope: 'crm:read-leads', description: 'Read leads' }]);
  });

  it.each([
    ['an empty description', ''],
    ['a description on two lines', 'Read leads\nin the CRM'],
    [`a description over ${String(SCOPE_DESCRIPTION_MAX_LENGTH)} characters`, 'd'.repeat(SCOPE_DESCRIPTION_MAX_LENGTH + 1)],
  ])('refuses %s, and keeps the description it had', async (_what, description) => {
    expect(refusalOf(await registry.describeScope(manager, { scope: 'crm:read-leads', description }))).toMatchObject({ kind: 'INVALID_SCOPE_DESCRIPTION' });
    expect(core.state.definedScopes).toEqual([{ fleetId, scope: 'crm:read-leads', description: 'Read leads' }]);
    expect(core.state.events).toEqual([]);
  });
});
