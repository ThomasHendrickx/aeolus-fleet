import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { unwrap } from '../../../test/support/result.js';
import type { Caller, Crew } from '../shared/caller.js';
import { newKey } from '../../../test/support/keys.js';

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
  ({ shipId: scoutId } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  scout = crewAboard(core, { fleetId, shipId: scoutId });
  core.clock.advance(60_000);
  core.state.events.length = 0;
});

function storedReport() {
  return core.state.leaseReports.find((held) => held.leaseId === scout.leaseId)?.report;
}

async function listedReport() {
  return (await useCases.listFleet(argo)).find((ship) => ship.id === scoutId)?.report;
}

describe("a crew's report", () => {
  it('is none before the crew reports', async () => {
    await expect(listedReport()).resolves.toBeNull();
  });

  it('holds the state, the note and when it was reported, shown with the ship', async () => {
    await expect(useCases.report(scout, { state: 'working', note: 'on PR 89' })).resolves.toEqual({ isOk: true, value: undefined });

    await expect(listedReport()).resolves.toEqual({ state: 'working', note: 'on PR 89', reportedAt: core.clock.now(), detailsVersion: 0 });
  });

  it('is listed with the version of its details, never the details', async () => {
    unwrap(await useCases.report(scout, { state: 'working', details: { running: 4 } }));

    await expect(listedReport()).resolves.toEqual({ state: 'working', note: null, reportedAt: core.clock.now(), detailsVersion: 1 });
  });

  it('is read whole, details included, with the one ship', async () => {
    unwrap(await useCases.report(scout, { state: 'working', details: { running: 4 } }));

    await expect(useCases.getShip(argo, { shipId: scoutId })).resolves.toMatchObject({
      value: { report: { state: 'working', note: null, reportedAt: core.clock.now(), detailsVersion: 1, details: { running: 4 } } },
    });
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
        details: { leaseId: scout.leaseId, state: 'blocked', note: 'waiting for review', detailsVersion: 0 },
      }),
    ]);
  });

  it('only moves when it was reported for the same state and note: a check-in writes no event', async () => {
    unwrap(await useCases.report(scout, { state: 'working', note: 'on PR 89' }));
    core.state.events.length = 0;
    core.clock.advance(300_000);

    unwrap(await useCases.report(scout, { state: 'working', note: 'on PR 89' }));

    expect(core.state.events).toEqual([]);
    await expect(listedReport()).resolves.toEqual({ state: 'working', note: 'on PR 89', reportedAt: core.clock.now(), detailsVersion: 0 });
  });

  it('writes ShipReported again when the note changes', async () => {
    unwrap(await useCases.report(scout, { state: 'working', note: 'on PR 89' }));
    core.state.events.length = 0;

    unwrap(await useCases.report(scout, { state: 'working', note: 'on PR 90' }));

    expect(core.state.events.map((event) => event.details)).toEqual([
      { leaseId: scout.leaseId, state: 'working', note: 'on PR 90', detailsVersion: 0 },
    ]);
  });

  it('belongs to the crew: a new crew of the ship starts with none', async () => {
    unwrap(await useCases.report(scout, { state: 'working' }));
    unwrap(await useCases.releaseShip(argo, { shipId: scoutId }));

    crewAboard(core, { fleetId, shipId: scoutId });

    await expect(listedReport()).resolves.toBeNull();
  });
});

describe("a report's details", () => {
  const running = { 'shp_01': { state: 'running' }, 'shp_02': { state: 'crashed' } };

  it('holds none, at version 0, when the crew reports without them', async () => {
    unwrap(await useCases.report(scout, { state: 'working' }));

    expect(storedReport()).toMatchObject({ details: null, detailsVersion: 0 });
  });

  it('sets the details whole and moves their version, written with ShipReported', async () => {
    unwrap(await useCases.report(scout, { state: 'working', note: '1 of 2 running', details: running }));

    expect(storedReport()).toMatchObject({ details: running, detailsVersion: 1 });
    expect(core.state.events.map((event) => event.details)).toEqual([
      { leaseId: scout.leaseId, state: 'working', note: '1 of 2 running', detailsVersion: 1 },
    ]);
  });

  it('keeps the details when a report leaves them out', async () => {
    unwrap(await useCases.report(scout, { state: 'working', details: running }));

    unwrap(await useCases.report(scout, { state: 'blocked' }));

    expect(storedReport()).toMatchObject({ state: 'blocked', details: running, detailsVersion: 1 });
  });

  it('replaces the details whole', async () => {
    unwrap(await useCases.report(scout, { state: 'working', details: running }));

    unwrap(await useCases.report(scout, { state: 'working', details: { caps: { max: 6 } } }));

    expect(storedReport()).toMatchObject({ details: { caps: { max: 6 } }, detailsVersion: 2 });
  });

  it('clears the details with null, moving their version', async () => {
    unwrap(await useCases.report(scout, { state: 'working', details: running }));

    unwrap(await useCases.report(scout, { state: 'working', details: null }));

    expect(storedReport()).toMatchObject({ details: null, detailsVersion: 2 });
  });

  it('applies a merge patch: objects merge per key, null deletes a key, arrays are replaced whole', async () => {
    unwrap(await useCases.report(scout, { state: 'working', details: { ...running, kept: ['a', 'b'] } }));

    unwrap(await useCases.report(scout, { state: 'working', detailsPatch: { 'shp_01': { state: 'stopped' }, 'shp_02': null, kept: ['c'] } }));

    expect(storedReport()).toMatchObject({ details: { 'shp_01': { state: 'stopped' }, kept: ['c'] }, detailsVersion: 2 });
  });

  it('applies a merge patch to no details as to an empty object', async () => {
    unwrap(await useCases.report(scout, { state: 'working', detailsPatch: { 'shp_01': { state: 'running' }, gone: null } }));

    expect(storedReport()).toMatchObject({ details: { 'shp_01': { state: 'running' } }, detailsVersion: 1 });
  });

  it('clears the details with a merge patch of null', async () => {
    unwrap(await useCases.report(scout, { state: 'working', details: running }));

    unwrap(await useCases.report(scout, { state: 'working', detailsPatch: null }));

    expect(storedReport()).toMatchObject({ details: null, detailsVersion: 2 });
  });

  it('writes ShipReported when only the details change', async () => {
    unwrap(await useCases.report(scout, { state: 'working', details: running }));
    core.state.events.length = 0;

    unwrap(await useCases.report(scout, { state: 'working', detailsPatch: { 'shp_02': { state: 'running' } } }));

    expect(core.state.events.map((event) => event.details)).toEqual([{ leaseId: scout.leaseId, state: 'working', note: null, detailsVersion: 2 }]);
  });

  it('is a check-in when the details stay the same, whatever the order of their keys: no event, the same version', async () => {
    unwrap(await useCases.report(scout, { state: 'working', details: { a: 1, b: 2 } }));
    core.state.events.length = 0;
    core.clock.advance(60_000);

    unwrap(await useCases.report(scout, { state: 'working', details: { b: 2, a: 1 } }));
    unwrap(await useCases.report(scout, { state: 'working', detailsPatch: { a: 1 } }));

    expect(core.state.events).toEqual([]);
    expect(storedReport()).toMatchObject({ detailsVersion: 1, reportedAt: core.clock.now() });
  });

  it('takes details of exactly 16 KB', async () => {
    const details = { x: 'x'.repeat(16 * 1024 - '{"x":""}'.length) };

    unwrap(await useCases.report(scout, { state: 'working', details }));

    expect(storedReport()).toMatchObject({ details });
  });
});

describe('a report refused', () => {
  async function expectRefused(input: Parameters<typeof useCases.report>[1], kind: string): Promise<void> {
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

  it('refuses details over 16 KB, naming their size, the limit and the decision', async () => {
    const details = { x: 'x'.repeat(16 * 1024 - '{"x":""}'.length + 1) };

    await expect(useCases.report(scout, { state: 'working', details })).resolves.toEqual({
      isOk: false,
      error: { kind: 'REPORT_DETAILS_TOO_LARGE', message: 'details is 16385 bytes, the limit is 16384 (decision 0028)' },
    });
  });

  it('refuses details over 16 KB and stores nothing', async () => {
    await expectRefused({ state: 'working', details: { x: 'x'.repeat(16 * 1024) } }, 'REPORT_DETAILS_TOO_LARGE');
  });

  it('refuses a merge patch whose result is over 16 KB, and stores nothing', async () => {
    unwrap(await useCases.report(scout, { state: 'working', details: { a: 'x'.repeat(10_000) } }));

    await expectRefused({ state: 'working', detailsPatch: { b: 'x'.repeat(10_000) } }, 'REPORT_DETAILS_TOO_LARGE');
  });

  it('refuses details and a merge patch together', async () => {
    await expectRefused({ state: 'working', details: {}, detailsPatch: {} }, 'INVALID_REPORT_DETAILS');
  });

  it('refuses a crew whose ship was released', async () => {
    unwrap(await useCases.releaseShip(argo, { shipId: scoutId }));

    await expectRefused({ state: 'working' }, 'LEASE_ENDED');
  });
});
