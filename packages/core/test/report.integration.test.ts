import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Caller, Crew } from '../src/domain/shared/caller.js';
import { OPERATOR, operatorCaller, secretOf } from './support/core-fixtures.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from './support/result.js';
import { newKey } from './support/keys.js';

// A crew's report on a real Postgres: stored with its lease, shown with the
// ship, an event only when it changes, and none for the ship's next crew.

let core: PostgresCore;
let argo: Caller;
let scout: Crew;

async function crewed(shipId: Crew['shipId'], secret: string): Promise<Crew> {
  const { crewToken } = unwrap(await core.useCases.claimShip({ shipId, secret, location: { kind: 'DEVICE' }, harness: 'claude-code' }));
  return unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
}

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await core.useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
  const { shipId, secret } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
  scout = await crewed(shipId, secretOf(secret));
  core.clock.advance(60_000);
});

afterEach(async () => {
  await core.close();
});

async function listedReport() {
  return (await core.useCases.listFleet(argo)).find((ship) => ship.id === scout.shipId)?.report;
}

async function reportEvents(): Promise<number> {
  return core.prisma.event.count({ where: { type: 'ShipReported', shipId: scout.shipId } });
}

describe("a crew's report on Postgres", () => {
  it('is stored with its lease and shown with the ship, with one event while it stays the same', async () => {
    unwrap(await core.useCases.report(scout, { state: 'working', note: 'on PR 89' }));
    core.clock.advance(300_000);

    unwrap(await core.useCases.report(scout, { state: 'working', note: 'on PR 89' }));

    await expect(listedReport()).resolves.toEqual({ state: 'working', note: 'on PR 89', reportedAt: core.clock.now(), detailsVersion: 0 });
    await expect(reportEvents()).resolves.toBe(1);
    await expect(core.useCases.getShip(argo, { shipId: scout.shipId })).resolves.toMatchObject({
      isOk: true,
      value: { report: { state: 'working', note: 'on PR 89' } },
    });
  });

  it('stores its details as JSON with their version, merge-patched in place', async () => {
    unwrap(await core.useCases.report(scout, { state: 'working', details: { 'shp_01': { state: 'running' }, kept: ['a'] } }));

    unwrap(await core.useCases.report(scout, { state: 'working', detailsPatch: { 'shp_02': { state: 'crashed' }, kept: null } }));

    const lease = await core.prisma.lease.findFirstOrThrow({ where: { id: scout.leaseId } });
    expect({ details: lease.reportDetails, version: lease.reportDetailsVersion }).toEqual({
      details: { 'shp_01': { state: 'running' }, 'shp_02': { state: 'crashed' } },
      version: 2,
    });
    await expect(reportEvents()).resolves.toBe(2);
    await expect(core.useCases.getShip(argo, { shipId: scout.shipId })).resolves.toMatchObject({
      value: { report: { detailsVersion: 2, details: { 'shp_01': { state: 'running' }, 'shp_02': { state: 'crashed' } } } },
    });
    await expect(listedReport()).resolves.toEqual({ state: 'working', note: null, reportedAt: core.clock.now(), detailsVersion: 2 });
  });

  it('clears its details to none with null', async () => {
    unwrap(await core.useCases.report(scout, { state: 'working', details: { running: 4 } }));

    unwrap(await core.useCases.report(scout, { state: 'working', details: null }));

    const lease = await core.prisma.lease.findFirstOrThrow({ where: { id: scout.leaseId } });
    expect({ details: lease.reportDetails, version: lease.reportDetailsVersion }).toEqual({ details: null, version: 2 });
  });

  it("gives the ship's next crew the previous crew's last report in its log, and the crew its own", async () => {
    unwrap(await core.useCases.report(scout, { state: 'blocked', note: 'waiting for review', details: { pr: 89 } }));
    unwrap(await core.useCases.releaseShip(argo, { shipId: scout.shipId }));
    const { secret } = unwrap(await core.useCases.getStartingPrompt(argo, { shipId: scout.shipId }));
    const next = await crewed(scout.shipId, secret);
    core.clock.advance(60_000);
    unwrap(await core.useCases.report(next, { state: 'working', details: { pr: 90 } }));

    await expect(core.useCases.reportLog(next)).resolves.toMatchObject({
      isOk: true,
      value: {
        report: { state: 'working', details: { pr: 90 }, detailsVersion: 1 },
        previousCrew: { state: 'blocked', note: 'waiting for review', details: { pr: 89 }, detailsVersion: 1 },
      },
    });
  });

  it("is none for the ship's next crew", async () => {
    unwrap(await core.useCases.report(scout, { state: 'blocked' }));
    unwrap(await core.useCases.releaseShip(argo, { shipId: scout.shipId }));
    const { secret } = unwrap(await core.useCases.getStartingPrompt(argo, { shipId: scout.shipId }));

    await crewed(scout.shipId, secret);

    await expect(listedReport()).resolves.toBeNull();
  });
});
