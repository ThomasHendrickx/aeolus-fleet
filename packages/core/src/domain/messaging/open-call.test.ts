/** Issue #2040: a moderator's call and its collected answers. */
import { beforeEach, describe, expect, it } from 'vitest';
import { meetingRoundSchema, type MeetingId, type MessageId } from '@aeolus-fleet/common';

import { crewAboard, sealFleet, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';

let core: ReturnType<typeof createInMemoryCore>;
let messaging: ReturnType<typeof messagingUseCases>;
let chair: ShipCaller;
let alpha: ShipCaller;
let beta: ShipCaller;
let later: ShipCaller;
let meetingId: MeetingId;
beforeEach(async () => {
  core = createInMemoryCore('2026-11-23T10:00:00.000Z');
  const argo = operatorCaller(await initialiseFleet(core));
  const registry = registryUseCases(core);
  chair = await shipWithScopes({ registry, argo }, { name: 'chair', type: 'agent', scopes: ['meetings:open'] });
  alpha = await shipWithScopes({ registry, argo }, { name: 'alpha', type: 'agent', scopes: [] });
  beta = await shipWithScopes({ registry, argo }, { name: 'beta', type: 'agent', scopes: [] });
  later = await shipWithScopes({ registry, argo }, { name: 'later', type: 'agent', scopes: [] });
  messaging = messagingUseCases(core);
  ({ meetingId } = unwrap(await messaging.openMeeting(chair, { ships: [{ shipId: alpha.shipId }, { shipId: beta.shipId }], goal: 'Agree the release', idempotencyKey: newKey(), model: SESSION_MODEL })));
});
const aCall = () => ({ meetingId, question: 'Which day?', excludedShipIds: [chair.shipId], deadline: '2026-11-23T10:05:00.000Z', idempotencyKey: newKey(), model: SESSION_MODEL });
const answer = (by: ShipCaller, { callId, payload = 'Friday' }: { callId: MessageId; payload?: string }) => messaging.sendMessage(by, { selector: { kind: 'meeting', meetingId }, callId, payload, idempotencyKey: newKey(), model: SESSION_MODEL });
const counts = () => [core.state.messages.length, core.state.deliveries.length, core.state.events.length, core.state.notices.length];

describe('a call and its answers', () => {
  it('resolves the expected list at opening and delivers the question and goal to every participant including excluded ships and the moderator', async () => {
    // Given a moderator asking everyone but itself.
    const input = aCall();
    // When it opens the call.
    const { callId } = unwrap(await messaging.openCall(chair, input));
    // Then the snapshot is stored and all participants get one delivery.
    expect(core.state.deliveries.filter((d) => d.messageId === callId).map((d) => d.recipient)).toEqual([chair, alpha, beta].map((s) => ({ kind: 'ship', shipId: s.shipId })));
    expect(core.state.messages.find((m) => m.id === callId)?.payload).toEqual(expect.stringContaining('Agree the release'));
    expect(core.state.messages.find((m) => m.id === callId)?.contentType).toBe('application/vnd.aeolus.meeting.call+json');
    expect(unwrap(await messaging.readMeeting(alpha, { meetingId, limit: 20 })).call).toMatchObject({ callId, expectedShipIds: [alpha.shipId, beta.shipId], deadline: new Date(input.deadline), closedAt: null });
    const before = counts();
    expect(unwrap(await messaging.openCall(chair, input))).toEqual({ callId });
    expect(counts()).toEqual(before);
  });
  it('accepts one answer without the mic, fans out none, and on the last answer tells only the moderator with every answer and its sender', async () => {
    // Given an open call with alpha and beta expected.
    const { callId } = unwrap(await messaging.openCall(chair, aCall()));
    const before = core.state.deliveries.length;
    // When alpha answers, then beta answers.
    const first = unwrap(await answer(alpha, { callId }));
    expect(core.state.deliveries).toHaveLength(before);
    const second = unwrap(await answer(beta, { callId, payload: 'Monday' }));
    // Then both answers are readable by all and one collected result reaches chair.
    const read = unwrap(await messaging.readMeeting(beta, { meetingId, limit: 20 }));
    expect(read.call).toMatchObject({ callId, closedAt: core.clock.now(), answers: [{ messageId: first.messageId, sender: { id: alpha.shipId }, payload: 'Friday' }, { messageId: second.messageId, sender: { id: beta.shipId }, payload: 'Monday' }] });
    expect(read.contributions.items).toEqual(expect.arrayContaining([expect.objectContaining({ messageId: first.messageId, sender: { id: alpha.shipId, name: 'alpha' } }), expect.objectContaining({ messageId: second.messageId, sender: { id: beta.shipId, name: 'beta' } })]));
    const deliveries = core.state.deliveries.slice(before);
    expect(deliveries.map((d) => d.recipient)).toEqual([{ kind: 'ship', shipId: chair.shipId }]);
    expect(core.state.messages.find((m) => m.id === deliveries[0]?.messageId)?.contentType).toBe('application/vnd.aeolus.meeting.round+json');
    expect(core.state.messages.find((m) => m.id === deliveries[0]?.messageId)?.payload).toEqual(expect.stringContaining('Monday'));
    expect(core.state.events.filter((e) => ['CallOpened', 'CallAnswered', 'CallClosed'].includes(e.type)).map((e) => e.type)).toEqual(['CallOpened', 'CallAnswered', 'CallAnswered', 'CallClosed']);
  });
  it('refuses a second answer without storing anything', async () => {
    // Given alpha has answered the open call.
    const { callId } = unwrap(await messaging.openCall(chair, aCall()));
    unwrap(await answer(alpha, { callId }));
    const before = counts();
    // When it answers a second time under another key.
    expect(refusalOf(await answer(alpha, { callId })).kind).toBe('ALREADY_PRESENT');
    // Then no message, event, delivery or wake was stored.
    expect(counts()).toEqual(before);
  });
  it('refuses excluded ships and ships joining later, preserving the opening snapshot', async () => {
    // Given a call opened before a fourth ship joins.
    const { callId } = unwrap(await messaging.openCall(chair, aCall()));
    unwrap(await messaging.addToMeeting(chair, { meetingId, ships: [{ shipId: later.shipId }], model: SESSION_MODEL }));
    const before = counts();
    // When the excluded moderator or late joiner answers.
    for (const ship of [chair, later]) expect(refusalOf(await answer(ship, { callId })).kind).toBe('PARTICIPANT_NOT_FOUND');
    // Then the call still expects only alpha and beta, and nothing new was stored.
    expect(counts()).toEqual(before);
    expect(unwrap(await messaging.readMeeting(chair, { meetingId, limit: 20 })).call?.expectedShipIds).toEqual([alpha.shipId, beta.shipId]);
  });
  it('expects the moderator unless explicitly excluded and closes an empty expected list immediately', async () => {
    // Given a call excluding every participant.
    const input = { ...aCall(), excludedShipIds: [chair.shipId, alpha.shipId, beta.shipId] };
    // When the moderator opens it, then opens a call with no exclusions.
    unwrap(await messaging.openCall(chair, input));
    expect(unwrap(await messaging.readMeeting(chair, { meetingId, limit: 20 })).call).toMatchObject({ closedAt: core.clock.now(), expectedShipIds: [], answers: [] });
    const { callId } = unwrap(await messaging.openCall(chair, { ...aCall(), excludedShipIds: [] }));
    // Then the moderator must answer too.
    unwrap(await answer(alpha, { callId }));
    unwrap(await answer(beta, { callId }));
    expect(unwrap(await messaging.readMeeting(chair, { meetingId, limit: 20 })).call?.closedAt).toBeNull();
    unwrap(await answer(chair, { callId }));
    expect(unwrap(await messaging.readMeeting(chair, { meetingId, limit: 20 })).call?.closedAt).toEqual(core.clock.now());
  });
  it('ends after the configured number of closed calls with an ended notice from the moderator', async () => {
    // Given a meeting ending after two calls.
    ({ meetingId } = unwrap(await messaging.openMeeting(chair, { ships: [{ shipId: alpha.shipId }], endAfterCalls: 2, idempotencyKey: newKey(), model: SESSION_MODEL })));
    // When two empty calls close.
    const input = () => ({ ...aCall(), excludedShipIds: [chair.shipId, alpha.shipId] });
    unwrap(await messaging.openCall(chair, input()));
    expect(unwrap(await messaging.readMeeting(chair, { meetingId, limit: 20 })).endedAt).toBeNull();
    unwrap(await messaging.openCall(chair, input()));
    // Then core stores the ending and its moderator's notice in the same change.
    expect(unwrap(await messaging.readMeeting(chair, { meetingId, limit: 20 })).endedAt).toEqual(core.clock.now());
    expect(core.state.messages.filter((m) => m.meetingId === meetingId && m.contentType === 'application/vnd.aeolus.meeting.ended+json')).toHaveLength(1);
  });
});

describe('a refused call', () => {
  it('refuses a non-moderator, a second open call and an ended meeting, storing nothing', async () => {
    // Given an open meeting.
    let before = counts();
    // When a participant tries to open a call.
    expect(refusalOf(await messaging.openCall(alpha, aCall())).kind).toBe('NOT_MODERATOR');
    expect(counts()).toEqual(before);
    unwrap(await messaging.openCall(chair, aCall()));
    before = counts();
    // Then a second call refuses, as does one after the meeting ends.
    expect(refusalOf(await messaging.openCall(chair, aCall())).kind).toBe('ALREADY_PRESENT');
    expect(counts()).toEqual(before);
    unwrap(await messaging.changeMeeting(chair, { meetingId, change: { kind: 'end' } }));
    before = counts();
    expect(refusalOf(await messaging.openCall(chair, aCall())).kind).toBe('MEETING_ENDED');
    expect(counts()).toEqual(before);
  });
  it.each(['2026-11-23T09:59:00.000Z', '2026-11-23T10:00:00.000Z'])('refuses deadline %s, storing nothing', async (deadline) => {
    // Given a deadline that is not in the future.
    const before = counts();
    // When it is used for a call.
    expect(refusalOf(await messaging.openCall(chair, { ...aCall(), deadline })).kind).toBe('INVALID_MEETING_END_TIME');
    // Then it stores nothing.
    expect(counts()).toEqual(before);
  });
  it('bounds questions and answers at 64 KB and stores the default deadline without acting on it', async () => {
    // Given a question exactly 64 KB and no explicit deadline.
    const input = { ...aCall(), deadline: undefined };
    const { callId } = unwrap(await messaging.openCall(chair, { ...input, question: 'a'.repeat(65_536) }));
    expect(unwrap(await messaging.readMeeting(chair, { meetingId, limit: 20 })).call?.deadline).toEqual(new Date('2026-11-23T10:05:00.000Z'));
    const before = counts();
    // When an expected ship exceeds the answer boundary.
    expect(refusalOf(await answer(alpha, { callId, payload: 'a'.repeat(65_537) })).kind).toBe('PAYLOAD_TOO_LARGE');
    // Then nothing is stored; the exact boundary is accepted.
    expect(counts()).toEqual(before);
    unwrap(await answer(alpha, { callId, payload: 'a'.repeat(65_536) }));
  });
});


it('keeps calls, answers and the collected round sealed, with repeat answers remaining idempotent', async () => {
  // Given a sealed fleet and an expected participant.
  await sealFleet(core, chair.fleetId);
  const input = aCall();
  const { callId } = unwrap(await messaging.openCall(chair, input));
  const reply = { selector: { kind: 'meeting' as const, meetingId }, callId, payload: 'Private Friday', model: SESSION_MODEL, idempotencyKey: newKey() };
  // When alpha retries an answer and beta closes the round.
  const original = unwrap(await messaging.sendMessage(alpha, reply));
  expect(unwrap(await messaging.sendMessage(alpha, reply))).toEqual(original);
  unwrap(await answer(beta, { callId }));
  expect(unwrap(await messaging.openCall(chair, input))).toEqual({ callId });
  // Then every new payload is sealed and the moderator receives the whole round as written.
  expect(core.state.messages.filter((m) => m.id >= callId).every((m) => typeof m.payload !== 'string')).toBe(true);
  const deliveries = unwrap(await messaging.receiveDeliveries(crewAboard(core, chair), { max: 10 })).deliveries;
  expect(deliveries.find((d) => d.contentType === 'application/vnd.aeolus.meeting.round+json')?.payload).toContain('Private Friday');
});

it('does not bypass meeting restrictions for answers and refuses an unknown call', async () => {
  // Given an open call.
  const { callId } = unwrap(await messaging.openCall(chair, aCall()));
  const input = { selector: { kind: 'meeting' as const, meetingId }, callId, payload: 'Friday', model: SESSION_MODEL, idempotencyKey: newKey() };
  const before = counts();
  // When an answer names a reply, an unknown call, or another selector.
  expect(refusalOf(await messaging.sendMessage(alpha, { ...input, inReplyTo: callId })).kind).toBe('CONTRIBUTION_REPLIES');
  expect(refusalOf(await messaging.sendMessage(alpha, { ...input, callId: core.ids('message') })).kind).toBe('MESSAGE_NOT_FOUND');
  expect(refusalOf(await messaging.sendMessage(alpha, { ...input, selector: { kind: 'ship', shipId: chair.shipId } })).kind).toBe('MESSAGE_NOT_FOUND');
  // Then all refusals store nothing, and an ended meeting still refuses answers.
  expect(counts()).toEqual(before);
  unwrap(await messaging.changeMeeting(chair, { meetingId, change: { kind: 'end' } }));
  expect(refusalOf(await messaging.sendMessage(alpha, input)).kind).toBe('MEETING_ENDED');
});

/** The full JSON notice, measured in UTF-8; fixture padding reaches the actual envelope boundary. */
function lastRoundPayload(): string {
  const payload = core.state.messages.filter((message) => message.contentType === 'application/vnd.aeolus.meeting.round+json').at(-1)?.payload;
  if (typeof payload !== 'string') throw new Error('Expected an unsealed round notice');
  return payload;
}

it.each([262_144, 262_145])('keeps an inline round of exactly 256 KB, and switches every answer to a reference one byte over: %s bytes', async (bytes) => {
  // Given the overhead of this meeting's two-answer round, and JSON-escaped UTF-8 answers.
  const probe = unwrap(await messaging.openCall(chair, aCall()));
  unwrap(await answer(alpha, { callId: probe.callId, payload: '' }));
  unwrap(await answer(beta, { callId: probe.callId, payload: '' }));
  const overhead = new TextEncoder().encode(lastRoundPayload()).byteLength;
  const firstPayload = '\u0000'.repeat(40_000);
  const secondPayload = 'é'.repeat(Math.floor((bytes - overhead - 240_000) / 2)) + 'x'.repeat((bytes - overhead - 240_000) % 2);
  const { callId } = unwrap(await messaging.openCall(chair, aCall()));
  // When both expected ships answer, making the complete inline JSON reach the boundary.
  const first = unwrap(await answer(alpha, { callId, payload: firstPayload }));
  const second = unwrap(await answer(beta, { callId, payload: secondPayload }));
  // Then there is one notice within the universal limit, and the meeting keeps both full answers.
  const notice = lastRoundPayload();
  const round = meetingRoundSchema.parse(JSON.parse(notice));
  expect(new TextEncoder().encode(notice).byteLength).toBeLessThanOrEqual(262_144);
  if (bytes === 262_144) {
    expect(new TextEncoder().encode(notice).byteLength).toBe(262_144);
    expect(round.areAnswersReferences).toBe(false);
    expect(round.answers.map((item) => 'payload' in item ? item.payload : undefined)).toEqual([firstPayload, secondPayload]);
  } else {
    expect(round.areAnswersReferences).toBe(true);
    expect(round.answers).toEqual([
      { messageId: first.messageId, sender: { id: alpha.shipId, name: 'alpha' }, sentAt: '2026-11-23T10:00:00.000Z' },
      { messageId: second.messageId, sender: { id: beta.shipId, name: 'beta' }, sentAt: '2026-11-23T10:00:00.000Z' },
    ]);
  }
  expect(unwrap(await messaging.readMeeting(beta, { meetingId, limit: 20 })).call?.answers.map((item) => item.payload)).toEqual([firstPayload, secondPayload]);
});

it('refuses a call notice whose serialized question exceeds 256 KB, storing nothing', async () => {
  // Given a 64 KB question whose JSON escaping makes its notice larger than 256 KB.
  const before = counts();
  // When the moderator opens the call.
  const result = await messaging.openCall(chair, { ...aCall(), question: '\u0000'.repeat(65_536) });
  // Then the universal payload limit refuses the entire opening.
  expect(refusalOf(result).kind).toBe('PAYLOAD_TOO_LARGE');
  expect(counts()).toEqual(before);
});
