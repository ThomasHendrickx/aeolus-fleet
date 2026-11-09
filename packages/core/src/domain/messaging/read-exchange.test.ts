import type { DeliveryId, FleetId, MessageId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, deliveryIdOf, initialiseFleet, messagingUseCases, modelOf, operatorCaller, registryUseCases, sealFleet } from '../../../test/support/core-fixtures.js';
import { valueIdOf } from '../../../test/support/label-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import { DATA_KEY_CACHE_MS } from './data-keys.js';
import { createCloseHealthSnapshots } from '../shared/close-health-snapshots.js';
import { createPruneHistory } from '../shared/prune-history.js';
import type { Crew, ShipCaller } from '../shared/caller.js';
import type { Selector } from '../shared/selector.js';

// The exchange read (docs/design/exchange-read, E1 to E3, E9, E10): what the
// calling ship and one other ship said to each other, both ways, newest
// first, a page at a time.

let core: InMemoryCore;
let useCases: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let argo: ShipCaller;
let thomasId: ShipId;
let lookoutId: ShipId;
let thomas: Crew;
let lookout: Crew;

beforeEach(async () => {
  core = createInMemoryCore('2026-11-06T12:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  const { commissionShip } = registryUseCases(core);
  ({ shipId: thomasId } = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind: 'person' })));
  ({ shipId: lookoutId } = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'lookout', type: 'reviewer' })));
  useCases = messagingUseCases(core);
  thomas = { ...crewAboard(core, { fleetId, shipId: thomasId }), kind: 'person' };
  lookout = crewAboard(core, { fleetId, shipId: lookoutId });
});

async function send(from: ShipCaller, { to, payload, inReplyTo }: { to: Selector; payload: string; inReplyTo?: MessageId }): Promise<MessageId> {
  core.clock.advance(1_000);
  const { messageId } = unwrap(await useCases.sendMessage(from, { selector: to, payload, contentType: 'text/plain', idempotencyKey: newKey(), ...(from.kind === 'agent' ? modelOf(from) : {}), ...(inReplyTo && { inReplyTo }) }));
  return messageId;
}

/** The ship's own delivery of the message: to it by name or label, or of its type once it claimed it. */
function deliveryOf(messageId: MessageId, shipId: ShipId): DeliveryId | undefined {
  return core.state.deliveries.find((held) => held.messageId === messageId && (held.claimedByShipId === shipId || (held.recipient.kind === 'ship' && held.recipient.shipId === shipId)))?.id;
}

describe('the exchange read', () => {
  it('reads what the other ship sent that reached the caller and what the caller sent that reached it, newest first', async () => {
    // Given the lookout asked thomas, thomas answered it, and the lookout acknowledged the answer.
    const asked = await send(lookout, { to: { kind: 'ship', shipId: thomasId }, payload: 'Merge PR #1497?' });
    const answered = await send(thomas, { to: { kind: 'ship', shipId: lookoutId }, payload: 'Yes, merge it', inReplyTo: asked });
    unwrap(await useCases.receiveDeliveries(lookout, {}));
    unwrap(await useCases.acknowledgeDelivery(lookout, { deliveryId: deliveryIdOf(core, answered) }));

    // When thomas reads its exchange with the lookout.
    const page = unwrap(await useCases.readExchange(thomas, { otherShipId: lookoutId }));

    // Then both messages show, newest first, each whole, and thomas's own with the lookout's delivery state.
    expect(page).toEqual({
      items: [
        {
          messageId: answered,
          senderShipId: thomasId,
          payload: 'Yes, merge it',
          contentType: 'text/plain',
          inReplyTo: asked,
          sentAt: new Date('2026-11-06T12:00:02.000Z'),
          deliveryState: 'acknowledged',
          receivedDelivery: null,
        },
        {
          messageId: asked,
          senderShipId: lookoutId,
          payload: 'Merge PR #1497?',
          contentType: 'text/plain',
          inReplyTo: null,
          sentAt: new Date('2026-11-06T12:00:01.000Z'),
          deliveryState: null,
          receivedDelivery: { deliveryId: deliveryIdOf(core, asked), state: 'pending' },
        },
      ],
      olderCursor: null,
      newerCursor: null,
      prunedUpTo: null,
    });
  });

  it("holds a message to the caller's type it claimed, and leaves pings and every other ship's messages out", async () => {
    // Given the lookout sent thomas's type a message thomas's crew claimed, argo pinged thomas, and argo wrote to thomas.
    const ofItsType = await send(lookout, { to: { kind: 'type', type: 'person' }, payload: 'Who is on call?' });
    unwrap(await useCases.pushReceiveDeliveries(thomas, {}));
    core.clock.advance(1_000);
    unwrap(await useCases.pingShip(argo, { shipId: lookoutId }));
    await send(argo, { to: { kind: 'ship', shipId: thomasId }, payload: 'PR #1497 is open' });

    // When thomas reads its exchange with the lookout, and the lookout its exchange with argo.
    const withLookout = unwrap(await useCases.readExchange(thomas, { otherShipId: lookoutId }));
    const withArgo = unwrap(await useCases.readExchange(lookout, { otherShipId: argo.shipId }));

    // Then the claimed one shows, and the ping does not.
    expect(withLookout.items.map((item) => item.messageId)).toEqual([ofItsType]);
    expect(withArgo.items).toEqual([]);
  });

  it('pages older and newer from a cursor', async () => {
    // Given the lookout sent thomas five messages.
    const sent: MessageId[] = [];
    for (const n of [1, 2, 3, 4, 5]) {
      sent.push(await send(lookout, { to: { kind: 'ship', shipId: thomasId }, payload: `Note ${String(n)}` }));
    }

    // When thomas reads two at a time, older from the newest page, then newer from that page.
    const newest = unwrap(await useCases.readExchange(thomas, { otherShipId: lookoutId, limit: 2 }));
    const older = unwrap(await useCases.readExchange(thomas, { otherShipId: lookoutId, limit: 2, before: newest.olderCursor ?? undefined }));
    const newer = unwrap(await useCases.readExchange(thomas, { otherShipId: lookoutId, limit: 2, after: older.newerCursor ?? undefined }));

    // Then each page holds the next two, newest first, with a cursor each way while more lie that way.
    expect(newest.items.map((item) => item.payload)).toEqual(['Note 5', 'Note 4']);
    expect(newest.newerCursor).toBeNull();
    expect(older.items.map((item) => item.payload)).toEqual(['Note 3', 'Note 2']);
    expect(older.olderCursor).not.toBeNull();
    expect(newer.items.map((item) => item.payload)).toEqual(['Note 5', 'Note 4']);
    expect(newer.newerCursor).toBeNull();
  });

  it('pages 20 unless asked', async () => {
    // Given the lookout sent thomas 21 messages.
    for (let n = 1; n <= 21; n += 1) {
      await send(lookout, { to: { kind: 'ship', shipId: thomasId }, payload: `Note ${String(n)}` });
    }

    // When thomas reads its exchange without a limit.
    const page = unwrap(await useCases.readExchange(thomas, { otherShipId: lookoutId }));

    // Then 20 come, and one lies older.
    expect(page.items).toHaveLength(20);
    expect(page.olderCursor).not.toBeNull();
  });

  it('opens at one message: up to 10 newer, the message and up to 9 older', async () => {
    // Given the lookout sent thomas 25 messages.
    const sent: MessageId[] = [];
    for (let n = 1; n <= 25; n += 1) {
      sent.push(await send(lookout, { to: { kind: 'ship', shipId: thomasId }, payload: `Note ${String(n)}` }));
    }

    // When thomas opens its exchange at the 12th.
    const page = unwrap(await useCases.readExchange(thomas, { otherShipId: lookoutId, around: sent[11] }));

    // Then the 22nd down to the 3rd show, with cursors both ways.
    expect(page.items.map((item) => item.payload)).toEqual(Array.from({ length: 20 }, (_, index) => `Note ${String(22 - index)}`));
    expect(page.olderCursor).not.toBeNull();
    expect(page.newerCursor).not.toBeNull();
  });

  it('refuses a message not in the exchange as MESSAGE_NOT_FOUND, and a ship not in the fleet as SHIP_NOT_FOUND', async () => {
    // Given argo wrote to thomas.
    const fromArgo = await send(argo, { to: { kind: 'ship', shipId: thomasId }, payload: 'PR #1497 is open' });

    // When thomas opens its exchange with the lookout at argo's message, and reads one with a ship of no fleet.
    const around = await useCases.readExchange(thomas, { otherShipId: lookoutId, around: fromArgo });
    const unknown = await useCases.readExchange(thomas, { otherShipId: core.ids('ship') });

    // Then both are refused.
    expect(around).toMatchObject({ isOk: false, error: { kind: 'MESSAGE_NOT_FOUND' } });
    expect(unknown).toMatchObject({ isOk: false, error: { kind: 'SHIP_NOT_FOUND' } });
  });

  it('reads the exchange with a retired ship by id', async () => {
    // Given the lookout wrote to thomas, then retired.
    await send(lookout, { to: { kind: 'ship', shipId: thomasId }, payload: 'Done for today' });
    unwrap(await registryUseCases(core).retireShip(argo, { shipId: lookoutId }));

    // When thomas reads its exchange with it.
    const page = unwrap(await useCases.readExchange(thomas, { otherShipId: lookoutId }));

    // Then its message is still there.
    expect(page.items.map((item) => item.payload)).toEqual(['Done for today']);
  });
});

// The reader's delivery on each message it received (docs/design/exchange-read, section 7, D1).
describe("the exchange read's delivery of each message the reader received", () => {
  it("carries the reader's delivery id and its state on a message the other ship sent by name", async () => {
    // Given the lookout asked thomas by name.
    const asked = await send(lookout, { to: { kind: 'ship', shipId: thomasId }, payload: 'Merge PR #1497?' });

    // When thomas reads its exchange with the lookout.
    const page = unwrap(await useCases.readExchange(thomas, { otherShipId: lookoutId }));

    // Then the message carries thomas's own delivery of it, pending.
    expect(page.items.map(({ messageId, deliveryState, receivedDelivery }) => ({ messageId, deliveryState, receivedDelivery }))).toEqual([
      { messageId: asked, deliveryState: null, receivedDelivery: { deliveryId: deliveryOf(asked, thomasId), state: 'pending' } },
    ]);
  });

  it("carries the claimed delivery on a message of the reader's type it claimed", async () => {
    // Given the lookout sent thomas's type a message thomas's crew claimed.
    const ofItsType = await send(lookout, { to: { kind: 'type', type: 'person' }, payload: 'Who is on call?' });
    unwrap(await useCases.pushReceiveDeliveries(thomas, {}));

    // When thomas reads its exchange with the lookout.
    const page = unwrap(await useCases.readExchange(thomas, { otherShipId: lookoutId }));

    // Then the message carries the delivery thomas claimed, received.
    expect(page.items.map((item) => item.receivedDelivery)).toEqual([{ deliveryId: deliveryOf(ofItsType, thomasId), state: 'received' }]);
  });

  it("carries the reader's delivery of a label send to it and another ship, never the other's", async () => {
    // Given the lookout sent a label thomas and argo hold, and argo acknowledged its delivery.
    unwrap(await registryUseCases(core).defineLabel(argo, { key: 'team', values: ['bridge'] }));
    const valueId = valueIdOf(core, { key: 'team', value: 'bridge' });
    for (const shipId of [thomasId, argo.shipId]) {
      unwrap(await registryUseCases(core).assignLabel(argo, { shipId, valueId }));
    }
    const byLabel = await send(lookout, { to: { kind: 'label', valueIds: [valueId] }, payload: 'Standup in five' });
    const argoCrew = crewAboard(core, argo);
    for (const { deliveryId } of unwrap(await useCases.receiveDeliveries(argoCrew, {})).deliveries) {
      unwrap(await useCases.acknowledgeDelivery(argoCrew, { deliveryId }));
    }

    // When thomas reads its exchange with the lookout.
    const page = unwrap(await useCases.readExchange(thomas, { otherShipId: lookoutId }));

    // Then the message carries thomas's own delivery, still pending, not argo's.
    expect(page.items.map((item) => item.receivedDelivery)).toEqual([{ deliveryId: deliveryOf(byLabel, thomasId), state: 'pending' }]);
  });

  it("carries no delivery on the reader's own message, and deliveryState still the other ship's", async () => {
    // Given thomas wrote to the lookout, and the lookout received it.
    const told = await send(thomas, { to: { kind: 'ship', shipId: lookoutId }, payload: 'Merge it' });
    unwrap(await useCases.receiveDeliveries(lookout, {}));

    // When thomas reads its exchange with the lookout.
    const page = unwrap(await useCases.readExchange(thomas, { otherShipId: lookoutId }));

    // Then the message carries no delivery of thomas's, and the lookout's delivery state.
    expect(page.items.map(({ messageId, deliveryState, receivedDelivery }) => ({ messageId, deliveryState, receivedDelivery }))).toEqual([
      { messageId: told, deliveryState: 'handed', receivedDelivery: null },
    ]);
  });

  it('answers acknowledged once the reader acknowledged it, on the page around the message too', async () => {
    // Given the lookout asked thomas, and thomas received and acknowledged it.
    const asked = await send(lookout, { to: { kind: 'ship', shipId: thomasId }, payload: 'Merge PR #1497?' });
    for (const { deliveryId } of unwrap(await useCases.receiveDeliveries(thomas, {})).deliveries) {
      unwrap(await useCases.acknowledgeDelivery(thomas, { deliveryId }));
    }

    // When thomas reads its exchange with the lookout, and the page around the message.
    const newest = unwrap(await useCases.readExchange(thomas, { otherShipId: lookoutId }));
    const around = unwrap(await useCases.readExchange(thomas, { otherShipId: lookoutId, around: asked }));

    // Then both carry its delivery, acknowledged.
    const acknowledged = [{ deliveryId: deliveryOf(asked, thomasId), state: 'acknowledged' }];
    expect(newest.items.map((item) => item.receivedDelivery)).toEqual(acknowledged);
    expect(around.items.map((item) => item.receivedDelivery)).toEqual(acknowledged);
  });

  it('carries the delivery on a message whose payload is marked unreadable', async () => {
    // Given a sealed fleet in which the lookout wrote to thomas, then the fleet's key was cut off.
    const fleetKey = await sealFleet(core, fleetId);
    const asked = await send(lookout, { to: { kind: 'ship', shipId: thomasId }, payload: 'Merge PR #1497?' });
    await core.keyVault.disable(fleetKey);
    core.clock.advance(DATA_KEY_CACHE_MS);

    // When thomas reads its exchange with the lookout.
    const page = unwrap(await useCases.readExchange(thomas, { otherShipId: lookoutId }));

    // Then the payload is unreadable and its delivery is still there.
    expect(page.items.map(({ payload, receivedDelivery }) => ({ payload, receivedDelivery }))).toEqual([
      { payload: { kind: 'unreadable' }, receivedDelivery: { deliveryId: deliveryOf(asked, thomasId), state: 'pending' } },
    ]);
  });
});

// Where the exchange's history ends (docs/design/exchange-history, section 5):
// every page answers the newest send time pruning removed of the exchange, or
// null when pruning removed none of it.
describe("the exchange read's mark of how far pruning went", () => {
  const DAY_MS = 24 * 60 * 60 * 1000;
  const RETENTION_DAYS = 30;

  /** The fleet keeps 30 days; the 30 second pass runs past them: the snapshot close, then the pruning pass. */
  async function passPastRetention(): Promise<void> {
    core.state.fleetLimitSettings.push({
      fleetId,
      ships: { kind: 'default' },
      dailyMessages: { kind: 'default' },
      schedulesPerShip: { kind: 'default' },
      minimumScheduleInterval: { kind: 'default' },
      retention: { kind: 'fleet', days: RETENTION_DAYS },
    });
    core.clock.advance((RETENTION_DAYS + 1) * DAY_MS);
    await createCloseHealthSnapshots({ fleets: core.fleets, uow: core.uow, clock: core.clock })();
    await createPruneHistory({ fleets: core.fleets, uow: core.uow, clock: core.clock, ids: core.ids })(() => undefined);
  }

  async function acknowledgeAll(crew: Crew): Promise<void> {
    for (const { deliveryId } of unwrap(await useCases.receiveDeliveries(crew, { max: 10 })).deliveries) {
      unwrap(await useCases.acknowledgeDelivery(crew, { deliveryId }));
    }
  }

  /** The newest page one at a time, the older one from it, the newer one from that, and the page around the middle message. */
  async function everyPage(crew: Crew, { otherShipId, middle }: { otherShipId: ShipId; middle: MessageId | undefined }) {
    const newest = unwrap(await useCases.readExchange(crew, { otherShipId, limit: 1 }));
    const older = unwrap(await useCases.readExchange(crew, { otherShipId, limit: 1, before: newest.olderCursor ?? undefined }));
    const newer = unwrap(await useCases.readExchange(crew, { otherShipId, limit: 1, after: older.olderCursor ?? undefined }));
    const around = unwrap(await useCases.readExchange(crew, { otherShipId, limit: 3, around: middle }));
    return [newest, older, newer, around].map((page) => page.prunedUpTo);
  }

  it('answers null on every page while pruning removed none of the exchange, though it pruned another', async () => {
    // Given argo wrote the lookout, which acknowledged it, and a pass past the retention let it go; then the lookout sent thomas three notes.
    await send(argo, { to: { kind: 'ship', shipId: lookoutId }, payload: 'Standup moved' });
    await acknowledgeAll(lookout);
    await passPastRetention();
    const notes: MessageId[] = [];
    for (const n of [1, 2, 3]) {
      notes.push(await send(lookout, { to: { kind: 'ship', shipId: thomasId }, payload: `Note ${String(n)}` }));
    }

    // When thomas reads every page of its exchange with the lookout.
    const marks = await everyPage(thomas, { otherShipId: lookoutId, middle: notes[1] });

    // Then each says pruning removed none of it.
    expect(marks).toEqual([null, null, null, null]);
  });

  it('answers the newest send time pruning removed on every page, whichever of the two ships reads', async () => {
    // Given the lookout sent thomas two notes and thomas answered once, each acknowledged, a pass past the retention let them go, and then the lookout sent thomas three more.
    await send(lookout, { to: { kind: 'ship', shipId: thomasId }, payload: 'Old note 1' });
    await send(lookout, { to: { kind: 'ship', shipId: thomasId }, payload: 'Old note 2' });
    await acknowledgeAll(thomas);
    await send(thomas, { to: { kind: 'ship', shipId: lookoutId }, payload: 'Old answer' });
    await acknowledgeAll(lookout);
    await passPastRetention();
    const notes: MessageId[] = [];
    for (const n of [1, 2, 3]) {
      notes.push(await send(lookout, { to: { kind: 'ship', shipId: thomasId }, payload: `Note ${String(n)}` }));
    }
    const middle = notes[1];

    // When thomas reads every page of its exchange with the lookout, and the lookout every page of its exchange with thomas.
    const byThomas = await everyPage(thomas, { otherShipId: lookoutId, middle });
    const byLookout = await everyPage(lookout, { otherShipId: thomasId, middle });

    // Then each answers the send time of the old answer, the newest message that went.
    const oldAnswerSentAt = new Date('2026-11-06T12:00:03.000Z');
    expect(byThomas).toEqual([oldAnswerSentAt, oldAnswerSentAt, oldAnswerSentAt, oldAnswerSentAt]);
    expect(byLookout).toEqual([oldAnswerSentAt, oldAnswerSentAt, oldAnswerSentAt, oldAnswerSentAt]);
  });
});
