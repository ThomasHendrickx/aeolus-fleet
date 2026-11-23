import { createIdGenerator, MEETING_ADDED_CONTENT_TYPE, MEETING_ENDED_CONTENT_TYPE, MEETING_MIC_CONTENT_TYPE, type FleetId, type MeetingId, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createApp } from '../src/app.js';
import { createPrismaClientTellingStatements } from '../src/adapters/prisma/client.js';
import { createPrismaMessageRepository } from '../src/adapters/prisma/messaging.js';
import { toMessage } from '../src/adapters/prisma/rows.js';
import { createPrismaLeaseRepository } from '../src/adapters/prisma/registry.js';
import { createPrismaMeetingRepository } from '../src/adapters/prisma/meetings.js';
import { assertIndexedPlan } from './support/assert-indexed-plan.js';
import { sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { listenForPendingDeliveries, type DeliveryListener } from '../src/adapters/prisma/delivery-notices.js';
import { createPrismaUnitOfWork, type PrismaTx } from '../src/adapters/prisma/unit-of-work.js';
import { createOpenCall } from '../src/domain/messaging/open-call.js';
import { createEndDueMeetings } from '../src/domain/messaging/end-due-meetings.js';
import { createChangeMeeting } from '../src/domain/messaging/change-meeting.js';
import { createChangeMic } from '../src/domain/messaging/change-mic.js';
import { createRetireShip } from '../src/domain/registry/retire-ship.js';
import { createOpenMeeting, type MeetingToOpen } from '../src/domain/messaging/open-meeting.js';
import type { Crew, ShipCaller } from '../src/domain/shared/caller.js';
import { createSendMessage, type MessageToSend } from '../src/domain/messaging/send-message.js';
import type { DeliveryNotice } from '../src/domain/shared/notifier.js';
import type { UnitOfWork } from '../src/domain/shared/unit-of-work.js';
import { executeSqlFile } from '../src/testing/database.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { agentCaller, operatorCaller, secretOf } from './support/core-fixtures.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createPostgresCore, racingUnitOfWork, type PostgresCore } from './support/postgres-core.js';
import { unsealedFleetsOnly } from './support/sealing.js';

// Meetings on a real Postgres through the Prisma adapters (decision 0061):
// what an open stores, the label selection resolved in SQL, one meeting for
// concurrent opens with one key, and that an open failing halfway stores
// nothing and wakes nobody; then what a contribution stores, that one failing
// halfway through its fan-out stores nothing and wakes nobody, concurrent
// contributions and receives, and the ship's message list.

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
let deadlines: Date[];

async function commissioned(name: string, type: string): Promise<ShipId> {
  return unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name, type })).shipId;
}

function aMeeting(overrides: Partial<MeetingToOpen> = {}): MeetingToOpen {
  return { ships: [{ shipId: marketingId }, { name: 'product' }], idempotencyKey: newKey(), model: MODEL, ...overrides };
}

function openMeetingWith(uow: UnitOfWork<PrismaTx>) {
  return createOpenMeeting({ uow, clock: core.clock, ids: newId, hasher: sha256Hasher, sealing: unsealedFleetsOnly });
}

/** The Prisma unit of work with a step of the open wrapped: `wrap` gets the transaction's ports and returns them with that step changed. */
function unitOfWorkWith(wrap: (tx: PrismaTx) => PrismaTx): UnitOfWork<PrismaTx> {
  const uow = createPrismaUnitOfWork(core.prisma);
  return { run: (work) => uow.run((tx) => work(wrap(tx))) };
}

/** Check the adapter's actual lock and timestamp update plans alongside the committed contribution. */
async function contributionPlans(meetingId: MeetingId): Promise<void> {
  const statements: { query: string; params: string }[] = [];
  const client = createPrismaClientTellingStatements(core.databaseUrl, (query, params) => {
    if (query.includes('FOR NO KEY UPDATE') || query.includes('GREATEST(last_contribution_at')) statements.push({ query, params });
  });
  try {
    await client.$transaction(async (db) => {
      const meetings = createPrismaMeetingRepository(db);
      await meetings.findForNoKeyUpdate(fleetId, meetingId);
      await meetings.contributed(fleetId, { meetingId, at: core.clock.now() });
    });
    expect(statements).toHaveLength(2);
    for (const statement of statements) await assertIndexedPlan(core.prisma, statement);
  } finally {
    await client.$disconnect();
  }
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
  deadlines = [];
  listener = listenForPendingDeliveries({
    databaseUrl: core.databaseUrl,
    onMeetingDeadline: (at) => { deadlines.push(at); },
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
        lastContributionAt: null,
        endedAt: null,
        participants: [{ shipId: chief.shipId, place: 0, meetingOpenedAt: core.clock.now(), isMeetingEnded: false }, { shipId: marketingId, place: 1, meetingOpenedAt: core.clock.now(), isMeetingEnded: false }, { shipId: productId, place: 2, meetingOpenedAt: core.clock.now(), isMeetingEnded: false }],
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

it('backfills the copied order key and newest kept contribution, leaving meetings without kept contributions null', async () => {
  // Given populated open and ended meetings, with notices newer than their contributions.
  const first = unwrap(await core.useCases.openMeeting(chief, aMeeting())).meetingId;
  const empty = unwrap(await core.useCases.openMeeting(chief, aMeeting())).meetingId;
  unwrap(await core.useCases.sendMessage(chief, aMeetingContribution(first)));
  core.clock.advance(1000);
  unwrap(await core.useCases.sendMessage(chief, aMeetingContribution(first)));
  const latest = core.clock.now();
  core.clock.advance(1000);
  unwrap(await core.useCases.changeMeeting(chief, { meetingId: first, change: { kind: 'end' } }));
  const before = await core.prisma.meeting.findMany({ orderBy: { id: 'asc' } });
  await core.prisma.$executeRawUnsafe('DROP INDEX meeting_participants_ship_list_idx');
  await core.prisma.$executeRawUnsafe('CREATE INDEX meeting_participants_fleet_id_ship_id_idx ON meeting_participants (fleet_id, ship_id)');
  await core.prisma.$executeRawUnsafe('ALTER TABLE meeting_participants DROP COLUMN meeting_opened_at, DROP COLUMN is_meeting_ended');
  await core.prisma.$executeRawUnsafe('ALTER TABLE meetings DROP COLUMN last_contribution_at');

  // When the forward migration runs against the old schema and kept history.
  await executeSqlFile(core.databaseUrl, 'packages/core/src/adapters/prisma/migrations/20261121120000_meeting_list/migration.sql');

  // Then only contributions set the time and every participant receives its meeting's key.
  await expect(core.prisma.meeting.findFirstOrThrow({ where: { id: first } })).resolves.toMatchObject({ lastContributionAt: latest });
  await expect(core.prisma.meeting.findFirstOrThrow({ where: { id: empty } })).resolves.toMatchObject({ lastContributionAt: null });
  for (const meeting of before) {
    const participants = await core.prisma.meetingParticipant.findMany({ where: { meetingId: meeting.id } });
    expect(participants).toHaveLength(3);
    expect(participants).toEqual(participants.map((participant) => ({ ...participant, meetingOpenedAt: meeting.openedAt, isMeetingEnded: meeting.endedAt !== null })));
  }
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

    await expect(openMeeting(chief, { ...aMeeting(), endsAt: new Date(core.clock.now().getTime() + 60_000).toISOString() })).rejects.toThrow('disk full');

    await expect(storedCounts()).resolves.toEqual({ meetings: 0, participants: 0, messages: 0, deliveries: 0, events: 0 });
    // A send after it is heard: had the failed open's notice gone out, it would be heard first.
    const { messageId } = unwrap(await core.useCases.sendMessage(chief, { selector: { kind: 'ship', name: 'argo' }, payload: 'probe', idempotencyKey: newKey(), model: MODEL }));
    const probe = await core.prisma.delivery.findFirstOrThrow({ where: { messageId } });
    await expect.poll(() => notices.map((notice) => notice.deliveryId)).toEqual([probe.id]);
    expect(deadlines).toEqual([]);
  });
});

/** The ship's crew, claimed with its secret as a session claims it. */
async function crewOf(shipId: ShipId): Promise<Crew> {
  const { secret } = unwrap(await core.useCases.getStartingPrompt(argo, { shipId }));
  const { crewToken } = unwrap(await core.useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'CLOUD' }, harness: 'claude-code' }));
  return unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
}

describe('contributing to a meeting on Postgres', () => {
  let meetingId: MeetingId;

  beforeEach(async () => {
    ({ meetingId } = unwrap(await core.useCases.openMeeting(chief, aMeeting())));
    // marketing holds the mic, so it contributes beside chief, the moderator (M7).
    unwrap(await core.useCases.changeMic(chief, { meetingId, change: { kind: 'give', shipId: marketingId } }));
    await expect.poll(() => notices.length).toBe(3);
    notices.length = 0;
  });

  function aContribution(overrides: Partial<MessageToSend> = {}): MessageToSend {
    return { selector: { kind: 'meeting', meetingId }, payload: 'The launch moves to Friday', idempotencyKey: newKey(), model: MODEL, ...overrides };
  }

  function sendMessageWith(uow: UnitOfWork<PrismaTx>) {
    return createSendMessage({ sealing: unsealedFleetsOnly, uow, clock: core.clock, ids: newId, hasher: sha256Hasher });
  }

  async function contributionCounts() {
    return {
      messages: await core.prisma.message.count({ where: { selectorKind: 'meeting' } }),
      deliveries: await core.prisma.delivery.count({ where: { message: { selectorKind: 'meeting' } } }),
      accepted: await core.prisma.event.count({ where: { type: 'MessageAccepted', message: { selectorKind: 'meeting' } } }),
    };
  }

  it('stores one message to the meeting and one pending delivery per other participant, each with its MessageAccepted, waking each after commit', async () => {
    const marketing = agentCaller({ fleetId, shipId: marketingId });

    const { messageId } = unwrap(await core.useCases.sendMessage(marketing, aContribution()));

    const [stored] = await core.prisma.message.findMany({ where: { id: messageId }, include: { deliveries: { orderBy: { recipientShipId: 'asc' } } } });
    await expect(core.prisma.meeting.findFirstOrThrow({ where: { id: meetingId } })).resolves.toMatchObject({ lastContributionAt: core.clock.now() });
    await contributionPlans(meetingId);
    expect(stored).toMatchObject({ senderShipId: marketingId, selectorKind: 'meeting', selectorShipId: null, selectorType: null, meetingId });
    expect(stored?.deliveries.map(({ recipientShipId, state }) => ({ recipientShipId, state }))).toEqual(
      [chief.shipId, productId].sort().map((recipientShipId) => ({ recipientShipId, state: 'pending' })),
    );
    await expect(core.prisma.event.findMany({ where: { messageId, type: 'MessageAccepted' }, select: { shipId: true, details: true }, orderBy: { seq: 'asc' } })).resolves.toEqual([
      { shipId: chief.shipId, details: { selector: 'meeting', recipientType: null, model: MODEL, senderLeaseId: null, meetingId } },
      { shipId: productId, details: { selector: 'meeting', recipientType: null, model: MODEL, senderLeaseId: null, meetingId } },
    ]);
    await expect.poll(() => notices.map((notice) => notice.recipient)).toEqual([
      { kind: 'ship', shipId: chief.shipId },
      { kind: 'ship', shipId: productId },
    ]);
  });

  it.each([
    {
      label: 'at its second delivery',
      wrap: (tx: PrismaTx): PrismaTx => {
        let created = 0;
        return {
          ...tx,
          deliveries: {
            ...tx.deliveries,
            create: async (delivery, message) => {
              created += 1;
              if (created === 2) {
                throw new Error('disk full');
              }
              await tx.deliveries.create(delivery, message);
            },
          },
        };
      },
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
  ])('failing $label leaves no message, no delivery and no event, and wakes nobody', async ({ wrap }) => {
    const sendMessage = sendMessageWith(unitOfWorkWith(wrap));

    await expect(sendMessage(agentCaller({ fleetId, shipId: marketingId }), aContribution())).rejects.toThrow('disk full');

    await expect(core.prisma.meeting.findFirstOrThrow({ where: { id: meetingId } })).resolves.toMatchObject({ lastContributionAt: null });
    await expect(contributionCounts()).resolves.toEqual({ messages: 0, deliveries: 0, accepted: 0 });
    const { messageId } = unwrap(await core.useCases.sendMessage(chief, { selector: { kind: 'ship', name: 'argo' }, payload: 'probe', idempotencyKey: newKey(), model: MODEL }));
    const probe = await core.prisma.delivery.findFirstOrThrow({ where: { messageId } });
    await expect.poll(() => notices.map((notice) => notice.deliveryId)).toEqual([probe.id]);
  });

  it('stores every contribution of the moderator and the holder of the mic contributing at once, each with all its deliveries', async () => {
    const senders = [chief, agentCaller({ fleetId, shipId: marketingId })];
    const uow = racingUnitOfWork({ prisma: core.prisma, transactions: senders.length }, (tx, allArrived) => ({
      ...tx,
      meetings: {
        ...tx.meetings,
        findForNoKeyUpdate: async (fleet, meeting) => {
          const found = await tx.meetings.findForNoKeyUpdate(fleet, meeting);
          await allArrived();
          return found;
        },
      },
    }));

    const latest = core.clock.now();
    const older = new Date(latest.getTime() - 1000);
    const results = await Promise.all(senders.map((sender, index) => createSendMessage({ sealing: unsealedFleetsOnly, uow, clock: { now: () => index === 0 ? latest : older }, ids: newId, hasher: sha256Hasher })(sender, aContribution())));

    expect(results.map((result) => result.isOk)).toEqual([true, true]);
    await expect(core.prisma.meeting.findFirstOrThrow({ where: { id: meetingId } })).resolves.toMatchObject({ lastContributionAt: core.clock.now() });
    await expect(contributionCounts()).resolves.toEqual({ messages: 2, deliveries: 4, accepted: 4 });
  });

  it('stores one contribution for concurrent sends with one key: every send gets its id', async () => {
    const marketing = agentCaller({ fleetId, shipId: marketingId });
    const sendMessage = sendMessageWith(
      racingUnitOfWork({ prisma: core.prisma, transactions: 3 }, (tx, allArrived) => ({
        ...tx,
        messages: {
          ...tx.messages,
          findByIdempotencyKey: async (key) => {
            await allArrived();
            return tx.messages.findByIdempotencyKey(key);
          },
        },
      })),
    );
    const input = aContribution();

    const results = await Promise.all(Array.from({ length: 3 }, () => sendMessage(marketing, input)));

    const [message] = await core.prisma.message.findMany({ where: { selectorKind: 'meeting' } });
    expect(results).toEqual(Array.from({ length: 3 }, () => ({ isOk: true, value: { messageId: message?.id } })));
    await expect(contributionCounts()).resolves.toEqual({ messages: 1, deliveries: 2, accepted: 2 });
  });

  it('is received and acknowledged by each participant on its own, the two receiving at once', async () => {
    const [chiefCrew, productCrew] = [await crewOf(chief.shipId), await crewOf(productId)];
    const { messageId } = unwrap(await core.useCases.sendMessage(agentCaller({ fleetId, shipId: marketingId }), aContribution()));

    const received = await Promise.all([chiefCrew, productCrew].map(async (crew) => unwrap(await core.useCases.receiveDeliveries(crew, { max: 10 })).deliveries.filter((delivery) => delivery.messageId === messageId)));
    const [byChief, byProduct] = received.map((deliveries) => deliveries.map(({ deliveryId, meetingId: of }) => ({ deliveryId, meetingId: of })));
    unwrap(await core.useCases.acknowledgeDelivery(productCrew, { deliveryId: byProduct?.[0]?.deliveryId ?? newId('delivery') }));

    expect([byChief?.length, byProduct?.length, byChief?.[0]?.meetingId, byProduct?.[0]?.meetingId]).toEqual([1, 1, meetingId, meetingId]);
    expect(byChief?.[0]?.deliveryId).not.toBe(byProduct?.[0]?.deliveryId);
    await expect(core.prisma.delivery.findMany({ where: { messageId }, select: { recipientShipId: true, state: true }, orderBy: { recipientShipId: 'asc' } })).resolves.toEqual(
      [
        { recipientShipId: chief.shipId, state: 'handed' },
        { recipientShipId: productId, state: 'acknowledged' },
      ].sort((first, second) => first.recipientShipId.localeCompare(second.recipientShipId)),
    );
  });

  it("leaves contributions off a ship's message list: the meeting's read shows them", async () => {
    const { messageId } = unwrap(await core.useCases.sendMessage(agentCaller({ fleetId, shipId: marketingId }), aContribution()));
    const productCrew = await crewOf(productId);
    unwrap(await core.useCases.receiveDeliveries(productCrew, { max: 10 }));

    for (const shipId of [marketingId, productId]) {
      const listed = unwrap(await core.useCases.readShipMessages(argo, { shipId, limit: 50 }));
      expect(listed.items.map((message) => message.id)).not.toContain(messageId);
    }
  });
});

describe('reading a meeting on Postgres', () => {
  it('shows its title, its participants in the order they joined with their status, and what was said newest first, a page at a time', async () => {
    const { meetingId } = unwrap(await core.useCases.openMeeting(chief, aMeeting({ title: 'Launch plan' })));
    const marketing = agentCaller({ fleetId, shipId: marketingId });
    await crewOf(marketingId);
    unwrap(await core.useCases.changeMic(chief, { meetingId, change: { kind: 'give', shipId: marketingId } }));
    const said: MessageId[] = [];
    for (const [by, payload] of [
      [chief, 'Agenda: the launch'],
      [marketing, 'Copy is ready'],
      [chief, 'Friday then'],
    ] as const) {
      core.clock.advance(1_000);
      said.push(unwrap(await core.useCases.sendMessage(by, { selector: { kind: 'meeting', meetingId }, payload, idempotencyKey: newKey(), model: MODEL })).messageId);
    }

    const first = unwrap(await core.useCases.readMeeting(marketing, { meetingId, limit: 2 }));
    const second = unwrap(await core.useCases.readMeeting(marketing, { meetingId, limit: 2, cursor: first.contributions.nextCursor ?? undefined }));

    expect(first.title).toBe('Launch plan');
    expect(first.participants.map(({ id, name, status }) => ({ id, name, status }))).toEqual([
      { id: chief.shipId, name: 'chief', status: 'awaitingCrew' },
      { id: marketingId, name: 'marketing', status: 'crewed' },
      { id: productId, name: 'product', status: 'awaitingCrew' },
    ]);
    expect([first.contributions.items.map(({ messageId, payload }) => ({ messageId, payload })), second.contributions.items.map(({ messageId }) => messageId), second.contributions.nextCursor]).toEqual([
      [
        { messageId: said[2], payload: 'Friday then' },
        { messageId: said[1], payload: 'Copy is ready' },
      ],
      [said[0]],
      null,
    ]);
  });
});

describe('the mic on Postgres', () => {
  let meetingId: MeetingId;
  let marketing: ShipCaller;
  let product: ShipCaller;

  beforeEach(async () => {
    ({ meetingId } = unwrap(await core.useCases.openMeeting(chief, aMeeting())));
    marketing = agentCaller({ fleetId, shipId: marketingId });
    product = agentCaller({ fleetId, shipId: productId });
    await expect.poll(() => notices.length).toBe(2);
    notices.length = 0;
  });

  function changeMicWith(uow: UnitOfWork<PrismaTx>) {
    return createChangeMic({ uow, clock: core.clock, ids: newId, hasher: sha256Hasher, sealing: unsealedFleetsOnly });
  }

  async function micNotices() {
    return core.prisma.message.findMany({ where: { contentType: MEETING_MIC_CONTENT_TYPE }, select: { senderShipId: true, selectorShipId: true, meetingId: true, model: true }, orderBy: { id: 'asc' } });
  }

  it('stores who holds it, how it passes and the requests in order, and tells the holder after commit', async () => {
    unwrap(await core.useCases.changeMic(product, { meetingId, change: { kind: 'request' } }));
    core.clock.advance(1_000);
    unwrap(await core.useCases.changeMic(marketing, { meetingId, change: { kind: 'request' } }));
    unwrap(await core.useCases.changeMic(chief, { meetingId, change: { kind: 'setPattern', pattern: 'fifo' } }));

    const { mic } = unwrap(await core.useCases.readMeeting(marketing, { meetingId, limit: 20 }));
    expect(mic).toEqual({ holder: { id: productId, name: 'product' }, pattern: 'fifo', requests: [{ ship: { id: marketingId, name: 'marketing' }, requestedAt: core.clock.now() }] });
    await expect(micNotices()).resolves.toEqual([{ senderShipId: chief.shipId, selectorShipId: productId, meetingId, model: null }]);
    await expect.poll(() => notices.map((notice) => notice.recipient)).toEqual([{ kind: 'ship', shipId: productId }]);
  });

  it('takes concurrent requests to a free mic first in line one at a time: one ship gets it, the other waits', async () => {
    unwrap(await core.useCases.changeMic(chief, { meetingId, change: { kind: 'setPattern', pattern: 'fifo' } }));
    const changeMic = changeMicWith(
      racingUnitOfWork({ prisma: core.prisma, transactions: 2 }, (tx, allArrived) => ({
        ...tx,
        meetings: {
          ...tx.meetings,
          findForUpdate: async (fleet, meeting) => {
            const found = await tx.meetings.findForUpdate(fleet, meeting);
            await allArrived();
            return found;
          },
        },
      })),
    );

    const results = await Promise.all([marketing, product].map((ship) => changeMic(ship, { meetingId, change: { kind: 'request' } })));

    const { mic } = unwrap(await core.useCases.readMeeting(chief, { meetingId, limit: 20 }));
    expect(results.map((result) => result.isOk)).toEqual([true, true]);
    expect([mic.holder === null ? [] : [mic.holder.id], mic.requests.map(({ ship }) => ship.id)].flat().sort()).toEqual([marketingId, productId].sort());
    expect([mic.holder === null, mic.requests.length]).toEqual([false, 1]);
    await expect(micNotices()).resolves.toEqual([]);
  });

  it('takes the mic back only once a contribution of its holder in flight is stored', async () => {
    unwrap(await core.useCases.changeMic(chief, { meetingId, change: { kind: 'give', shipId: marketingId } }));
    let isContributionHeld = false;
    const uow = racingUnitOfWork({ prisma: core.prisma, transactions: 2 }, (tx, allArrived) => ({
      ...tx,
      meetings: {
        ...tx.meetings,
        findForNoKeyUpdate: async (fleet, meeting) => {
          const found = await tx.meetings.findForNoKeyUpdate(fleet, meeting);
          isContributionHeld = true;
          await allArrived();
          return found;
        },
      },
    }));
    const sending = createSendMessage({ sealing: unsealedFleetsOnly, uow, clock: core.clock, ids: newId, hasher: sha256Hasher })(marketing, { selector: { kind: 'meeting', meetingId }, payload: 'Copy is ready', idempotencyKey: newKey(), model: MODEL });
    await expect.poll(() => isContributionHeld).toBe(true);

    const [sent, taken] = await Promise.all([sending, changeMicWith(uow)(chief, { meetingId, change: { kind: 'take' } })]);

    expect([sent.isOk, taken.isOk]).toEqual([true, true]);
    await expect(core.prisma.delivery.count({ where: { message: { selectorKind: 'meeting' } } })).resolves.toBe(2);
    // Had the take not waited for the contribution, its event would be written before the contribution's.
    const order = await core.prisma.event.findMany({ where: { type: { in: ['MessageAccepted', 'MicTaken'] }, OR: [{ type: 'MicTaken' }, { message: { selectorKind: 'meeting' } }] }, select: { type: true }, orderBy: { seq: 'asc' } });
    expect(order.map(({ type }) => type)).toEqual(['MessageAccepted', 'MessageAccepted', 'MicTaken']);
    await expect(core.prisma.meeting.findFirstOrThrow({ where: { id: meetingId }, select: { micHolderShipId: true } })).resolves.toEqual({ micHolderShipId: null });
  });

  it('stores nothing and wakes nobody when a give fails after its notice was queued', async () => {
    const changeMic = changeMicWith(
      unitOfWorkWith((tx) => ({
        ...tx,
        notifier: {
          deliveryPending: async (notice) => {
            await tx.notifier.deliveryPending(notice);
            throw new Error('disk full');
          },
        },
      })),
    );

    await expect(changeMic(chief, { meetingId, change: { kind: 'give', shipId: productId } })).rejects.toThrow('disk full');

    await expect(core.prisma.meeting.findFirstOrThrow({ where: { id: meetingId }, select: { micHolderShipId: true } })).resolves.toEqual({ micHolderShipId: null });
    await expect(micNotices()).resolves.toEqual([]);
    await expect(core.prisma.event.count({ where: { type: { startsWith: 'Mic' } } })).resolves.toBe(0);
    // A send after it is heard: had the failed give's notice gone out, it would be heard first.
    const { messageId } = unwrap(await core.useCases.sendMessage(chief, { selector: { kind: 'ship', name: 'argo' }, payload: 'probe', idempotencyKey: newKey(), model: MODEL }));
    const probe = await core.prisma.delivery.findFirstOrThrow({ where: { messageId } });
    await expect.poll(() => notices.map((notice) => notice.deliveryId)).toEqual([probe.id]);
  });
});

describe("a meeting's life on Postgres", () => {
  let meetingId: MeetingId;
  let marketing: ShipCaller;
  let product: ShipCaller;

  beforeEach(async () => {
    ({ meetingId } = unwrap(await core.useCases.openMeeting(chief, aMeeting())));
    marketing = agentCaller({ fleetId, shipId: marketingId });
    product = agentCaller({ fleetId, shipId: productId });
    await expect.poll(() => notices.length).toBe(2);
    notices.length = 0;
  });

  function participantRows() {
    return core.prisma.meetingParticipant.findMany({ where: { meetingId }, select: { shipId: true, leftAt: true, isRevoked: true, place: true }, orderBy: { place: 'asc' } });
  }

  it('stores who left and who was revoked, keeps their rows, and a ship the owner adds again joins at the back', async () => {
    unwrap(await core.useCases.changeMeeting(marketing, { meetingId, change: { kind: 'leave' } }));
    unwrap(await core.useCases.changeMeeting(chief, { meetingId, change: { kind: 'revoke', shipId: productId } }));
    const leftAt = core.clock.now();
    unwrap(await core.useCases.addToMeeting(chief, { meetingId, ships: [{ shipId: productId }], model: MODEL }));

    await expect(participantRows()).resolves.toEqual([
      { shipId: chief.shipId, leftAt: null, isRevoked: false, place: 0 },
      { shipId: marketingId, leftAt, isRevoked: false, place: 1 },
      { shipId: productId, leftAt: null, isRevoked: false, place: 2 },
    ]);
  });

  it('copies the original meeting order key to a newly added participant', async () => {
    // Given an open meeting and a ship that joined later.
    const openedAt = core.clock.now();
    const shipId = await commissioned('later', 'head');
    core.clock.advance(1000);

    // When the owner adds it.
    unwrap(await core.useCases.addToMeeting(chief, { meetingId, ships: [{ shipId }], model: MODEL }));

    // Then the list key comes from the meeting rather than the join time.
    await expect(core.prisma.meetingParticipant.findFirstOrThrow({ where: { meetingId, shipId } })).resolves.toMatchObject({ meetingOpenedAt: openedAt, isMeetingEnded: false });
  });

  it('stores the new owner and moderator, and the end, telling every other present participant after commit', async () => {
    unwrap(await core.useCases.changeMeeting(chief, { meetingId, change: { kind: 'nameModerator', shipId: productId } }));
    unwrap(await core.useCases.changeMeeting(chief, { meetingId, change: { kind: 'transfer', shipId: marketingId } }));

    unwrap(await core.useCases.changeMeeting(product, { meetingId, change: { kind: 'end' } }));

    await expect(core.prisma.meeting.findFirstOrThrow({ where: { id: meetingId }, select: { ownerShipId: true, moderatorShipId: true, endedAt: true } })).resolves.toEqual({
      ownerShipId: marketingId,
      moderatorShipId: productId,
      endedAt: core.clock.now(),
    });
    const participants = await core.prisma.meetingParticipant.findMany({ where: { meetingId } });
    expect(participants).toHaveLength(3);
    expect(participants.every((participant) => participant.isMeetingEnded)).toBe(true);
    await expect(core.prisma.message.findMany({ where: { contentType: MEETING_ENDED_CONTENT_TYPE }, select: { senderShipId: true, selectorShipId: true, model: true }, orderBy: { selectorShipId: 'asc' } })).resolves.toEqual(
      [chief.shipId, marketingId].sort().map((selectorShipId) => ({ senderShipId: productId, selectorShipId, model: null })),
    );
    await expect.poll(() => notices.map((notice) => notice.recipient.kind === 'ship' && notice.recipient.shipId).sort()).toEqual([chief.shipId, marketingId].sort());
  });

  it('stores nothing and wakes nobody when an end fails after its first notice was queued', async () => {
    const changeMeeting = createChangeMeeting({
      uow: unitOfWorkWith((tx) => ({
        ...tx,
        notifier: {
          deliveryPending: async (notice) => {
            await tx.notifier.deliveryPending(notice);
            throw new Error('disk full');
          },
        },
      })),
      clock: core.clock,
      ids: newId,
      hasher: sha256Hasher,
      sealing: unsealedFleetsOnly,
    });

    await expect(changeMeeting(chief, { meetingId, change: { kind: 'end' } })).rejects.toThrow('disk full');

    await expect(core.prisma.meeting.findFirstOrThrow({ where: { id: meetingId }, select: { endedAt: true } })).resolves.toEqual({ endedAt: null });
    const participants = await core.prisma.meetingParticipant.findMany({ where: { meetingId } });
    expect(participants).toHaveLength(3);
    expect(participants.every((participant) => !participant.isMeetingEnded)).toBe(true);
    await expect(core.prisma.message.count({ where: { contentType: MEETING_ENDED_CONTENT_TYPE } })).resolves.toBe(0);
    await expect(core.prisma.event.count({ where: { type: 'MeetingEnded' } })).resolves.toBe(0);
    const { messageId } = unwrap(await core.useCases.sendMessage(chief, { selector: { kind: 'ship', name: 'argo' }, payload: 'probe', idempotencyKey: newKey(), model: MODEL }));
    const probe = await core.prisma.delivery.findFirstOrThrow({ where: { messageId } });
    await expect.poll(() => notices.map((notice) => notice.deliveryId)).toEqual([probe.id]);
  });

  it('still delivers a contribution pending when the meeting ended', async () => {
    const { messageId } = unwrap(await core.useCases.sendMessage(chief, aMeetingContribution(meetingId)));
    unwrap(await core.useCases.changeMeeting(chief, { meetingId, change: { kind: 'end' } }));

    const received = unwrap(await core.useCases.receiveDeliveries(await crewOf(productId), { max: 10 })).deliveries;

    expect(received.filter((delivery) => delivery.messageId === messageId)).toHaveLength(1);
  });

  it('takes a retire and a contribution to its meeting at once one after the other, never in a deadlock', async () => {
    unwrap(await core.useCases.changeMic(chief, { meetingId, change: { kind: 'give', shipId: marketingId } }));
    const uow = racingUnitOfWork({ prisma: core.prisma, transactions: 2 }, (tx, allArrived) => ({
      ...tx,
      meetings: {
        ...tx.meetings,
        findForNoKeyUpdate: async (fleet, meeting) => {
          const found = await tx.meetings.findForNoKeyUpdate(fleet, meeting);
          await allArrived();
          return found;
        },
      },
    }));
    const sending = createSendMessage({ sealing: unsealedFleetsOnly, uow, clock: core.clock, ids: newId, hasher: sha256Hasher })(marketing, aMeetingContribution(meetingId));

    const [sent, retiredShip] = await Promise.all([sending, createRetireShip({ uow, clock: core.clock, ids: newId, hasher: sha256Hasher, sealing: unsealedFleetsOnly })(argo, { shipId: productId })]);

    expect([sent.isOk, retiredShip.isOk]).toEqual([true, true]);
    await expect(participantRows()).resolves.toContainEqual({ shipId: productId, leftAt: core.clock.now(), isRevoked: false, place: 2 });
    await expect(core.prisma.delivery.findFirstOrThrow({ where: { message: { selectorKind: 'meeting' }, recipientShipId: productId }, select: { state: true } })).resolves.toEqual({ state: 'abandoned' });
  });

  it('ends the meeting of a retired owner, telling the others by a message from it', async () => {
    unwrap(await core.useCases.retireShip(argo, { shipId: chief.shipId }));

    await expect(core.prisma.meeting.findFirstOrThrow({ where: { id: meetingId }, select: { endedAt: true } })).resolves.toEqual({ endedAt: core.clock.now() });
    const endedParticipants = await core.prisma.meetingParticipant.findMany({ where: { meetingId } });
    expect(endedParticipants).toHaveLength(3);
    expect(endedParticipants.every((participant) => participant.isMeetingEnded)).toBe(true);
    await expect(core.prisma.message.count({ where: { contentType: MEETING_ENDED_CONTENT_TYPE, senderShipId: chief.shipId } })).resolves.toBe(2);
  });
});

/** A contribution to the meeting, with a key of its own. */
function aMeetingContribution(meetingId: MeetingId): MessageToSend {
  return { selector: { kind: 'meeting', meetingId }, payload: 'Wrap up', idempotencyKey: newKey(), model: MODEL };
}


it('persists the goal and end time and reads them through the Postgres adapter', async () => {
  // Given a meeting opened with a goal and future end time.
  const endsAt = new Date(core.clock.now().getTime() + 60_000).toISOString();
  const input = { ...aMeeting(), goal: 'Agree the release date', endsAt };
  const { meetingId } = unwrap(await core.useCases.openMeeting(chief, input));
  // When the adapter reloads it from Postgres.
  const read = unwrap(await core.useCases.readMeeting(chief, { meetingId, limit: 20 }));
  // Then both values survive storage and are available to every participant.
  expect(read).toMatchObject({ goal: 'Agree the release date', endsAt: new Date(endsAt) });
  const notice = await core.prisma.message.findFirst({ where: { fleetId, meetingId }, orderBy: { id: 'asc' } });
  expect(JSON.parse(notice?.payload ?? '{}')).toMatchObject({ goal: 'Agree the release date' });
});


function endDueWith(uow: UnitOfWork<PrismaTx>) {
  return createEndDueMeetings({ uow, fleets: { list: () => Promise.resolve([{ id: fleetId }]) }, meetings: createPrismaMeetingRepository(core.prisma), clock: core.clock, ids: newId, hasher: sha256Hasher, sealing: unsealedFleetsOnly });
}

it('ends a due meeting once across concurrent servers, with durable notices and an indexed deadline claim', async () => {
  // Given a stored deadline and a moderator distinct from its owner.
  const endsAt = new Date(core.clock.now().getTime() + 60_000).toISOString();
  const { meetingId } = unwrap(await core.useCases.openMeeting(chief, { ...aMeeting(), endsAt }));
  unwrap(await core.useCases.changeMeeting(chief, { meetingId, change: { kind: 'nameModerator', shipId: marketingId } }));
  core.clock.advance(60_000);
  await core.prisma.meeting.createMany({ data: Array.from({ length: 5000 }, (_, serial) => ({
    id: newId('meeting'), fleetId, ownerShipId: chief.shipId, moderatorShipId: chief.shipId,
    openedByShipId: chief.shipId, idempotencyKey: `untimed-${String(serial)}`, requestHash: 'hash', openedAt: core.clock.now(),
  })) });
  await core.prisma.$executeRaw`ANALYZE meetings`;
  const statements: { query: string; params: string }[] = [];
  const client = createPrismaClientTellingStatements(core.databaseUrl, (query, params) => {
    if (query.includes('meetings') && (query.includes('SKIP LOCKED') || query.includes('MIN(ends_at)'))) statements.push({ query, params });
  });
  try {
    // When two newly built use cases race to close the stored deadline.
    const racing = racingUnitOfWork({ prisma: client, transactions: 2 }, (tx, allArrived) => ({
      ...tx, meetings: { ...tx.meetings, claimDue: async (scope, query) => {
        const meeting = await tx.meetings.claimDue(scope, query);
        await allArrived();
        return meeting;
      } },
    }));
    const endDue = endDueWith(racing);
    await Promise.all([endDue(), endDue()]);
    await endDue();
    await createPrismaMeetingRepository(client).nextEndTime(fleetId);
    // Then one ending, from the moderator, survives reload, and the plans are indexed.
    await expect(core.prisma.meeting.findFirst({ where: { fleetId, id: meetingId } })).resolves.toMatchObject({ endedAt: new Date(endsAt) });
    const events = await core.prisma.event.findMany({ where: { fleetId, type: 'MeetingEnded' } });
    expect(events).toHaveLength(1);
    const messages = await core.prisma.message.findMany({ where: { fleetId, meetingId, contentType: MEETING_ENDED_CONTENT_TYPE }, orderBy: { selectorShipId: 'asc' } });
    expect(messages.map(({ senderShipId, selectorShipId }) => ({ senderShipId, selectorShipId }))).toEqual([chief.shipId, productId].sort().map((selectorShipId) => ({ senderShipId: marketingId, selectorShipId })));
    expect(statements.some(({ query }) => query.includes('SKIP LOCKED'))).toBe(true);
    expect(statements.some(({ query }) => query.includes('MIN(ends_at)'))).toBe(true);
    for (const statement of statements) {
      const plan = await assertIndexedPlan(core.prisma, statement);
      expect(plan).toContain('meetings_due_idx');
    }
  } finally { await client.$disconnect(); }
});

it('rolls back an automatic ending, its notices and events after a failure, then recovers on the next pass', async () => {
  // Given a due meeting, with a failure after its first ended notice is queued.
  const endsAt = new Date(core.clock.now().getTime() + 60_000).toISOString();
  const { meetingId } = unwrap(await core.useCases.openMeeting(chief, { ...aMeeting(), endsAt }));
  core.clock.advance(60_000);
  await expect.poll(() => notices.length).toBe(2);
  notices.length = 0;
  const before = await storedCounts();
  const broken = unitOfWorkWith((tx) => ({ ...tx, notifier: { deliveryPending: async (notice) => { await tx.notifier.deliveryPending(notice); throw new Error('forced ending failure'); } } }));
  // When the ending fails and a fresh use case later retries it.
  const failures: unknown[] = [];
  await endDueWith(broken)((_fleetId, error) => { failures.push(error); });
  // Then none of the ending was stored or announced.
  expect(failures).toHaveLength(1);
  await expect(storedCounts()).resolves.toEqual(before);
  await expect(core.prisma.event.count({ where: { fleetId, type: 'MeetingEnded' } })).resolves.toBe(0);
  await expect(core.prisma.meeting.findFirst({ where: { fleetId, id: meetingId } })).resolves.toMatchObject({ endedAt: null });
  const { messageId } = unwrap(await core.useCases.sendMessage(chief, { selector: { kind: 'ship', name: 'argo' }, payload: 'probe', idempotencyKey: newKey(), model: MODEL }));
  const probe = await core.prisma.delivery.findFirstOrThrow({ where: { messageId } });
  await expect.poll(() => notices.map((notice) => notice.deliveryId)).toEqual([probe.id]);
  await endDueWith(createPrismaUnitOfWork(core.prisma))();
  await expect(core.prisma.event.count({ where: { fleetId, type: 'MeetingEnded' } })).resolves.toBe(1);
});


it('core automatically recovers a due meeting after a restart without its moderator', async () => {
  // Given an opening persisted before this server started, whose deadline is due.
  const endsAt = new Date(core.clock.now().getTime() + 60_000).toISOString();
  const { meetingId } = unwrap(await core.useCases.openMeeting(chief, { ...aMeeting(), endsAt }));
  core.clock.advance(60_000);
  // When core restarts, its first maintenance pass recovers the missed notification without participant action.
  const app = createApp({ databaseUrl: core.databaseUrl, publicUrl: 'http://localhost', clock: core.clock, logger: false, overduePassMs: 100 });
  try {
    await app.ready();
    // Then core recovers the stored ending and delivers its notices.
    await expect.poll(() => core.prisma.meeting.findFirst({ where: { fleetId, id: meetingId } })).toMatchObject({ endedAt: new Date(endsAt) });
    await expect(core.prisma.message.count({ where: { fleetId, meetingId, contentType: MEETING_ENDED_CONTENT_TYPE } })).resolves.toBe(2);
  } finally { await app.close(); }
});


it('announces a new deadline only after the opening commits, for every core timer', async () => {
  // Given a core listener and a future deadline.
  const endsAt = new Date(core.clock.now().getTime() + 60_000).toISOString();
  // When an opener stores the meeting.
  unwrap(await core.useCases.openMeeting(chief, { ...aMeeting(), endsAt }));
  // Then the committed opening tells listening core servers when to wake.
  await expect.poll(() => deadlines).toEqual([new Date(endsAt)]);
});


describe('a call on Postgres', () => {
  beforeEach(async () => { for (const shipId of [chief.shipId, marketingId, productId]) await crewOf(shipId); });
  const callInput = (meetingId: MeetingId) => ({ meetingId, question: 'Which day?', excludedShipIds: [chief.shipId], model: MODEL, idempotencyKey: newKey() });
  const answer = ({ meetingId, callId, shipId }: { meetingId: MeetingId; callId: MessageId; shipId: ShipId }) => core.useCases.sendMessage(agentCaller({ fleetId, shipId }), { selector: { kind: 'meeting', meetingId }, callId, payload: shipId === marketingId ? 'Friday' : 'Monday', model: MODEL, idempotencyKey: newKey() });
  it('serializes concurrent opens so only one call opens', async () => {
    const { meetingId } = unwrap(await core.useCases.openMeeting(chief, aMeeting()));
    const opens = await Promise.all([core.useCases.openCall(chief, callInput(meetingId)), core.useCases.openCall(chief, callInput(meetingId))]);
    expect(opens.filter((r) => r.isOk)).toHaveLength(1);
  });
  async function answeredCall() {
    const { meetingId } = unwrap(await core.useCases.openMeeting(chief, aMeeting()));
    const { callId } = unwrap(await core.useCases.openCall(chief, callInput(meetingId)));
    const answers = await Promise.all([answer({ meetingId, callId, shipId: marketingId }), answer({ meetingId, callId, shipId: productId })]);
    for (const result of answers) unwrap(result);
    return { meetingId, callId };
  }
  it('retains concurrent answers when reloaded through a fresh repository', async () => {
    const { meetingId } = await answeredCall();
    const read = unwrap(await core.useCases.readMeeting(chief, { meetingId, limit: 20 }));
    expect(read.call?.answers.map((a) => a.payload).sort()).toEqual(['Friday', 'Monday']);
  });
  it('delivers one round when the final answers race', async () => {
    const { meetingId } = await answeredCall();
    await expect(core.prisma.message.count({ where: { fleetId, meetingId, contentType: 'application/vnd.aeolus.meeting.round+json' } })).resolves.toBe(1);
  });
  it('records one close when the final answers race', async () => {
    await answeredCall();
    await expect(core.prisma.event.count({ where: { fleetId, type: 'CallClosed' } })).resolves.toBe(1);
  });
  it('uses indexed reads for calls and their answers', async () => {
    const { meetingId, callId } = await answeredCall();
    const read = unwrap(await core.useCases.readMeeting(chief, { meetingId, limit: 20 }));
    const statements: { query: string; params: string }[] = [];
    const client = createPrismaClientTellingStatements(core.databaseUrl, (query, params) => { if (query.includes('meeting_calls') || query.includes('messages')) statements.push({ query, params }); });
    try {
      const meetings = createPrismaMeetingRepository(client);
      await meetings.latestCall(fleetId, meetingId);
      await meetings.findCall(fleetId, { meetingId, callId });
      await meetings.closedCallCount(fleetId, meetingId);
      const answerIds = read.call?.answers.map((a) => a.messageId) ?? [];
      await createPrismaMessageRepository(client).findMany(fleetId, answerIds);
      expect(statements.length).toBeGreaterThan(0);
      for (const statement of statements) await assertIndexedPlan(core.prisma, statement);
    } finally { await client.$disconnect(); }
  });
  it('retains the call id on each answer envelope', async () => {
    const { meetingId, callId } = await answeredCall();
    const read = unwrap(await core.useCases.readMeeting(chief, { meetingId, limit: 20 }));
    const answerIds = read.call?.answers.map((a) => a.messageId) ?? [];
    const stored = await createPrismaMessageRepository(core.prisma).findMany(fleetId, answerIds);
    expect(stored.map((m) => m.callId)).toEqual([callId, callId]);
  });
  it('reads the call id from a persisted answer row', async () => {
    const { meetingId, callId } = await answeredCall();
    const row = await core.prisma.message.findFirst({ where: { fleetId, meetingId, callId } });
    expect(toMessage(row).callId).toBe(callId);
  });
  it('retains the answer contributions when saving the call state', async () => {
    // Given a call state loaded before an expected participant answers.
    const { meetingId } = unwrap(await core.useCases.openMeeting(chief, aMeeting()));
    const { callId } = unwrap(await core.useCases.openCall(chief, callInput(meetingId)));
    const meetings = createPrismaMeetingRepository(core.prisma);
    const call = await meetings.findCall(fleetId, { meetingId, callId });
    if (call === undefined) throw new Error('No call opened');
    const { messageId } = unwrap(await answer({ meetingId, callId, shipId: marketingId }));
    // When only the call state is saved, its answer contributions remain authoritative.
    await meetings.saveCall(call);
    // Then reloading derives the retained answer from its contribution.
    expect((await meetings.findCall(fleetId, { meetingId, callId }))?.answers).toEqual([{ shipId: marketingId, messageId }]);
  });
  it.each(['rolls back the opening', 'retries the opening'])('%s after a forced failure', async (outcome) => {
    // Given a failure after the first call delivery has been queued.
    const { meetingId } = unwrap(await core.useCases.openMeeting(chief, aMeeting()));
    const before = await storedCounts();
    const broken = unitOfWorkWith((tx) => ({ ...tx, notifier: { deliveryPending: async (notice) => { await tx.notifier.deliveryPending(notice); throw new Error('call failure'); } } }));
    const open = createOpenCall({ uow: broken, clock: core.clock, ids: newId, hasher: sha256Hasher, sealing: unsealedFleetsOnly });
    const input = callInput(meetingId);
    // When the opening fails.
    await expect(open(chief, input)).rejects.toThrow('call failure');
    // Then no call, message, event or delivery survives; retry opens it.
    if (outcome === 'rolls back the opening') {
      await expect(storedCounts()).resolves.toEqual(before);
      await expect(core.prisma.event.count({ where: { fleetId, type: 'CallOpened' } })).resolves.toBe(0);
    } else {
      expect((await core.useCases.openCall(chief, input)).isOk).toBe(true);
    }
  });
  it.each(['rolls back the final answer, close and ending together', 'retries the final answer to end once'])('%s on a round-notice failure', async (outcome) => {
    // Given a call whose final answer would end the meeting.
    const { meetingId } = unwrap(await core.useCases.openMeeting(chief, { ...aMeeting(), endAfterCalls: 1 }));
    const { callId } = unwrap(await core.useCases.openCall(chief, callInput(meetingId)));
    unwrap(await answer({ meetingId, callId, shipId: marketingId }));
    const before = await storedCounts();
    const broken = unitOfWorkWith((tx) => ({ ...tx, notifier: { deliveryPending: () => Promise.reject(new Error('round failure')) } }));
    const send = createSendMessage({ uow: broken, clock: core.clock, ids: newId, hasher: sha256Hasher, sealing: unsealedFleetsOnly });
    // When the final answer's round delivery cannot be queued.
    await expect(send(agentCaller({ fleetId, shipId: productId }), { selector: { kind: 'meeting', meetingId }, callId, payload: 'Monday', model: MODEL, idempotencyKey: newKey() })).rejects.toThrow('round failure');
    // Then none of that transaction survives, and a retry ends the meeting once.
    if (outcome === 'rolls back the final answer, close and ending together') {
      await expect(storedCounts()).resolves.toEqual(before);
      const read = unwrap(await core.useCases.readMeeting(chief, { meetingId, limit: 20 }));
      expect(read.endedAt).toBeNull();
      expect(read.call?.answers).toHaveLength(1);
    } else {
      unwrap(await answer({ meetingId, callId, shipId: productId }));
      expect(unwrap(await core.useCases.readMeeting(chief, { meetingId, limit: 20 })).endedAt).toEqual(core.clock.now());
      await expect(core.prisma.event.count({ where: { fleetId, type: 'MeetingEnded' } })).resolves.toBe(1);
    }
  });
});


describe('call silence on Postgres', () => {
  it('persists immediate silence and accepts a late answer outside the closed round after reload', async () => {
    // Given every expected ship awaits crew at opening.
    const { meetingId } = unwrap(await core.useCases.openMeeting(chief, aMeeting()));
    const { callId } = unwrap(await core.useCases.openCall(chief, { meetingId, question: 'Ready?', excludedShipIds: [chief.shipId], model: MODEL, idempotencyKey: newKey() }));
    // When one ship gets a crew and answers the already closed call.
    const marketing = await crewOf(marketingId);
    const { messageId } = unwrap(await core.useCases.sendMessage(marketing, { selector: { kind: 'meeting', meetingId }, callId, payload: 'Late but retained', model: MODEL, idempotencyKey: newKey() }));
    // Then a fresh read keeps silence and the original round separate from the late answer.
    const read = unwrap(await core.useCases.readMeeting(chief, { meetingId, callId, limit: 20 }));
    expect(read.call).toMatchObject({ silentShipIds: [marketingId, productId], answers: [], lateAnswers: [{ messageId, isLate: true, payload: 'Late but retained' }] });
    expect(read.contributions.items).toContainEqual(expect.objectContaining({ messageId, isLate: true }));
    await expect(core.prisma.event.count({ where: { fleetId, type: 'CallClosed' } })).resolves.toBe(1);
  });
  it('recovers a call deadline after restart and closes once with a revoked expected ship silent', async () => {
    // Given a persisted call with a ship revoked mid-call and a deadline missed while core was stopped.
    for (const shipId of [marketingId, productId]) await crewOf(shipId);
    const { meetingId } = unwrap(await core.useCases.openMeeting(chief, aMeeting()));
    const { callId } = unwrap(await core.useCases.openCall(chief, { meetingId, question: 'Ready?', excludedShipIds: [chief.shipId], model: MODEL, idempotencyKey: newKey() }));
    unwrap(await core.useCases.changeMeeting(chief, { meetingId, change: { kind: 'revoke', shipId: productId } }));
    core.clock.advance(300_000);
    // When a fresh server starts its maintenance pass.
    const app = createApp({ databaseUrl: core.databaseUrl, publicUrl: 'http://localhost', clock: core.clock, logger: false, overduePassMs: 100 });
    try {
      await app.ready();
      // Then the durable deadline closes once and the moderator receives the silent ships.
      await expect.poll(() => core.prisma.event.count({ where: { fleetId, type: 'CallClosed' } })).toBe(1);
      const read = unwrap(await core.useCases.readMeeting(chief, { meetingId, callId, limit: 20 }));
      expect(read.call).toMatchObject({ closedAt: core.clock.now(), silentShipIds: [marketingId, productId], answers: [] });
      await expect(core.prisma.message.count({ where: { fleetId, meetingId, contentType: 'application/vnd.aeolus.meeting.round+json' } })).resolves.toBe(1);
    } finally { await app.close(); }
  });
});


it('rolls back deadline silence, its round notice and events together, then closes once across concurrent passes', async () => {
  // Given an open call with both expected ships crewed.
  for (const shipId of [marketingId, productId]) await crewOf(shipId);
  const { meetingId } = unwrap(await core.useCases.openMeeting(chief, aMeeting()));
  const { callId } = unwrap(await core.useCases.openCall(chief, { meetingId, question: 'Ready?', excludedShipIds: [chief.shipId], model: MODEL, idempotencyKey: newKey() }));
  await expect.poll(() => deadlines.length).toBe(1);
  await expect.poll(() => notices.length).toBe(5);
  notices.length = 0;
  core.clock.advance(300_000);
  const broken = unitOfWorkWith((tx) => ({ ...tx, notifier: { deliveryPending: async (notice) => { await tx.notifier.deliveryPending(notice); throw new Error('deadline round failure'); } } }));
  const failures: unknown[] = [];
  // When the close fails after queuing its notice.
  await endDueWith(broken)((_fleetId, error) => { failures.push(error); });
  // Then neither silence nor close nor its event or notice survives.
  expect(failures).toHaveLength(1);
  expect((await createPrismaMeetingRepository(core.prisma).findCall(fleetId, { meetingId, callId }))).toMatchObject({ closedAt: null, silentShipIds: [] });
  await expect(core.prisma.event.count({ where: { fleetId, type: 'CallClosed' } })).resolves.toBe(0);
  await expect(core.prisma.message.count({ where: { fleetId, meetingId, contentType: 'application/vnd.aeolus.meeting.round+json' } })).resolves.toBe(0);
  expect(notices).toEqual([]);
  // When two servers recover that same deadline together.
  const racing = racingUnitOfWork({ prisma: core.prisma, transactions: 2 }, (tx, allArrived) => ({
    ...tx, meetings: { ...tx.meetings, claimDue: async (scope, query) => { const meeting = await tx.meetings.claimDue(scope, query); await allArrived(); return meeting; } },
  }));
  await Promise.all([endDueWith(racing)(), endDueWith(racing)()]);
  // Then exactly one committed round records both silent ships.
  expect((await createPrismaMeetingRepository(core.prisma).findCall(fleetId, { meetingId, callId }))).toMatchObject({ closedAt: core.clock.now(), silentShipIds: [marketingId, productId] });
  await expect(core.prisma.event.count({ where: { fleetId, type: 'CallClosed' } })).resolves.toBe(1);
  await expect.poll(() => notices.length).toBe(1);
});

it('uses the indexed call deadlines to recover a due call among closed history', async () => {
  // Given one open call among 5,000 closed calls.
  for (const shipId of [marketingId, productId]) await crewOf(shipId);
  const { meetingId } = unwrap(await core.useCases.openMeeting(chief, aMeeting()));
  const { callId } = unwrap(await core.useCases.openCall(chief, { meetingId, question: 'Ready?', excludedShipIds: [chief.shipId], model: MODEL, idempotencyKey: newKey() }));
  await core.prisma.$executeRaw`
    INSERT INTO meeting_calls (id, fleet_id, meeting_id, request_hash, expected_ship_ids, deadline, opened_at, closed_at)
    SELECT 'msg_' || lpad(i::text, 26, '0'), ${fleetId}, ${meetingId}, 'hash', ARRAY[]::text[], ${core.clock.now()}, ${core.clock.now()}, ${core.clock.now()}
    FROM generate_series(1, 5000) i`;
  await core.prisma.$executeRaw`ANALYZE meeting_calls`;
  core.clock.advance(300_000);
  const statements: { query: string; params: string }[] = [];
  const client = createPrismaClientTellingStatements(core.databaseUrl, (query, params) => { if (query.includes('meeting_calls') && (query.includes('SKIP LOCKED') || query.includes('c.deadline AS at'))) statements.push({ query, params }); });
  try {
    // When a new repository finds the durable deadline and claims its meeting.
    const meetings = createPrismaMeetingRepository(client);
    expect(await meetings.nextEndTime(fleetId)).toEqual(core.clock.now());
    await client.$transaction(async (tx) => { expect((await createPrismaMeetingRepository(tx).claimDue(fleetId, { at: core.clock.now(), tried: [] }))?.id).toBe(meetingId); });
    // Then the next instant uses the deadline index and the claim uses an open-call partial index.
    expect(statements).toHaveLength(2);
    for (const statement of statements) {
      const plan = await assertIndexedPlan(core.prisma, statement);
      expect(plan).toMatch(/meeting_calls_(?:due|one_open)_idx/);
      if (!statement.query.includes('SKIP LOCKED')) expect(plan).toContain('meeting_calls_due_idx');
    }
    expect((await meetings.findCall(fleetId, { meetingId, callId }))?.closedAt).toBeNull();
  } finally { await client.$disconnect(); }
});


it('pages expected ships in the database and reads acknowledged progress with pushed crew state', async () => {
  // Given a call whose marketing crew has acknowledged its notice and reported busy.
  const marketing = await crewOf(marketingId);
  await crewOf(productId);
  const { meetingId } = unwrap(await core.useCases.openMeeting(chief, aMeeting()));
  const { callId } = unwrap(await core.useCases.openCall(chief, { meetingId, question: 'Ready?', excludedShipIds: [chief.shipId], model: MODEL, idempotencyKey: newKey() }));
  const delivery = await core.prisma.delivery.findFirstOrThrow({ where: { fleetId, messageId: callId, recipientShipId: marketingId } });
  const at = core.clock.now();
  await core.prisma.delivery.update({ where: { id: delivery.id }, data: { state: 'acknowledged', claimedByShipId: marketingId, claimedByLeaseId: marketing.leaseId } });
  await core.prisma.event.create({ data: { id: newId('event'), fleetId, type: 'DeliveryAcknowledged', occurredAt: at, actorKind: 'ship', actorShipId: marketingId, shipId: marketingId, deliveryId: delivery.id, messageId: callId, details: {}, seq: -1n } });
  await core.prisma.lease.update({ where: { id: marketing.leaseId }, data: { pushedAt: at, turn: 'busy', turnAt: at } });
  // When the moderator reads the first expected ship and continues with its own cursor.
  const first = unwrap(await core.useCases.readMeeting(chief, { meetingId, callId, limit: 20, progressLimit: 1 }));
  expect(first.call).toMatchObject({ progress: { items: [{ ship: { id: marketingId }, progress: 'acknowledged', status: 'crewed', turn: 'busy', deliveredAt: delivery.createdAt, acknowledgedAt: at }], nextCursor: marketingId } });
  const second = unwrap(await core.useCases.readMeeting(chief, { meetingId, callId, limit: 20, progressLimit: 1, progressCursor: marketingId }));
  // Then the second ship is delivered and its unreported plain session has no turn.
  expect(second.call).toMatchObject({ progress: { items: [{ ship: { id: productId }, progress: 'delivered', status: 'crewed', turn: null }], nextCursor: null } });
  const statements: { query: string; params: string }[] = [];
  const client = createPrismaClientTellingStatements(core.databaseUrl, (query, params) => { statements.push({ query, params }); });
  try {
    await createPrismaMeetingRepository(client).progressPage(fleetId, { callId, limit: 20 });
    await createPrismaLeaseRepository(client).readCrews(fleetId, [marketingId, productId]);
    for (const statement of statements) await assertIndexedPlan(core.prisma, statement);
  } finally { await client.$disconnect(); }

});
