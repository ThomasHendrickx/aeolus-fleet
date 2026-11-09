import { aQuestion } from './support/formatted-message-fixtures.js';
import { ANSWER_CONTENT_TYPE, idSchema, NOTICE_CONTENT_TYPE, QUESTION_CONTENT_TYPE, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import type { Crew, ShipCaller } from '../src/domain/shared/caller.js';
import type { Selector } from '../src/domain/shared/selector.js';
import { newKey } from '../src/testing/keys.js';
import { unwrap } from '../src/testing/result.js';
import { operatorCaller, secretOf } from './support/core-fixtures.js';
import { withOperatorLogin } from './support/operator-login.js';
import { createPostgresCore, type PostgresCore } from './support/postgres-core.js';

// Retention and the exchanges on a real Postgres (docs/design/exchange-read,
// E8, E10): a plain message acknowledged at a person ship is finished while
// its pushed lease lasts, a convention is not; and when pruning lets an
// exchange's newest message go, its row points at the newest kept one, or
// goes when nothing of the exchange is left. Each exchange pruning touched
// is marked with the newest send time it removed (docs/design/exchange-history).

const MODEL = 'claude-opus-5-5';
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;
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

async function send(from: ShipCaller, { to, payload, contentType = 'text/plain', inReplyTo }: { to: ShipId | Selector; payload: string; contentType?: string; inReplyTo?: MessageId }): Promise<MessageId> {
  core.clock.advance(1_000);
  const model = from.kind === 'agent' ? { model: MODEL } : {};
  const selector = typeof to === 'string' ? { kind: 'ship' as const, shipId: to } : to;
  return unwrap(await core.useCases.sendMessage(from, { selector, payload, contentType, idempotencyKey: newKey(), ...model, ...(inReplyTo && { inReplyTo }) })).messageId;
}

/** The crew receives what waits for it and acknowledges each: finished, its lease not pushed. */
async function acknowledgeAll(crew: Crew): Promise<void> {
  for (const { deliveryId } of unwrap(await core.useCases.receiveDeliveries(crew, { max: 10 })).deliveries) {
    unwrap(await core.useCases.acknowledgeDelivery(crew, { deliveryId }));
  }
}

/** A label value the ships hold, defined and assigned by a plugin with the labels scopes. */
async function labelValue(shipIds: readonly ShipId[]): Promise<Selector> {
  const { shipId: pluginId } = unwrap(
    await core.useCases.commissionShip(argo, { idempotencyKey: newKey(), name: 'trierarch-plugin', type: 'trierarch-plugin', scopes: ['labels:define', 'labels:assign', 'labels:any'] }),
  );
  const plugin: ShipCaller = { fleetId: argo.fleetId, shipId: pluginId, kind: 'agent', scopes: ['labels:define', 'labels:assign', 'labels:any'] };
  const { values } = unwrap(await core.useCases.defineLabel(plugin, { key: 'team', values: ['bridge'] }));
  const valueId = values[0]?.id;
  if (valueId === undefined) {
    throw new Error('defineLabel answered no value');
  }
  for (const shipId of shipIds) {
    unwrap(await core.useCases.assignLabel(plugin, { shipId, valueId }));
  }
  return { kind: 'label', valueIds: [valueId] };
}

/** When the message was sent, as the fleet stored it. */
async function sentAt(messageId: MessageId): Promise<Date> {
  return (await core.prisma.message.findUniqueOrThrow({ where: { id: messageId }, select: { createdAt: true } })).createdAt;
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

describe('how far pruning went, per exchange, on Postgres (docs/design/exchange-history)', () => {
  it('marks an exchange with the newest send time pruning removed, every kept item sent after it, and one with nothing kept too', async () => {
    // Given the lookout wrote thomas twice and thomas answered, each acknowledged, and the scout wrote thomas once, acknowledged.
    await send(lookout, { to: thomas.shipId, payload: 'Merge PR #1497?' });
    await send(lookout, { to: thomas.shipId, payload: 'CI is green' });
    await acknowledgeAll(thomas);
    const answer = await send(thomas, { to: lookout.shipId, payload: 'Merged' });
    const answerSentAt = await sentAt(answer);
    await acknowledgeAll(lookout);
    const fromScout = await send(scout, { to: thomas.shipId, payload: 'Found the bug' });
    const fromScoutSentAt = await sentAt(fromScout);
    await acknowledgeAll(thomas);

    // When a pass runs past the retention, and the lookout writes thomas again.
    await passAfter((RETENTION_DAYS + 1) * DAY_MS);
    await send(lookout, { to: thomas.shipId, payload: 'Next one: PR #1500' });
    const withLookout = unwrap(await core.useCases.readExchange(thomas, { otherShipId: lookout.shipId }));
    const withScout = unwrap(await core.useCases.readExchange(thomas, { otherShipId: scout.shipId }));

    // Then the lookout's exchange is marked at the answer, its one kept item sent after it; the scout's holds no item and its mark.
    expect(withLookout.prunedUpTo).toEqual(answerSentAt);
    expect(withLookout.items.map((item) => item.payload)).toEqual(['Next one: PR #1500']);
    expect(withLookout.items.every((item) => item.sentAt > answerSentAt)).toBe(true);
    expect(withLookout.olderCursor).toBeNull();
    expect(withScout).toMatchObject({ items: [], olderCursor: null, prunedUpTo: fromScoutSentAt });
  });

  it('answers null for an exchange begun after the cutoff, in a fleet that pruned', async () => {
    // Given the scout wrote thomas, acknowledged, and a pass past the retention let it go.
    await send(scout, { to: thomas.shipId, payload: 'Found the bug' });
    await acknowledgeAll(thomas);
    await passAfter((RETENTION_DAYS + 1) * DAY_MS);

    // When the lookout writes thomas for the first time, and thomas reads that exchange.
    await send(lookout, { to: thomas.shipId, payload: 'Merge PR #1497?' });
    const page = unwrap(await core.useCases.readExchange(thomas, { otherShipId: lookout.shipId }));

    // Then pruning removed none of it.
    expect(page.prunedUpTo).toBeNull();
    expect(page.items).toHaveLength(1);
  });

  it('places a hole: an open question survives the finished messages after it, and the mark never moves back once it goes', async () => {
    // Given the lookout asked thomas a question, still open, then sent a note, both acknowledged.
    const question = await send(lookout, { to: thomas.shipId, payload: JSON.stringify(aQuestion()), contentType: QUESTION_CONTENT_TYPE });
    const note = await send(lookout, { to: thomas.shipId, payload: 'CI is green' });
    const noteSentAt = await sentAt(note);
    await acknowledgeAll(thomas);

    // When a pass runs past the retention.
    await passAfter((RETENTION_DAYS + 1) * DAY_MS);
    const holed = unwrap(await core.useCases.readExchange(thomas, { otherShipId: lookout.shipId }));

    // Then the note went, the question survives sent before the mark, and the mark is the note's send time.
    expect(holed.prunedUpTo).toEqual(noteSentAt);
    expect(holed.items.map((item) => item.messageId)).toEqual([question]);
    expect(holed.items.every((item) => item.sentAt < noteSentAt)).toBe(true);

    // When thomas answers the question, the lookout acknowledges the answer, and the next pass lets the question go.
    const answer = await send(thomas, { to: lookout.shipId, payload: '{"questionId":"11111111-1111-4111-8111-111111111111","option":2}', contentType: ANSWER_CONTENT_TYPE, inReplyTo: question });
    const answerSentAt = await sentAt(answer);
    await acknowledgeAll(lookout);
    await passAfter(HOUR_MS);
    const answered = unwrap(await core.useCases.readExchange(thomas, { otherShipId: lookout.shipId }));

    // Then the mark stays at the note, never back to the older question.
    expect(await isKept(question)).toBe(false);
    expect(answered.prunedUpTo).toEqual(noteSentAt);

    // When a pass past the retention lets the answer go.
    await passAfter((RETENTION_DAYS + 1) * DAY_MS);
    const ended = unwrap(await core.useCases.readExchange(thomas, { otherShipId: lookout.shipId }));

    // Then the mark moves forward to the answer.
    expect(ended).toMatchObject({ items: [], prunedUpTo: answerSentAt });
  });

  it('marks only exchanges: each pair a label send reached, the claimer of a type send, never a meeting or a ping', async () => {
    // Given the lookout wrote a label thomas and the scout hold, the scout wrote thomas's type which thomas claimed,
    // the lookout said something in a meeting with the scout that then ended, and argo pinged the lookout; all acknowledged.
    const byLabel = await send(lookout, { to: await labelValue([thomas.shipId, scout.shipId]), payload: 'Standup in five' });
    const byLabelSentAt = await sentAt(byLabel);
    const byType = await send(scout, { to: { kind: 'type', type: 'person' }, payload: 'Who is on call?' });
    const byTypeSentAt = await sentAt(byType);
    await acknowledgeAll(thomas);
    const { meetingId } = unwrap(await core.useCases.openMeeting(lookout, { ships: [{ shipId: scout.shipId }], idempotencyKey: newKey(), model: MODEL }));
    const inMeeting = await send(lookout, { to: { kind: 'meeting', meetingId }, payload: 'The launch moves to Friday' });
    unwrap(await core.useCases.changeMeeting(lookout, { meetingId, change: { kind: 'end' } }));
    core.clock.advance(1_000);
    unwrap(await core.useCases.pingShip(argo, { shipId: lookout.shipId }));
    await acknowledgeAll(scout);
    for (const { deliveryId } of unwrap(await core.useCases.receiveDeliveries(lookout, { max: 10 })).deliveries) {
      unwrap(await core.useCases.answerPing(lookout, { deliveryId }));
    }

    // When a pass runs past the retention.
    await passAfter((RETENTION_DAYS + 1) * DAY_MS);

    // Then every one of them went; the label send marks both pairs it reached, the type send the claimer's, and neither the meeting nor the ping marks anything.
    expect(await core.prisma.message.count({ where: { fleetId: argo.fleetId } })).toBe(0);
    expect(await isKept(inMeeting)).toBe(false);
    const markOf = async (crew: Crew, otherShipId: ShipId) => unwrap(await core.useCases.readExchange(crew, { otherShipId })).prunedUpTo;
    expect(await markOf(thomas, lookout.shipId)).toEqual(byLabelSentAt);
    expect(await markOf(scout, lookout.shipId)).toEqual(byLabelSentAt);
    expect(await markOf(thomas, scout.shipId)).toEqual(byTypeSentAt);
    expect(await markOf(lookout, argo.shipId)).toBeNull();
  });

  it("keeps the mark of an exchange with a ship removed to a remnant, read by id", async () => {
    // Given the lookout wrote thomas, acknowledged, and was retired.
    const note = await send(lookout, { to: thomas.shipId, payload: 'Done for today' });
    const noteSentAt = await sentAt(note);
    await acknowledgeAll(thomas);
    core.clock.advance(1_000);
    unwrap(await core.useCases.retireShip(argo, { shipId: lookout.shipId }));

    // When a pass past the retention lets the note go and removes the lookout.
    await passAfter((RETENTION_DAYS + 1) * DAY_MS);
    const page = unwrap(await core.useCases.readExchange(thomas, { otherShipId: lookout.shipId }));

    // Then the lookout is a remnant, and thomas's exchange with it still answers the mark.
    expect((await core.prisma.ship.findUniqueOrThrow({ where: { id: lookout.shipId } })).removedAt).not.toBeNull();
    expect(page).toMatchObject({ items: [], prunedUpTo: noteSentAt });
  });

  it("lets a fleet's delete remove its marks", async () => {
    // Given a pass past the retention marked thomas's exchange with the lookout.
    await send(lookout, { to: thomas.shipId, payload: 'Merge PR #1497?' });
    await acknowledgeAll(thomas);
    await passAfter((RETENTION_DAYS + 1) * DAY_MS);
    expect(unwrap(await core.useCases.readExchange(thomas, { otherShipId: lookout.shipId })).prunedUpTo).not.toBeNull();

    // When the fleet is deleted.
    unwrap(await core.useCases.deleteFleet({ requestId: 'delete-home-fleet', fleetId: argo.fleetId }));

    // Then no mark of it is left.
    await expect(core.prisma.$queryRaw<{ count: number }[]>`SELECT count(*)::int AS count FROM pruned_exchanges`).resolves.toEqual([{ count: 0 }]);
  });
});
