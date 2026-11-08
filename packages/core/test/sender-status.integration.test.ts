import { createIdGenerator, idSchema, type DeliveryId, type MessageId, type ShipStatus } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaUnitOfWork, type PrismaTx } from '../src/adapters/prisma/unit-of-work.js';
import { DATA_KEY_CACHE_MS } from '../src/domain/messaging/data-keys.js';
import { createReadRecord } from '../src/domain/messaging/read-record.js';
import { createReceiveDeliveries } from '../src/domain/messaging/receive-deliveries.js';
import { createRetireShip } from '../src/domain/registry/retire-ship.js';
import { sha256Hasher } from '../src/adapters/crypto/secrets.js';
import type { Crew, ShipCaller } from '../src/domain/shared/caller.js';
import type { UnitOfWork } from '../src/domain/shared/unit-of-work.js';
import { createUseCases } from '../src/wiring.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { createInMemoryKeyVault } from './support/in-memory-key-vault.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createPostgresCore, heldUnitOfWork, racingUnitOfWork, type PostgresCore } from './support/postgres-core.js';
import { unsealedFleetsOnly } from './support/sealing.js';

// The sender's status on every delivery read, on a real Postgres (#1714, the
// retired sender design, section 7): derived from the sender's row and its
// open lease when the delivery is read, never stored, never a filter. A
// retirement racing a pickup changes no delivery and takes no lock a receive
// waits for; a pruned remnant keeps its status; a sealed receive that cannot
// get its key still claims nothing.

const newId = createIdGenerator();
const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 30;
const MODEL = 'claude-opus-5-5';

let core: PostgresCore;
let argo: ShipCaller;
let scout: Crew;

beforeEach(async () => {
  core = await createPostgresCore();
  await aFleet();
});

afterEach(async () => {
  await core.close();
});

async function aFleet(): Promise<void> {
  argo = operatorCaller(unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' }))));
  scout = await crewed('scout', 'reviewer');
}

async function crewed(name: string, type: string): Promise<Crew> {
  const { shipId, secret } = unwrap(await core.useCases.commissionShip(argo, { name, type, idempotencyKey: newKey() }));
  const { crewToken } = unwrap(await core.useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }));
  return unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
}

/** The sender's crew sends scout a plain message; its message and delivery ids. */
async function sendScout(sender: ShipCaller, payload = 'PR #1497 is open'): Promise<{ messageId: MessageId; deliveryId: DeliveryId }> {
  core.clock.advance(1_000);
  const { messageId } = unwrap(
    await core.useCases.sendMessage(sender, {
      selector: { kind: 'ship', shipId: scout.shipId },
      payload,
      idempotencyKey: newKey(),
      ...(sender.shipId === argo.shipId ? {} : { model: MODEL }),
    }),
  );
  const { id } = await core.prisma.delivery.findFirstOrThrow({ where: { messageId } });
  return { messageId, deliveryId: idSchema('delivery').parse(id) };
}

function stored(deliveryId: DeliveryId) {
  return core.prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId }, select: { state: true, attempts: true, claimedByShipId: true, claimedByLeaseId: true } });
}

function statusesOf(deliveries: readonly { deliveryId: DeliveryId; senderStatus: ShipStatus }[]): Record<string, ShipStatus> {
  return Object.fromEntries(deliveries.map(({ deliveryId, senderStatus }) => [deliveryId, senderStatus]));
}

describe("the sender's status on Postgres", () => {
  it('names each sender as it is now on receive, delivery and record: argo and a crewed ship crewed, a released one awaiting crew, a retired one retired', async () => {
    // Given scout got a message from argo, from the harbour (crewed), the mooring (since released) and the tender (since retired).
    const [harbour, mooring, tender] = [await crewed('harbour', 'builder'), await crewed('mooring', 'builder'), await crewed('tender', 'builder')];
    const fromArgo = await sendScout(argo);
    const fromHarbour = await sendScout(harbour);
    const fromMooring = await sendScout(mooring);
    const fromTender = await sendScout(tender);
    unwrap(await core.useCases.releaseShip(argo, { shipId: mooring.shipId }));
    unwrap(await core.useCases.retireShip(argo, { shipId: tender.shipId }));
    const expected = {
      [fromArgo.deliveryId]: 'crewed',
      [fromHarbour.deliveryId]: 'crewed',
      [fromMooring.deliveryId]: 'awaitingCrew',
      [fromTender.deliveryId]: 'retired',
    };

    // When scout receives them all, acknowledges the tender's, reads it again and reads its record.
    const { deliveries } = unwrap(await core.useCases.receiveDeliveries(scout, { max: 10 }));
    unwrap(await core.useCases.acknowledgeDelivery(scout, { deliveryId: fromTender.deliveryId }));
    const reread = unwrap(await core.useCases.readDelivery(scout, { deliveryId: fromTender.deliveryId }));
    const record = unwrap(await core.useCases.readRecord(scout, {}));

    // Then each read names each sender's status now, and the tender's delivery went on as any other.
    expect(statusesOf(deliveries)).toEqual(expected);
    expect(reread).toMatchObject({ deliveryId: fromTender.deliveryId, senderShipId: tender.shipId, senderName: 'tender', senderStatus: 'retired', state: 'acknowledged' });
    expect(statusesOf(record.items)).toEqual(expected);
  });

  it('reads the sender afresh at each read, and changes no delivery to do so', async () => {
    // Given scout received the harbour's message while the harbour was crewed.
    const harbour = await crewed('harbour', 'builder');
    const { deliveryId } = await sendScout(harbour);
    const first = unwrap(await core.useCases.pushReceiveDeliveries(scout, {}));
    const before = await stored(deliveryId);

    // When the harbour's crew is released, and later the harbour retires, scout's push receive returning it after each.
    unwrap(await core.useCases.releaseShip(argo, { shipId: harbour.shipId }));
    const afterRelease = unwrap(await core.useCases.pushReceiveDeliveries(scout, {}));
    unwrap(await core.useCases.retireShip(argo, { shipId: harbour.shipId }));
    const afterRetire = unwrap(await core.useCases.pushReceiveDeliveries(scout, {}));

    // Then each names the harbour's status at that read, and the delivery row stayed as it was.
    expect([first, afterRelease, afterRetire].map(({ deliveries }) => deliveries.map((delivery) => delivery.senderStatus))).toEqual([['crewed'], ['awaitingCrew'], ['retired']]);
    expect(await stored(deliveryId)).toEqual(before);
  });
});

describe('a retirement racing a pickup on Postgres', () => {
  it('a retire that commits while a receive holds its claim: the receive hands the delivery once, naming the sender retired, and the retire leaves it handed', async () => {
    // Given the tender sent scout a message, and scout's receive holds the claim it took.
    const tender = await crewed('tender', 'builder');
    const { deliveryId } = await sendScout(tender);
    const retiring = Promise.withResolvers<undefined>();
    const { uow, reached } = heldUnitOfWork(core.prisma, (tx, hold) => ({
      ...tx,
      deliveries: {
        ...tx.deliveries,
        findClaimableForUpdate: async (query) => {
          const claimable = await tx.deliveries.findClaimableForUpdate(query);
          await hold(retiring.promise);
          return claimable;
        },
      },
    }));
    const receiving = createReceiveDeliveries({ sealing: unsealedFleetsOnly, uow, clock: core.clock, ids: newId, wakeups: noWakeups, waitMs: 0 })(scout, {});
    await reached;

    // When the tender retires meanwhile, and the receive goes on.
    unwrap(await core.useCases.retireShip(argo, { shipId: tender.shipId }));
    retiring.resolve(undefined);
    const received = unwrap(await receiving);

    // Then the delivery was handed once, to scout, naming the tender retired; the retire did not change it.
    expect(received.deliveries).toEqual([expect.objectContaining({ deliveryId, senderShipId: tender.shipId, senderStatus: 'retired' })]);
    expect(await stored(deliveryId)).toEqual({ state: 'handed', attempts: 1, claimedByShipId: scout.shipId, claimedByLeaseId: scout.leaseId });
  });

  it('a retire still open while a receive reads the sender: the receive waits for no lock, names the sender crewed, and the next read names it retired', async () => {
    // Given the tender sent scout a message, and the tender's retire holds its transaction open once it marked the ship retired.
    const tender = await crewed('tender', 'builder');
    const { deliveryId } = await sendScout(tender);
    const receivedFirst = Promise.withResolvers<undefined>();
    const { uow, reached } = heldUnitOfWork(core.prisma, (tx, hold) => ({
      ...tx,
      ships: {
        ...tx.ships,
        retire: async (change) => {
          await tx.ships.retire(change);
          await hold(receivedFirst.promise);
        },
      },
    }));
    const retiring = createRetireShip({ uow, clock: core.clock, ids: newId, hasher: sha256Hasher, sealing: unsealedFleetsOnly })(argo, { shipId: tender.shipId });
    await reached;

    // When scout receives meanwhile, and again once the retire committed.
    const first = unwrap(await core.useCases.receiveDeliveries(scout, {}));
    receivedFirst.resolve(undefined);
    unwrap(await retiring);
    const again = unwrap(await core.useCases.receiveDeliveries(scout, {}));

    // Then the first read saw the tender as it was committed, the second as retired; one delivery, handed twice to the same crew.
    expect(first.deliveries).toEqual([expect.objectContaining({ deliveryId, senderStatus: 'crewed' })]);
    expect(again.deliveries).toEqual([expect.objectContaining({ deliveryId, senderStatus: 'retired' })]);
    expect(await stored(deliveryId)).toEqual({ state: 'handed', attempts: 2, claimedByShipId: scout.shipId, claimedByLeaseId: scout.leaseId });
  });

  it('concurrent receivers of a type while its sender retires never share a delivery, and every delivery is handed once', async () => {
    // Given the tender sent four messages to the reviewers, and the lookout crews a second reviewer.
    const tender = await crewed('tender', 'builder');
    const lookout = await crewed('lookout', 'reviewer');
    const sent: DeliveryId[] = [];
    for (let count = 0; count < 4; count += 1) {
      core.clock.advance(1_000);
      const { messageId } = unwrap(await core.useCases.sendMessage(tender, { selector: { kind: 'type', type: 'reviewer' }, payload: `Review PR #${count}`, model: MODEL, idempotencyKey: newKey() }));
      sent.push(idSchema('delivery').parse((await core.prisma.delivery.findFirstOrThrow({ where: { messageId } })).id));
    }
    const racing = createReceiveDeliveries({
      sealing: unsealedFleetsOnly,
      uow: racingUnitOfWork({ prisma: core.prisma, transactions: 2 }, (tx, allArrived) => ({
        ...tx,
        deliveries: {
          ...tx.deliveries,
          findClaimableForUpdate: async (query) => {
            const claimable = await tx.deliveries.findClaimableForUpdate(query);
            await allArrived();
            return claimable;
          },
        },
      })),
      clock: core.clock,
      ids: newId,
      wakeups: noWakeups,
      waitMs: 0,
    });

    // When scout and the lookout receive two each at once, while the tender retires.
    const [byScout, byLookout] = await Promise.all([racing(scout, { max: 2 }), racing(lookout, { max: 2 }), core.useCases.retireShip(argo, { shipId: tender.shipId }).then(unwrap)]);

    // Then each delivery went to one crew, once, naming the tender as that read found it; none was abandoned.
    const handedOut = [...unwrap(byScout).deliveries, ...unwrap(byLookout).deliveries];
    expect(handedOut.map((delivery) => delivery.deliveryId).sort()).toEqual([...sent].sort());
    expect(handedOut.every((delivery) => delivery.senderStatus === 'crewed' || delivery.senderStatus === 'retired')).toBe(true);
    await expect(core.prisma.delivery.count({ where: { id: { in: sent }, state: 'handed', attempts: 1 } })).resolves.toBe(4);
  });

  it('a receiving side that restarts gets its received delivery again, unchanged, naming the sender as it is now', async () => {
    // Given scout's computer side received the tender's message, then the tender retired, then the server restarted.
    const tender = await crewed('tender', 'builder');
    const { deliveryId, messageId } = await sendScout(tender);
    unwrap(await core.useCases.pushReceiveDeliveries(scout, {}));
    unwrap(await core.useCases.retireShip(argo, { shipId: tender.shipId }));
    const restarted = createPrismaClient(core.databaseUrl);
    const afterRestart = createUseCases({ prisma: restarted, clock: core.clock });

    // When the restarted side pushes a receive again.
    const again = unwrap(await afterRestart.pushReceiveDeliveries(scout, {}));
    await restarted.$disconnect();

    // Then the same delivery comes back, still received with no attempt counted, naming the tender retired.
    expect(again.deliveries).toEqual([expect.objectContaining({ deliveryId, messageId, state: 'received', attempts: 0, senderStatus: 'retired' })]);
  });
});

describe('a retired sender pruned to a remnant on Postgres', () => {
  it('keeps its id and its retired status on the delivery it sent, still open, after another ship takes its name', async () => {
    // Given a 30 day retention; the tender sent scout a message and retired; 31 days on the pass made it a remnant; a new ship is called tender.
    await core.prisma.$executeRaw`UPDATE fleets SET retention_set = true, retention_days = ${RETENTION_DAYS} WHERE id = ${argo.fleetId}`;
    const tender = await crewed('tender', 'builder');
    const { deliveryId } = await sendScout(tender);
    unwrap(await core.useCases.retireShip(argo, { shipId: tender.shipId }));
    core.clock.advance((RETENTION_DAYS + 1) * DAY_MS);
    await core.useCases.closeHealthSnapshots();
    await core.useCases.pruneHistory();
    const { shipId: newTenderId } = unwrap(await core.useCases.commissionShip(argo, { name: 'tender', type: 'builder', idempotencyKey: newKey() }));

    // When scout receives the delivery and reads its record.
    const { deliveries } = unwrap(await core.useCases.receiveDeliveries(scout, {}));
    const record = unwrap(await core.useCases.readRecord(scout, {}));

    // Then the tender is a remnant, and the delivery and the record name the original tender, retired.
    const { removedAt } = await core.prisma.ship.findUniqueOrThrow({ where: { id: tender.shipId }, select: { removedAt: true } });
    expect(removedAt).not.toBeNull();
    expect(newTenderId).not.toBe(tender.shipId);
    const named = { deliveryId, senderShipId: tender.shipId, senderName: 'tender', senderType: 'builder', senderStatus: 'retired' };
    expect(deliveries).toEqual([expect.objectContaining(named)]);
    expect(record.items).toEqual([expect.objectContaining({ ...named, state: 'handed' })]);
  });
});

describe("a record page's senders on Postgres", () => {
  it('are read in one ships read and one leases read, however many entries each sender sent', async () => {
    // Given scout got twelve messages from the harbour, six from the mooring and two from argo.
    const [harbour, mooring] = [await crewed('harbour', 'builder'), await crewed('mooring', 'builder')];
    for (let count = 0; count < 12; count += 1) {
      await sendScout(harbour);
    }
    for (let count = 0; count < 6; count += 1) {
      await sendScout(mooring);
    }
    await sendScout(argo);
    await sendScout(argo);
    const reads = { ships: 0, leases: 0 };
    const counting: UnitOfWork<PrismaTx> = {
      run: (work) =>
        createPrismaUnitOfWork(core.prisma).run((tx) =>
          work({
            ...tx,
            ships: { ...tx.ships, findMany: (...args) => ((reads.ships += 1), tx.ships.findMany(...args)) },
            leases: { ...tx.leases, findCrewed: (...args) => ((reads.leases += 1), tx.leases.findCrewed(...args)) },
          }),
        ),
    };

    // When scout reads a page of twenty.
    const page = unwrap(await createReadRecord({ uow: counting, sealing: unsealedFleetsOnly })(scout, { limit: 20 }));

    // Then all twenty name their sender's status, read in one of each.
    expect(page.items).toHaveLength(20);
    expect(page.items.every((entry) => entry.senderStatus === 'crewed')).toBe(true);
    expect(reads).toEqual({ ships: 1, leases: 1 });
  });
});

describe('a sealed fleet on Postgres (decision 0068)', () => {
  it('a receive whose key is cut off claims nothing; once the key is back the same message comes, naming the sender as it is then', async () => {
    // Given a sealed fleet whose company key the company then disabled, after the tender sent scout a message.
    await core.close();
    const world = createInMemoryKeyVault();
    core = await createPostgresCore({ keyVault: world.vault });
    await aFleet();
    const companyKey = await world.aCompanyKey();
    await world.bindToFleet(companyKey, argo.fleetId);
    unwrap(await core.useCases.turnOnSealing(argo, { companyKey }));
    const tender = await crewed('tender', 'builder');
    const { deliveryId, messageId } = await sendScout(tender, 'Sign in to Slack');
    await world.disable(companyKey);
    core.clock.advance(DATA_KEY_CACHE_MS);

    // When scout receives, then reads its record; the tender retires, the key comes back, and scout receives again.
    const refused = await core.useCases.receiveDeliveries(scout, {});
    const pushRefused = await core.useCases.pushReceiveDeliveries(scout, {});
    const deliveryAfterRefusal = await stored(deliveryId);
    const claimEvents = await core.prisma.event.count({ where: { deliveryId, type: { in: ['DeliveryHanded', 'DeliveryReceived'] } } });
    const unreadable = unwrap(await core.useCases.readRecord(scout, {}));
    unwrap(await core.useCases.retireShip(argo, { shipId: tender.shipId }));
    await world.enable(companyKey);
    core.clock.advance(DATA_KEY_CACHE_MS);
    const { deliveries } = unwrap(await core.useCases.receiveDeliveries(scout, {}));
    unwrap(await core.useCases.acknowledgeDelivery(scout, { deliveryId }));
    await world.disable(companyKey);
    core.clock.advance(DATA_KEY_CACHE_MS);
    const rereadRefused = await core.useCases.readDelivery(scout, { deliveryId });

    // Then the cut-off receives committed no claim, attempt or event; the record named the tender with its payload unreadable;
    // the later receive handed the same message, opened, naming the tender retired; a reread without the key is refused as before.
    expect([refused, pushRefused]).toMatchObject([{ isOk: false, error: { kind: 'KEY_UNAVAILABLE' } }, { isOk: false, error: { kind: 'KEY_UNAVAILABLE' } }]);
    expect(deliveryAfterRefusal).toEqual({ state: 'pending', attempts: 0, claimedByShipId: null, claimedByLeaseId: null });
    expect(claimEvents).toBe(0);
    expect(unreadable.items).toEqual([expect.objectContaining({ deliveryId, senderShipId: tender.shipId, senderStatus: 'crewed', payload: { kind: 'unreadable' } })]);
    expect(deliveries).toEqual([expect.objectContaining({ deliveryId, messageId, payload: 'Sign in to Slack', senderStatus: 'retired' })]);
    expect(rereadRefused).toMatchObject({ isOk: false, error: { kind: 'KEY_UNAVAILABLE' } });
  });
});

/** Wake-ups for a receive that never waits: these tests hand it deliveries already there. */
const noWakeups = {
  watch: () => ({ next: () => Promise.resolve('timedOut' as const), stop: () => undefined }),
};
