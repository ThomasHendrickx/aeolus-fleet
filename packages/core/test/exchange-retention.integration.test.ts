import { idSchema, NOTICE_CONTENT_TYPE, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Crew, ShipCaller } from '../src/domain/shared/caller.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';

// Retention and the exchanges on a real Postgres (docs/design/exchange-read,
// E8, E10): a plain message acknowledged at a person ship is finished while
// its pushed lease lasts, a convention is not; and when pruning lets an
// exchange's newest message go, its row points at the newest kept one, or
// goes when nothing of the exchange is left.

const MODEL = 'claude-opus-5-5';
const DAY_MS = 24 * 60 * 60 * 1000;
const RETENTION_DAYS = 30;

let core: PostgresCore;
let argo: ShipCaller;
let thomas: Crew;
let lookout: Crew;
let scout: Crew;

async function crewed(ship: { name: string; kind: 'person' | 'agent'; type: string }): Promise<Crew> {
  const { shipId, secret } = unwrap(await core.useCases.commissionShip(argo, { ...ship, idempotencyKey: newKey() }));
  const { crewToken } = unwrap(await core.useCases.claimShip({ shipId, secret: secretOf(secret), location: { kind: 'CLOUD' }, harness: 'claude-code' }));
  return unwrap(await core.useCases.authenticate.byCrewToken(crewToken));
}

beforeEach(async () => {
  core = await createPostgresCore();
  argo = operatorCaller(unwrap(await withOperatorLogin(core.prisma, core.useCases.initialiseFleet({ name: 'home fleet' }))));
  thomas = await crewed({ name: 'thomas', kind: 'person', type: 'person' });
  lookout = await crewed({ name: 'lookout', kind: 'agent', type: 'reviewer' });
  scout = await crewed({ name: 'scout', kind: 'agent', type: 'scout' });
  await core.prisma.$executeRaw`UPDATE fleets SET retention_set = true, retention_days = ${RETENTION_DAYS} WHERE id = ${argo.fleetId}`;
});

afterEach(async () => {
  await core.close();
});

async function send(from: Crew, { to, payload, contentType = 'text/plain' }: { to: ShipId; payload: string; contentType?: string }): Promise<MessageId> {
  core.clock.advance(1_000);
  const model = from.kind === 'agent' ? { model: MODEL } : {};
  return unwrap(await core.useCases.sendMessage(from, { selector: { kind: 'ship', shipId: to }, payload, contentType, idempotencyKey: newKey(), ...model })).messageId;
}

/** The 30 second pass, past the retention: the snapshot close, then the pruning pass. */
async function passAfter(ms: number): Promise<void> {
  core.clock.advance(ms);
  await core.useCases.closeHealthSnapshots();
  await core.useCases.pruneHistory();
}

async function isKept(messageId: MessageId): Promise<boolean> {
  return (await core.prisma.message.count({ where: { id: messageId } })) === 1;
}

describe('retention and the exchanges on Postgres', () => {
  it("lets a plain message acknowledged at a person ship go while its pushed lease lasts, and keeps a notice so acknowledged", async () => {
    // Given the lookout sent thomas a note and a notice, which thomas's pushed crew took and marked seen.
    const note = await send(lookout, { to: thomas.shipId, payload: 'Merge it?' });
    const notice = await send(lookout, { to: thomas.shipId, payload: '{"headline":"PR #1497 is open","body":"Ready"}', contentType: NOTICE_CONTENT_TYPE });
    unwrap(await core.useCases.pushReceiveDeliveries(thomas, { max: 10 }));
    unwrap(await core.useCases.acknowledgeUpTo(thomas, { otherShipId: lookout.shipId, messageId: note }));
    const noticeDelivery = await core.prisma.delivery.findFirstOrThrow({ where: { messageId: notice } });
    unwrap(await core.useCases.acknowledgeDelivery(thomas, { deliveryId: idSchema('delivery').parse(noticeDelivery.id) }));

    // When a pass runs past the retention, thomas's lease still open.
    await passAfter((RETENTION_DAYS + 1) * DAY_MS);

    // Then the note is gone and the notice kept.
    expect(await isKept(note)).toBe(false);
    expect(await isKept(notice)).toBe(true);
  });

  it("points an exchange at its newest kept message when pruning lets the newest go, and removes one with nothing left", async () => {
    // Given the lookout asked thomas, still waiting, then thomas wrote the lookout, which acknowledged it; and the scout wrote thomas, who marked it seen.
    const waiting = await send(lookout, { to: thomas.shipId, payload: 'Merge PR #1497?' });
    const answer = await send(thomas, { to: lookout.shipId, payload: 'Looking now' });
    const taken = unwrap(await core.useCases.receiveDeliveries(lookout, { max: 10 }));
    for (const delivery of taken.deliveries) {
      unwrap(await core.useCases.acknowledgeDelivery(lookout, { deliveryId: delivery.deliveryId }));
    }
    const fromScout = await send(scout, { to: thomas.shipId, payload: 'Found the bug' });
    unwrap(await core.useCases.acknowledgeUpTo(thomas, { otherShipId: scout.shipId, messageId: fromScout }));

    // When a pass runs past the retention.
    await passAfter((RETENTION_DAYS + 1) * DAY_MS);

    // Then the answer and the scout's message are gone, the lookout's row points at the waiting one, and the scout's row is gone.
    expect(await isKept(answer)).toBe(false);
    expect(await isKept(fromScout)).toBe(false);
    await expect(core.prisma.exchange.findMany({ select: { otherShipId: true, newestMessageId: true, unacknowledged: true } })).resolves.toEqual([
      { otherShipId: lookout.shipId, newestMessageId: waiting, unacknowledged: 1 },
    ]);
  });
});
