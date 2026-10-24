import { createIdGenerator, MEETING_ADDED_CONTENT_TYPE, type FleetId, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { listenForPendingDeliveries, type DeliveryListener } from '../src/adapters/prisma/delivery-notices.js';
import { createPrismaUnitOfWork, type PrismaTx } from '../src/adapters/prisma/unit-of-work.js';
import { createOpenMeeting, type MeetingToOpen } from '../src/domain/messaging/open-meeting.js';
import type { ShipCaller } from '../src/domain/shared/caller.js';
import type { DeliveryNotice } from '../src/domain/shared/notifier.js';
import type { UnitOfWork } from '../src/domain/shared/unit-of-work.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { agentCaller, operatorCaller } from './support/core-fixtures.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createPostgresCore, racingUnitOfWork, type PostgresCore } from './support/postgres-core.js';

// Meetings on a real Postgres through the Prisma adapters (decision 0061):
// what an open stores, the label selection resolved in SQL, one meeting for
// concurrent opens with one key, and that an open failing halfway stores
// nothing and wakes nobody.

const newId = createIdGenerator();
const MODEL = 'claude-opus-5-5';

let core: PostgresCore;
let fleetId: FleetId;
let argo: ShipCaller;
let chief: ShipCaller;
let marketingId: ShipId;
let productId: ShipId;
let listener: DeliveryListener;
let notices: DeliveryNotice[];

async function commissioned(name: string, type: string): Promise<ShipId> {
  return unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name, type })).shipId;
}

function aMeeting(overrides: Partial<MeetingToOpen> = {}): MeetingToOpen {
  return { ships: [{ shipId: marketingId }, { name: 'product' }], idempotencyKey: newKey(), model: MODEL, ...overrides };
}

function openMeetingWith(uow: UnitOfWork<PrismaTx>) {
  return createOpenMeeting({ uow, clock: core.clock, ids: newId, hasher: sha256Hasher });
}

/** The Prisma unit of work with a step of the open wrapped: `wrap` gets the transaction's ports and returns them with that step changed. */
function unitOfWorkWith(wrap: (tx: PrismaTx) => PrismaTx): UnitOfWork<PrismaTx> {
  const uow = createPrismaUnitOfWork(core.prisma);
  return { run: (work) => uow.run((tx) => work(wrap(tx))) };
}

async function storedCounts() {
  return {
    meetings: await core.prisma.meeting.count(),
    participants: await core.prisma.meetingParticipant.count(),
    messages: await core.prisma.message.count(),
    deliveries: await core.prisma.delivery.count(),
    events: await core.prisma.event.count({ where: { type: { in: ['MeetingOpened', 'ParticipantAdded', 'MessageAccepted'] } } }),
  };
}

beforeEach(async () => {
  core = await createPostgresCore();
  const fleet = unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' })));
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  chief = agentCaller({ fleetId, shipId: await commissioned('chief', 'chief-of-staff') });
  marketingId = await commissioned('marketing', 'head');
  productId = await commissioned('product', 'head');
  core.clock.advance(60_000);
  notices = [];
  listener = listenForPendingDeliveries({
    databaseUrl: core.databaseUrl,
    onNotice: (notice) => {
      notices.push(notice);
    },
  });
  await listener.listening;
});

afterEach(async () => {
  await listener.close();
  await core.close();
});

describe('opening a meeting on Postgres', () => {
  it('stores the meeting, its participants in the order they joined, and an added notice to each but the owner', async () => {
    const { meetingId } = unwrap(await core.useCases.openMeeting(chief, aMeeting()));

    await expect(core.prisma.meeting.findMany({ include: { participants: { orderBy: { place: 'asc' } } } })).resolves.toMatchObject([
      {
        id: meetingId,
        fleetId,
        ownerShipId: chief.shipId,
        moderatorShipId: chief.shipId,
        openedByShipId: chief.shipId,
        openedAt: core.clock.now(),
        endedAt: null,
        participants: [{ shipId: chief.shipId, place: 0 }, { shipId: marketingId, place: 1 }, { shipId: productId, place: 2 }],
      },
    ]);
    const messages = await core.prisma.message.findMany({ orderBy: { id: 'asc' }, include: { deliveries: true } });
    expect(messages.map(({ senderShipId, selectorShipId, contentType, meetingId: of, deliveries }) => ({ senderShipId, selectorShipId, contentType, meetingId: of, delivered: deliveries.map((delivery) => delivery.recipientShipId) }))).toEqual([
      { senderShipId: chief.shipId, selectorShipId: marketingId, contentType: MEETING_ADDED_CONTENT_TYPE, meetingId, delivered: [marketingId] },
      { senderShipId: chief.shipId, selectorShipId: productId, contentType: MEETING_ADDED_CONTENT_TYPE, meetingId, delivered: [productId] },
    ]);
    await expect.poll(() => notices.map((notice) => notice.recipient)).toEqual([
      { kind: 'ship', shipId: marketingId },
      { kind: 'ship', shipId: productId },
    ]);
  });

  it('invites the ships carrying every value of a label selection, read in SQL', async () => {
    const role = unwrap(await core.useCases.defineLabel(argo, { key: 'role', values: ['head', 'weekly'] }));
    const [head, weekly] = role.values;
    const engineeringId = await commissioned('engineering', 'head');
    for (const [shipId, value] of [
      [marketingId, head],
      [marketingId, weekly],
      [productId, head],
      [engineeringId, weekly],
    ] as const) {
      unwrap(await core.useCases.assignLabel(argo, { shipId, valueId: value?.id ?? newId('labelValue') }));
    }

    unwrap(await core.useCases.openMeeting(chief, aMeeting({ ships: [], valueIds: [head?.id ?? newId('labelValue'), weekly?.id ?? newId('labelValue')] })));

    await expect(core.prisma.meetingParticipant.findMany({ orderBy: { place: 'asc' }, select: { shipId: true } })).resolves.toEqual([{ shipId: chief.shipId }, { shipId: marketingId }]);
  });
});

describe('concurrent opens with one idempotency key', () => {
  it('store one meeting: every open gets its id', async () => {
    const openMeeting = openMeetingWith(
      racingUnitOfWork({ prisma: core.prisma, transactions: 4 }, (tx, allArrived) => ({
        ...tx,
        meetings: {
          ...tx.meetings,
          findByOpenerKey: async (key) => {
            await allArrived();
            return tx.meetings.findByOpenerKey(key);
          },
        },
      })),
    );
    const input = aMeeting();

    const results = await Promise.all(Array.from({ length: 4 }, () => openMeeting(chief, input)));

    const [meeting] = await core.prisma.meeting.findMany();
    expect(results).toEqual(Array.from({ length: 4 }, () => ({ isOk: true, value: { meetingId: meeting?.id } })));
    await expect(storedCounts()).resolves.toEqual({ meetings: 1, participants: 3, messages: 2, deliveries: 2, events: 6 });
  });
});

describe('an open that fails', () => {
  it.each([
    {
      label: 'after its meeting was stored',
      wrap: (tx: PrismaTx): PrismaTx => ({ ...tx, messages: { ...tx.messages, create: () => Promise.reject(new Error('disk full')) } }),
    },
    {
      label: 'after its first notice was queued',
      wrap: (tx: PrismaTx): PrismaTx => ({
        ...tx,
        notifier: {
          deliveryPending: async (notice) => {
            await tx.notifier.deliveryPending(notice);
            throw new Error('disk full');
          },
        },
      }),
    },
  ])('$label leaves no meeting, message, delivery or event, and wakes nobody', async ({ wrap }) => {
    const openMeeting = openMeetingWith(unitOfWorkWith(wrap));

    await expect(openMeeting(chief, aMeeting())).rejects.toThrow('disk full');

    await expect(storedCounts()).resolves.toEqual({ meetings: 0, participants: 0, messages: 0, deliveries: 0, events: 0 });
    // A send after it is heard: had the failed open's notice gone out, it would be heard first.
    const { messageId } = unwrap(await core.useCases.sendMessage(chief, { selector: { kind: 'ship', name: 'argo' }, payload: 'probe', idempotencyKey: newKey(), model: MODEL }));
    const probe = await core.prisma.delivery.findFirstOrThrow({ where: { messageId } });
    await expect.poll(() => notices.map((notice) => notice.deliveryId)).toEqual([probe.id]);
  });
});
