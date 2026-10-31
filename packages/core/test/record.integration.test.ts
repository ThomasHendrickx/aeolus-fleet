import { idSchema, QUESTION_CONTENT_TYPE, type DeliveryId, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaDeliveryRepository } from '../src/adapters/prisma/messaging.js';
import type { Crew, ShipCaller } from '../src/domain/shared/caller.js';
import { newKey } from '../src/testing/keys.js';
import { refusalOf, unwrap } from '../src/testing/result.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';

// The record read and the lease rule on a real Postgres (Bridge, CC12): a
// crew reads its ship's deliveries with their messages across its leases,
// newest first, paged, within its fleet and what the fleet's retention keeps;
// a person ship's next crew finishes what an earlier lease acknowledged, and
// any other kind of ship keeps the per-lease rule.

const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 30;

let core: PostgresCore;
let argo: ShipCaller;

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' }))));
});

afterEach(async () => {
  await core.close();
});

async function commissioned(ship: { name: string; kind: 'person' | 'agent' }): Promise<{ shipId: ShipId; secret: string }> {
  const { shipId, secret } = unwrap(await core.useCases.commissionShip(argo, { ...ship, type: ship.kind === 'person' ? 'person' : 'reviewer', idempotencyKey: newKey() }));
  return { shipId, secret: secretOf(secret) };
}

async function crewWith(shipId: ShipId, secret: string): Promise<Crew> {
  const { crewToken } = unwrap(await core.useCases.claimShip({ shipId, secret, location: { kind: 'CLOUD' }, harness: 'claude-code' }));
  return unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
}

/** Releases the ship, ending its crew's lease, and crews it again under a new one. */
async function nextCrewOf(shipId: ShipId): Promise<Crew> {
  unwrap(await core.useCases.releaseShip(argo, { shipId }));
  const { secret } = unwrap(await core.useCases.getStartingPrompt(argo, { shipId }));
  return crewWith(shipId, secretOf(secret));
}

async function sendTo(shipId: ShipId, message: { payload: string; contentType?: string }): Promise<DeliveryId> {
  core.clock.advance(1_000);
  const { messageId } = unwrap(
    await core.useCases.sendMessage(argo, { selector: { kind: 'ship', shipId }, contentType: 'text/plain', ...message, idempotencyKey: newKey() }),
  );
  return idSchema('delivery').parse((await core.prisma.delivery.findFirstOrThrow({ where: { messageId } })).id);
}

/** Push received by the crew, handed as number 1 and acknowledged, as the gateway takes a person ship's delivery. */
async function acknowledgedBy(crew: Crew, deliveryId: DeliveryId): Promise<void> {
  unwrap(await core.useCases.pushReceiveDeliveries(crew, {}));
  unwrap(await core.useCases.handOverDelivery(crew, { deliveryId, handOverNumber: 1 }));
  unwrap(await core.useCases.acknowledgeDelivery(crew, { deliveryId }));
}

describe('the record read on Postgres', () => {
  it("pages a ship's deliveries across two leases, newest first, each with its message and state", async () => {
    // Given thomas's first crew acknowledged a question and its lease ended, and a notice came for the next crew.
    const thomas = await commissioned({ name: 'thomas', kind: 'person' });
    const first = await crewWith(thomas.shipId, thomas.secret);
    const question = await sendTo(thomas.shipId, { payload: '{"id":"q-1","title":"Which design?"}', contentType: QUESTION_CONTENT_TYPE });
    await acknowledgedBy(first, question);
    const next = await nextCrewOf(thomas.shipId);
    const notice = await sendTo(thomas.shipId, { payload: 'PR #1497 is open' });

    // When the next crew reads its record one at a time.
    const firstPage = unwrap(await core.useCases.readRecord(next, { limit: 1 }));
    const secondPage = unwrap(await core.useCases.readRecord(next, { limit: 1, cursor: firstPage.nextCursor ?? undefined }));

    // Then the newest comes first, and the one the earlier lease took follows.
    expect(firstPage).toMatchObject({ items: [{ deliveryId: notice, state: 'pending', payload: 'PR #1497 is open', senderName: 'argo' }], nextCursor: notice });
    expect(secondPage).toMatchObject({
      items: [{ deliveryId: question, state: 'acknowledged', contentType: QUESTION_CONTENT_TYPE, payload: '{"id":"q-1","title":"Which design?"}' }],
      nextCursor: null,
    });
  });

  it("reads only within the ship's fleet", async () => {
    // Given a delivery to thomas in its fleet.
    const thomas = await commissioned({ name: 'thomas', kind: 'person' });
    await sendTo(thomas.shipId, { payload: 'PR #1497 is open' });
    const elsewhere = idSchema('fleet').parse(`flt_${'0'.repeat(26)}`);

    // When the record of the same ship is read in another fleet.
    const page = await createPrismaDeliveryRepository(core.prisma).findRecordPage({ fleetId: elsewhere, shipId: thomas.shipId, limit: 20 });

    // Then it holds nothing.
    expect(page).toEqual({ items: [], nextCursor: null });
  });

  it("holds what the fleet's retention keeps: a finished delivery past it goes, an open question stays", async () => {
    // Given a 30 day retention, a delivery thomas finished and a question still open, both older than it.
    await core.prisma.$executeRaw`UPDATE fleets SET retention_set = true, retention_days = ${RETENTION_DAYS} WHERE id = ${argo.fleetId}`;
    const thomas = await commissioned({ name: 'thomas', kind: 'person' });
    const crew = await crewWith(thomas.shipId, thomas.secret);
    const finished = await sendTo(thomas.shipId, { payload: 'Release 0.36.0 is out' });
    await acknowledgedBy(crew, finished);
    unwrap(await core.useCases.reportHandled(crew, { deliveryId: finished }));
    const open = await sendTo(thomas.shipId, { payload: '{"id":"q-2","title":"Merge it?"}', contentType: QUESTION_CONTENT_TYPE });
    core.clock.advance((RETENTION_DAYS + 1) * DAY_MS);
    await core.useCases.closeHealthSnapshots();
    await core.useCases.pruneHistory();

    // When thomas's crew reads its record.
    const page = unwrap(await core.useCases.readRecord(crew, {}));

    // Then only the open question is there.
    expect(page.items.map((item) => item.deliveryId)).toEqual([open]);
  });
});

describe("the lease rule on Postgres: finishing a ship's delivery under its next lease", () => {
  it("reports handled under a person ship's next lease a delivery acknowledged under the one before", async () => {
    // Given thomas's delivery acknowledged by its first crew, whose lease ended.
    const thomas = await commissioned({ name: 'thomas', kind: 'person' });
    const first = await crewWith(thomas.shipId, thomas.secret);
    const deliveryId = await sendTo(thomas.shipId, { payload: '{"id":"q-1","title":"Which design?"}', contentType: QUESTION_CONTENT_TYPE });
    await acknowledgedBy(first, deliveryId);
    const next = await nextCrewOf(thomas.shipId);

    // When the next crew acks it again and reports it handled.
    unwrap(await core.useCases.acknowledgeDelivery(next, { deliveryId }));
    unwrap(await core.useCases.reportHandled(next, { deliveryId }));

    // Then it is handled, still naming the lease that took it, and DeliveryHandled names the next lease.
    expect(await core.prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).toMatchObject({ state: 'handled', claimedByLeaseId: first.leaseId });
    expect(await core.prisma.event.findFirstOrThrow({ where: { deliveryId, type: 'DeliveryHandled' } })).toMatchObject({ details: { leaseId: next.leaseId } });
  });

  it('keeps the per-lease rule for another kind of ship: its next crew is refused', async () => {
    // Given an agent ship's delivery acknowledged by its first crew, whose lease ended.
    const scout = await commissioned({ name: 'scout', kind: 'agent' });
    const first = await crewWith(scout.shipId, scout.secret);
    const deliveryId = await sendTo(scout.shipId, { payload: 'Review PR #1497' });
    await acknowledgedBy(first, deliveryId);
    const next = await nextCrewOf(scout.shipId);

    // When the next crew reports it handled.
    const refusal = refusalOf(await core.useCases.reportHandled(next, { deliveryId }));

    // Then it is refused, and the delivery stays acknowledged.
    expect(refusal).toMatchObject({ kind: 'DELIVERY_HELD_BY_ANOTHER_SHIP' });
    expect(await core.prisma.delivery.findUniqueOrThrow({ where: { id: deliveryId } })).toMatchObject({ state: 'acknowledged', claimedByLeaseId: first.leaseId });
  });
});
