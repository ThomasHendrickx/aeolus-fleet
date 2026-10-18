import { createIdGenerator, type FleetId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createReceiverWakeups } from '../src/adapters/prisma/receiver-wakeups.js';
import { createPrismaUnitOfWork, type PrismaTx } from '../src/adapters/prisma/unit-of-work.js';
import { createReportTurn } from '../src/domain/registry/report-turn.js';
import type { Caller, Crew } from '../src/domain/shared/caller.js';
import { createUseCases, systemClock, type UseCases } from '../src/wiring.js';
import { OPERATOR, operatorCaller, secretOf } from './support/core-fixtures.js';
import { createMigratedDatabase } from '../src/testing/database.js';
import { newKey } from '../src/testing/keys.js';
import { racingUnitOfWork } from './support/postgres-core.js';
import { unwrap } from '../src/testing/result.js';

// The turn on a real Postgres (decision 0040): what a turn report keeps with
// the lease, that two reports racing keep the newer turn, that one which fails
// midway stores nothing, and that a restart of the server keeps the turn.

const newId = createIdGenerator();
/** How long a receive waits on an empty inbox in these tests: short, so an empty receive costs little. */
const WAIT_MS = 500;

let databaseUrl: string;
let prisma: PrismaClient;
let useCases: UseCases;
let fleetId: FleetId;
let argo: Caller;
let scout: Crew;

beforeEach(async () => {
  databaseUrl = await createMigratedDatabase();
  prisma = createPrismaClient(databaseUrl);
  useCases = createUseCases({ prisma, clock: systemClock, wakeups: createReceiverWakeups(), receiveWaitMs: WAIT_MS });
  const fleet = unwrap(await useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR }));
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  const { shipId, secret } = unwrap(await useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
  const { crewToken } = unwrap(
    await useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }),
  );
  scout = unwrap(await useCases.authenticate.byCrewToken(crewToken));
});

afterEach(async () => {
  await prisma.$disconnect();
});

/** A moment `seconds` ago: when the hook saw the turn change. */
function secondsAgo(seconds: number): Date {
  return new Date(Date.now() - seconds * 1_000);
}

function storedLease() {
  return prisma.lease.findUniqueOrThrow({ where: { id: scout.leaseId } });
}

function turnEvents() {
  return prisma.event.findMany({ where: { fleetId, type: 'TurnReported' }, orderBy: { seq: 'asc' } });
}

describe('a turn report on Postgres', () => {
  it('keeps the turn with the lease at its own time, with TurnReported at that time', async () => {
    const at = secondsAgo(3);

    unwrap(await useCases.reportTurn(scout, { turn: 'busy', at }));

    await expect(storedLease()).resolves.toMatchObject({ turn: 'busy', turnAt: at });
    await expect(turnEvents()).resolves.toMatchObject([
      { shipId: scout.shipId, actorShipId: scout.shipId, occurredAt: at, details: { leaseId: scout.leaseId, turn: 'busy' } },
    ]);
  });
});

describe('two turn reports racing', () => {
  it('keep the newer turn, whichever lands first, and write no event for the older one after it', async () => {
    const busyAt = secondsAgo(20);
    const idleAt = secondsAgo(10);
    const racing = createReportTurn({
      uow: racingUnitOfWork({ prisma, transactions: 2 }, (tx, allArrived): PrismaTx => ({
        ...tx,
        events: {
          ...tx.events,
          append: async (event) => {
            await allArrived();
            await tx.events.append(event);
          },
        },
      })),
      clock: systemClock,
      ids: newId,
    });

    const answers = await Promise.all([racing(scout, { turn: 'busy', at: busyAt }), racing(scout, { turn: 'idle', at: idleAt })]);

    expect(answers.every((answer) => answer.isOk)).toBe(true);
    await expect(storedLease()).resolves.toMatchObject({ turn: 'idle', turnAt: idleAt });
    const events = await turnEvents();
    expect(events.at(-1)).toMatchObject({ occurredAt: idleAt, details: { turn: 'idle' } });
  });
});

describe('a turn report that fails midway', () => {
  it('stores nothing: no turn with the lease, and no TurnReported', async () => {
    const failing = createReportTurn({
      uow: {
        run: (work) =>
          createPrismaUnitOfWork(prisma).run((tx) =>
            work({
              ...tx,
              events: {
                ...tx.events,
                append: async (event) => {
                  await tx.events.append(event);
                  throw new Error('disk full');
                },
              },
            }),
          ),
      },
      clock: systemClock,
      ids: newId,
    });

    await expect(failing(scout, { turn: 'busy', at: secondsAgo(1) })).rejects.toThrow('disk full');

    await expect(storedLease()).resolves.toMatchObject({ turn: null, turnAt: null });
    await expect(turnEvents()).resolves.toEqual([]);
  });
});

describe('a restart of the server', () => {
  it('keeps the turn: a late report older than it changes nothing', async () => {
    const at = secondsAgo(5);
    unwrap(await useCases.reportTurn(scout, { turn: 'idle', at }));

    const restarted = createPrismaClient(databaseUrl);
    try {
      const afterRestart = createUseCases({ prisma: restarted, clock: systemClock, wakeups: createReceiverWakeups(), receiveWaitMs: WAIT_MS });

      unwrap(await afterRestart.reportTurn(scout, { turn: 'busy', at: secondsAgo(60) }));

      await expect(storedLease()).resolves.toMatchObject({ turn: 'idle', turnAt: at });
      await expect(turnEvents()).resolves.toHaveLength(1);
    } finally {
      await restarted.$disconnect();
    }
  });
});
