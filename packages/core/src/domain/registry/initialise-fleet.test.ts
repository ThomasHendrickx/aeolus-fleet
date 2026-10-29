import { describe, expect, it } from 'vitest';

import { createInMemoryCore, type InMemoryTx } from '../../../test/support/in-memory.js';
import { unwrap } from '../../testing/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { createInitialiseFleet } from './initialise-fleet.js';

function setup(uowOverride?: (core: ReturnType<typeof createInMemoryCore>) => UnitOfWork<InMemoryTx>) {
  const core = createInMemoryCore('2026-09-29T12:00:00.000Z');
  const initialiseFleet = createInitialiseFleet({
    uow: uowOverride?.(core) ?? core.uow,
    clock: core.clock,
    ids: core.ids,
  });
  return { core, initialiseFleet };
}

describe('initialise fleet', () => {
  it('creates the fleet and argo, of kind operator with every scope', async () => {
    const { core, initialiseFleet } = setup();

    const result = unwrap(await initialiseFleet({ name: 'home fleet' }));

    expect(core.state.fleets).toEqual([
      { id: result.fleetId, name: 'home fleet', createdAt: new Date('2026-09-29T12:00:00.000Z') },
    ]);
    expect(core.state.ships).toEqual([
      {
        id: result.operatorShipId,
        fleetId: result.fleetId,
        name: 'argo',
        type: 'operator',
        kind: 'operator',
        scopes: ['messages:send', 'messages:receive', 'messages:force', 'messages:resend', 'fleet:read', 'fleet:commission', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'fleet:network', 'fleet:on-behalf', 'fleet:person', 'fleet:owner', 'fleet:explain', 'fleet:connect', 'labels:any', 'fleet:verify', 'scopes:declare', 'scopes:grant', 'scopes:define', 'meetings:open', 'fleet:keys'],
        note: null,
        createdAt: new Date('2026-09-29T12:00:00.000Z'),
        retiredAt: null,
        commission: null,
        owner: null,
      },
    ]);
  });

  it('creates the operator account with no email and no password: argo signs in with a link from the terminal', async () => {
    const { core, initialiseFleet } = setup();

    const { fleetId, operatorId } = unwrap(await initialiseFleet({ name: 'home fleet' }));

    expect(core.state.operatorAccounts).toEqual([
      { id: operatorId, fleetId, email: null, passwordHash: null, theme: 'system', createdAt: new Date('2026-09-29T12:00:00.000Z') },
    ]);
    expect(operatorId).toMatch(/^opr_/);
  });

  it('gives argo no secret: the operator account is the only way to crew it', async () => {
    const { core, initialiseFleet } = setup();

    const initialised = unwrap(await initialiseFleet({ name: 'home fleet' }));

    expect(core.state.credentials).toEqual([]);
    expect(initialised).not.toHaveProperty('secret');
  });

  it('writes FleetInitialised, naming the operator account, and ShipCommissioned, caused by the system', async () => {
    const { core, initialiseFleet } = setup();

    const { fleetId, operatorShipId, operatorId } = unwrap(await initialiseFleet({ name: 'home fleet' }));

    expect(core.state.events).toEqual([
      expect.objectContaining({
        fleetId,
        type: 'FleetInitialised',
        actor: { kind: 'system' },
        details: { name: 'home fleet', operatorId },
      }),
      expect.objectContaining({
        fleetId,
        type: 'ShipCommissioned',
        actor: { kind: 'system' },
        shipId: operatorShipId,
        details: { name: 'argo', type: 'operator', kind: 'operator' },
      }),
    ]);
    expect(core.state.events.map((event) => event.id)).toEqual([
      expect.stringMatching(/^evt_/),
      expect.stringMatching(/^evt_/),
    ]);
  });

  it('refuses a second run and changes nothing', async () => {
    const { core, initialiseFleet } = setup();
    unwrap(await initialiseFleet({ name: 'home fleet' }));
    const before = structuredClone(core.state);

    const second = await initialiseFleet({ name: 'another fleet' });

    expect(second).toEqual({
      isOk: false,
      error: { kind: 'FLEET_ALREADY_EXISTS', message: 'A fleet already exists: a fleet is initialised only once' },
    });
    expect(core.state).toEqual(before);
  });

  it('trims the name', async () => {
    const { core, initialiseFleet } = setup();

    unwrap(await initialiseFleet({ name: '  home fleet \n' }));

    expect(core.state.fleets[0]?.name).toBe('home fleet');
  });

  it.each([
    ['an empty name', ''],
    ['a name of only spaces', '   '],
    ['a name over 100 characters', 'a'.repeat(101)],
  ])('refuses %s and creates nothing', async (_label, name) => {
    const { core, initialiseFleet } = setup();

    await expect(initialiseFleet({ name })).resolves.toEqual({
      isOk: false,
      error: {
        kind: 'INVALID_FLEET_NAME',
        message: 'A fleet name is 1 to 100 characters, not counting spaces around it',
      },
    });
    expect(core.state.fleets).toEqual([]);
  });

  it('leaves nothing behind when a write in the transaction fails', async () => {
    const { core, initialiseFleet } = setup((inner) => ({
      run: (work) =>
        inner.uow.run((tx) =>
          work({ ...tx, events: { append: () => Promise.reject(new Error('event log unavailable')) } }),
        ),
    }));

    await expect(initialiseFleet({ name: 'home fleet' })).rejects.toThrow('event log unavailable');
    expect(core.state).toEqual({
      fleets: [],
      ships: [],
      leases: [],
      credentials: [],
      operatorAccounts: [],
      consoleSessions: [],
      signInTickets: [],
      messages: [],
      deliveries: [],
      meetings: [],
      schedules: [],
      scheduleNotices: [],
      deliveryReads: [],
      leaseSeen: [],
      pushedLeases: [],
      leaseReports: [],
      leaseStatements: [],
      leaseTurns: [],
      crewRequests: [],
      clearRequests: [],
      labels: [],
      shipLabels: [],
      networkSettings: [],
      declaredNetworkRules: [],
      networkRulesDrafts: [],
      scopeNamespaces: [],
      definedScopes: [],
      verifiedFacts: [],
      reachRefusals: [],
      events: [],
      overdueDeliveries: [],
      installationRequests: [],
      installationSettings: [],
      fleetLimitSettings: [],
      notices: [],
      installationNotices: [],
      noticeDismissals: [],
      installationGuide: null,
      guideProgress: [],
      healthSnapshots: [],
      healthSnapshotLocks: [],
      fleetPrunes: [],
      historyPruneLocks: [],
      lockedMessages: [],
      prunedEventSeqs: [],
      fleetSealings: [],
      dataKeys: [],
    });
  });
});
