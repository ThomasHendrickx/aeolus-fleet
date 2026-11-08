import type { DeliveryId, FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, deliveryIdOf, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import { endLease } from '../registry/public.js';
import { UNDELIVERABLE_AT_ATTEMPT } from './delivery.js';
import type { Crew, ShipCaller } from '../shared/caller.js';
import { shipActor } from '../shared/events.js';
import { ok } from '../shared/result.js';
import type { Selector } from '../shared/selector.js';

// The record read (Bridge, CC12): a crew's own ship's deliveries with their
// messages, in any state and across its leases, newest first, paged.

let core: InMemoryCore;
let useCases: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let argo: ShipCaller;
let thomasId: ShipId;
let lookoutId: ShipId;

beforeEach(async () => {
  core = createInMemoryCore('2026-10-31T12:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  const { commissionShip } = registryUseCases(core);
  ({ shipId: thomasId } = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'thomas', type: 'person', kind: 'person' })));
  ({ shipId: lookoutId } = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'lookout', type: 'reviewer' })));
  useCases = messagingUseCases(core);
});

function crewOf(shipId: ShipId): Crew {
  return { ...crewAboard(core, { fleetId, shipId }), kind: 'person' };
}

async function sendTo(selector: Selector, payload: string): Promise<DeliveryId> {
  core.clock.advance(1_000);
  const { messageId } = unwrap(await useCases.sendMessage(argo, { selector, payload, contentType: 'text/plain', idempotencyKey: newKey() }));
  return deliveryIdOf(core, messageId);
}

async function release(crew: Crew): Promise<void> {
  const ended = await core.uow.run(async (tx) =>
    ok(await endLease({ tx, ids: core.ids }, { fleetId, leaseId: crew.leaseId, actor: shipActor(argo.shipId), at: core.clock.now(), reason: 'released' })),
  );
  expect(ended).toEqual(ok(true));
}

describe('the record read', () => {
  it("pages the crew's own ship's deliveries across its leases, newest first, in any state", async () => {
    // Given thomas's first crew acknowledged one delivery and held another received, which went back to pending when its lease ended, and a third came for the next crew.
    const first = crewOf(thomasId);
    const acknowledged = await sendTo({ kind: 'ship', shipId: thomasId }, 'Which design do we build?');
    const returned = await sendTo({ kind: 'ship', shipId: thomasId }, 'PR #1497 is open');
    unwrap(await useCases.pushReceiveDeliveries(first, {}));
    unwrap(await useCases.acknowledgeDelivery(first, { deliveryId: acknowledged }));
    await release(first);
    const next = crewOf(thomasId);
    const pending = await sendTo({ kind: 'ship', shipId: thomasId }, 'Sign in to Slack');

    // When the next crew reads its record two at a time.
    const firstPage = unwrap(await useCases.readRecord(next, { limit: 2 }));
    const secondPage = unwrap(await useCases.readRecord(next, { limit: 2, cursor: firstPage.nextCursor ?? undefined }));

    // Then every delivery shows, newest first, each with its message and state.
    expect(firstPage.items).toMatchObject([
      { deliveryId: pending, state: 'pending', payload: 'Sign in to Slack', senderName: 'argo' },
      { deliveryId: returned, state: 'pending', payload: 'PR #1497 is open' },
    ]);
    expect(firstPage.nextCursor).toBe(returned);
    expect(secondPage).toMatchObject({ items: [{ deliveryId: acknowledged, state: 'acknowledged', payload: 'Which design do we build?' }], nextCursor: null });
  });

  it("holds its ship's deliveries of its type that it claimed, and leaves out every other ship's", async () => {
    // Given a delivery to the lookout, and one to thomas's type that thomas's crew claimed.
    const crew = crewOf(thomasId);
    await sendTo({ kind: 'ship', shipId: lookoutId }, 'Review PR #1497');
    const ofItsType = await sendTo({ kind: 'type', type: 'person' }, 'Who is on call?');
    unwrap(await useCases.pushReceiveDeliveries(crew, {}));

    // When thomas's crew reads its record.
    const page = unwrap(await useCases.readRecord(crew, {}));

    // Then only the one its ship claimed shows.
    expect(page).toMatchObject({ items: [{ deliveryId: ofItsType, state: 'received' }], nextCursor: null });
  });

  it('changes nothing: no state, attempt or event', async () => {
    // Given a delivery thomas's crew received.
    const crew = crewOf(thomasId);
    const deliveryId = await sendTo({ kind: 'ship', shipId: thomasId }, 'PR #1497 is open');
    unwrap(await useCases.pushReceiveDeliveries(crew, {}));
    const before = structuredClone(core.state.deliveries.find((held) => held.id === deliveryId));
    const events = core.state.events.length;

    // When the crew reads its record.
    unwrap(await useCases.readRecord(crew, {}));

    // Then the delivery and the event log are as they were.
    expect(core.state.deliveries.find((held) => held.id === deliveryId)).toEqual(before);
    expect(core.state.events).toHaveLength(events);
  });

  it("names each entry's sender with the status it has now, across senders and delivery states", async () => {
    // Given thomas got one message from argo, acknowledged, one from the lookout, received, and two from the scout, pending;
    // then the lookout retired and the scout's crew was released.
    const crew = crewOf(thomasId);
    const { commissionShip, releaseShip, retireShip } = registryUseCases(core);
    const { shipId: scoutId } = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
    const lookout = crewAboard(core, { fleetId, shipId: lookoutId });
    const scout = crewAboard(core, { fleetId, shipId: scoutId });
    const fromArgo = await sendTo({ kind: 'ship', shipId: thomasId }, 'Which design do we build?');
    unwrap(await useCases.pushReceiveDeliveries(crew, {}));
    unwrap(await useCases.acknowledgeDelivery(crew, { deliveryId: fromArgo }));
    const sendFrom = async (sender: Crew, payload: string): Promise<DeliveryId> => {
      core.clock.advance(1_000);
      const { messageId } = unwrap(
        await useCases.sendMessage(sender, { selector: { kind: 'ship', shipId: thomasId }, payload, model: 'claude-opus-5-5', idempotencyKey: newKey() }),
      );
      return deliveryIdOf(core, messageId);
    };
    const fromLookout = await sendFrom(lookout, 'PR #1497 is open');
    unwrap(await useCases.pushReceiveDeliveries(crew, {}));
    const fromScout = await sendFrom(scout, 'PR #1498 is open');
    const againFromScout = await sendFrom(scout, 'PR #1499 is open');
    unwrap(await retireShip(argo, { shipId: lookoutId }));
    unwrap(await releaseShip(argo, { shipId: scoutId }));

    // When thomas's crew reads its record.
    const page = unwrap(await useCases.readRecord(crew, {}));

    // Then every entry shows, each naming its sender's status now: argo crewed, the lookout retired, the scout awaiting crew.
    expect(page.items.map(({ deliveryId, state, senderShipId, senderName, senderStatus }) => ({ deliveryId, state, senderShipId, senderName, senderStatus }))).toEqual([
      { deliveryId: againFromScout, state: 'pending', senderShipId: scoutId, senderName: 'scout', senderStatus: 'awaitingCrew' },
      { deliveryId: fromScout, state: 'pending', senderShipId: scoutId, senderName: 'scout', senderStatus: 'awaitingCrew' },
      { deliveryId: fromLookout, state: 'received', senderShipId: lookoutId, senderName: 'lookout', senderStatus: 'retired' },
      { deliveryId: fromArgo, state: 'acknowledged', senderShipId: argo.shipId, senderName: 'argo', senderStatus: 'crewed' },
    ]);
  });

  it("names the sender's status on entries handed, handled, undeliverable and abandoned too", async () => {
    // Given, on a pull lease, a message from the scout received five times unacknowledged, one from argo acknowledged and handled,
    // one from the lookout handed, and another from the scout abandoned; then the lookout retired and the scout's crew was released.
    const crew = crewOf(thomasId);
    const { commissionShip, releaseShip, retireShip } = registryUseCases(core);
    const { shipId: scoutId } = unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' }));
    const lookout = crewAboard(core, { fleetId, shipId: lookoutId });
    const scout = crewAboard(core, { fleetId, shipId: scoutId });
    const sendFrom = async (sender: Crew, payload: string): Promise<DeliveryId> => {
      core.clock.advance(1_000);
      const { messageId } = unwrap(
        await useCases.sendMessage(sender, { selector: { kind: 'ship', shipId: thomasId }, payload, model: 'claude-opus-5-5', idempotencyKey: newKey() }),
      );
      return deliveryIdOf(core, messageId);
    };
    const undeliverable = await sendFrom(scout, 'PR #1500 is open');
    for (let attempt = 0; attempt < UNDELIVERABLE_AT_ATTEMPT; attempt += 1) {
      unwrap(await useCases.receiveDeliveries(crew, {}));
    }
    const handled = await sendTo({ kind: 'ship', shipId: thomasId }, 'Which design do we build?');
    unwrap(await useCases.receiveDeliveries(crew, {}));
    unwrap(await useCases.acknowledgeDelivery(crew, { deliveryId: handled }));
    unwrap(await useCases.reportHandled(crew, { deliveryId: handled }));
    const handed = await sendFrom(lookout, 'PR #1501 is open');
    unwrap(await useCases.receiveDeliveries(crew, {}));
    const abandoned = await sendFrom(scout, 'PR #1502 is open');
    // Only a retire abandons a delivery, and only one to the retired ship, whose crew then reads no record: the state is set here.
    const stored = core.state.deliveries.find((held) => held.id === abandoned);
    if (stored) {
      stored.state = 'abandoned';
    }
    unwrap(await retireShip(argo, { shipId: lookoutId }));
    unwrap(await releaseShip(argo, { shipId: scoutId }));

    // When thomas's crew reads its record.
    const page = unwrap(await useCases.readRecord(crew, {}));

    // Then each entry keeps its state, payload and attempts, and names its sender's status now.
    expect(
      page.items.map(({ deliveryId, state, payload, attempts, senderShipId, senderStatus }) => ({ deliveryId, state, payload, attempts, senderShipId, senderStatus })),
    ).toEqual([
      { deliveryId: abandoned, state: 'abandoned', payload: 'PR #1502 is open', attempts: 0, senderShipId: scoutId, senderStatus: 'awaitingCrew' },
      { deliveryId: handed, state: 'handed', payload: 'PR #1501 is open', attempts: 1, senderShipId: lookoutId, senderStatus: 'retired' },
      { deliveryId: handled, state: 'handled', payload: 'Which design do we build?', attempts: 1, senderShipId: argo.shipId, senderStatus: 'crewed' },
      { deliveryId: undeliverable, state: 'undeliverable', payload: 'PR #1500 is open', attempts: UNDELIVERABLE_AT_ATTEMPT, senderShipId: scoutId, senderStatus: 'awaitingCrew' },
    ]);
  });

  it('refuses a crew whose lease ended', async () => {
    // Given a crew whose lease ended.
    const crew = crewOf(thomasId);
    await release(crew);

    // When it reads its record.
    const read = await useCases.readRecord(crew, {});

    // Then it is refused as LEASE_ENDED.
    expect(read).toMatchObject({ isOk: false, error: { kind: 'LEASE_ENDED' } });
  });
});
