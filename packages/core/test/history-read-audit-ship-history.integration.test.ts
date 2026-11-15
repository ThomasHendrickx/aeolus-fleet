/**
 * The ship history reads on a fleet with a long history (holding scale, H3):
 * each request path's statements on messages, deliveries and events, by plan.
 */
import { idSchema } from '@aeolus-fleet/common';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createPrismaShipHistory } from '../src/adapters/prisma/history.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { SCALE_MESSAGES, seedScaleHistory, type ScaleHistory } from './support/scale-history.js';
import { plansOf, scansIn } from './support/statement-plans.js';

let core: PostgresCore;
let scale: ScaleHistory;

beforeAll(async () => {
  core = await createPostgresCore();
  scale = await seedScaleHistory(core);
}, 600_000);

afterAll(async () => {
  await core.close();
});

/** The statements `read` runs on the history tables that scan one of them, by table. */
async function scansOf(read: (history: ReturnType<typeof createPrismaShipHistory>) => Promise<unknown>): Promise<string[]> {
  const plans = await plansOf(core, ({ client }) => read(createPrismaShipHistory(client)));
  expect(plans.length).toBeGreaterThan(0);
  return scansIn(plans).flatMap(({ tables }) => tables);
}

describe('the ship history reads on a fleet with 120,000 messages', () => {
  const ship = () => scale.shipId(42);
  const message = () => idSchema('message').parse(scale.messageId(SCALE_MESSAGES / 2));
  const delivery = () => idSchema('delivery').parse(scale.deliveryId(SCALE_MESSAGES / 2));

  it('fleet.shipTimeline pages a ship\'s events through its indexes', async () => {
    expect(await scansOf((history) => history.timeline(scale.fleetId, { shipId: ship(), limit: 20 }))).toEqual([]);
  });

  it('fleet.shipMessages pages a ship\'s messages through its indexes', async () => {
    expect(await scansOf((history) => history.messages(scale.fleetId, { shipId: ship(), limit: 20 }))).toEqual([]);
  });

  it('fleet.message, fleet.messageDeliveries, ship.sentMessage and fleet.shipWay read one message through its indexes', async () => {
    expect(await scansOf((history) => history.message(scale.fleetId, message()))).toEqual([]);
  });

  it('fleet.messageDeliveries pages a message\'s deliveries through its indexes', async () => {
    expect(await scansOf((history) => history.messageDeliveries(scale.fleetId, { messageId: message(), limit: 20 }))).toEqual([]);
  });

  it('fleet.events, fleet.follow and the report tasks read a page\'s message parties through their indexes', async () => {
    expect(await scansOf((history) => history.messageParties(scale.fleetId, [message()]))).toEqual([]);
  });

  it('fleet.inboxCount counts a ship\'s open inbox through its indexes', async () => {
    expect(await scansOf((history) => history.openInboxCount(scale.fleetId, { shipId: ship(), senderIds: new Set([scale.shipId(35)]) }))).toEqual([]);
  });

  it.each(['open', 'done', 'all'] as const)('fleet.inbox pages the %s inbox of a ship through its indexes', async (filter) => {
    expect(await scansOf((history) => history.inbox(scale.fleetId, { shipId: ship(), filter, limit: 20 }))).toEqual([]);
  });

  it('fleet.inboxMessage reads one inbox entry through its indexes', async () => {
    expect(await scansOf((history) => history.inboxMessage(scale.fleetId, { shipId: scale.shipId(1 + ((SCALE_MESSAGES / 2 + 7) % 2_999)), deliveryId: delivery() }))).toEqual([]);
  });

  it('fleet.inboxWithdrawals pages a question\'s withdrawals through its indexes', async () => {
    expect(await scansOf((history) => history.inboxWithdrawals(scale.fleetId, { shipId: ship(), questionId: 'a-question', limit: 20 }))).toEqual([]);
  });

  it('fleet.needsAttention pages the fleet\'s deliveries that need attention through their indexes', async () => {
    expect(await scansOf((history) => history.needsAttention(scale.fleetId, { limit: 20 }))).toEqual([]);
  });

  it('fleet.needsAttention pages one ship\'s deliveries that need attention through their indexes', async () => {
    expect(await scansOf((history) => history.needsAttention(scale.fleetId, { shipId: ship(), state: 'undeliverable', limit: 20 }))).toEqual([]);
  });

  it('fleet.shipWay reads a ship\'s waiting deliveries through their indexes', async () => {
    expect(await scansOf((history) => history.shipWay(scale.fleetId, ship()))).toEqual([]);
  });
});
