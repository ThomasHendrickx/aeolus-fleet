import { describe, expect, it } from 'vitest';

import { createInMemoryCore, type InMemoryTx } from '../../../test/support/in-memory.js';
import { DomainError } from '../shared/errors.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { createInitialiseFleet } from './initialise-fleet.js';

function setup(uowOverride?: (core: ReturnType<typeof createInMemoryCore>) => UnitOfWork<InMemoryTx>) {
  const core = createInMemoryCore('2026-09-29T12:00:00.000Z');
  const initialiseFleet = createInitialiseFleet({
    uow: uowOverride?.(core) ?? core.uow,
    clock: core.clock,
    ids: core.ids,
    secrets: { hasher: core.hasher, random: core.random },
  });
  return { core, initialiseFleet };
}

describe('initialise fleet', () => {
  it('creates the fleet and argo, of kind operator with every scope', async () => {
    const { core, initialiseFleet } = setup();

    const result = await initialiseFleet({ name: 'home fleet' });

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
        scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage'],
        note: null,
        createdAt: new Date('2026-09-29T12:00:00.000Z'),
        retiredAt: null,
      },
    ]);
  });

  it("returns argo's secret once and stores only its hash", async () => {
    const { core, initialiseFleet } = setup();

    const { secret, fleetId, operatorShipId } = await initialiseFleet({ name: 'home fleet' });

    expect(secret).toMatch(/^aeolus_sk_v1_./);
    expect(core.state.credentials).toEqual([
      expect.objectContaining({
        fleetId,
        shipId: operatorShipId,
        secretHash: core.hasher.hash(secret),
        claimedAt: null,
        invalidatedAt: null,
      }),
    ]);
    expect(JSON.stringify(core.state)).not.toContain(`"${secret}"`);
  });

  it('writes FleetInitialised and ShipCommissioned, caused by the system', async () => {
    const { core, initialiseFleet } = setup();

    const { fleetId, operatorShipId } = await initialiseFleet({ name: 'home fleet' });

    expect(core.state.events).toEqual([
      expect.objectContaining({
        fleetId,
        type: 'FleetInitialised',
        actor: { kind: 'system' },
        details: { name: 'home fleet' },
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
    await initialiseFleet({ name: 'home fleet' });
    const before = structuredClone(core.state);

    const second = initialiseFleet({ name: 'another fleet' });

    await expect(second).rejects.toThrow(DomainError);
    await expect(second).rejects.toMatchObject({ code: 'FLEET_ALREADY_EXISTS' });
    expect(core.state).toEqual(before);
  });

  it('trims the name', async () => {
    const { core, initialiseFleet } = setup();

    await initialiseFleet({ name: '  home fleet \n' });

    expect(core.state.fleets[0]?.name).toBe('home fleet');
  });

  it.each([
    ['an empty name', ''],
    ['a name of only spaces', '   '],
    ['a name over 100 characters', 'a'.repeat(101)],
  ])('refuses %s and creates nothing', async (_label, name) => {
    const { core, initialiseFleet } = setup();

    await expect(initialiseFleet({ name })).rejects.toMatchObject({ code: 'INVALID_FLEET_NAME' });
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
      consoleSessions: [],
      deliveries: [],
      events: [],
    });
  });
});
