import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Caller, Crew } from '../src/core/shared/caller.js';
import { OPERATOR, operatorCaller, secretIn } from './support/core-fixtures.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from './support/result.js';
import { newKey } from './support/keys.js';

// A crew's report on a real Postgres: stored with its lease, shown with the
// ship, an event only when it changes, and none for the ship's next crew.

let core: PostgresCore;
let argo: Caller;
let scout: Crew;

async function crewed(shipId: Crew['shipId'], prompt: string): Promise<Crew> {
  const { crewToken } = unwrap(await core.useCases.claimShip({ shipId, secret: secretIn(prompt), location: { kind: 'DEVICE' }, harness: 'claude-code' }));
  return unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
}

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await core.useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
  const { shipId, prompt } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
  scout = await crewed(shipId, prompt ?? '');
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

    await expect(listedReport()).resolves.toEqual({ state: 'working', note: 'on PR 89', reportedAt: core.clock.now() });
    await expect(reportEvents()).resolves.toBe(1);
    await expect(core.useCases.getShip(argo, { shipId: scout.shipId })).resolves.toMatchObject({
      isOk: true,
      value: { report: { state: 'working', note: 'on PR 89' } },
    });
  });

  it("is none for the ship's next crew", async () => {
    unwrap(await core.useCases.report(scout, { state: 'blocked' }));
    unwrap(await core.useCases.releaseShip(argo, { shipId: scout.shipId }));
    const { prompt } = unwrap(await core.useCases.getStartingPrompt(argo, { shipId: scout.shipId }));

    await crewed(scout.shipId, prompt);

    await expect(listedReport()).resolves.toBeNull();
  });
});
