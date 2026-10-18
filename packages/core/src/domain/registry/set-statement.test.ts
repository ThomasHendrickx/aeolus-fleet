import type { FleetId, ShipId, Statement } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, initialiseFleet, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../../test/support/keys.js';
import { refusalOf, unwrap } from '../../../test/support/result.js';
import type { Caller, Crew } from '../shared/caller.js';

let core: InMemoryCore;
let registry: ReturnType<typeof registryUseCases>;
let fleetId: FleetId;
let argo: Caller;
let reviewerId: ShipId;
let reviewer: Crew;

const REVIEWS: Statement = {
  summary: 'Reviews pull requests of aeolus-fleet.',
  capabilities: [{ name: 'review_pr', description: 'Reviews a pull request', inputModes: ['text/plain'], outputModes: ['text/markdown'] }],
};

beforeEach(async () => {
  core = createInMemoryCore('2026-10-18T09:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  registry = registryUseCases(core);
  ({ shipId: reviewerId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'reviewer', type: 'reviewer' })));
  reviewer = crewAboard(core, { fleetId, shipId: reviewerId });
  core.state.events.length = 0;
});

async function discoveredReviewer() {
  return unwrap(await registry.discover(argo)).ships.find((ship) => ship.id === reviewerId)?.statement;
}

describe("a crew's statement (decision 0047)", () => {
  it('is kept with the lease at version 1, and read with the ship', async () => {
    expect(unwrap(await registry.setStatement(reviewer, REVIEWS))).toEqual({ version: 1 });

    await expect(discoveredReviewer()).resolves.toEqual({ by: 'crew', version: 1, ...REVIEWS });
  });

  it('writes StatementSet with the lease, the version and how many capabilities, never the statement', async () => {
    unwrap(await registry.setStatement(reviewer, REVIEWS));

    expect(core.state.events).toEqual([
      expect.objectContaining({
        type: 'StatementSet',
        shipId: reviewerId,
        occurredAt: core.clock.now(),
        actor: { kind: 'ship', shipId: reviewerId },
        details: { leaseId: reviewer.leaseId, version: 1, capabilities: 1 },
      }),
    ]);
  });

  it('changes nothing when the same statement is stated again: no version, no event', async () => {
    unwrap(await registry.setStatement(reviewer, REVIEWS));
    core.state.events.length = 0;

    expect(unwrap(await registry.setStatement(reviewer, { capabilities: REVIEWS.capabilities, summary: REVIEWS.summary }))).toEqual({ version: 1 });
    expect(core.state.events).toEqual([]);
  });

  it('is replaced whole by a new one, at the next version', async () => {
    unwrap(await registry.setStatement(reviewer, REVIEWS));
    const plans: Statement = { summary: 'Plans slices.', capabilities: [] };

    expect(unwrap(await registry.setStatement(reviewer, plans))).toEqual({ version: 2 });
    await expect(discoveredReviewer()).resolves.toEqual({ by: 'crew', version: 2, ...plans });
  });

  it('is refused once the lease has ended', async () => {
    unwrap(await registry.releaseShip(argo, { shipId: reviewerId }));

    expect(refusalOf(await registry.setStatement(reviewer, REVIEWS))).toMatchObject({ kind: 'LEASE_ENDED' });
  });

  it('goes with the lease: once released, the ship shows no statement of its crew, and its next crew starts with none', async () => {
    unwrap(await registry.setStatement(reviewer, REVIEWS));
    unwrap(await registry.releaseShip(argo, { shipId: reviewerId }));

    await expect(discoveredReviewer()).resolves.toBeNull();
    crewAboard(core, { fleetId, shipId: reviewerId });
    await expect(discoveredReviewer()).resolves.toBeNull();
  });
});
