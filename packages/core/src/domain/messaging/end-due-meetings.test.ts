/** Issue #2036: the deadline ends a meeting without its moderator running. */
import { MEETING_ENDED_CONTENT_TYPE } from '@aeolus-fleet/common';
import { beforeEach, expect, it } from 'vitest';

import { initialiseFleet, messagingUseCases, operatorCaller, plainPayloadOf, registryUseCases, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import { createEndDueMeetings } from './end-due-meetings.js';

async function fixture() {
  const core = createInMemoryCore('2026-11-23T10:00:00.000Z');
  const fleet = await initialiseFleet(core);
  const registry = registryUseCases(core);
  const argo = operatorCaller(fleet);
  const chief = await shipWithScopes({ registry, argo }, { name: 'chief', type: 'chair', scopes: ['meetings:open'] });
  const alpha = await shipWithScopes({ registry, argo }, { name: 'alpha', type: 'participant', scopes: [] });
  const beta = await shipWithScopes({ registry, argo }, { name: 'beta', type: 'participant', scopes: [] });
  const messaging = messagingUseCases(core);
  const input = { ships: [{ shipId: alpha.shipId }, { shipId: beta.shipId }], idempotencyKey: newKey(), model: SESSION_MODEL, endsAt: '2026-11-23T10:01:00.000Z' };
  const { meetingId } = unwrap(await messaging.openMeeting(chief, input));
  const endDueMeetings = createEndDueMeetings({ uow: core.uow, fleets: core.fleets, meetings: core.meetings, clock: core.clock, ids: core.ids, hasher: core.hasher, sealing: core.sealing });
  return { core, messaging, chief, alpha, beta, meetingId, input, endDueMeetings };
}
let scene: Awaited<ReturnType<typeof fixture>>;
beforeEach(async () => { scene = await fixture(); });

it('ends at the deadline without its moderator and tells every other present participant once', async () => {
  // Given a different moderator and one participant who left.
  const { core, messaging, chief, alpha, beta, meetingId, endDueMeetings } = scene;
  unwrap(await messaging.changeMeeting(chief, { meetingId, change: { kind: 'nameModerator', shipId: alpha.shipId } }));
  unwrap(await messaging.changeMeeting(beta, { meetingId, change: { kind: 'leave' } }));
  // When core reaches the deadline, even with no crew running.
  core.clock.advance(60_000);
  await endDueMeetings();
  await endDueMeetings();
  // Then one ending and its notice are committed, from the current moderator.
  expect(core.state.meetings[0]?.endedAt).toEqual(new Date('2026-11-23T10:01:00.000Z'));
  expect(core.state.events.filter(({ type }) => type === 'MeetingEnded')).toMatchObject([{ actor: { kind: 'system' }, shipId: alpha.shipId, details: { meetingId } }]);
  const notices = core.state.messages.filter(({ contentType }) => contentType === MEETING_ENDED_CONTENT_TYPE);
  expect(notices).toMatchObject([{ senderShipId: alpha.shipId, selector: { kind: 'ship', shipId: chief.shipId } }]);
  expect(JSON.parse(plainPayloadOf(notices[0]))).toEqual({ meetingId });
});

it('does not end before the deadline and reports when the next deadline is due', async () => {
  // Given a meeting a millisecond before its deadline.
  scene.core.clock.advance(59_999);
  // When core checks its deadlines.
  const result = await scene.endDueMeetings();
  // Then it stays open and the timer has its next instant.
  expect(scene.core.state.meetings[0]?.endedAt).toBeNull();
  expect(result.nextAttemptAt).toEqual(new Date('2026-11-23T10:01:00.000Z'));
});

it('refuses a contribution exactly at the end time before the ending pass runs', async () => {
  // Given the deadline has arrived and the timer has not run yet.
  scene.core.clock.advance(60_000);
  const before = structuredClone(scene.core.state.messages);
  // When even the moderator contributes.
  const result = await scene.messaging.sendMessage(scene.chief, { selector: { kind: 'meeting', meetingId: scene.meetingId }, payload: 'Too late', idempotencyKey: newKey(), model: SESSION_MODEL });
  // Then it is ended for contributions and nothing is stored.
  expect(refusalOf(result).kind).toBe('MEETING_ENDED');
  expect(scene.core.state.messages).toEqual(before);
});

it('leaves meetings without deadlines open and never sends a second ended notice for an early end', async () => {
  // Given an early-ended meeting and an untimed one.
  const { core, chief, messaging, meetingId, input, endDueMeetings } = scene;
  unwrap(await messaging.changeMeeting(chief, { meetingId, change: { kind: 'end' } }));
  const untimed = unwrap(await messaging.openMeeting(chief, { ...input, idempotencyKey: newKey(), endsAt: undefined })).meetingId;
  const before = core.state.messages.length;
  // When the old deadline has passed.
  core.clock.advance(120_000);
  await endDueMeetings();
  // Then neither meeting generates another notice.
  expect(core.state.messages).toHaveLength(before);
  expect(core.state.meetings.find(({ id }) => id === untimed)?.endedAt).toBeNull();
});

it('refuses meeting changes at the deadline before the ending pass', async () => {
  // Given a participant who left before the deadline.
  const { core, messaging, chief, alpha, beta, meetingId } = scene;
  unwrap(await messaging.changeMeeting(beta, { meetingId, change: { kind: 'leave' } }));
  core.clock.advance(60_000);
  const before = structuredClone(core.state.meetings);
  // When participants attempt each meeting change.
  const added = await messaging.addToMeeting(chief, { meetingId, ships: [{ shipId: beta.shipId }], model: SESSION_MODEL });
  const results = await Promise.all([
    messaging.changeMeeting(alpha, { meetingId, change: { kind: 'leave' } }),
    messaging.changeMeeting(beta, { meetingId, change: { kind: 'rejoin' } }),
    messaging.changeMeeting(chief, { meetingId, change: { kind: 'revoke', shipId: alpha.shipId } }),
    messaging.changeMeeting(chief, { meetingId, change: { kind: 'transfer', shipId: alpha.shipId } }),
    messaging.changeMeeting(chief, { meetingId, change: { kind: 'nameModerator', shipId: alpha.shipId } }),
    messaging.changeMeeting(chief, { meetingId, change: { kind: 'end' } }),
  ]);
  // Then each sees the same refusal as an ended meeting, without a change.
  expect(refusalOf(added).kind).toBe('MEETING_ENDED');
  expect(results.map((result) => refusalOf(result).kind)).toEqual(Array(6).fill('MEETING_ENDED'));
  expect(core.state.meetings).toEqual(before);
});

it('refuses every mic change after the deadline before the ending pass', async () => {
  // Given a meeting past its deadline.
  const { core, messaging, chief, alpha, meetingId } = scene;
  core.clock.advance(60_001);
  const before = structuredClone(core.state.meetings);
  // When participants attempt each mic call.
  const results = await Promise.all([
    messaging.changeMic(alpha, { meetingId, change: { kind: 'request' } }),
    messaging.changeMic(alpha, { meetingId, change: { kind: 'withdraw' } }),
    messaging.changeMic(alpha, { meetingId, change: { kind: 'release' } }),
    messaging.changeMic(chief, { meetingId, change: { kind: 'give', shipId: alpha.shipId } }),
    messaging.changeMic(chief, { meetingId, change: { kind: 'take' } }),
    messaging.changeMic(chief, { meetingId, change: { kind: 'setPattern', pattern: 'fifo' } }),
  ]);
  // Then each sees the ended refusal and nothing changes.
  expect(results.map((result) => refusalOf(result).kind)).toEqual(Array(6).fill('MEETING_ENDED'));
  expect(core.state.meetings).toEqual(before);
});
