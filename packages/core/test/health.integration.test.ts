import { createIdGenerator, idSchema, type DeliveryId, type MessageId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { UNDELIVERABLE_AT_ATTEMPT } from '../src/domain/messaging/delivery.js';
import type { Caller, Crew } from '../src/domain/shared/caller.js';
import type { Selector } from '../src/domain/shared/selector.js';
import { OPERATOR, operatorCaller, secretOf, modelOf } from './support/core-fixtures.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';
import { unwrap } from './support/result.js';
import { newKey } from './support/keys.js';

// The fleet health on a real Postgres (decision 0042): the stuck deliveries by
// cause and place, read from the ships, leases, deliveries and their events,
// the trend replayed from them, and the acknowledged with their median.

const newId = createIdGenerator();
const SECOND_MS = 1_000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;

let core: PostgresCore;
let argo: Caller;
let scout: Crew;
let planner: Crew;

async function commission(ship: { name: string; type: string }) {
  return unwrap(await core.useCases.commissionShip(argo, { ...ship, idempotencyKey: newKey() }));
}

async function crewed(ship: { name: string; type: string }): Promise<Crew> {
  const { shipId, secret } = await commission(ship);
  const { crewToken } = unwrap(await core.useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'DEVICE' }, harness: 'claude-code' }));
  return unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
}

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await core.useCases.initialiseFleet({ name: 'home fleet', ...OPERATOR })));
  scout = await crewed({ name: 'scout', type: 'tester' });
  planner = await crewed({ name: 'planner', type: 'planner' });
});

afterEach(async () => {
  await core.close();
});

async function sendTo(selector: Selector): Promise<MessageId> {
  core.clock.advance(SECOND_MS);
  return unwrap(
    await core.useCases.sendMessage(planner, { ...modelOf(planner), selector, payload: 'Test pr-304', contentType: 'text/plain', idempotencyKey: `key-${newId('message')}` }),
  ).messageId;
}

async function deliveryOf(messageId: MessageId): Promise<DeliveryId> {
  const { id } = await core.prisma.delivery.findFirstOrThrow({ where: { messageId } });
  return idSchema('delivery').parse(id);
}

const toScout = (): Selector => ({ kind: 'ship', shipId: scout.shipId });

describe('the fleet health on Postgres', () => {
  it('places a delivery to a type whose last ship retired at the type, and replays it into the trend', async () => {
    await sendTo({ kind: 'type', type: 'planner' });
    const sentAt = core.clock.now();
    unwrap(await core.useCases.retireShip(argo, { shipId: planner.shipId }));
    core.clock.advance(2 * HOUR_MS);

    const health = await core.useCases.readHealth(argo);

    expect(health.stuck).toEqual([{ cause: 'noShipCanTake', place: { kind: 'type', type: 'planner' }, count: 1, oldestSince: sentAt }]);
    expect(health.stuckPerHour).toHaveLength(168);
    expect(health.stuckPerHour.slice(-4).map((hour) => hour.count)).toEqual([0, 1, 1, 1]);
  });

  it('places a delivery to a ship awaiting crew at that ship, with the machine its crew request is assigned to', async () => {
    const docsWriter = await commission({ name: 'docs-writer', type: 'writer' });
    const macStudio = await crewed({ name: 'mac-studio', type: 'trierarch' });
    const crewedAt = core.clock.now();
    await core.prisma.crewRequest.create({
      data: { fleetId: argo.fleetId, shipId: docsWriter.shipId, settings: {}, settingsVersion: 1, requestedAt: crewedAt, assignedTo: macStudio.shipId },
    });
    await sendTo({ kind: 'ship', shipId: docsWriter.shipId });
    const sentAt = core.clock.now();

    await expect(core.useCases.readHealth(argo)).resolves.toMatchObject({
      stuck: [
        {
          cause: 'waitingForCrew',
          place: { kind: 'ship', ship: { id: docsWriter.shipId, name: 'docs-writer' }, machine: { id: macStudio.shipId, name: 'mac-studio', lastSeenAt: crewedAt } },
          count: 1,
          oldestSince: sentAt,
        },
      ],
    });
  });

  it('places a delivery handed on a plain lease whose session went quiet for 10 minutes at its ship', async () => {
    await sendTo(toScout());
    core.clock.advance(SECOND_MS);
    unwrap(await core.useCases.receiveDeliveries(scout, {}));
    const handedAt = core.clock.now();
    core.clock.advance(10 * MINUTE_MS);

    await expect(core.useCases.readHealth(argo)).resolves.toMatchObject({
      stuck: [{ cause: 'stalledInFlight', place: { kind: 'ship', ship: { id: scout.shipId, name: 'scout' }, machine: null }, oldestSince: handedAt }],
    });
  });

  it('places a delivery received on a pushed lease at its ship once its busy clock ran out, not before', async () => {
    await sendTo(toScout());
    unwrap(await core.useCases.reportTurn(scout, { turn: 'busy', at: core.clock.now() }));
    unwrap(await core.useCases.pushReceiveDeliveries(scout, {}));
    core.clock.advance(59 * MINUTE_MS);
    const before = await core.useCases.readHealth(argo);
    core.clock.advance(MINUTE_MS);

    expect(before.stuck).toEqual([]);
    await expect(core.useCases.readHealth(argo)).resolves.toMatchObject({ stuck: [{ cause: 'stalledInFlight', place: { kind: 'ship', ship: { name: 'scout' } } }] });
  });

  it('places an undeliverable delivery at the ship whose fifth attempt made it so', async () => {
    const messageId = await sendTo(toScout());
    const next = await sendTo(toScout());
    for (let claim = 1; claim <= UNDELIVERABLE_AT_ATTEMPT; claim += 1) {
      core.clock.advance(SECOND_MS);
      unwrap(await core.useCases.receiveDeliveries(scout, {}));
    }
    unwrap(await core.useCases.acknowledgeDelivery(scout, { deliveryId: await deliveryOf(next) }));
    const stored = await core.prisma.delivery.findUniqueOrThrow({ where: { id: await deliveryOf(messageId) } });

    expect(stored.state).toBe('undeliverable');
    await expect(core.useCases.readHealth(argo)).resolves.toMatchObject({ stuck: [{ cause: 'undeliverable', place: { kind: 'ship', ship: { name: 'scout' } }, count: 1 }] });
  });

  it('counts the deliveries acknowledged in the last 24 hours, with the median time from send to acknowledgement', async () => {
    const before = await sendTo(toScout());
    unwrap(await core.useCases.receiveDeliveries(scout, {}));
    unwrap(await core.useCases.acknowledgeDelivery(scout, { deliveryId: await deliveryOf(before) }));
    core.clock.advance(25 * HOUR_MS);
    for (const waits of [2 * SECOND_MS, 10 * SECOND_MS, 60 * SECOND_MS]) {
      const messageId = await sendTo(toScout());
      core.clock.advance(waits);
      unwrap(await core.useCases.receiveDeliveries(scout, {}));
      unwrap(await core.useCases.acknowledgeDelivery(scout, { deliveryId: await deliveryOf(messageId) }));
    }

    await expect(core.useCases.readHealth(argo)).resolves.toMatchObject({ stuck: [], acknowledged: { count: 3, medianMs: 10 * SECOND_MS } });
  });
});
