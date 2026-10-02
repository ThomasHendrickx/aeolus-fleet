import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller, Crew } from '../shared/caller.js';

let core: InMemoryCore;
let useCases: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argo: Caller;
let scoutId: ShipId;
let scout: Crew;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-02T19:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  useCases = registryUseCases(core);
  ({ shipId: scoutId } = unwrap(await useCases.commissionShip(argo, { name: 'scout', type: 'reviewer' })));
  scout = crewAboard(core, { fleetId, shipId: scoutId });
  core.clock.advance(60_000);
  core.state.events.length = 0;
});

async function listedReport() {
  return (await useCases.listFleet(argo)).find((ship) => ship.id === scoutId)?.report;
}

describe("a crew's report", () => {
  it('is none before the crew reports', async () => {
    await expect(listedReport()).resolves.toBeNull();
  });

  it('holds the state, the note and when it was reported, shown with the ship', async () => {
    await expect(useCases.report(scout, { state: 'working', note: 'on PR 89' })).resolves.toEqual({ isOk: true, value: undefined });

    await expect(listedReport()).resolves.toEqual({ state: 'working', note: 'on PR 89', reportedAt: core.clock.now() });
  });

  it('holds no note when none is given, and trims one that is', async () => {
    unwrap(await useCases.report(scout, { state: 'idle' }));
    await expect(listedReport()).resolves.toMatchObject({ note: null });

    unwrap(await useCases.report(scout, { state: 'idle', note: '  between tasks  ' }));
    await expect(listedReport()).resolves.toMatchObject({ note: 'between tasks' });
  });

  it('writes ShipReported, caused by the ship, with its state and note', async () => {
    unwrap(await useCases.report(scout, { state: 'blocked', note: 'waiting for review' }));

    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'ShipReported',
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: scoutId },
        shipId: scoutId,
        details: { leaseId: scout.leaseId, state: 'blocked', note: 'waiting for review' },
      }),
    ]);
  });

  it('only moves when it was reported for the same state and note: a check-in writes no event', async () => {
    unwrap(await useCases.report(scout, { state: 'working', note: 'on PR 89' }));
    core.state.events.length = 0;
    core.clock.advance(300_000);

    unwrap(await useCases.report(scout, { state: 'working', note: 'on PR 89' }));

    expect(core.state.events).toEqual([]);
    await expect(listedReport()).resolves.toEqual({ state: 'working', note: 'on PR 89', reportedAt: core.clock.now() });
  });

  it('writes ShipReported again when the note changes', async () => {
    unwrap(await useCases.report(scout, { state: 'working', note: 'on PR 89' }));
    core.state.events.length = 0;

    unwrap(await useCases.report(scout, { state: 'working', note: 'on PR 90' }));

    expect(core.state.events.map((event) => event.details)).toEqual([
      { leaseId: scout.leaseId, state: 'working', note: 'on PR 90' },
    ]);
  });

  it('belongs to the crew: a new crew of the ship starts with none', async () => {
    unwrap(await useCases.report(scout, { state: 'working' }));
    unwrap(await useCases.releaseShip(argo, { shipId: scoutId }));

    crewAboard(core, { fleetId, shipId: scoutId });

    await expect(listedReport()).resolves.toBeNull();
  });
});

describe('a report refused', () => {
  async function expectRefused(input: { state: string; note?: string }, kind: string): Promise<void> {
    const before = structuredClone(core.state);

    await expect(useCases.report(scout, input)).resolves.toMatchObject({ isOk: false, error: { kind } });

    expect(core.state).toEqual(before);
  }

  it('refuses a state that is not working, blocked or idle', async () => {
    await expectRefused({ state: 'sleeping' }, 'INVALID_REPORT_STATE');
  });

  it('refuses a note over 200 characters', async () => {
    await expectRefused({ state: 'working', note: 'x'.repeat(201) }, 'INVALID_REPORT_NOTE');
  });

  it('refuses a note over one line', async () => {
    await expectRefused({ state: 'working', note: 'on PR 89\nthen PR 90' }, 'INVALID_REPORT_NOTE');
  });

  it('refuses a crew whose ship was released', async () => {
    unwrap(await useCases.releaseShip(argo, { shipId: scoutId }));

    await expectRefused({ state: 'working' }, 'LEASE_ENDED');
  });
});
