import type { FleetId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaBulkUnitOfWork, type PrismaTx } from '../src/adapters/prisma/unit-of-work.js';
import { createPrismaFleetRepository } from '../src/adapters/prisma/registry.js';
import { createRemoveDeletedFleets } from '../src/domain/registry/remove-deleted-fleets.js';
import type { Crew, ShipCaller } from '../src/domain/shared/caller.js';
import type { UnitOfWork } from '../src/domain/shared/unit-of-work.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';

// A deleted fleet's removal on a real Postgres (decision 0020): the delete marks
// the fleet and it reads as gone at once; the removal pass takes its history
// away in batches, and a pass that failed at its first batch, part way or just
// before its last step is taken up again until the fleet is gone.

const MODEL = 'claude-opus-5-5';

let core: PostgresCore;
let argo: ShipCaller;
let fleetId: FleetId;

async function crewed(name: string): Promise<Crew> {
  const { shipId, secret } = unwrap(await core.useCases.commissionShip(argo, { name, kind: 'agent', type: 'scout', idempotencyKey: newKey() }));
  const { crewToken } = unwrap(await core.useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'CLOUD' }, harness: 'claude-code' }));
  return unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
}

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' }))));
  ({ fleetId } = argo);
  const lookout = await crewed('lookout');
  const scout = await crewed('scout');
  // A chain of answers, so the messages name each other, and a schedule that names one.
  let previous = unwrap(await core.useCases.sendMessage(scout, { selector: { kind: 'ship', shipId: lookout.shipId }, payload: 'one', contentType: 'text/plain', idempotencyKey: newKey(), model: MODEL })).messageId;
  for (const payload of ['two', 'three', 'four', 'five']) {
    previous = unwrap(await core.useCases.sendMessage(scout, { selector: { kind: 'ship', shipId: lookout.shipId }, payload, contentType: 'text/plain', idempotencyKey: newKey(), model: MODEL, inReplyTo: previous })).messageId;
  }
  unwrap(
    await core.useCases.scheduleMessage(scout, {
      selector: { kind: 'ship', shipId: lookout.shipId },
      payload: 'Check in',
      model: MODEL,
      idempotencyKey: newKey(),
      timing: { kind: 'once', at: new Date('2026-09-29T13:00:00.000Z') },
      inReplyTo: previous,
    }),
  );
  unwrap(await core.useCases.deleteFleet({ requestId: 'delete-home-fleet', fleetId }));
});

afterEach(async () => {
  await core.close();
});

const rowsOfFleet = async (): Promise<number> => {
  const [row] = await core.prisma.$queryRaw<{ rows: number }[]>`
    SELECT (SELECT count(*) FROM fleets WHERE id = ${fleetId}) + (SELECT count(*) FROM messages WHERE fleet_id = ${fleetId}) + (SELECT count(*) FROM deliveries WHERE fleet_id = ${fleetId})
      + (SELECT count(*) FROM events WHERE fleet_id = ${fleetId}) + (SELECT count(*) FROM ships WHERE fleet_id = ${fleetId}) + (SELECT count(*) FROM schedules WHERE fleet_id = ${fleetId}) AS rows`;
  return Number(row?.rows);
};

type Step = 'removeHistoryBatch' | 'removeRest';
/** The bulk unit of work, with the `at`th call of `step` failing as the database going away would. */
function failing(step: Step, at: number): UnitOfWork<PrismaTx> {
  const bulk = createPrismaBulkUnitOfWork(core.prisma);
  let calls = 0;
  const fails = (name: Step) => name === step && (calls += 1) === at;
  return {
    run: (work) =>
      bulk.run((tx) =>
        work({
          ...tx,
          fleetRemoval: {
            ...tx.fleetRemoval,
            removeHistoryBatch: async (...args) => {
              const batch = await tx.fleetRemoval.removeHistoryBatch(...args);
              if (fails('removeHistoryBatch')) {
                throw new Error('the database went away');
              }
              return batch;
            },
            removeRest: (...args) => {
              if (fails('removeRest')) {
                throw new Error('the database went away');
              }
              return tx.fleetRemoval.removeRest(...args);
            },
          },
        }),
      ),
  };
}

describe('a deleted fleet', () => {
  it('reads as gone at once, with its history still there for the removal pass', async () => {
    expect(await createPrismaFleetRepository(core.prisma).find(fleetId)).toBeUndefined();
    expect(await createPrismaFleetRepository(core.prisma).count()).toBe(0);
    expect(await core.prisma.operator.count({ where: { fleetId } })).toBe(0);
    expect(await core.prisma.credential.count({ where: { fleetId } })).toBe(0);
    expect(await rowsOfFleet()).toBeGreaterThan(0);
  });

  it('is removed whole by the pass, in batches', async () => {
    await core.useCases.removeDeletedFleets();

    expect(await rowsOfFleet()).toBe(0);
    expect(await core.prisma.installationRequest.count({ where: { fleetId } })).toBe(0);
  });
});

describe('a removal that fails, then is taken up again', () => {
  it.each([
    { when: 'at its first batch', step: 'removeHistoryBatch', at: 1 },
    { when: 'part way', step: 'removeHistoryBatch', at: 4 },
    { when: 'just before its last step', step: 'removeRest', at: 1 },
  ] as const)('ends with the fleet gone when it fails $when', async ({ step, at }) => {
    const failures: unknown[] = [];

    await createRemoveDeletedFleets({ fleets: createPrismaFleetRepository(core.prisma), uow: failing(step, at), clock: core.clock, batch: 2 })((_fleetId, error) => failures.push(error));

    expect(failures).toHaveLength(1);
    // The failed batch rolled back whole: the fleet is still marked and has rows.
    expect(await rowsOfFleet()).toBeGreaterThan(0);
    expect(await core.prisma.fleet.count({ where: { id: fleetId, deletedAt: { not: null } } })).toBe(1);

    // The next pass, or a restarted server's: it starts from what is left.
    await core.useCases.removeDeletedFleets();

    expect(await rowsOfFleet()).toBe(0);
  });
});
