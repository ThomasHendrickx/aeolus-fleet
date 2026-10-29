import {
  createIdGenerator,
  MEETING_ADDED_CONTENT_TYPE,
  MEETING_ENDED_CONTENT_TYPE,
  MEETING_MIC_CONTENT_TYPE,
  type FleetId,
  type MeetingId,
  type MessageId,
  type ShipId,
} from "@aeolus-fleet/common";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { sha256Hasher } from "../src/adapters/crypto/secrets.js";
import {
  listenForPendingDeliveries,
  type DeliveryListener,
} from "../src/adapters/prisma/delivery-notices.js";
import {
  createPrismaUnitOfWork,
  type PrismaTx,
} from "../src/adapters/prisma/unit-of-work.js";
import { createChangeMeeting } from "../src/domain/messaging/change-meeting.js";
import { createChangeMic } from "../src/domain/messaging/change-mic.js";
import { createRetireShip } from "../src/domain/registry/retire-ship.js";
import {
  createOpenMeeting,
  type MeetingToOpen,
} from "../src/domain/messaging/open-meeting.js";
import type { Crew, ShipCaller } from "../src/domain/shared/caller.js";
import {
  createSendMessage,
  type MessageToSend,
} from "../src/domain/messaging/send-message.js";
import type { DeliveryNotice } from "../src/domain/shared/notifier.js";
import type { UnitOfWork } from "../src/domain/shared/unit-of-work.js";
import { newKey } from "../src/testing/keys.js";
import { unwrap } from "../src/testing/result.js";
import {
  agentCaller,
  operatorCaller,
  secretOf,
} from "./support/core-fixtures.js";
import { withOperatorLogin } from "./support/operator-login.js";
import {
  createPostgresCore,
  racingUnitOfWork,
  type PostgresCore,
} from "./support/postgres-core.js";
import { unsealedFleetsOnly } from "./support/sealing.js";

// Meetings on a real Postgres through the Prisma adapters (decision 0061):
// what an open stores, the label selection resolved in SQL, one meeting for
// concurrent opens with one key, and that an open failing halfway stores
// nothing and wakes nobody; then what a contribution stores, that one failing
// halfway through its fan-out stores nothing and wakes nobody, concurrent
// contributions and receives, and the ship's message list.

const newId = createIdGenerator();
const MODEL = "claude-opus-5-5";

let core: PostgresCore;
let fleetId: FleetId;
let argo: ShipCaller;
let chief: ShipCaller;
let marketingId: ShipId;
let productId: ShipId;
let listener: DeliveryListener;
let notices: DeliveryNotice[];

async function commissioned(name: string, type: string): Promise<ShipId> {
  return unwrap(
    await core.useCases.commissionShip(argo, {
      idempotencyKey: newKey(),
      name,
      type,
    }),
  ).shipId;
}

function aMeeting(overrides: Partial<MeetingToOpen> = {}): MeetingToOpen {
  return {
    ships: [{ shipId: marketingId }, { name: "product" }],
    idempotencyKey: newKey(),
    model: MODEL,
    ...overrides,
  };
}

function openMeetingWith(uow: UnitOfWork<PrismaTx>) {
  return createOpenMeeting({
    uow,
    clock: core.clock,
    ids: newId,
    hasher: sha256Hasher,
    sealing: unsealedFleetsOnly,
  });
}

/** The Prisma unit of work with a step of the open wrapped: `wrap` gets the transaction's ports and returns them with that step changed. */
function unitOfWorkWith(
  wrap: (tx: PrismaTx) => PrismaTx,
): UnitOfWork<PrismaTx> {
  const uow = createPrismaUnitOfWork(core.prisma);
  return { run: (work) => uow.run((tx) => work(wrap(tx))) };
}

async function storedCounts() {
  return {
    meetings: await core.prisma.meeting.count(),
    participants: await core.prisma.meetingParticipant.count(),
    messages: await core.prisma.message.count(),
    deliveries: await core.prisma.delivery.count(),
    events: await core.prisma.event.count({
      where: {
        type: { in: ["MeetingOpened", "ParticipantAdded", "MessageAccepted"] },
      },
    }),
  };
}

beforeEach(async () => {
  core = await createPostgresCore();
  const fleet = unwrap(
    await withOperatorLogin(
      core.prisma,
      core.useCases.initialiseFleet({ name: "home fleet" }),
    ),
  );
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  chief = agentCaller({
    fleetId,
    shipId: await commissioned("chief", "chief-of-staff"),
  });
  marketingId = await commissioned("marketing", "head");
  productId = await commissioned("product", "head");
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

describe("opening a meeting on Postgres", () => {
  it("stores the meeting, its participants in the order they joined, and an added notice to each but the owner", async () => {
    const { meetingId } = unwrap(
      await core.useCases.openMeeting(chief, aMeeting()),
    );

    await expect(
      core.prisma.meeting.findMany({
        include: { participants: { orderBy: { place: "asc" } } },
      }),
    ).resolves.toMatchObject([
      {
        id: meetingId,
        fleetId,
        ownerShipId: chief.shipId,
        moderatorShipId: chief.shipId,
        openedByShipId: chief.shipId,
        openedAt: core.clock.now(),
        endedAt: null,
        participants: [
          { shipId: chief.shipId, place: 0 },
          { shipId: marketingId, place: 1 },
          { shipId: productId, place: 2 },
        ],
      },
    ]);
    const messages = await core.prisma.message.findMany({
      orderBy: { id: "asc" },
      include: { deliveries: true },
    });
    expect(
      messages.map(
        ({
          senderShipId,
          selectorShipId,
          contentType,
          meetingId: of,
          deliveries,
        }) => ({
          senderShipId,
          selectorShipId,
          contentType,
          meetingId: of,
          delivered: deliveries.map((delivery) => delivery.recipientShipId),
        }),
      ),
    ).toEqual([
      {
        senderShipId: chief.shipId,
        selectorShipId: marketingId,
        contentType: MEETING_ADDED_CONTENT_TYPE,
        meetingId,
        delivered: [marketingId],
      },
      {
        senderShipId: chief.shipId,
        selectorShipId: productId,
        contentType: MEETING_ADDED_CONTENT_TYPE,
        meetingId,
        delivered: [productId],
      },
    ]);
    await expect
      .poll(() => notices.map((notice) => notice.recipient))
      .toEqual([
        { kind: "ship", shipId: marketingId },
        { kind: "ship", shipId: productId },
      ]);
  });

  it("invites the ships carrying every value of a label selection, read in SQL", async () => {
    const role = unwrap(
      await core.useCases.defineLabel(argo, {
        key: "role",
        values: ["head", "weekly"],
      }),
    );
    const [head, weekly] = role.values;
    const engineeringId = await commissioned("engineering", "head");
    for (const [shipId, value] of [
      [marketingId, head],
      [marketingId, weekly],
      [productId, head],
      [engineeringId, weekly],
    ] as const) {
      unwrap(
        await core.useCases.assignLabel(argo, {
          shipId,
          valueId: value?.id ?? newId("labelValue"),
        }),
      );
    }

    unwrap(
      await core.useCases.openMeeting(
        chief,
        aMeeting({
          ships: [],
          valueIds: [
            head?.id ?? newId("labelValue"),
            weekly?.id ?? newId("labelValue"),
          ],
        }),
      ),
    );

    await expect(
      core.prisma.meetingParticipant.findMany({
        orderBy: { place: "asc" },
        select: { shipId: true },
      }),
    ).resolves.toEqual([{ shipId: chief.shipId }, { shipId: marketingId }]);
  });
});

describe("concurrent opens with one idempotency key", () => {
  it("store one meeting: every open gets its id", async () => {
    const openMeeting = openMeetingWith(
      racingUnitOfWork(
        { prisma: core.prisma, transactions: 4 },
        (tx, allArrived) => ({
          ...tx,
          meetings: {
            ...tx.meetings,
            findByOpenerKey: async (key) => {
              await allArrived();
              return tx.meetings.findByOpenerKey(key);
            },
          },
        }),
      ),
    );
    const input = aMeeting();

    const results = await Promise.all(
      Array.from({ length: 4 }, () => openMeeting(chief, input)),
    );

    const [meeting] = await core.prisma.meeting.findMany();
    expect(results).toEqual(
      Array.from({ length: 4 }, () => ({
        isOk: true,
        value: { meetingId: meeting?.id },
      })),
    );
    await expect(storedCounts()).resolves.toEqual({
      meetings: 1,
      participants: 3,
      messages: 2,
      deliveries: 2,
      events: 6,
    });
  });
});

describe("an open that fails", () => {
  it.each([
    {
      label: "after its meeting was stored",
      wrap: (tx: PrismaTx): PrismaTx => ({
        ...tx,
        messages: {
          ...tx.messages,
          create: () => Promise.reject(new Error("disk full")),
        },
      }),
    },
    {
      label: "after its first notice was queued",
      wrap: (tx: PrismaTx): PrismaTx => ({
        ...tx,
        notifier: {
          deliveryPending: async (notice) => {
            await tx.notifier.deliveryPending(notice);
            throw new Error("disk full");
          },
        },
      }),
    },
  ])(
    "$label leaves no meeting, message, delivery or event, and wakes nobody",
    async ({ wrap }) => {
      const openMeeting = openMeetingWith(unitOfWorkWith(wrap));

      await expect(openMeeting(chief, aMeeting())).rejects.toThrow("disk full");

      await expect(storedCounts()).resolves.toEqual({
        meetings: 0,
        participants: 0,
        messages: 0,
        deliveries: 0,
        events: 0,
      });
      // A send after it is heard: had the failed open's notice gone out, it would be heard first.
      const { messageId } = unwrap(
        await core.useCases.sendMessage(chief, {
          selector: { kind: "ship", name: "argo" },
          payload: "probe",
          idempotencyKey: newKey(),
          model: MODEL,
        }),
      );
      const probe = await core.prisma.delivery.findFirstOrThrow({
        where: { messageId },
      });
      await expect
        .poll(() => notices.map((notice) => notice.deliveryId))
        .toEqual([probe.id]);
    },
  );
});

/** The ship's crew, claimed with its secret as a session claims it. */
async function crewOf(shipId: ShipId): Promise<Crew> {
  const { secret } = unwrap(
    await core.useCases.getStartingPrompt(argo, { shipId }),
  );
  const { crewToken } = unwrap(
    await core.useCases.claimShip({
      shipId,
      secret: secretOf(secret),
      location: { kind: "CLOUD" },
      harness: "claude-code",
    }),
  );
  return unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
}

describe("contributing to a meeting on Postgres", () => {
  let meetingId: MeetingId;

  beforeEach(async () => {
    ({ meetingId } = unwrap(
      await core.useCases.openMeeting(chief, aMeeting()),
    ));
    // marketing holds the mic, so it contributes beside chief, the moderator (M7).
    unwrap(
      await core.useCases.changeMic(chief, {
        meetingId,
        change: { kind: "give", shipId: marketingId },
      }),
    );
    await expect.poll(() => notices.length).toBe(3);
    notices.length = 0;
  });

  function aContribution(
    overrides: Partial<MessageToSend> = {},
  ): MessageToSend {
    return {
      selector: { kind: "meeting", meetingId },
      payload: "The launch moves to Friday",
      idempotencyKey: newKey(),
      model: MODEL,
      ...overrides,
    };
  }

  function sendMessageWith(uow: UnitOfWork<PrismaTx>) {
    return createSendMessage({
      sealing: unsealedFleetsOnly,
      uow,
      clock: core.clock,
      ids: newId,
      hasher: sha256Hasher,
    });
  }

  async function contributionCounts() {
    return {
      messages: await core.prisma.message.count({
        where: { selectorKind: "meeting" },
      }),
      deliveries: await core.prisma.delivery.count({
        where: { message: { selectorKind: "meeting" } },
      }),
      accepted: await core.prisma.event.count({
        where: {
          type: "MessageAccepted",
          message: { selectorKind: "meeting" },
        },
      }),
    };
  }

  it("stores one message to the meeting and one pending delivery per other participant, each with its MessageAccepted, waking each after commit", async () => {
    const marketing = agentCaller({ fleetId, shipId: marketingId });

    const { messageId } = unwrap(
      await core.useCases.sendMessage(marketing, aContribution()),
    );

    const [stored] = await core.prisma.message.findMany({
      where: { id: messageId },
      include: { deliveries: { orderBy: { recipientShipId: "asc" } } },
    });
    expect(stored).toMatchObject({
      senderShipId: marketingId,
      selectorKind: "meeting",
      selectorShipId: null,
      selectorType: null,
      meetingId,
    });
    expect(
      stored?.deliveries.map(({ recipientShipId, state }) => ({
        recipientShipId,
        state,
      })),
    ).toEqual(
      [chief.shipId, productId]
        .sort()
        .map((recipientShipId) => ({ recipientShipId, state: "pending" })),
    );
    await expect(
      core.prisma.event.findMany({
        where: { messageId, type: "MessageAccepted" },
        select: { shipId: true, details: true },
        orderBy: { seq: "asc" },
      }),
    ).resolves.toEqual([
      {
        shipId: chief.shipId,
        details: {
          selector: "meeting",
          recipientType: null,
          model: MODEL,
          meetingId,
        },
      },
      {
        shipId: productId,
        details: {
          selector: "meeting",
          recipientType: null,
          model: MODEL,
          meetingId,
        },
      },
    ]);
    await expect
      .poll(() => notices.map((notice) => notice.recipient))
      .toEqual([
        { kind: "ship", shipId: chief.shipId },
        { kind: "ship", shipId: productId },
      ]);
  });

  it.each([
    {
      label: "at its second delivery",
      wrap: (tx: PrismaTx): PrismaTx => {
        let created = 0;
        return {
          ...tx,
          deliveries: {
            ...tx.deliveries,
            create: async (delivery) => {
              created += 1;
              if (created === 2) {
                throw new Error("disk full");
              }
              await tx.deliveries.create(delivery);
            },
          },
        };
      },
    },
    {
      label: "after its first notice was queued",
      wrap: (tx: PrismaTx): PrismaTx => ({
        ...tx,
        notifier: {
          deliveryPending: async (notice) => {
            await tx.notifier.deliveryPending(notice);
            throw new Error("disk full");
          },
        },
      }),
    },
  ])(
    "failing $label leaves no message, no delivery and no event, and wakes nobody",
    async ({ wrap }) => {
      const sendMessage = sendMessageWith(unitOfWorkWith(wrap));

      await expect(
        sendMessage(
          agentCaller({ fleetId, shipId: marketingId }),
          aContribution(),
        ),
      ).rejects.toThrow("disk full");

      await expect(contributionCounts()).resolves.toEqual({
        messages: 0,
        deliveries: 0,
        accepted: 0,
      });
      const { messageId } = unwrap(
        await core.useCases.sendMessage(chief, {
          selector: { kind: "ship", name: "argo" },
          payload: "probe",
          idempotencyKey: newKey(),
          model: MODEL,
        }),
      );
      const probe = await core.prisma.delivery.findFirstOrThrow({
        where: { messageId },
      });
      await expect
        .poll(() => notices.map((notice) => notice.deliveryId))
        .toEqual([probe.id]);
    },
  );

  it("stores every contribution of the moderator and the holder of the mic contributing at once, each with all its deliveries", async () => {
    const senders = [chief, agentCaller({ fleetId, shipId: marketingId })];
    const sendMessage = sendMessageWith(
      racingUnitOfWork(
        { prisma: core.prisma, transactions: senders.length },
        (tx, allArrived) => ({
          ...tx,
          meetings: {
            ...tx.meetings,
            findForShare: async (fleet, meeting) => {
              const found = await tx.meetings.findForShare(fleet, meeting);
              await allArrived();
              return found;
            },
          },
        }),
      ),
    );

    const results = await Promise.all(
      senders.map((sender) => sendMessage(sender, aContribution())),
    );

    expect(results.map((result) => result.isOk)).toEqual([true, true]);
    await expect(contributionCounts()).resolves.toEqual({
      messages: 2,
      deliveries: 4,
      accepted: 4,
    });
  });

  it("stores one contribution for concurrent sends with one key: every send gets its id", async () => {
    const marketing = agentCaller({ fleetId, shipId: marketingId });
    const sendMessage = sendMessageWith(
      racingUnitOfWork(
        { prisma: core.prisma, transactions: 3 },
        (tx, allArrived) => ({
          ...tx,
          messages: {
            ...tx.messages,
            findByIdempotencyKey: async (key) => {
              await allArrived();
              return tx.messages.findByIdempotencyKey(key);
            },
          },
        }),
      ),
    );
    const input = aContribution();

    const results = await Promise.all(
      Array.from({ length: 3 }, () => sendMessage(marketing, input)),
    );

    const [message] = await core.prisma.message.findMany({
      where: { selectorKind: "meeting" },
    });
    expect(results).toEqual(
      Array.from({ length: 3 }, () => ({
        isOk: true,
        value: { messageId: message?.id },
      })),
    );
    await expect(contributionCounts()).resolves.toEqual({
      messages: 1,
      deliveries: 2,
      accepted: 2,
    });
  });

  it("is received and acknowledged by each participant on its own, the two receiving at once", async () => {
    const [chiefCrew, productCrew] = [
      await crewOf(chief.shipId),
      await crewOf(productId),
    ];
    const { messageId } = unwrap(
      await core.useCases.sendMessage(
        agentCaller({ fleetId, shipId: marketingId }),
        aContribution(),
      ),
    );

    const received = await Promise.all(
      [chiefCrew, productCrew].map(async (crew) =>
        unwrap(
          await core.useCases.receiveDeliveries(crew, { max: 10 }),
        ).deliveries.filter((delivery) => delivery.messageId === messageId),
      ),
    );
    const [byChief, byProduct] = received.map((deliveries) =>
      deliveries.map(({ deliveryId, meetingId: of }) => ({
        deliveryId,
        meetingId: of,
      })),
    );
    unwrap(
      await core.useCases.acknowledgeDelivery(productCrew, {
        deliveryId: byProduct?.[0]?.deliveryId ?? newId("delivery"),
      }),
    );

    expect([
      byChief?.length,
      byProduct?.length,
      byChief?.[0]?.meetingId,
      byProduct?.[0]?.meetingId,
    ]).toEqual([1, 1, meetingId, meetingId]);
    expect(byChief?.[0]?.deliveryId).not.toBe(byProduct?.[0]?.deliveryId);
    await expect(
      core.prisma.delivery.findMany({
        where: { messageId },
        select: { recipientShipId: true, state: true },
        orderBy: { recipientShipId: "asc" },
      }),
    ).resolves.toEqual(
      [
        { recipientShipId: chief.shipId, state: "handed" },
        { recipientShipId: productId, state: "acknowledged" },
      ].sort((first, second) =>
        first.recipientShipId.localeCompare(second.recipientShipId),
      ),
    );
  });

  it("leaves contributions off a ship's message list: the meeting's read shows them", async () => {
    const { messageId } = unwrap(
      await core.useCases.sendMessage(
        agentCaller({ fleetId, shipId: marketingId }),
        aContribution(),
      ),
    );
    const productCrew = await crewOf(productId);
    unwrap(await core.useCases.receiveDeliveries(productCrew, { max: 10 }));

    for (const shipId of [marketingId, productId]) {
      const listed = unwrap(
        await core.useCases.readShipMessages(argo, { shipId, limit: 50 }),
      );
      expect(listed.items.map((message) => message.id)).not.toContain(
        messageId,
      );
    }
  });
});

describe("reading a meeting on Postgres", () => {
  it("shows its title, its participants in the order they joined with their status, and what was said newest first, a page at a time", async () => {
    const { meetingId } = unwrap(
      await core.useCases.openMeeting(
        chief,
        aMeeting({ title: "Launch plan" }),
      ),
    );
    const marketing = agentCaller({ fleetId, shipId: marketingId });
    await crewOf(marketingId);
    unwrap(
      await core.useCases.changeMic(chief, {
        meetingId,
        change: { kind: "give", shipId: marketingId },
      }),
    );
    const said: MessageId[] = [];
    for (const [by, payload] of [
      [chief, "Agenda: the launch"],
      [marketing, "Copy is ready"],
      [chief, "Friday then"],
    ] as const) {
      core.clock.advance(1_000);
      said.push(
        unwrap(
          await core.useCases.sendMessage(by, {
            selector: { kind: "meeting", meetingId },
            payload,
            idempotencyKey: newKey(),
            model: MODEL,
          }),
        ).messageId,
      );
    }

    const first = unwrap(
      await core.useCases.readMeeting(marketing, { meetingId, limit: 2 }),
    );
    const second = unwrap(
      await core.useCases.readMeeting(marketing, {
        meetingId,
        limit: 2,
        cursor: first.contributions.nextCursor ?? undefined,
      }),
    );

    expect(first.title).toBe("Launch plan");
    expect(
      first.participants.map(({ id, name, status }) => ({ id, name, status })),
    ).toEqual([
      { id: chief.shipId, name: "chief", status: "awaitingCrew" },
      { id: marketingId, name: "marketing", status: "crewed" },
      { id: productId, name: "product", status: "awaitingCrew" },
    ]);
    expect([
      first.contributions.items.map(({ messageId, payload }) => ({
        messageId,
        payload,
      })),
      second.contributions.items.map(({ messageId }) => messageId),
      second.contributions.nextCursor,
    ]).toEqual([
      [
        { messageId: said[2], payload: "Friday then" },
        { messageId: said[1], payload: "Copy is ready" },
      ],
      [said[0]],
      null,
    ]);
  });
});

describe("the mic on Postgres", () => {
  let meetingId: MeetingId;
  let marketing: ShipCaller;
  let product: ShipCaller;

  beforeEach(async () => {
    ({ meetingId } = unwrap(
      await core.useCases.openMeeting(chief, aMeeting()),
    ));
    marketing = agentCaller({ fleetId, shipId: marketingId });
    product = agentCaller({ fleetId, shipId: productId });
    await expect.poll(() => notices.length).toBe(2);
    notices.length = 0;
  });

  function changeMicWith(uow: UnitOfWork<PrismaTx>) {
    return createChangeMic({
      uow,
      clock: core.clock,
      ids: newId,
      hasher: sha256Hasher,
      sealing: unsealedFleetsOnly,
    });
  }

  async function micNotices() {
    return core.prisma.message.findMany({
      where: { contentType: MEETING_MIC_CONTENT_TYPE },
      select: {
        senderShipId: true,
        selectorShipId: true,
        meetingId: true,
        model: true,
      },
      orderBy: { id: "asc" },
    });
  }

  it("stores who holds it, how it passes and the requests in order, and tells the holder after commit", async () => {
    unwrap(
      await core.useCases.changeMic(product, {
        meetingId,
        change: { kind: "request" },
      }),
    );
    core.clock.advance(1_000);
    unwrap(
      await core.useCases.changeMic(marketing, {
        meetingId,
        change: { kind: "request" },
      }),
    );
    unwrap(
      await core.useCases.changeMic(chief, {
        meetingId,
        change: { kind: "setPattern", pattern: "fifo" },
      }),
    );

    const { mic } = unwrap(
      await core.useCases.readMeeting(marketing, { meetingId, limit: 20 }),
    );
    expect(mic).toEqual({
      holder: { id: productId, name: "product" },
      pattern: "fifo",
      requests: [
        {
          ship: { id: marketingId, name: "marketing" },
          requestedAt: core.clock.now(),
        },
      ],
    });
    await expect(micNotices()).resolves.toEqual([
      {
        senderShipId: chief.shipId,
        selectorShipId: productId,
        meetingId,
        model: null,
      },
    ]);
    await expect
      .poll(() => notices.map((notice) => notice.recipient))
      .toEqual([{ kind: "ship", shipId: productId }]);
  });

  it("takes concurrent requests to a free mic first in line one at a time: one ship gets it, the other waits", async () => {
    unwrap(
      await core.useCases.changeMic(chief, {
        meetingId,
        change: { kind: "setPattern", pattern: "fifo" },
      }),
    );
    const changeMic = changeMicWith(
      racingUnitOfWork(
        { prisma: core.prisma, transactions: 2 },
        (tx, allArrived) => ({
          ...tx,
          meetings: {
            ...tx.meetings,
            findForUpdate: async (fleet, meeting) => {
              const found = await tx.meetings.findForUpdate(fleet, meeting);
              await allArrived();
              return found;
            },
          },
        }),
      ),
    );

    const results = await Promise.all(
      [marketing, product].map((ship) =>
        changeMic(ship, { meetingId, change: { kind: "request" } }),
      ),
    );

    const { mic } = unwrap(
      await core.useCases.readMeeting(chief, { meetingId, limit: 20 }),
    );
    expect(results.map((result) => result.isOk)).toEqual([true, true]);
    expect(
      [
        mic.holder === null ? [] : [mic.holder.id],
        mic.requests.map(({ ship }) => ship.id),
      ]
        .flat()
        .sort(),
    ).toEqual([marketingId, productId].sort());
    expect([mic.holder === null, mic.requests.length]).toEqual([false, 1]);
    await expect(micNotices()).resolves.toHaveLength(1);
  });

  it("takes the mic back only once a contribution of its holder in flight is stored", async () => {
    unwrap(
      await core.useCases.changeMic(chief, {
        meetingId,
        change: { kind: "give", shipId: marketingId },
      }),
    );
    let isContributionHeld = false;
    const uow = racingUnitOfWork(
      { prisma: core.prisma, transactions: 2 },
      (tx, allArrived) => ({
        ...tx,
        meetings: {
          ...tx.meetings,
          findForShare: async (fleet, meeting) => {
            const found = await tx.meetings.findForShare(fleet, meeting);
            isContributionHeld = true;
            await allArrived();
            return found;
          },
        },
      }),
    );
    const sending = createSendMessage({
      sealing: unsealedFleetsOnly,
      uow,
      clock: core.clock,
      ids: newId,
      hasher: sha256Hasher,
    })(marketing, {
      selector: { kind: "meeting", meetingId },
      payload: "Copy is ready",
      idempotencyKey: newKey(),
      model: MODEL,
    });
    await expect.poll(() => isContributionHeld).toBe(true);

    const [sent, taken] = await Promise.all([
      sending,
      changeMicWith(uow)(chief, { meetingId, change: { kind: "take" } }),
    ]);

    expect([sent.isOk, taken.isOk]).toEqual([true, true]);
    await expect(
      core.prisma.delivery.count({
        where: { message: { selectorKind: "meeting" } },
      }),
    ).resolves.toBe(2);
    // Had the take not waited for the contribution, its event would be written before the contribution's.
    const order = await core.prisma.event.findMany({
      where: {
        type: { in: ["MessageAccepted", "MicTaken"] },
        OR: [{ type: "MicTaken" }, { message: { selectorKind: "meeting" } }],
      },
      select: { type: true },
      orderBy: { seq: "asc" },
    });
    expect(order.map(({ type }) => type)).toEqual([
      "MessageAccepted",
      "MessageAccepted",
      "MicTaken",
    ]);
    await expect(
      core.prisma.meeting.findFirstOrThrow({
        where: { id: meetingId },
        select: { micHolderShipId: true },
      }),
    ).resolves.toEqual({ micHolderShipId: null });
  });

  it("stores nothing and wakes nobody when a give fails after its notice was queued", async () => {
    const changeMic = changeMicWith(
      unitOfWorkWith((tx) => ({
        ...tx,
        notifier: {
          deliveryPending: async (notice) => {
            await tx.notifier.deliveryPending(notice);
            throw new Error("disk full");
          },
        },
      })),
    );

    await expect(
      changeMic(chief, {
        meetingId,
        change: { kind: "give", shipId: productId },
      }),
    ).rejects.toThrow("disk full");

    await expect(
      core.prisma.meeting.findFirstOrThrow({
        where: { id: meetingId },
        select: { micHolderShipId: true },
      }),
    ).resolves.toEqual({ micHolderShipId: null });
    await expect(micNotices()).resolves.toEqual([]);
    await expect(
      core.prisma.event.count({ where: { type: { startsWith: "Mic" } } }),
    ).resolves.toBe(0);
    // A send after it is heard: had the failed give's notice gone out, it would be heard first.
    const { messageId } = unwrap(
      await core.useCases.sendMessage(chief, {
        selector: { kind: "ship", name: "argo" },
        payload: "probe",
        idempotencyKey: newKey(),
        model: MODEL,
      }),
    );
    const probe = await core.prisma.delivery.findFirstOrThrow({
      where: { messageId },
    });
    await expect
      .poll(() => notices.map((notice) => notice.deliveryId))
      .toEqual([probe.id]);
  });
});

describe("a meeting's life on Postgres", () => {
  let meetingId: MeetingId;
  let marketing: ShipCaller;
  let product: ShipCaller;

  beforeEach(async () => {
    ({ meetingId } = unwrap(
      await core.useCases.openMeeting(chief, aMeeting()),
    ));
    marketing = agentCaller({ fleetId, shipId: marketingId });
    product = agentCaller({ fleetId, shipId: productId });
    await expect.poll(() => notices.length).toBe(2);
    notices.length = 0;
  });

  function participantRows() {
    return core.prisma.meetingParticipant.findMany({
      where: { meetingId },
      select: { shipId: true, leftAt: true, isRevoked: true, place: true },
      orderBy: { place: "asc" },
    });
  }

  it("stores who left and who was revoked, keeps their rows, and a ship the owner adds again joins at the back", async () => {
    unwrap(
      await core.useCases.changeMeeting(marketing, {
        meetingId,
        change: { kind: "leave" },
      }),
    );
    unwrap(
      await core.useCases.changeMeeting(chief, {
        meetingId,
        change: { kind: "revoke", shipId: productId },
      }),
    );
    const leftAt = core.clock.now();
    unwrap(
      await core.useCases.addToMeeting(chief, {
        meetingId,
        ships: [{ shipId: productId }],
        model: MODEL,
      }),
    );

    await expect(participantRows()).resolves.toEqual([
      { shipId: chief.shipId, leftAt: null, isRevoked: false, place: 0 },
      { shipId: marketingId, leftAt, isRevoked: false, place: 1 },
      { shipId: productId, leftAt: null, isRevoked: false, place: 2 },
    ]);
  });

  it("stores the new owner and moderator, and the end, telling every other present participant after commit", async () => {
    unwrap(
      await core.useCases.changeMeeting(chief, {
        meetingId,
        change: { kind: "nameModerator", shipId: productId },
      }),
    );
    unwrap(
      await core.useCases.changeMeeting(chief, {
        meetingId,
        change: { kind: "transfer", shipId: marketingId },
      }),
    );

    unwrap(
      await core.useCases.changeMeeting(product, {
        meetingId,
        change: { kind: "end" },
      }),
    );

    await expect(
      core.prisma.meeting.findFirstOrThrow({
        where: { id: meetingId },
        select: { ownerShipId: true, moderatorShipId: true, endedAt: true },
      }),
    ).resolves.toEqual({
      ownerShipId: marketingId,
      moderatorShipId: productId,
      endedAt: core.clock.now(),
    });
    await expect(
      core.prisma.message.findMany({
        where: { contentType: MEETING_ENDED_CONTENT_TYPE },
        select: { senderShipId: true, selectorShipId: true, model: true },
        orderBy: { selectorShipId: "asc" },
      }),
    ).resolves.toEqual(
      [chief.shipId, marketingId]
        .sort()
        .map((selectorShipId) => ({
          senderShipId: productId,
          selectorShipId,
          model: null,
        })),
    );
    await expect
      .poll(() =>
        notices
          .map(
            (notice) =>
              notice.recipient.kind === "ship" && notice.recipient.shipId,
          )
          .sort(),
      )
      .toEqual([chief.shipId, marketingId].sort());
  });

  it("stores nothing and wakes nobody when an end fails after its first notice was queued", async () => {
    const changeMeeting = createChangeMeeting({
      uow: unitOfWorkWith((tx) => ({
        ...tx,
        notifier: {
          deliveryPending: async (notice) => {
            await tx.notifier.deliveryPending(notice);
            throw new Error("disk full");
          },
        },
      })),
      clock: core.clock,
      ids: newId,
      hasher: sha256Hasher,
      sealing: unsealedFleetsOnly,
    });

    await expect(
      changeMeeting(chief, { meetingId, change: { kind: "end" } }),
    ).rejects.toThrow("disk full");

    await expect(
      core.prisma.meeting.findFirstOrThrow({
        where: { id: meetingId },
        select: { endedAt: true },
      }),
    ).resolves.toEqual({ endedAt: null });
    await expect(
      core.prisma.message.count({
        where: { contentType: MEETING_ENDED_CONTENT_TYPE },
      }),
    ).resolves.toBe(0);
    await expect(
      core.prisma.event.count({ where: { type: "MeetingEnded" } }),
    ).resolves.toBe(0);
    const { messageId } = unwrap(
      await core.useCases.sendMessage(chief, {
        selector: { kind: "ship", name: "argo" },
        payload: "probe",
        idempotencyKey: newKey(),
        model: MODEL,
      }),
    );
    const probe = await core.prisma.delivery.findFirstOrThrow({
      where: { messageId },
    });
    await expect
      .poll(() => notices.map((notice) => notice.deliveryId))
      .toEqual([probe.id]);
  });

  it("still delivers a contribution pending when the meeting ended", async () => {
    const { messageId } = unwrap(
      await core.useCases.sendMessage(chief, aMeetingContribution(meetingId)),
    );
    unwrap(
      await core.useCases.changeMeeting(chief, {
        meetingId,
        change: { kind: "end" },
      }),
    );

    const received = unwrap(
      await core.useCases.receiveDeliveries(await crewOf(productId), {
        max: 10,
      }),
    ).deliveries;

    expect(
      received.filter((delivery) => delivery.messageId === messageId),
    ).toHaveLength(1);
  });

  it("takes a retire and a contribution to its meeting at once one after the other, never in a deadlock", async () => {
    unwrap(
      await core.useCases.changeMic(chief, {
        meetingId,
        change: { kind: "give", shipId: marketingId },
      }),
    );
    const uow = racingUnitOfWork(
      { prisma: core.prisma, transactions: 2 },
      (tx, allArrived) => ({
        ...tx,
        meetings: {
          ...tx.meetings,
          findForShare: async (fleet, meeting) => {
            const found = await tx.meetings.findForShare(fleet, meeting);
            await allArrived();
            return found;
          },
        },
      }),
    );
    const sending = createSendMessage({
      sealing: unsealedFleetsOnly,
      uow,
      clock: core.clock,
      ids: newId,
      hasher: sha256Hasher,
    })(marketing, aMeetingContribution(meetingId));

    const [sent, retiredShip] = await Promise.all([
      sending,
      createRetireShip({
        uow,
        clock: core.clock,
        ids: newId,
        hasher: sha256Hasher,
        sealing: unsealedFleetsOnly,
      })(argo, { shipId: productId }),
    ]);

    expect([sent.isOk, retiredShip.isOk]).toEqual([true, true]);
    await expect(participantRows()).resolves.toContainEqual({
      shipId: productId,
      leftAt: core.clock.now(),
      isRevoked: false,
      place: 2,
    });
    await expect(
      core.prisma.delivery.findFirstOrThrow({
        where: {
          message: { selectorKind: "meeting" },
          recipientShipId: productId,
        },
        select: { state: true },
      }),
    ).resolves.toEqual({ state: "abandoned" });
  });

  it("ends the meeting of a retired owner, telling the others by a message from it", async () => {
    unwrap(await core.useCases.retireShip(argo, { shipId: chief.shipId }));

    await expect(
      core.prisma.meeting.findFirstOrThrow({
        where: { id: meetingId },
        select: { endedAt: true },
      }),
    ).resolves.toEqual({ endedAt: core.clock.now() });
    await expect(
      core.prisma.message.count({
        where: {
          contentType: MEETING_ENDED_CONTENT_TYPE,
          senderShipId: chief.shipId,
        },
      }),
    ).resolves.toBe(2);
  });
});

/** A contribution to the meeting, with a key of its own. */
function aMeetingContribution(meetingId: MeetingId): MessageToSend {
  return {
    selector: { kind: "meeting", meetingId },
    payload: "Wrap up",
    idempotencyKey: newKey(),
    model: MODEL,
  };
}
