/** Issue #2040: a moderator's call and its collected answers. */
import { beforeEach, describe, expect, it } from 'vitest';
import { meetingRoundSchema, type MeetingId, type MessageId } from '@aeolus-fleet/common';

import { crewAboard, sealFleet, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { createEndDueMeetings } from './end-due-meetings.js';
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
  for (const ship of [chair, alpha, beta, later]) crewAboard(core, ship);
  messaging = messagingUseCases(core);
  ({ meetingId } = unwrap(await messaging.openMeeting(chair, { ships: [{ shipId: alpha.shipId }, { shipId: beta.shipId }], goal: 'Agree the release', idempotencyKey: newKey(), model: SESSION_MODEL })));
});
const aCall = () => ({ meetingId, question: 'Which day?', excludedShipIds: [chair.shipId], deadline: '2026-11-23T10:05:00.000Z', idempotencyKey: newKey(), model: SESSION_MODEL });
const answer = (by: ShipCaller, { callId, payload = 'Friday' }: { callId: MessageId; payload?: string }) => messaging.sendMessage(by, { selector: { kind: 'meeting', meetingId }, callId, payload, idempotencyKey: newKey(), model: SESSION_MODEL });
const counts = () => [core.state.messages.length, core.state.deliveries.length, core.state.events.length, core.state.notices.length];

describe('a call and its answers', () => {
  it('delivers the question and goal to every participant, including excluded ships and the moderator', async () => {
    const { callId } = unwrap(await messaging.openCall(chair, aCall()));
    expect(core.state.deliveries.filter((d) => d.messageId === callId).map((d) => d.recipient)).toEqual([chair, alpha, beta].map((s) => ({ kind: 'ship', shipId: s.shipId })));
    expect(core.state.messages.find((m) => m.id === callId)?.payload).toContain('Agree the release');
    expect(core.state.messages.find((m) => m.id === callId)?.contentType).toBe('application/vnd.aeolus.meeting.call+json');
  });
  it('stores the fixed expected ships and deadline at opening', async () => {
    const input = aCall();
    const { callId } = unwrap(await messaging.openCall(chair, input));
    expect(unwrap(await messaging.readMeeting(alpha, { meetingId, limit: 20 })).call).toMatchObject({ callId, expectedShipIds: [alpha.shipId, beta.shipId], deadline: new Date(input.deadline), closedAt: null });
  });
  it('repeats an opening without storing anything', async () => {
    const input = aCall();
    const original = unwrap(await messaging.openCall(chair, input));
    const before = counts();
    expect(unwrap(await messaging.openCall(chair, input))).toEqual(original);
    expect(counts()).toEqual(before);
  });
  it('accepts an expected answer without the mic', async () => {
    const { callId } = unwrap(await messaging.openCall(chair, aCall()));
    const first = unwrap(await answer(alpha, { callId }));
    expect(unwrap(await messaging.readMeeting(beta, { meetingId, limit: 20 })).call?.answers).toMatchObject([{ messageId: first.messageId, sender: { id: alpha.shipId }, payload: 'Friday' }]);
  });
  it('creates no individual answer delivery', async () => {
    const { callId } = unwrap(await messaging.openCall(chair, aCall()));
    const before = core.state.deliveries.length;
    unwrap(await answer(alpha, { callId }));
    expect(core.state.deliveries).toHaveLength(before);
  });
  it('closes the call with every answer and its sender after the last expected answer', async () => {
    const { callId } = unwrap(await messaging.openCall(chair, aCall()));
    const first = unwrap(await answer(alpha, { callId }));
    const second = unwrap(await answer(beta, { callId, payload: 'Monday' }));
    expect(unwrap(await messaging.readMeeting(beta, { meetingId, limit: 20 })).call).toMatchObject({ callId, closedAt: core.clock.now(), answers: [{ messageId: first.messageId, sender: { id: alpha.shipId }, payload: 'Friday' }, { messageId: second.messageId, sender: { id: beta.shipId }, payload: 'Monday' }] });
  });
  it('reads answers as contributions with their senders', async () => {
    const { callId } = unwrap(await messaging.openCall(chair, aCall()));
    const first = unwrap(await answer(alpha, { callId }));
    const second = unwrap(await answer(beta, { callId, payload: 'Monday' }));
    expect(unwrap(await messaging.readMeeting(beta, { meetingId, limit: 20 })).contributions.items).toEqual(expect.arrayContaining([expect.objectContaining({ messageId: first.messageId, sender: { id: alpha.shipId, name: 'alpha' } }), expect.objectContaining({ messageId: second.messageId, sender: { id: beta.shipId, name: 'beta' } })]));
  });
  it('delivers one collected round only to the moderator', async () => {
    const { callId } = unwrap(await messaging.openCall(chair, aCall()));
    const before = core.state.deliveries.length;
    unwrap(await answer(alpha, { callId }));
    unwrap(await answer(beta, { callId, payload: 'Monday' }));
    const deliveries = core.state.deliveries.slice(before);
    expect(deliveries.map((d) => d.recipient)).toEqual([{ kind: 'ship', shipId: chair.shipId }]);
    expect(core.state.messages.find((m) => m.id === deliveries[0]?.messageId)?.contentType).toBe('application/vnd.aeolus.meeting.round+json');
    expect(core.state.messages.find((m) => m.id === deliveries[0]?.messageId)?.payload).toContain('Monday');
  });
  it('records the call opening, each answer and one close', async () => {
    const { callId } = unwrap(await messaging.openCall(chair, aCall()));
    unwrap(await answer(alpha, { callId }));
    unwrap(await answer(beta, { callId }));
    expect(core.state.events.filter((e) => ['CallOpened', 'CallAnswered', 'CallClosed'].includes(e.type)).map((e) => e.type)).toEqual(['CallOpened', 'CallAnswered', 'CallAnswered', 'CallClosed']);
  });
  it('refuses a second answer without storing anything', async () => {
    const { callId } = unwrap(await messaging.openCall(chair, aCall()));
    unwrap(await answer(alpha, { callId }));
    const before = counts();
    expect(refusalOf(await answer(alpha, { callId })).kind).toBe('ALREADY_PRESENT');
    expect(counts()).toEqual(before);
  });
  it.each(['excluded', 'joining later'])('refuses a ship %s without changing the opening snapshot', async (status) => {
    const { callId } = unwrap(await messaging.openCall(chair, aCall()));
    unwrap(await messaging.addToMeeting(chair, { meetingId, ships: [{ shipId: later.shipId }], model: SESSION_MODEL }));
    const before = counts();
    expect(refusalOf(await answer(status === 'excluded' ? chair : later, { callId })).kind).toBe('PARTICIPANT_NOT_FOUND');
    expect(counts()).toEqual(before);
    expect(unwrap(await messaging.readMeeting(chair, { meetingId, limit: 20 })).call?.expectedShipIds).toEqual([alpha.shipId, beta.shipId]);
  });
  it('closes an empty expected list immediately', async () => {
    unwrap(await messaging.openCall(chair, { ...aCall(), excludedShipIds: [chair.shipId, alpha.shipId, beta.shipId] }));
    expect(unwrap(await messaging.readMeeting(chair, { meetingId, limit: 20 })).call).toMatchObject({ closedAt: core.clock.now(), expectedShipIds: [], answers: [] });
  });
  it('waits for the moderator answer unless explicitly excluded', async () => {
    const { callId } = unwrap(await messaging.openCall(chair, { ...aCall(), excludedShipIds: [] }));
    unwrap(await answer(alpha, { callId }));
    unwrap(await answer(beta, { callId }));
    expect(unwrap(await messaging.readMeeting(chair, { meetingId, limit: 20 })).call?.closedAt).toBeNull();
  });
  it('closes when the expected moderator supplies the last answer', async () => {
    const { callId } = unwrap(await messaging.openCall(chair, { ...aCall(), excludedShipIds: [] }));
    unwrap(await answer(alpha, { callId }));
    unwrap(await answer(beta, { callId }));
    unwrap(await answer(chair, { callId }));
    expect(unwrap(await messaging.readMeeting(chair, { meetingId, limit: 20 })).call?.closedAt).toEqual(core.clock.now());
  });
  it('keeps the meeting open before its configured number of closed calls', async () => {
    ({ meetingId } = unwrap(await messaging.openMeeting(chair, { ships: [{ shipId: alpha.shipId }], endAfterCalls: 2, idempotencyKey: newKey(), model: SESSION_MODEL })));
    unwrap(await messaging.openCall(chair, { ...aCall(), excludedShipIds: [chair.shipId, alpha.shipId] }));
    expect(unwrap(await messaging.readMeeting(chair, { meetingId, limit: 20 })).endedAt).toBeNull();
  });
  it('ends after the configured number of closed calls', async () => {
    ({ meetingId } = unwrap(await messaging.openMeeting(chair, { ships: [{ shipId: alpha.shipId }], endAfterCalls: 2, idempotencyKey: newKey(), model: SESSION_MODEL })));
    for (let call = 0; call < 2; call++) unwrap(await messaging.openCall(chair, { ...aCall(), excludedShipIds: [chair.shipId, alpha.shipId] }));
    expect(unwrap(await messaging.readMeeting(chair, { meetingId, limit: 20 })).endedAt).toEqual(core.clock.now());
  });
  it('delivers the call-count ending notice from the moderator', async () => {
    ({ meetingId } = unwrap(await messaging.openMeeting(chair, { ships: [{ shipId: alpha.shipId }], endAfterCalls: 1, idempotencyKey: newKey(), model: SESSION_MODEL })));
    unwrap(await messaging.openCall(chair, { ...aCall(), excludedShipIds: [chair.shipId, alpha.shipId] }));
    expect(core.state.messages.filter((m) => m.meetingId === meetingId && m.contentType === 'application/vnd.aeolus.meeting.ended+json')).toMatchObject([{ senderShipId: chair.shipId }]);
  });
});

describe('a refused call', () => {
  it('refuses a non-moderator without storing anything', async () => {
    const before = counts();
    expect(refusalOf(await messaging.openCall(alpha, aCall())).kind).toBe('NOT_MODERATOR');
    expect(counts()).toEqual(before);
  });
  it('refuses a second open call without storing anything', async () => {
    unwrap(await messaging.openCall(chair, aCall()));
    const before = counts();
    expect(refusalOf(await messaging.openCall(chair, aCall())).kind).toBe('ALREADY_PRESENT');
    expect(counts()).toEqual(before);
  });
  it('refuses a call in an ended meeting without storing anything', async () => {
    unwrap(await messaging.changeMeeting(chair, { meetingId, change: { kind: 'end' } }));
    const before = counts();
    expect(refusalOf(await messaging.openCall(chair, aCall())).kind).toBe('MEETING_ENDED');
    expect(counts()).toEqual(before);
  });
  it.each(['2026-11-23T09:59:00.000Z', '2026-11-23T10:00:00.000Z'])('refuses deadline %s without storing anything', async (deadline) => {
    const before = counts();
    expect(refusalOf(await messaging.openCall(chair, { ...aCall(), deadline })).kind).toBe('INVALID_MEETING_END_TIME');
    expect(counts()).toEqual(before);
  });
  it('accepts a question of exactly 64 KB', async () => {
    expect((await messaging.openCall(chair, { ...aCall(), question: 'a'.repeat(65_536) })).isOk).toBe(true);
  });
  it('refuses a question one byte over 64 KB without storing anything', async () => {
    const before = counts();
    expect(refusalOf(await messaging.openCall(chair, { ...aCall(), question: 'a'.repeat(65_537) })).kind).toBe('PAYLOAD_TOO_LARGE');
    expect(counts()).toEqual(before);
  });
  it('stores a default deadline five minutes after opening', async () => {
    unwrap(await messaging.openCall(chair, { ...aCall(), deadline: undefined }));
    expect(unwrap(await messaging.readMeeting(chair, { meetingId, limit: 20 })).call?.deadline).toEqual(new Date('2026-11-23T10:05:00.000Z'));
  });
  it('accepts an answer of exactly 64 KB', async () => {
    const { callId } = unwrap(await messaging.openCall(chair, aCall()));
    expect((await answer(alpha, { callId, payload: 'a'.repeat(65_536) })).isOk).toBe(true);
  });
  it('refuses an answer one byte over 64 KB without storing anything', async () => {
    const { callId } = unwrap(await messaging.openCall(chair, aCall()));
    const before = counts();
    expect(refusalOf(await answer(alpha, { callId, payload: 'a'.repeat(65_537) })).kind).toBe('PAYLOAD_TOO_LARGE');
    expect(counts()).toEqual(before);
  });
});

describe('a sealed call', () => {
  beforeEach(async () => { await sealFleet(core, chair.fleetId); });
  it('keeps the call, answers and collected round sealed', async () => {
    const { callId } = unwrap(await messaging.openCall(chair, aCall()));
    unwrap(await answer(alpha, { callId }));
    unwrap(await answer(beta, { callId }));
    expect(core.state.messages.filter((m) => m.id >= callId).every((m) => typeof m.payload !== 'string')).toBe(true);
  });
  it('repeats a sealed answer without storing anything', async () => {
    const { callId } = unwrap(await messaging.openCall(chair, aCall()));
    const reply = { selector: { kind: 'meeting' as const, meetingId }, callId, payload: 'Private Friday', model: SESSION_MODEL, idempotencyKey: newKey() };
    const original = unwrap(await messaging.sendMessage(alpha, reply));
    const before = counts();
    expect(unwrap(await messaging.sendMessage(alpha, reply))).toEqual(original);
    expect(counts()).toEqual(before);
  });
  it('repeats a sealed call without storing anything', async () => {
    const input = aCall();
    const original = unwrap(await messaging.openCall(chair, input));
    const before = counts();
    expect(unwrap(await messaging.openCall(chair, input))).toEqual(original);
    expect(counts()).toEqual(before);
  });
  it('delivers the unsealed collected round as written', async () => {
    const { callId } = unwrap(await messaging.openCall(chair, aCall()));
    unwrap(await answer(alpha, { callId, payload: 'Private Friday' }));
    unwrap(await answer(beta, { callId }));
    const deliveries = unwrap(await messaging.receiveDeliveries(crewAboard(core, chair), { max: 10 })).deliveries;
    expect(deliveries.find((d) => d.contentType === 'application/vnd.aeolus.meeting.round+json')?.payload).toContain('Private Friday');
  });
});

describe('an answer restriction', () => {
  it.each([
    ['a reply', 'CONTRIBUTION_REPLIES'],
    ['an unknown call', 'MESSAGE_NOT_FOUND'],
    ['another selector', 'MESSAGE_NOT_FOUND'],
    ['an ended meeting', 'MEETING_ENDED'],
  ])('refuses %s without storing anything', async (restriction, kind) => {
    const { callId } = unwrap(await messaging.openCall(chair, aCall()));
    const input = { selector: { kind: 'meeting' as const, meetingId }, callId, payload: 'Friday', model: SESSION_MODEL, idempotencyKey: newKey() };
    if (restriction === 'an ended meeting') unwrap(await messaging.changeMeeting(chair, { meetingId, change: { kind: 'end' } }));
    const before = counts();
    const request = restriction === 'a reply' ? { ...input, inReplyTo: callId }
      : restriction === 'an unknown call' ? { ...input, callId: core.ids('message') }
      : restriction === 'another selector' ? { ...input, selector: { kind: 'ship' as const, shipId: chair.shipId } } : input;
    expect(refusalOf(await messaging.sendMessage(alpha, request)).kind).toBe(kind);
    expect(counts()).toEqual(before);
  });
});

/** The full JSON notice, measured in UTF-8; fixture padding reaches the actual envelope boundary. */
function lastRoundPayload(): string {
  const payload = core.state.messages.filter((message) => message.contentType === 'application/vnd.aeolus.meeting.round+json').at(-1)?.payload;
  expect(payload).toBeTypeOf('string');
  return typeof payload === 'string' ? payload : '';
}

it.each([262_144, 262_145])('keeps the round notice within 256 KB at %s bytes', async (bytes) => {
  // Given the overhead of this meeting's two-answer round, and JSON-escaped UTF-8 answers.
  const probe = unwrap(await messaging.openCall(chair, aCall()));
  unwrap(await answer(alpha, { callId: probe.callId, payload: '' }));
  unwrap(await answer(beta, { callId: probe.callId, payload: '' }));
  const overhead = new TextEncoder().encode(lastRoundPayload()).byteLength;
  const firstPayload = '\u0000'.repeat(40_000);
  const secondPayload = 'é'.repeat(Math.floor((bytes - overhead - 240_000) / 2)) + 'x'.repeat((bytes - overhead - 240_000) % 2);
  const { callId } = unwrap(await messaging.openCall(chair, aCall()));
  // When both expected ships answer, making the complete inline JSON reach the boundary.
  unwrap(await answer(alpha, { callId, payload: firstPayload }));
  unwrap(await answer(beta, { callId, payload: secondPayload }));
  // Then there is one notice within the universal limit, and the meeting keeps both full answers.
  const notice = lastRoundPayload();
  const round = meetingRoundSchema.parse(JSON.parse(notice));
  expect(new TextEncoder().encode(notice).byteLength).toBeLessThanOrEqual(262_144);
  if (bytes === 262_144) {
    expect(new TextEncoder().encode(notice).byteLength).toBe(262_144);
    expect(round).toHaveProperty('isRoundReference', false);
    expect(round).toMatchObject({ answers: [{ payload: firstPayload }, { payload: secondPayload }] });
  } else {
    expect(round).toEqual({ meetingId, callId, isRoundReference: true, expectedCount: 2, answeredCount: 2 });
  }
});

it.each([262_144, 262_145])('retains full answers when the inline round would be %s bytes', async (bytes) => {
  // Given the overhead of this meeting's two-answer round, and JSON-escaped UTF-8 answers.
  const probe = unwrap(await messaging.openCall(chair, aCall()));
  unwrap(await answer(alpha, { callId: probe.callId, payload: '' }));
  unwrap(await answer(beta, { callId: probe.callId, payload: '' }));
  const overhead = new TextEncoder().encode(lastRoundPayload()).byteLength;
  const firstPayload = '\u0000'.repeat(40_000);
  const secondPayload = 'é'.repeat(Math.floor((bytes - overhead - 240_000) / 2)) + 'x'.repeat((bytes - overhead - 240_000) % 2);
  const { callId } = unwrap(await messaging.openCall(chair, aCall()));
  // When both expected ships answer, making the complete inline JSON reach the boundary.
  unwrap(await answer(alpha, { callId, payload: firstPayload }));
  unwrap(await answer(beta, { callId, payload: secondPayload }));
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

it('reads the round named by a delayed notice after a newer call opens', async () => {
  // Given a completed round, followed by a new open call.
  const { callId } = unwrap(await messaging.openCall(chair, aCall()));
  unwrap(await answer(alpha, { callId }));
  unwrap(await answer(beta, { callId, payload: 'Monday' }));
  unwrap(await messaging.openCall(chair, aCall()));
  // When a participant follows the earlier notice's meeting and call reference.
  const read = unwrap(await messaging.readMeeting(beta, { meetingId, callId, limit: 20 }));
  // Then that round's fixed list, close and full answers remain readable.
  expect(read.call).toMatchObject({ callId, expectedShipIds: [alpha.shipId, beta.shipId], closedAt: core.clock.now() });
  expect(read.call?.answers.map((item) => item.payload)).toEqual(['Friday', 'Monday']);
});

it.each([60_000, 60_001])('refuses calls and answers at or past the meeting end after %s ms', async (elapsed) => {
  // Given a meeting with an open call and a future end time.
  ({ meetingId } = unwrap(await messaging.openMeeting(chair, { ships: [{ shipId: alpha.shipId }], endsAt: '2026-11-23T10:01:00.000Z', idempotencyKey: newKey(), model: SESSION_MODEL })));
  const { callId } = unwrap(await messaging.openCall(chair, { ...aCall(), deadline: '2026-11-23T10:01:00.000Z' }));
  core.clock.advance(elapsed);
  const before = counts();
  // When the moderator opens another call and a participant answers the existing call.
  const opened = await messaging.openCall(chair, aCall());
  const answered = await answer(alpha, { callId });
  // Then both refuse without storing anything, before the ending worker runs.
  expect(refusalOf(opened)).toMatchObject({ kind: 'MEETING_ENDED', message: `Meeting ${meetingId} ended: it takes no more calls` });
  expect(refusalOf(answered).kind).toBe('MEETING_ENDED');
  expect(counts()).toEqual(before);
});


describe('silence and the deadline', () => {
  const pass = () => createEndDueMeetings({ uow: core.uow, fleets: core.fleets, meetings: core.meetings, clock: core.clock, ids: core.ids, hasher: core.hasher, sealing: core.sealing })();
  it('counts closed calls once when a deadline ends the meeting', async () => {
    // Given a call and meeting due together at the call-count limit.
    ({ meetingId } = unwrap(await messaging.openMeeting(chair, { ships: [{ shipId: alpha.shipId }], endAfterCalls: 1, endsAt: '2026-11-23T10:01:00.000Z', idempotencyKey: newKey(), model: SESSION_MODEL })));
    unwrap(await messaging.openCall(chair, { ...aCall(), deadline: '2026-11-23T10:01:00.000Z' }));
    let counts = 0;
    const uow: typeof core.uow = { run: (work) => core.uow.run((tx) => work({ ...tx, meetings: { ...tx.meetings, closedCallCount: async (...args) => { counts += 1; return tx.meetings.closedCallCount(...args); } } })) };
    core.clock.advance(60_000);
    // When maintenance closes the call.
    await createEndDueMeetings({ uow, fleets: core.fleets, meetings: core.meetings, clock: core.clock, ids: core.ids, hasher: core.hasher, sealing: core.sealing })();
    // Then the meeting ends using one count.
    expect(counts).toBe(1);
    expect(core.state.meetings.find((meeting) => meeting.id === meetingId)?.endedAt).toEqual(core.clock.now());
  });
  it('marks a ship awaiting crew silent at opening and closes after the other answer', async () => {
    // Given beta has no crew when the call opens.
    core.state.leases = core.state.leases.filter((lease) => lease.shipId !== beta.shipId);
    const { callId } = unwrap(await messaging.openCall(chair, aCall()));
    expect(unwrap(await messaging.readMeeting(chair, { meetingId, limit: 20 })).call).toMatchObject({ silentShipIds: [beta.shipId] });
    // When the only crewed expected ship answers.
    unwrap(await answer(alpha, { callId }));
    // Then the moderator gets the closed round with beta silent.
    expect(JSON.parse(lastRoundPayload())).toMatchObject({ silentShipIds: [beta.shipId], closedAt: '2026-11-23T10:00:00.000Z' });
  });
  it('closes immediately when every expected ship awaits crew', async () => {
    // Given neither expected ship has a crew.
    core.state.leases = core.state.leases.filter((lease) => lease.shipId === chair.shipId);
    // When the call opens.
    unwrap(await messaging.openCall(chair, aCall()));
    // Then nobody waits five minutes for them.
    expect(JSON.parse(lastRoundPayload())).toMatchObject({ silentShipIds: [alpha.shipId, beta.shipId], answers: [] });
  });
  it.each(['present', 'left', 'revoked'])('closes at the default deadline with the unanswered ship %s silent', async (state) => {
    // Given a call with one answer, and beta may no longer participate.
    const { callId } = unwrap(await messaging.openCall(chair, { ...aCall(), deadline: undefined }));
    unwrap(await answer(alpha, { callId }));
    if (state === 'left') unwrap(await messaging.changeMeeting(beta, { meetingId, change: { kind: 'leave' } }));
    if (state === 'revoked') unwrap(await messaging.changeMeeting(chair, { meetingId, change: { kind: 'revoke', shipId: beta.shipId } }));
    core.clock.advance(299_999);
    expect((await pass()).nextAttemptAt).toEqual(new Date('2026-11-23T10:05:00.000Z'));
    expect(unwrap(await messaging.readMeeting(chair, { meetingId, limit: 20 })).call?.closedAt).toBeNull();
    // When maintenance reaches the deadline, twice.
    core.clock.advance(1);
    await pass();
    await pass();
    // Then one round closes and tells the moderator who was silent.
    expect(JSON.parse(lastRoundPayload())).toMatchObject({ silentShipIds: [beta.shipId], answers: [{ sender: { id: alpha.shipId } }] });
    expect(core.state.events.filter((event) => event.type === 'CallClosed')).toHaveLength(1);
  });
  it.each(['after maintenance', 'before maintenance'])('stores a late answer outside the closed round %s', async (timing) => {
    // Given alpha answered, and beta missed the deadline.
    const { callId } = unwrap(await messaging.openCall(chair, aCall()));
    unwrap(await answer(alpha, { callId }));
    core.clock.advance(300_000);
    if (timing === 'after maintenance') await pass();
    // When beta answers late.
    const { messageId } = unwrap(await answer(beta, { callId, payload: 'Keep this late thought' }));
    await pass();
    // Then the answer stays readable, marked late, outside the closed round.
    const read = unwrap(await messaging.readMeeting(chair, { meetingId, callId, limit: 20 }));
    expect(read.contributions.items).toContainEqual(expect.objectContaining({ messageId, isLate: true, payload: 'Keep this late thought' }));
    expect(read.call?.answers).toHaveLength(1);
    expect(read.call).toMatchObject({ lateAnswers: [{ messageId, isLate: true }], silentShipIds: [beta.shipId] });
    expect(JSON.parse(lastRoundPayload())).toMatchObject({ answers: [{ sender: { id: alpha.shipId } }], silentShipIds: [beta.shipId] });
  });
});
