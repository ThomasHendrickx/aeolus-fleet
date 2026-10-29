import type { DeliveryId, FleetId, MessageId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, deliveryIdOf, initialiseFleet, messagingUseCases, modelOf, operatorCaller, registryUseCases, sealFleet } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { unwrap } from '../../testing/result.js';
import type { Crew, ShipCaller } from '../shared/caller.js';
import { UNDELIVERABLE_AT_ATTEMPT } from './delivery.js';

let core: InMemoryCore;
let useCases: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let argo: ShipCaller;
let scoutId: ShipId;
let scout: Crew;
let planner: Crew;

/** A payload with bytes past ASCII, so it comes back exactly or not at all. */
const PAYLOAD = '{"run":"e2e","ref":"pr-1373","note":"5 € café"}';

beforeEach(async () => {
  core = createInMemoryCore('2026-10-29T12:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  const registry = registryUseCases(core);
  ({ shipId: scoutId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'tester' })));
  const { shipId: plannerId } = unwrap(await registry.commissionShip(argo, { idempotencyKey: newKey(), name: 'planner', type: 'planner' }));
  scout = crewAboard(core, { fleetId, shipId: scoutId });
  planner = crewAboard(core, { fleetId, shipId: plannerId });
  useCases = messagingUseCases(core);
  await sealFleet(core, fleetId);
  core.clock.advance(60_000);
});

/** A sealed message from planner that the scout's crew received five times without acknowledging it: undeliverable. */
async function undeliverable(): Promise<{ deliveryId: DeliveryId; messageId: MessageId }> {
  const { messageId } = unwrap(
    await useCases.sendMessage(planner, { ...modelOf(planner), selector: { kind: 'ship', shipId: scoutId }, payload: PAYLOAD, contentType: 'application/json', idempotencyKey: newKey() }),
  );
  const deliveryId = deliveryIdOf(core, messageId);
  for (let claim = 1; claim <= UNDELIVERABLE_AT_ATTEMPT; claim += 1) {
    unwrap(await useCases.receiveDeliveries(scout, {}));
  }
  expect(core.state.deliveries.find((held) => held.id === deliveryId)?.state).toBe('undeliverable');
  core.clock.advance(60_000);
  return { deliveryId, messageId };
}

describe('a resend in a sealed fleet (decision 0068, B17)', () => {
  it("scenario 16: a resend of a sealed undeliverable message is sealed for its own id, and its recipient reads the original's payload", async () => {
    const { deliveryId, messageId: originalId } = await undeliverable();

    const { messageId } = unwrap(await useCases.resendDelivery(argo, { deliveryId }));

    const original = core.state.messages.find((held) => held.id === originalId);
    const resent = core.state.messages.find((held) => held.id === messageId);
    expect(resent?.payload).toMatchObject({ plainBytes: 50 });
    expect(resent?.payload).not.toEqual(original?.payload);
    expect(JSON.stringify(core.state.messages)).not.toContain('café');
    const { deliveries } = unwrap(await useCases.receiveDeliveries(scout, {}));
    expect(deliveries.map(({ messageId: id, payload }) => ({ id, payload }))).toEqual([{ id: messageId, payload: PAYLOAD }]);
  });

  it("a second resend of the delivery answers the first one's message and stores nothing", async () => {
    const { deliveryId } = await undeliverable();
    const first = unwrap(await useCases.resendDelivery(argo, { deliveryId }));
    const before = structuredClone(core.state);

    const again = unwrap(await useCases.resendDelivery(argo, { deliveryId }));

    expect(again).toEqual(first);
    expect(core.state).toEqual(before);
  });
});
