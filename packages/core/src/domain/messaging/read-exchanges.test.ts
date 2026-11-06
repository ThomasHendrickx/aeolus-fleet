import type { FleetId, MessageId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, deliveryIdOf, initialiseFleet, messagingUseCases, modelOf, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import type { Crew, ShipCaller } from '../shared/caller.js';

// The list of exchanges (docs/design/exchange-read, E2, E4, E5, E10): per
// other ship a person ship exchanged with, the newest message between them
// and how many of the other ship's messages to it are not yet acknowledged,
// newest first, a page at a time.

let core: InMemoryCore;
let useCases: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let argo: ShipCaller;
let thomas: Crew;
let lookout: Crew;
let scout: Crew;

beforeEach(async () => {
  core = createInMemoryCore('2026-11-06T12:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  const { commissionShip } = registryUseCases(core);
  const commissioned = async (name: string, ship: { type: string; kind?: 'person' }): Promise<ShipId> =>
    unwrap(await commissionShip(argo, { idempotencyKey: newKey(), name, ...ship })).shipId;
  thomas = { ...crewAboard(core, { fleetId, shipId: await commissioned('thomas', { type: 'person', kind: 'person' }) }), kind: 'person' };
  lookout = crewAboard(core, { fleetId, shipId: await commissioned('lookout', { type: 'reviewer' }) });
  scout = crewAboard(core, { fleetId, shipId: await commissioned('scout', { type: 'scout' }) });
  useCases = messagingUseCases(core);
});

async function send(from: ShipCaller, { to, payload }: { to: ShipId; payload: string }): Promise<MessageId> {
  core.clock.advance(1_000);
  const model = from.kind === 'agent' ? modelOf(from) : {};
  const { messageId } = unwrap(await useCases.sendMessage(from, { selector: { kind: 'ship', shipId: to }, payload, contentType: 'text/plain', idempotencyKey: newKey(), ...model }));
  return messageId;
}

describe('the list of exchanges', () => {
  it('lists each other ship, newest exchange first, with its newest message and how many of its messages are not yet acknowledged', async () => {
    // Given the lookout wrote thomas twice, thomas acknowledged one and the other waits; then the scout wrote, and thomas answered the scout.
    const first = await send(lookout, { to: thomas.shipId, payload: 'Merge PR #1497?' });
    await send(lookout, { to: thomas.shipId, payload: 'And PR #1498?' });
    unwrap(await useCases.receiveDeliveries(thomas, {}));
    unwrap(await useCases.acknowledgeDelivery(thomas, { deliveryId: deliveryIdOf(core, first) }));
    await send(scout, { to: thomas.shipId, payload: 'Found the bug' });
    const answer = await send(thomas, { to: scout.shipId, payload: 'Thanks' });

    // When thomas lists its exchanges.
    const page = unwrap(await useCases.readExchanges(thomas, {}));

    // Then the scout comes first with thomas's answer and one waiting, then the lookout with one waiting.
    expect(page).toMatchObject({
      items: [
        {
          otherShipId: scout.shipId,
          otherShipName: 'scout',
          otherShipType: 'scout',
          otherShipKind: 'agent',
          unacknowledged: 1,
          newestMessage: { messageId: answer, senderShipId: thomas.shipId, payload: 'Thanks', contentType: 'text/plain', sentAt: new Date('2026-11-06T12:00:04.000Z') },
        },
        { otherShipId: lookout.shipId, otherShipName: 'lookout', unacknowledged: 1, newestMessage: { payload: 'And PR #1498?' } },
      ],
      nextCursor: null,
    });
  });

  it('pages newest first from a cursor', async () => {
    // Given the lookout, the scout and argo each wrote thomas, in that order.
    await send(lookout, { to: thomas.shipId, payload: 'Merge PR #1497?' });
    await send(scout, { to: thomas.shipId, payload: 'Found the bug' });
    await send(argo, { to: thomas.shipId, payload: 'Standup in five' });

    // When thomas lists its exchanges two at a time.
    const firstPage = unwrap(await useCases.readExchanges(thomas, { limit: 2 }));
    const secondPage = unwrap(await useCases.readExchanges(thomas, { limit: 2, cursor: firstPage.nextCursor ?? undefined }));

    // Then argo and the scout come first, then the lookout.
    expect(firstPage.items.map((item) => item.otherShipName)).toEqual(['argo', 'scout']);
    expect(secondPage).toMatchObject({ items: [{ otherShipName: 'lookout' }], nextCursor: null });
  });

  it('leaves a retired ship out', async () => {
    // Given the lookout and the scout wrote thomas, and the lookout retired.
    await send(lookout, { to: thomas.shipId, payload: 'Merge PR #1497?' });
    await send(scout, { to: thomas.shipId, payload: 'Found the bug' });
    unwrap(await registryUseCases(core).retireShip(argo, { shipId: lookout.shipId }));

    // When thomas lists its exchanges.
    const page = unwrap(await useCases.readExchanges(thomas, {}));

    // Then only the scout shows.
    expect(page.items.map((item) => item.otherShipName)).toEqual(['scout']);
  });

  it('lists nothing for a ship that is not a person ship: the rollup is kept for person ships', async () => {
    // Given the scout wrote the lookout.
    await send(scout, { to: lookout.shipId, payload: 'Found the bug' });

    // When the lookout lists its exchanges.
    const page = unwrap(await useCases.readExchanges(lookout, {}));

    // Then none show.
    expect(page).toEqual({ items: [], nextCursor: null });
  });
});
