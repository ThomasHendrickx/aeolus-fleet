import type { FleetId, MessageId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, initialiseFleet, messagingUseCases, modelOf, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
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

async function send(from: ShipCaller, to: Selector, payload: string, more: { inReplyTo?: MessageId } = {}): Promise<MessageId> {
  core.clock.advance(1_000);
  const { messageId } = unwrap(await useCases.sendMessage(from, { selector: to, payload, contentType: 'text/plain', idempotencyKey: newKey(), ...modelOf(from), ...more }));
  return messageId;
}

describe('the exchange read', () => {
  it('reads what the other ship sent that reached the caller and what the caller sent that reached it, newest first', async () => {
    // Given the lookout asked thomas, thomas answered it, and the lookout acknowledged the answer.
    const asked = await send(lookout, { kind: 'ship', shipId: thomasId }, 'Merge PR #1497?');
    const answered = await send(thomas, { kind: 'ship', shipId: lookoutId }, 'Yes, merge it', { inReplyTo: asked });
    unwrap(await useCases.receiveDeliveries(lookout, {}));
    const [answerDelivery] = core.state.deliveries.filter((delivery) => delivery.messageId === answered);
    unwrap(await useCases.acknowledgeDelivery(lookout, { deliveryId: answerDelivery?.id ?? '' }));

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
        },
        {
          messageId: asked,
          senderShipId: lookoutId,
          payload: 'Merge PR #1497?',
          contentType: 'text/plain',
          inReplyTo: null,
          sentAt: new Date('2026-11-06T12:00:01.000Z'),
          deliveryState: null,
        },
      ],
      olderCursor: null,
      newerCursor: null,
    });
  });

  it("holds a message to the caller's type it claimed, and leaves pings and every other ship's messages out", async () => {
    // Given the lookout sent thomas's type a message thomas's crew claimed, argo pinged thomas, and argo wrote to thomas.
    const ofItsType = await send(lookout, { kind: 'type', type: 'person' }, 'Who is on call?');
    unwrap(await useCases.pushReceiveDeliveries(thomas, {}));
    core.clock.advance(1_000);
    unwrap(await useCases.pingShip(argo, { shipId: lookoutId }));
    await send(argo, { kind: 'ship', shipId: thomasId }, 'PR #1497 is open');

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
      sent.push(await send(lookout, { kind: 'ship', shipId: thomasId }, `Note ${String(n)}`));
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
      await send(lookout, { kind: 'ship', shipId: thomasId }, `Note ${String(n)}`);
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
      sent.push(await send(lookout, { kind: 'ship', shipId: thomasId }, `Note ${String(n)}`));
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
    const fromArgo = await send(argo, { kind: 'ship', shipId: thomasId }, 'PR #1497 is open');

    // When thomas opens its exchange with the lookout at argo's message, and reads one with a ship of no fleet.
    const around = await useCases.readExchange(thomas, { otherShipId: lookoutId, around: fromArgo });
    const unknown = await useCases.readExchange(thomas, { otherShipId: core.ids('ship') });

    // Then both are refused.
    expect(around).toMatchObject({ isOk: false, error: { kind: 'MESSAGE_NOT_FOUND' } });
    expect(unknown).toMatchObject({ isOk: false, error: { kind: 'SHIP_NOT_FOUND' } });
  });

  it('reads the exchange with a retired ship by id', async () => {
    // Given the lookout wrote to thomas, then retired.
    await send(lookout, { kind: 'ship', shipId: thomasId }, 'Done for today');
    unwrap(await registryUseCases(core).retireShip(argo, { shipId: lookoutId }));

    // When thomas reads its exchange with it.
    const page = unwrap(await useCases.readExchange(thomas, { otherShipId: lookoutId }));

    // Then its message is still there.
    expect(page.items.map((item) => item.payload)).toEqual(['Done for today']);
  });
});
