import type { DeliveryId, FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, deliveryIdOf, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import { endLease } from '../registry/public.js';
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
