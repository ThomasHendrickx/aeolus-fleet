import { idSchema, type DeliveryId, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Caller, Crew } from '../src/core/shared/caller.js';
import type { Selector } from '../src/core/shared/selector.js';
import { OPERATOR, operatorCaller, secretOf, modelOf } from './support/core-fixtures.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from './support/result.js';
import { newKey } from './support/keys.js';

// The history reads on a real Postgres through the Prisma adapter: a ship's
// timeline and messages and one message's delivery history, within the
// caller's fleet, as two ships exchange messages and a type delivery is
// claimed, returned and claimed again.

let core: PostgresCore;
let argo: Caller;
let scout: Crew;
let lookout: Crew;
let planner: Crew;

async function crewed(ship: { name: string; type: string; location: { kind: 'DEVICE' | 'SERVER' } }): Promise<Crew> {
  const { name, type, location } = ship;
  const { shipId, secret } = unwrap(await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name, type }));
  const { crewToken } = unwrap(await core.useCases.claimShip({ shipId, secret: secretOf(secret), location, harness: 'claude-code' }));
  return unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
}

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await core.useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
  scout = await crewed({ name: 'scout', type: 'reviewer', location: { kind: 'DEVICE' } });
  lookout = await crewed({ name: 'lookout', type: 'reviewer', location: { kind: 'SERVER' } });
  planner = await crewed({ name: 'planner', type: 'planner', location: { kind: 'DEVICE' } });
});

afterEach(async () => {
  await core.close();
});

async function send(from: Caller, message: { to: Selector; payload?: string; inReplyTo?: MessageId }): Promise<MessageId> {
  core.clock.advance(1_000);
  const { to, payload = 'Review PR 48', inReplyTo } = message;
  return unwrap(
    await core.useCases.sendMessage(from, { ...modelOf(from),
      selector: to,
      payload,
      contentType: 'text/plain',
      idempotencyKey: `key-${String(core.clock.now().getTime())}`,
      ...(inReplyTo === undefined ? {} : { inReplyTo }),
    }),
  ).messageId;
}

async function receive(crew: Crew): Promise<DeliveryId[]> {
  core.clock.advance(1_000);
  return unwrap(await core.useCases.receiveDeliveries(crew, { max: 10 })).deliveries.map((delivery) => delivery.deliveryId);
}

async function ack(crew: Crew, deliveryId: DeliveryId | undefined): Promise<void> {
  core.clock.advance(1_000);
  unwrap(await core.useCases.acknowledgeDelivery(crew, { deliveryId: idSchema('delivery').parse(deliveryId) }));
}

describe('the history reads on Postgres', () => {
  it("give a ship's timeline: the events naming it or caused by it, newest first, with the parties named", async () => {
    const messageId = await send(scout, { to: { kind: 'ship', shipId: planner.shipId } });

    const timeline = unwrap(await core.useCases.readShipTimeline(argo, { shipId: scout.shipId }));

    expect(timeline.map((entry) => entry.type)).toEqual([
      'MessageAccepted',
      'ShipClaimed',
      'StartingPromptIssued',
      'ShipCommissioned',
    ]);
    expect(timeline[0]).toMatchObject({
      actor: { id: scout.shipId, name: 'scout' },
      ship: { id: planner.shipId, name: 'planner' },
      message: {
        id: messageId,
        sender: { id: scout.shipId, name: 'scout' },
        recipient: { kind: 'ship', ship: { id: planner.shipId, name: 'planner' } },
        contentType: 'text/plain',
        model: 'claude-opus-5-5',
      },
      details: { selector: 'ship' },
    });
    expect(timeline.at(-1)).toMatchObject({ actor: { id: argo.shipId, name: 'argo' }, message: null });
  });

  it("give a ship's messages: sent, received and claimed by type, newest first, with a preview and the delivery now", async () => {
    const asked = await send(planner, { to: { kind: 'ship', shipId: scout.shipId }, payload: 'Can you\n  review   PR 48?' });
    const [askedDelivery] = await receive(scout);
    await ack(scout, askedDelivery);
    const answered = await send(scout, { to: { kind: 'ship', shipId: planner.shipId }, inReplyTo: asked });
    const toReviewers = await send(planner, { to: { kind: 'type', type: 'reviewer' } });
    await receive(lookout);

    const scoutMessages = unwrap(await core.useCases.readShipMessages(argo, { shipId: scout.shipId }));
    const lookoutMessages = unwrap(await core.useCases.readShipMessages(argo, { shipId: lookout.shipId }));

    expect(scoutMessages).toMatchObject([
      { id: answered, inReplyTo: asked, delivery: { state: 'pending', claimedBy: null } },
      {
        id: asked,
        sender: { name: 'planner' },
        recipient: { kind: 'ship', ship: { name: 'scout' } },
        preview: 'Can you review PR 48?',
        delivery: { state: 'acknowledged', claimedBy: { id: scout.shipId, name: 'scout' } },
      },
    ]);
    expect(scoutMessages).toHaveLength(2);
    expect(lookoutMessages).toMatchObject([
      { id: toReviewers, recipient: { kind: 'type', type: 'reviewer' }, delivery: { state: 'delivered', claimedBy: { name: 'lookout' } } },
    ]);
  });

  it("give one message with its delivery's history: stored, claimed where the session ran, returned and claimed again", async () => {
    const messageId = await send(planner, { to: { kind: 'type', type: 'reviewer' }, payload: '{"pr":48}' });
    await receive(scout);
    unwrap(await core.useCases.releaseShip(argo, { shipId: scout.shipId }));
    const [deliveryId] = await receive(lookout);
    await ack(lookout, deliveryId);

    const message = unwrap(await core.useCases.readMessage(argo, { messageId }));

    expect(message).toMatchObject({
      id: messageId,
      sender: { name: 'planner' },
      recipient: { kind: 'type', type: 'reviewer' },
      payload: '{"pr":48}',
      delivery: { state: 'acknowledged', attempts: 2, claimedBy: { name: 'lookout' } },
    });
    expect(message.delivery.history).toMatchObject([
      { type: 'DeliveryAcknowledged', ship: { name: 'lookout' }, location: null, attempts: null },
      { type: 'DeliveryClaimed', ship: { name: 'lookout' }, location: { kind: 'SERVER', description: null }, harness: 'claude-code', attempts: 2 },
      { type: 'DeliveryReturned', ship: { name: 'scout' }, location: null, attempts: 1 },
      { type: 'DeliveryClaimed', ship: { name: 'scout' }, location: { kind: 'DEVICE', description: null }, harness: 'claude-code', attempts: 1 },
      { type: 'MessageAccepted', ship: null, location: null, attempts: null },
    ]);
  });

  it('know no ship or message of another fleet', async () => {
    const messageId = await send(planner, { to: { kind: 'ship', shipId: scout.shipId } });
    const elsewhere = { ...argo, fleetId: idSchema('fleet').parse(`flt_${'0'.repeat(26)}`) };
    const shipId: ShipId = scout.shipId;

    await expect(core.useCases.readShipTimeline(elsewhere, { shipId })).resolves.toMatchObject({ error: { kind: 'SHIP_NOT_FOUND' } });
    await expect(core.useCases.readShipMessages(elsewhere, { shipId })).resolves.toMatchObject({ error: { kind: 'SHIP_NOT_FOUND' } });
    await expect(core.useCases.readMessage(elsewhere, { messageId })).resolves.toMatchObject({ error: { kind: 'MESSAGE_NOT_FOUND' } });
  });
});
