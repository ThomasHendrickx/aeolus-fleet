import { NOTICE_CONTENT_TYPE, QUESTION_CONTENT_TYPE, STEP_CONTENT_TYPE, type DeliveryState, type FleetId, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, deliveryIdOf, initialiseFleet, messagingUseCases, modelOf, operatorCaller, registryUseCases } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import type { Crew, ShipCaller } from '../shared/caller.js';

// Seen up to here (docs/design/exchange-read, E6, E7): a person ship's crew
// acknowledges the other ship's plain deliveries to it up to one message, in
// one call; questions, steps, alerts and notices stay as they are.

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

async function send(from: ShipCaller, { to, payload, contentType = 'text/plain' }: { to: ShipId; payload: string; contentType?: string }): Promise<MessageId> {
  core.clock.advance(1_000);
  const model = from.kind === 'agent' ? modelOf(from) : {};
  const { messageId } = unwrap(await useCases.sendMessage(from, { selector: { kind: 'ship', shipId: to }, payload, contentType, idempotencyKey: newKey(), ...model }));
  return messageId;
}

function stateOf(messageId: MessageId): DeliveryState | undefined {
  return core.state.deliveries.find((delivery) => delivery.messageId === messageId)?.state;
}

describe('seen up to here', () => {
  it("acknowledges the other ship's plain deliveries to the caller up to the message, pending, received or handed, each with DeliveryAcknowledged", async () => {
    // Given the lookout wrote thomas four times: the first handed to thomas, the second received, the third pending; and a fourth after them.
    const handed = await send(lookout, { to: thomas.shipId, payload: 'Note 1' });
    unwrap(await useCases.pushReceiveDeliveries(thomas, {}));
    unwrap(await useCases.handOverDelivery(thomas, { deliveryId: deliveryIdOf(core, handed), handOverNumber: 1 }));
    const received = await send(lookout, { to: thomas.shipId, payload: 'Note 2' });
    unwrap(await useCases.pushReceiveDeliveries(thomas, { max: 10 }));
    const pending = await send(lookout, { to: thomas.shipId, payload: 'Note 3' });
    const after = await send(lookout, { to: thomas.shipId, payload: 'Note 4' });
    const events = core.state.events.length;

    // When thomas's crew marks its exchange with the lookout seen up to the third.
    const seen = unwrap(await useCases.acknowledgeUpTo(thomas, { otherShipId: lookout.shipId, messageId: pending }));

    // Then the three are acknowledged, each with its event and no attempt counted, and the fourth waits.
    expect(seen).toEqual({ acknowledged: 3 });
    expect([handed, received, pending, after].map(stateOf)).toEqual(['acknowledged', 'acknowledged', 'acknowledged', 'pending']);
    expect(core.state.events.slice(events).map((event) => [event.type, event.deliveryId])).toEqual([
      ['DeliveryAcknowledged', deliveryIdOf(core, handed)],
      ['DeliveryAcknowledged', deliveryIdOf(core, received)],
      ['DeliveryAcknowledged', deliveryIdOf(core, pending)],
    ]);
    expect(core.state.deliveries.find((delivery) => delivery.messageId === pending)).toMatchObject({ attempts: 0, claimedByShipId: thomas.shipId, claimedByLeaseId: thomas.leaseId });
  });

  it('leaves questions, steps and notices as they are, and every other ship\'s messages', async () => {
    // Given the lookout asked thomas a question, asked a step, sent a notice and a plain note, and the scout wrote thomas too.
    const question = await send(lookout, { to: thomas.shipId, payload: '{"id":"q-1","title":"Which design?"}', contentType: QUESTION_CONTENT_TYPE });
    const step = await send(lookout, { to: thomas.shipId, payload: '{"id":"s-1","title":"Sign in","why":"Only you can"}', contentType: STEP_CONTENT_TYPE });
    const notice = await send(lookout, { to: thomas.shipId, payload: '{"headline":"PR #1497 is open","body":"Ready"}', contentType: NOTICE_CONTENT_TYPE });
    const fromScout = await send(scout, { to: thomas.shipId, payload: 'Found the bug' });
    const note = await send(lookout, { to: thomas.shipId, payload: 'Merge it?' });

    // When thomas's crew marks its exchange with the lookout seen up to the note.
    const seen = unwrap(await useCases.acknowledgeUpTo(thomas, { otherShipId: lookout.shipId, messageId: note }));

    // Then only the note is acknowledged.
    expect(seen).toEqual({ acknowledged: 1 });
    expect([question, step, notice, fromScout, note].map(stateOf)).toEqual(['pending', 'pending', 'pending', 'pending', 'acknowledged']);
  });

  it('changes nothing the second time, answering none acknowledged', async () => {
    // Given thomas's crew marked its exchange with the lookout seen up to its note.
    const note = await send(lookout, { to: thomas.shipId, payload: 'Merge it?' });
    unwrap(await useCases.acknowledgeUpTo(thomas, { otherShipId: lookout.shipId, messageId: note }));
    const events = core.state.events.length;

    // When it does so again.
    const again = unwrap(await useCases.acknowledgeUpTo(thomas, { otherShipId: lookout.shipId, messageId: note }));

    // Then nothing changes.
    expect(again).toEqual({ acknowledged: 0 });
    expect(core.state.events).toHaveLength(events);
  });

  it("refuses a message that is not the other ship's to the caller as MESSAGE_NOT_FOUND", async () => {
    // Given thomas wrote the lookout, and the scout wrote thomas.
    const fromThomas = await send(thomas, { to: lookout.shipId, payload: 'Merge it' });
    const fromScout = await send(scout, { to: thomas.shipId, payload: 'Found the bug' });

    // When thomas's crew marks its exchange with the lookout seen up to either.
    const own = await useCases.acknowledgeUpTo(thomas, { otherShipId: lookout.shipId, messageId: fromThomas });
    const another = await useCases.acknowledgeUpTo(thomas, { otherShipId: lookout.shipId, messageId: fromScout });

    // Then both are refused, and nothing is acknowledged.
    expect(own).toMatchObject({ isOk: false, error: { kind: 'MESSAGE_NOT_FOUND' } });
    expect(another).toMatchObject({ isOk: false, error: { kind: 'MESSAGE_NOT_FOUND' } });
    expect(stateOf(fromScout)).toBe('pending');
  });

  it("refuses the crew of a ship that is not a person ship: an agent's ack stays its confirmation of what was handed", async () => {
    // Given the scout wrote the lookout.
    const note = await send(scout, { to: lookout.shipId, payload: 'Found the bug' });

    // When the lookout's crew marks its exchange with the scout seen up to it.
    const seen = await useCases.acknowledgeUpTo(lookout, { otherShipId: scout.shipId, messageId: note });

    // Then it is refused, and the delivery waits.
    expect(seen).toMatchObject({ isOk: false, error: { kind: 'NOT_A_PERSON_SHIP' } });
    expect(stateOf(note)).toBe('pending');
  });
});
