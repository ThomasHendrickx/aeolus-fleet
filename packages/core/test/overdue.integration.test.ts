import { createIdGenerator, type DeliveryId, type FleetId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../src/adapters/prisma/client.js';
import { createApp } from '../src/app.js';
import { createPrismaPushedCrews } from '../src/adapters/prisma/overdue.js';
import { createPrismaFleetRepository } from '../src/adapters/prisma/registry.js';
import { createPrismaUnitOfWork, type PrismaTx } from '../src/adapters/prisma/unit-of-work.js';
import { createTellOverdueDeliveries } from '../src/domain/messaging/tell-overdue-deliveries.js';
import type { Caller, Crew } from '../src/domain/shared/caller.js';
import type { UnitOfWork } from '../src/domain/shared/unit-of-work.js';
import { createUseCases, type UseCases } from '../src/wiring.js';
import { OPERATOR, operatorCaller, secretOf } from './support/core-fixtures.js';
import { newKey } from './support/keys.js';
import { createPostgresCore, racingUnitOfWork, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from './support/result.js';

// The 10 and 60 minute clocks on a real Postgres (decision 0040), on a test
// clock: argo is told at the time, not before, and once, also when two passes
// race and after a restart of core; a pass that fails midway stores nothing,
// and a delivery confirmed after it was judged is not told.

const MINUTE = 60_000;
const newId = createIdGenerator();
/** How often the running server passes in these tests: often, so it tells soon. */
const PASS_MS = 50;

let core: PostgresCore;
let useCases: UseCases;
let fleetId: FleetId;
let argo: Caller;
let scout: Crew;

beforeEach(async () => {
  core = await createPostgresCore();
  ({ useCases } = core);
  const fleet = unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR }));
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  const { shipId, secret } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
  const { crewToken } = unwrap(await useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }));
  scout = unwrap(await useCases.authenticate.byCrewToken(crewToken));
});

afterEach(async () => {
  await core.close();
});

/** A message to the scout, push received by its computer side and handed as number 1, not confirmed. */
async function handed(): Promise<DeliveryId> {
  unwrap(
    await useCases.sendMessage(argo, {
      selector: { kind: 'ship', shipId: scout.shipId },
      payload: 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/25',
      contentType: 'text/plain',
      idempotencyKey: newKey(),
    }),
  );
  const [received] = unwrap(await useCases.pushReceiveDeliveries(scout, {})).deliveries;
  if (!received) {
    throw new Error('The push receive took nothing');
  }
  unwrap(await useCases.handOverDelivery(scout, { deliveryId: received.deliveryId, handOverNumber: 1 }));
  return received.deliveryId;
}

/** The clocks of the server under test, with its unit of work replaced. */
function clocksWith(uow: UnitOfWork<PrismaTx>) {
  return createTellOverdueDeliveries({
    fleets: createPrismaFleetRepository(core.prisma),
    pushedCrews: createPrismaPushedCrews(core.prisma),
    uow,
    clock: core.clock,
    ids: newId,
  });
}

function overdueEvents() {
  return core.prisma.event.findMany({ where: { fleetId, type: 'DeliveryOverdue' }, orderBy: { seq: 'asc' } });
}

function overdueRows() {
  return core.prisma.overdueDelivery.findMany({ where: { fleetId } });
}

describe('the clocks on Postgres', () => {
  it('tell argo once a handed delivery is not confirmed for 10 minutes, not before, and once', async () => {
    const deliveryId = await handed();

    core.clock.advance(10 * MINUTE - 1);
    await useCases.tellOverdueDeliveries();
    await expect(overdueEvents()).resolves.toEqual([]);

    core.clock.advance(1);
    await useCases.tellOverdueDeliveries();
    core.clock.advance(MINUTE);
    await useCases.tellOverdueDeliveries();

    await expect(overdueEvents()).resolves.toMatchObject([
      {
        shipId: scout.shipId,
        actorShipId: null,
        deliveryId,
        occurredAt: new Date(core.clock.now().getTime() - MINUTE),
        details: { leaseId: scout.leaseId, clock: 'notConfirmed', minutes: 10 },
      },
    ]);
    await expect(overdueRows()).resolves.toMatchObject([{ shipId: scout.shipId, leaseId: scout.leaseId, deliveryId, state: 'handed', clock: 'notConfirmed' }]);
  });

  it('tell argo of a delivery to the ship type waiting 60 minutes while the session is busy, not at 10', async () => {
    unwrap(await useCases.pushReceiveDeliveries(scout, {}));
    unwrap(await useCases.reportTurn(scout, { turn: 'busy', at: core.clock.now() }));
    unwrap(
      await useCases.sendMessage(argo, {
        selector: { kind: 'type', type: 'reviewer' },
        payload: 'Anyone free to review?',
        contentType: 'text/plain',
        idempotencyKey: newKey(),
      }),
    );

    core.clock.advance(60 * MINUTE - 1);
    await useCases.tellOverdueDeliveries();
    await expect(overdueEvents()).resolves.toEqual([]);

    core.clock.advance(1);
    await useCases.tellOverdueDeliveries();
    await expect(overdueEvents()).resolves.toMatchObject([{ shipId: scout.shipId, details: { leaseId: scout.leaseId, clock: 'busy', minutes: 60 } }]);
  });

  it('count a delivery from the state it is in now: received again on the next lease, after it was handed and returned', async () => {
    const deliveryId = await handed();
    core.clock.advance(30 * MINUTE);
    unwrap(await useCases.releaseShip(argo, { shipId: scout.shipId }));
    const { secret } = unwrap(await useCases.getStartingPrompt(argo, { shipId: scout.shipId }));
    const { crewToken } = unwrap(await useCases.claimShip({ shipId: scout.shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }));
    const next = unwrap(await useCases.authenticate.byCrewToken(crewToken));
    unwrap(await useCases.pushReceiveDeliveries(next, {}));
    unwrap(await useCases.reportTurn(next, { turn: 'busy', at: core.clock.now() }));

    core.clock.advance(60 * MINUTE - 1);
    await useCases.tellOverdueDeliveries();
    await expect(overdueEvents()).resolves.toEqual([]);

    core.clock.advance(1);
    await useCases.tellOverdueDeliveries();
    await expect(overdueEvents()).resolves.toMatchObject([{ deliveryId, details: { leaseId: next.leaseId, clock: 'busy' } }]);
  });
});

describe('a restart of core', () => {
  it('tells nothing again: what argo was told is kept in Postgres', async () => {
    await handed();
    core.clock.advance(10 * MINUTE);
    await useCases.tellOverdueDeliveries();

    const restarted = createPrismaClient(core.databaseUrl);
    try {
      const afterRestart = createUseCases({ prisma: restarted, clock: core.clock });
      core.clock.advance(MINUTE);
      await afterRestart.tellOverdueDeliveries();
    } finally {
      await restarted.$disconnect();
    }

    await expect(overdueEvents()).resolves.toHaveLength(1);
    await expect(overdueRows()).resolves.toHaveLength(1);
  });
});

describe('two passes racing', () => {
  it('tell argo once: one row and one DeliveryOverdue', async () => {
    await handed();
    core.clock.advance(10 * MINUTE);
    const racing = clocksWith(
      racingUnitOfWork({ prisma: core.prisma, transactions: 2 }, (tx, allArrived): PrismaTx => ({
        ...tx,
        overdueDeliveries: {
          tell: async (overdue, at) => {
            await allArrived();
            return tx.overdueDeliveries.tell(overdue, at);
          },
        },
      })),
    );

    await Promise.all([racing(), racing()]);

    await expect(overdueEvents()).resolves.toHaveLength(1);
    await expect(overdueRows()).resolves.toHaveLength(1);
  });
});

describe('a pass that fails midway', () => {
  it('stores nothing, so the next pass tells argo', async () => {
    await handed();
    core.clock.advance(10 * MINUTE);
    const failing = clocksWith({
      run: (work) =>
        createPrismaUnitOfWork(core.prisma).run((tx) =>
          work({
            ...tx,
            events: {
              append: async (event) => {
                await tx.events.append(event);
                throw new Error('disk full');
              },
            },
          }),
        ),
    });

    await expect(failing()).rejects.toThrow('disk full');
    await expect(overdueEvents()).resolves.toEqual([]);
    await expect(overdueRows()).resolves.toEqual([]);

    await useCases.tellOverdueDeliveries();
    await expect(overdueEvents()).resolves.toHaveLength(1);
  });
});

describe('a delivery confirmed after the pass judged it', () => {
  it('is not told: the tell stores only while the delivery is still in the state it was judged in', async () => {
    const deliveryId = await handed();
    core.clock.advance(10 * MINUTE);
    const confirmedMeanwhile = clocksWith({
      run: (work) =>
        createPrismaUnitOfWork(core.prisma).run((tx) =>
          work({
            ...tx,
            overdueDeliveries: {
              tell: async (overdue, at) => {
                unwrap(await useCases.acknowledgeDelivery(scout, { deliveryId }));
                return tx.overdueDeliveries.tell(overdue, at);
              },
            },
          }),
        ),
    });

    await confirmedMeanwhile();

    await expect(overdueEvents()).resolves.toEqual([]);
    await expect(overdueRows()).resolves.toEqual([]);
  });
});

describe('the running server', () => {
  it('runs the clocks by itself, pass after pass, until it closes', async () => {
    const deliveryId = await handed();
    const server = createApp({ databaseUrl: core.databaseUrl, publicUrl: 'http://localhost:3000', clock: core.clock, logger: false, overduePassMs: PASS_MS });
    try {
      core.clock.advance(10 * MINUTE);
      await expect.poll(overdueEvents, { timeout: 5_000 }).toMatchObject([{ deliveryId }]);
    } finally {
      await server.close();
    }
  });
});
