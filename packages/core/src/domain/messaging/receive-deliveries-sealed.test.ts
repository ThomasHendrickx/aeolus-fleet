import type { DeliveryId, FleetId, MessageId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { crewAboard, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, sealFleet } from '../../../test/support/core-fixtures.js';
import { createInMemoryCore, type InMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import { endLease } from '../registry/public.js';
import type { Crew, ShipCaller } from '../shared/caller.js';
import { shipActor } from '../shared/events.js';
import { ok } from '../shared/result.js';
import { DATA_KEY_CACHE_MS } from './data-keys.js';

let core: InMemoryCore;
let useCases: ReturnType<typeof messagingUseCases>;
let fleetId: FleetId;
let argo: ShipCaller;
let scoutId: ShipId;
let scout: Crew;
let companyKey: string;

/** A payload with bytes past ASCII, so it comes back exactly or not at all. */
const PAYLOAD = 'Review https://github.com/ThomasHendrickx/aeolus-fleet/pull/1373, before 5 € lunch';

beforeEach(async () => {
  core = createInMemoryCore('2026-10-29T12:00:00.000Z');
  const fleet = await initialiseFleet(core);
  ({ fleetId } = fleet);
  argo = operatorCaller(fleet);
  ({ shipId: scoutId } = unwrap(await registryUseCases(core).commissionShip(argo, { idempotencyKey: newKey(), name: 'scout', type: 'reviewer' })));
  scout = crewAboard(core, { fleetId, shipId: scoutId });
  useCases = messagingUseCases(core);
  companyKey = await sealFleet(core, fleetId);
  core.state.events.length = 0;
});

async function sentToScout(options: { inReplyTo?: MessageId } = {}): Promise<{ messageId: MessageId; deliveryId: DeliveryId }> {
  const { messageId } = unwrap(
    await useCases.sendMessage(argo, { selector: { kind: 'ship', shipId: scoutId }, payload: PAYLOAD, contentType: 'text/plain', idempotencyKey: newKey(), ...options }),
  );
  const delivery = core.state.deliveries.find((held) => held.messageId === messageId);
  expect(delivery).toBeDefined();
  return { messageId, deliveryId: delivery?.id ?? core.ids('delivery') };
}

describe('a receive in a sealed fleet (decision 0068, B9)', () => {
  it('scenario 12: a pending sealed delivery is received with its plain payload, exactly as sent', async () => {
    const { deliveryId } = await sentToScout();

    const { deliveries } = unwrap(await useCases.receiveDeliveries(scout, {}));

    expect(deliveries.map(({ deliveryId: id, payload }) => ({ id, payload }))).toEqual([{ id: deliveryId, payload: PAYLOAD }]);
  });

  it('scenario 12: a push receive, a re-read and a receive of a reply answer the plain payload too', async () => {
    const { messageId, deliveryId } = await sentToScout();
    const [pushed] = unwrap(await useCases.pushReceiveDeliveries(scout, {})).deliveries;
    unwrap(await useCases.acknowledgeDelivery(scout, { deliveryId }));
    const reread = unwrap(await useCases.readDelivery(scout, { deliveryId }));
    const asker = crewAboard(core, { fleetId, shipId: argo.shipId });
    unwrap(await useCases.sendMessage(scout, { selector: { kind: 'ship', shipId: argo.shipId }, payload: PAYLOAD, contentType: 'text/plain', idempotencyKey: newKey(), inReplyTo: messageId, model: 'claude-opus-5-5' }));

    const [reply] = unwrap(await useCases.receiveReply(asker, { messageId })).deliveries;

    expect([pushed?.payload, reread.payload, reply?.payload]).toEqual([PAYLOAD, PAYLOAD, PAYLOAD]);
  });

  it('scenario 14: a sealed delivery received and not acknowledged is received with its plain payload by the next crew once the lease ends', async () => {
    const { deliveryId } = await sentToScout();
    unwrap(await useCases.receiveDeliveries(scout, {}));
    unwrap(await core.uow.run(async (tx) => ok(await endLease({ tx, ids: core.ids }, { fleetId, leaseId: scout.leaseId, actor: shipActor(argo.shipId), at: core.clock.now(), reason: 'released' }))));
    const nextCrew = crewAboard(core, { fleetId, shipId: scoutId });

    const { deliveries } = unwrap(await useCases.receiveDeliveries(nextCrew, {}));

    expect(deliveries.map(({ deliveryId: id, payload, attempts }) => ({ id, payload, attempts }))).toEqual([{ id: deliveryId, payload: PAYLOAD, attempts: 2 }]);
  });

  it('scenario 13: with the company key disabled and the data key cache run out, a receive is refused KEY_UNAVAILABLE, claims nothing and counts no attempt: the delivery waits pending', async () => {
    const { deliveryId } = await sentToScout();
    await core.keyVault.disable(companyKey);
    core.clock.advance(DATA_KEY_CACHE_MS);
    const before = structuredClone(core.state);

    const refusal = refusalOf(await useCases.receiveDeliveries(scout, {}));

    expect(refusal.kind).toBe('KEY_UNAVAILABLE');
    expect({ deliveries: core.state.deliveries, leases: core.state.leases }).toEqual({ deliveries: before.deliveries, leases: before.leases });
    expect(core.state.events.slice(before.events.length).map(({ type }) => type)).toEqual(['FleetKeyUnavailable']);
    expect(core.state.deliveries.find((held) => held.id === deliveryId)).toMatchObject({ state: 'pending', attempts: 0 });
  });

  it('with the key cut off, a re-read and a receive of a reply are refused KEY_UNAVAILABLE and claim nothing', async () => {
    const { messageId, deliveryId } = await sentToScout();
    unwrap(await useCases.receiveDeliveries(scout, {}));
    unwrap(await useCases.acknowledgeDelivery(scout, { deliveryId }));
    const asker = crewAboard(core, { fleetId, shipId: argo.shipId });
    unwrap(await useCases.sendMessage(scout, { selector: { kind: 'ship', shipId: argo.shipId }, payload: PAYLOAD, contentType: 'text/plain', idempotencyKey: newKey(), inReplyTo: messageId, model: 'claude-opus-5-5' }));
    await core.keyVault.disable(companyKey);
    core.clock.advance(DATA_KEY_CACHE_MS);
    const before = structuredClone(core.state.deliveries);

    const reread = refusalOf(await useCases.readDelivery(scout, { deliveryId }));
    const reply = refusalOf(await useCases.receiveReply(asker, { messageId }));

    expect([reread.kind, reply.kind]).toEqual(['KEY_UNAVAILABLE', 'KEY_UNAVAILABLE']);
    expect(core.state.deliveries).toEqual(before);
  });
});
