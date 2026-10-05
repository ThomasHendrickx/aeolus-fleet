import { describe, expect, it } from 'vitest';

import { createInMemoryCore, type InMemoryTx } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { createInitialiseFleet } from './initialise-fleet.js';

const PASSWORD = 'correct horse battery staple';
const operator = { email: 'thomas@example.com', password: PASSWORD };

function setup(uowOverride?: (core: ReturnType<typeof createInMemoryCore>) => UnitOfWork<InMemoryTx>) {
  const core = createInMemoryCore('2026-09-29T12:00:00.000Z');
  const initialiseFleet = createInitialiseFleet({
    uow: uowOverride?.(core) ?? core.uow,
    clock: core.clock,
    ids: core.ids,
    passwords: core.passwords,
  });
  return { core, initialiseFleet };
}

describe('initialise fleet', () => {
  it('creates the fleet and argo, of kind operator with every scope', async () => {
    const { core, initialiseFleet } = setup();

    const result = unwrap(await initialiseFleet({ name: 'home fleet', ...operator }));

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
        scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage', 'fleet:crew'],
        note: null,
        createdAt: new Date('2026-09-29T12:00:00.000Z'),
        retiredAt: null,
        commission: null,
      },
    ]);
  });

  it('creates the operator account with the email and only the hash of the password', async () => {
    const { core, initialiseFleet } = setup();

    const { fleetId, operatorId } = unwrap(await initialiseFleet({ name: 'home fleet', ...operator }));

    expect(core.state.operatorAccounts).toEqual([
      {
        id: operatorId,
        fleetId,
        email: 'thomas@example.com',
        passwordHash: await core.passwords.hash(PASSWORD),
        theme: 'system',
        createdAt: new Date('2026-09-29T12:00:00.000Z'),
      },
    ]);
    expect(operatorId).toMatch(/^opr_/);
    expect(JSON.stringify(core.state)).not.toContain(`"${PASSWORD}"`);
  });

  it('stores the email trimmed and in lowercase, the form sign-in finds it in', async () => {
    const { core, initialiseFleet } = setup();

    unwrap(await initialiseFleet({ name: 'home fleet', email: ' Thomas@Example.COM ', password: PASSWORD }));

    expect(core.state.operatorAccounts[0]?.email).toBe('thomas@example.com');
  });

  it.each([
    { label: 'an email that is not an address', input: { email: 'thomas', password: PASSWORD }, kind: 'INVALID_EMAIL' },
    { label: 'an empty password', input: { email: 'thomas@example.com', password: '' }, kind: 'INVALID_PASSWORD' },
  ])('refuses $label and creates nothing', async ({ input, kind }) => {
    const { core, initialiseFleet } = setup();

    await expect(initialiseFleet({ name: 'home fleet', ...input })).resolves.toMatchObject({
      isOk: false,
      error: { kind },
    });
    expect(core.state.fleets).toEqual([]);
    expect(core.state.operatorAccounts).toEqual([]);
  });

  it('gives argo no secret: the operator account is the only way to crew it', async () => {
    const { core, initialiseFleet } = setup();

    const initialised = unwrap(await initialiseFleet({ name: 'home fleet', ...operator }));

    expect(core.state.credentials).toEqual([]);
    expect(initialised).not.toHaveProperty('secret');
  });

  it('writes FleetInitialised, naming the operator account, and ShipCommissioned, caused by the system', async () => {
    const { core, initialiseFleet } = setup();

    const { fleetId, operatorShipId, operatorId } = unwrap(await initialiseFleet({ name: 'home fleet', ...operator }));

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
    unwrap(await initialiseFleet({ name: 'home fleet', ...operator }));
    const before = structuredClone(core.state);

    const second = await initialiseFleet({ name: 'another fleet', ...operator });

    expect(second).toEqual({
      isOk: false,
      error: { kind: 'FLEET_ALREADY_EXISTS', message: 'A fleet already exists: a fleet is initialised only once' },
    });
    expect(core.state).toEqual(before);
  });

  it('trims the name', async () => {
    const { core, initialiseFleet } = setup();

    unwrap(await initialiseFleet({ name: '  home fleet \n', ...operator }));

    expect(core.state.fleets[0]?.name).toBe('home fleet');
  });

  it.each([
    ['an empty name', ''],
    ['a name of only spaces', '   '],
    ['a name over 100 characters', 'a'.repeat(101)],
  ])('refuses %s and creates nothing', async (_label, name) => {
    const { core, initialiseFleet } = setup();

    await expect(initialiseFleet({ name, ...operator })).resolves.toEqual({
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

    await expect(initialiseFleet({ name: 'home fleet', ...operator })).rejects.toThrow('event log unavailable');
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
      deliveryReads: [],
      leaseSeen: [],
      leaseReports: [],
      events: [],
      installationRequests: [],
      installationSettings: [],
      fleetLimitSettings: [],
      notices: [],
      installationNotices: [],
      noticeDismissals: [],
      installationGuide: null,
      guideProgress: [],
    });
  });
});
