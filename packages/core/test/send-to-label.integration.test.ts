import { createIdGenerator, type FleetId, type FleetScope, type LabelValueId, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { sha256Hasher } from '../src/adapters/crypto/secrets.js';
import { listenForPendingDeliveries, type DeliveryListener } from '../src/adapters/prisma/delivery-notices.js';
import { createPrismaUnitOfWork, type PrismaTx } from '../src/adapters/prisma/unit-of-work.js';
import { createRetireShip } from '../src/domain/registry/retire-ship.js';
import type { Crew, ShipCaller } from '../src/domain/shared/caller.js';
import { createSendMessage, type MessageToSend } from '../src/domain/messaging/send-message.js';
import type { DeliveryNotice } from '../src/domain/shared/notifier.js';
import type { UnitOfWork } from '../src/domain/shared/unit-of-work.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createPostgresCore, racingUnitOfWork, type PostgresCore } from './support/postgres-core.js';

// A send to a label on a real Postgres through the Prisma adapters (decision
// 0065): lead sends to team=a, carried by alpha, bravo and charlie (and lead),
// not by delta. The list is resolved in SQL and each ship acknowledges on its
// own; one ship out of reach refuses all of it; a failure at the second
// delivery stores nothing and wakes nobody; a retire racing the send abandons
// its delivery; a repeat of the key answers the first message after the
// label moved.

const newId = createIdGenerator();
const MODEL = 'claude-opus-5-5';

let core: PostgresCore;
let fleetId: FleetId;
let argo: ShipCaller;
let lead: Crew;
let alpha: Crew;
let bravo: Crew;
let charlie: Crew;
let delta: Crew;
let teamA: LabelValueId;
let teamB: LabelValueId;
let listener: DeliveryListener;
let notices: DeliveryNotice[];

async function crewed(name: string, scopes: FleetScope[] = []): Promise<Crew> {
  const { shipId, secret } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name, type: 'implementer', scopes }));
  const { crewToken } = unwrap(await core.useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'CLOUD' }, harness: 'claude-code' }));
  return unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
}

function toTeamA(overrides: Partial<MessageToSend> = {}): MessageToSend {
  return { selector: { kind: 'label', valueIds: [teamA] }, payload: 'main is red', idempotencyKey: newKey(), model: MODEL, ...overrides };
}

function sendMessageWith(uow: UnitOfWork<PrismaTx>) {
  return createSendMessage({ uow, clock: core.clock, ids: newId, hasher: sha256Hasher });
}

/** The Prisma unit of work with a step of the send wrapped: `wrap` gets the transaction's ports and returns them with that step changed. */
function unitOfWorkWith(wrap: (tx: PrismaTx) => PrismaTx): UnitOfWork<PrismaTx> {
  const uow = createPrismaUnitOfWork(core.prisma);
  return { run: (work) => uow.run((tx) => work(wrap(tx))) };
}

async function labelSendCounts() {
  return {
    messages: await core.prisma.message.count({ where: { selectorKind: 'label' } }),
    deliveries: await core.prisma.delivery.count({ where: { message: { selectorKind: 'label' } } }),
    accepted: await core.prisma.event.count({ where: { type: 'MessageAccepted', message: { selectorKind: 'label' } } }),
  };
}

function byId(...ships: Crew[]): ShipId[] {
  return ships.map((ship) => ship.shipId).sort();
}

beforeEach(async () => {
  core = await createPostgresCore();
  const fleet = unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' })));
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  [lead, alpha, bravo, charlie, delta] = [await crewed('lead'), await crewed('alpha'), await crewed('bravo'), await crewed('charlie'), await crewed('delta')];
  const team = unwrap(await core.useCases.defineLabel(argo, { key: 'team', values: ['a', 'b'] }));
  const [a, b] = team.values.map((value) => value.id);
  if (a === undefined || b === undefined) {
    throw new Error('the team label has no values a and b');
  }
  [teamA, teamB] = [a, b];
  for (const [ship, valueId] of [
    [lead, teamA],
    [alpha, teamA],
    [bravo, teamA],
    [charlie, teamA],
    [delta, teamB],
  ] as const) {
    unwrap(await core.useCases.assignLabel(argo, { shipId: ship.shipId, valueId }));
  }
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

describe('a send to a label on Postgres', () => {
  it('stores one message keeping its selection, one pending delivery per ship carrying it with its MessageAccepted, never the sender, waking each after commit', async () => {
    const { messageId } = unwrap(await core.useCases.sendMessage(lead, toTeamA()));

    const stored = await core.prisma.message.findFirstOrThrow({ where: { id: messageId }, include: { deliveries: { orderBy: { recipientShipId: 'asc' } } } });
    expect(stored).toMatchObject({ senderShipId: lead.shipId, selectorKind: 'label', selectorShipId: null, selectorType: null, selectorValueIds: [teamA] });
    expect(stored.deliveries.map(({ recipientShipId, state }) => ({ recipientShipId, state }))).toEqual(byId(alpha, bravo, charlie).map((recipientShipId) => ({ recipientShipId, state: 'pending' })));
    await expect(core.prisma.event.findMany({ where: { messageId, type: 'MessageAccepted' }, select: { shipId: true }, orderBy: { shipId: 'asc' } })).resolves.toEqual(
      byId(alpha, bravo, charlie).map((shipId) => ({ shipId })),
    );
    await expect.poll(() => notices.map((notice) => (notice.recipient.kind === 'ship' ? notice.recipient.shipId : null)).sort()).toEqual(byId(alpha, bravo, charlie));
  });

  it('is received and acknowledged by each ship on its own, the three receiving at once', async () => {
    const { messageId } = unwrap(await core.useCases.sendMessage(lead, toTeamA()));

    const received = await Promise.all(
      [alpha, bravo, charlie].map(async (crew) => unwrap(await core.useCases.receiveDeliveries(crew, { max: 10 })).deliveries.filter((delivery) => delivery.messageId === messageId)),
    );
    const [byAlpha, byBravo] = received;
    unwrap(await core.useCases.acknowledgeDelivery(alpha, { deliveryId: byAlpha?.[0]?.deliveryId ?? newId('delivery') }));
    unwrap(await core.useCases.acknowledgeDelivery(bravo, { deliveryId: byBravo?.[0]?.deliveryId ?? newId('delivery') }));

    expect(received.map((deliveries) => deliveries.length)).toEqual([1, 1, 1]);
    expect(new Set(received.flat().map((delivery) => delivery.deliveryId)).size).toBe(3);
    const states = await core.prisma.delivery.findMany({ where: { messageId }, select: { recipientShipId: true, state: true } });
    expect(Object.fromEntries(states.map(({ recipientShipId, state }) => [recipientShipId, state]))).toEqual({
      [alpha.shipId]: 'acknowledged',
      [bravo.shipId]: 'acknowledged',
      [charlie.shipId]: 'handed',
    });
  });

  it('answers a repeat of its key with the first message after the label moved, storing nothing new', async () => {
    const input = toTeamA();
    const { messageId } = unwrap(await core.useCases.sendMessage(lead, input));
    unwrap(await core.useCases.unassignLabel(argo, { shipId: charlie.shipId, valueId: teamA }));
    unwrap(await core.useCases.assignLabel(argo, { shipId: delta.shipId, valueId: teamA }));

    await expect(core.useCases.sendMessage(lead, input)).resolves.toEqual({ isOk: true, value: { messageId } });
    await expect(labelSendCounts()).resolves.toEqual({ messages: 1, deliveries: 3, accepted: 3 });
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
            create: async (delivery) => {
              created += 1;
              if (created === 2) {
                throw new Error('disk full');
              }
              await tx.deliveries.create(delivery);
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
    await expect(sendMessageWith(unitOfWorkWith(wrap))(lead, toTeamA())).rejects.toThrow('disk full');

    await expect(labelSendCounts()).resolves.toEqual({ messages: 0, deliveries: 0, accepted: 0 });
    const { messageId } = unwrap(await core.useCases.sendMessage(lead, { selector: { kind: 'ship', name: 'argo' }, payload: 'probe', idempotencyKey: newKey(), model: MODEL }));
    const probe = await core.prisma.delivery.findFirstOrThrow({ where: { messageId } });
    await expect.poll(() => notices.map((notice) => notice.deliveryId)).toEqual([probe.id]);
  });

  it('holds each ship of the list: a retire racing the send waits for it, then abandons its delivery', async () => {
    let reachedStore: () => void = () => undefined;
    const stored = new Promise<void>((resolve) => {
      reachedStore = resolve;
    });
    const uow = racingUnitOfWork({ prisma: core.prisma, transactions: 2 }, (tx, allArrived) => ({
      ...tx,
      messages: {
        ...tx.messages,
        create: async (message) => {
          reachedStore();
          await allArrived();
          await tx.messages.create(message);
        },
      },
    }));
    const sending = sendMessageWith(uow)(lead, toTeamA());
    await stored;

    const retiring = createRetireShip({ uow: createPrismaUnitOfWork(core.prisma), clock: core.clock, ids: newId, hasher: sha256Hasher })(argo, { shipId: charlie.shipId });
    const [sent, retired] = await Promise.all([sending, retiring]);

    expect([sent.isOk, retired.isOk]).toEqual([true, true]);
    await expect(core.prisma.delivery.findFirstOrThrow({ where: { message: { selectorKind: 'label' }, recipientShipId: charlie.shipId }, select: { state: true } })).resolves.toEqual({ state: 'abandoned' });
  });
});

describe('reading a send to a label on Postgres', () => {
  it('names its selection by key and value texts in the message, the ship page list and the timeline (R10)', async () => {
    const { messageId } = unwrap(await core.useCases.sendMessage(lead, toTeamA()));
    const named = { kind: 'label', values: [{ valueId: teamA, key: 'team', value: 'a' }] };

    expect(unwrap(await core.useCases.readMessage(argo, { messageId })).recipient).toEqual(named);
    expect(unwrap(await core.useCases.readShipMessages(argo, { shipId: lead.shipId })).items.find((message) => message.id === messageId)?.recipient).toEqual(named);
    expect(unwrap(await core.useCases.readShipTimeline(argo, { shipId: alpha.shipId })).items.find((entry) => entry.message?.id === messageId)?.message?.recipient).toEqual(named);
  });

  it('lists every delivery with its ship, a sender reading them by their value ids as sent', async () => {
    const { messageId } = unwrap(await core.useCases.sendMessage(lead, toTeamA()));

    const read = unwrap(await core.useCases.readMessage(argo, { messageId }));
    const sent = unwrap(await core.useCases.sentMessage(lead, { messageId }));

    expect(read.deliveries.map(({ ship, state }) => ({ shipId: ship?.id, state }))).toEqual(
      byId(alpha, bravo, charlie).map((shipId) => ({ shipId, state: 'pending' })),
    );
    expect(sent.recipient).toEqual({ kind: 'label', valueIds: [teamA] });
    expect(sent.deliveries.map(({ deliveryId }) => deliveryId)).toEqual(read.deliveries.map(({ id }) => id));
  });
});

describe('a send to a label under network rules on Postgres', () => {
  it('refuses the whole send when one ship of the list is out of reach, storing only the refusal', async () => {
    const networking = await crewed('networking', ['fleet:network']);
    const reach = unwrap(await core.useCases.defineLabel(argo, { key: 'reach', values: ['open'] }));
    const open = reach.values[0]?.id ?? newId('labelValue');
    for (const ship of [alpha, bravo]) {
      unwrap(await core.useCases.assignLabel(argo, { shipId: ship.shipId, valueId: open }));
    }
    const { savedAgainstVersion } = unwrap(
      await core.useCases.saveNetworkRulesDraft(networking, { rules: [{ verb: 'send', from: [teamA], to: [open] }, { verb: 'read', from: [], to: [] }, { verb: 'manage', from: [], to: [] }] }),
    );
    unwrap(await core.useCases.applyNetworkRules(networking, { version: savedAgainstVersion }));

    const refused = await core.useCases.sendMessage(lead, toTeamA());

    expect(refused).toEqual({ isOk: false, error: { kind: 'NOT_REACHABLE', message: 'The network rules do not allow this send' } });
    await expect(labelSendCounts()).resolves.toEqual({ messages: 0, deliveries: 0, accepted: 0 });
    await expect(core.prisma.reachRefusal.count({ where: { fleetId } })).resolves.toBe(1);
  });
});
