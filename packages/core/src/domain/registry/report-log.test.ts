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
  core = createInMemoryCore('2026-10-06T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  useCases = registryUseCases(core);
  ({ shipId: scoutId } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  scout = crewAboard(core, { fleetId, shipId: scoutId });
  core.clock.advance(60_000);
});

async function nextCrew(): Promise<Crew> {
  unwrap(await useCases.releaseShip(argo, { shipId: scoutId }));
  core.clock.advance(60_000);
  return crewAboard(core, { fleetId, shipId: scoutId });
}

describe("a crew's report log", () => {
  it('holds none before the crew reports, and no previous crew for the first', async () => {
    await expect(useCases.reportLog(scout)).resolves.toEqual({ isOk: true, value: { report: null, previousCrew: null } });
  });

  it("holds the crew's own report whole, details included", async () => {
    unwrap(await useCases.report(scout, { state: 'working', note: '4 of 6 running', details: { running: 4 } }));

    await expect(useCases.reportLog(scout)).resolves.toEqual({
      isOk: true,
      value: {
        report: { state: 'working', note: '4 of 6 running', reportedAt: core.clock.now(), details: { running: 4 }, detailsVersion: 1 },
        previousCrew: null,
      },
    });
  });

  it("gives a new crew the previous crew's last report, while its own is none", async () => {
    const reportedAt = core.clock.now();
    unwrap(await useCases.report(scout, { state: 'blocked', note: 'waiting for review', details: { pr: 89 } }));

    const next = await nextCrew();

    await expect(useCases.reportLog(next)).resolves.toEqual({
      isOk: true,
      value: {
        report: null,
        previousCrew: { state: 'blocked', note: 'waiting for review', reportedAt, details: { pr: 89 }, detailsVersion: 1 },
      },
    });
  });

  it('gives only the previous crew, none when that crew never reported', async () => {
    unwrap(await useCases.report(scout, { state: 'working' }));
    await nextCrew();

    const third = await nextCrew();

    await expect(useCases.reportLog(third)).resolves.toMatchObject({ value: { previousCrew: null } });
  });

  it("never lets a crew change the previous crew's report", async () => {
    unwrap(await useCases.report(scout, { state: 'blocked', details: { pr: 89 } }));
    const next = await nextCrew();

    unwrap(await useCases.report(next, { state: 'working', detailsPatch: { pr: 90 } }));

    await expect(useCases.reportLog(next)).resolves.toMatchObject({
      value: { report: { details: { pr: 90 } }, previousCrew: { state: 'blocked', details: { pr: 89 } } },
    });
  });

  it('is refused once the crew has left', async () => {
    unwrap(await useCases.releaseShip(argo, { shipId: scoutId }));

    await expect(useCases.reportLog(scout)).resolves.toMatchObject({ isOk: false, error: { kind: 'LEASE_ENDED' } });
  });
});
