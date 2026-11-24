/** A person joins on owner reach and steers without taking the moderator's place. */
import { beforeEach, expect, it } from 'vitest';
import type { MeetingId } from '@aeolus-fleet/common';

import { applyNetworkRules, crewAboard, initialiseFleet, messagingUseCases, operatorCaller, registryUseCases, SESSION_MODEL } from '../../../test/support/core-fixtures.js';
import { shipWithScopes } from '../../../test/support/crew-fixtures.js';
import { createInMemoryCore } from '../../../test/support/in-memory.js';
import { newKey } from '../../testing/keys.js';
import { refusalOf, unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';

let core: ReturnType<typeof createInMemoryCore>;
let messaging: ReturnType<typeof messagingUseCases>;
let registry: ReturnType<typeof registryUseCases>;
let argo: ShipCaller;
let chair: ShipCaller;
let alpha: ShipCaller;
let beta: ShipCaller;
let person: ShipCaller;
let meetingId: MeetingId;
beforeEach(async () => {
  core = createInMemoryCore('2026-11-23T10:00:00.000Z');
  argo = operatorCaller(await initialiseFleet(core));
  registry = registryUseCases(core);
  messaging = messagingUseCases(core);
  chair = await shipWithScopes({ registry, argo }, { name: 'chair', type: 'agent', scopes: ['meetings:open'] });
  alpha = await shipWithScopes({ registry, argo }, { name: 'alpha', type: 'agent', scopes: [] });
  beta = await shipWithScopes({ registry, argo }, { name: 'beta', type: 'agent', scopes: [] });
  const { shipId } = unwrap(await registry.commissionShip(argo, { name: 'person', type: 'person', kind: 'person', idempotencyKey: newKey() }));
  person = { fleetId: argo.fleetId, shipId, kind: 'person', scopes: ['messages:send', 'messages:receive'] };
  for (const ship of [chair, alpha, beta]) crewAboard(core, ship);
  ({ meetingId } = unwrap(await messaging.openMeeting(chair, { ships: [{ shipId: alpha.shipId }, { shipId: beta.shipId }], idempotencyKey: newKey(), model: SESSION_MODEL })));
});
const join = () => messaging.changeMeeting(person, { meetingId, change: { kind: 'rejoin' } });
const speak = () => messaging.sendMessage(person, { selector: { kind: 'meeting', meetingId }, payload: 'Let us change direction', idempotencyKey: newKey() });

it('lets a reached person join for the first time and records its participation', async () => {
  // Given a person who was never invited.
  // When it joins by itself.
  unwrap(await join());
  // Then it is present and the join has its event.
  expect(unwrap(await messaging.readMeeting(person, { meetingId, limit: 20 })).participants).toContainEqual(expect.objectContaining({ id: person.shipId, state: 'present' }));
  expect(core.state.events).toContainEqual(expect.objectContaining({ type: 'ParticipantAdded', shipId: person.shipId, actor: { kind: 'ship', shipId: person.shipId } }));
});

it('refuses a first join outside owner reach and records only the reach refusal', async () => {
  // Given network rules through which the owner reaches nobody.
  await applyNetworkRules(registry, { by: argo, rules: [] });
  const before = [core.state.events.length, core.state.messages.length];
  // When the person tries to join.
  expect(refusalOf(await join()).kind).toBe('NOT_REACHABLE');
  // Then no participation is stored and the refusal is recorded.
  expect(core.state.meetings[0]?.participants.some((p) => p.shipId === person.shipId)).toBe(false);
  expect([core.state.events.length, core.state.messages.length]).toEqual(before);
  expect(core.state.reachRefusals).toHaveLength(1);
});

it('keeps the already-present and revoked refusals for a person', async () => {
  // Given a person who joined.
  unwrap(await join());
  // When it joins again, then is revoked and tries again.
  expect(refusalOf(await join()).kind).toBe('ALREADY_PRESENT');
  unwrap(await messaging.changeMeeting(chair, { meetingId, change: { kind: 'revoke', shipId: person.shipId } }));
  // Then a person cannot bypass revoked rights.
  expect(refusalOf(await join()).kind).toBe('PARTICIPANT_REVOKED');
});

it('delivers person speech without the mic to every other participant and keeps the moderator', async () => {
  // Given a joined person and an agent holding the mic.
  unwrap(await join());
  unwrap(await messaging.changeMic(chair, { meetingId, change: { kind: 'give', shipId: alpha.shipId } }));
  // When the person speaks without requesting it.
  const { messageId } = unwrap(await speak());
  // Then every other participant gets it and the moderator can continue.
  expect(core.state.deliveries.filter((d) => d.messageId === messageId).map((d) => d.recipient)).toEqual([chair, alpha, beta].map((s) => ({ kind: 'ship', shipId: s.shipId })));
  expect(core.state.meetings[0]).toMatchObject({ moderatorShipId: chair.shipId, micHolderShipId: alpha.shipId });
  expect((await messaging.sendMessage(chair, { selector: { kind: 'meeting', meetingId }, payload: 'Continuing', model: SESSION_MODEL, idempotencyKey: newKey() })).isOk).toBe(true);
});

it('keeps the call open on person speech and marks pending ships not asked only on explicit close', async () => {
  // Given one answer and another expected ship still pending.
  const { callId } = unwrap(await messaging.openCall(chair, { meetingId, question: 'Ready?', excludedShipIds: [chair.shipId], model: SESSION_MODEL, idempotencyKey: newKey() }));
  unwrap(await messaging.sendMessage(alpha, { selector: { kind: 'meeting', meetingId }, callId, payload: 'Yes', model: SESSION_MODEL, idempotencyKey: newKey() }));
  unwrap(await join());
  // When the person steers by speaking.
  unwrap(await speak());
  // Then speaking leaves the call open, and explicit close preserves answers.
  expect(unwrap(await messaging.readMeeting(chair, { meetingId, callId, limit: 20 })).call?.closedAt).toBeNull();
  unwrap(await messaging.closeCall(person, { meetingId, callId }));
  expect(unwrap(await messaging.readMeeting(chair, { meetingId, callId, limit: 20 })).call).toMatchObject({ closedAt: core.clock.now(), silentShipIds: [], notAskedShipIds: [beta.shipId], answers: [{ sender: { id: alpha.shipId } }] });
  expect(core.state.events.filter((e) => e.type === 'CallClosed')).toHaveLength(1);
});

it('lets a present person end the meeting and tells every other participant', async () => {
  // Given a joined person who neither owns nor moderates.
  unwrap(await join());
  // When it ends the meeting.
  unwrap(await messaging.changeMeeting(person, { meetingId, change: { kind: 'end' } }));
  // Then the ending and its event are stored and all others are told.
  expect(core.state.meetings[0]?.endedAt).toEqual(core.clock.now());
  expect(core.state.events).toContainEqual(expect.objectContaining({ type: 'MeetingEnded', shipId: person.shipId }));
  expect(core.state.messages.filter((m) => m.contentType === 'application/vnd.aeolus.meeting.ended+json').map((m) => m.selector)).toEqual([chair, alpha, beta].map((s) => ({ kind: 'ship', shipId: s.shipId })));
});

it('leaves a call open on joining and uses the ordinary meeting end when the person ends it', async () => {
  // Given an open call and a person about to join.
  const { callId } = unwrap(await messaging.openCall(chair, { meetingId, question: 'Ready?', excludedShipIds: [chair.shipId], model: SESSION_MODEL, idempotencyKey: newKey() }));
  unwrap(await join());
  expect(unwrap(await messaging.readMeeting(chair, { meetingId, limit: 20 })).call?.closedAt).toBeNull();
  // When the person ends rather than contributes.
  unwrap(await messaging.changeMeeting(person, { meetingId, change: { kind: 'end' } }));
  // Then the call closes as it does for an owner or moderator ending.
  expect(unwrap(await messaging.readMeeting(chair, { meetingId, callId, limit: 20 })).call).toMatchObject({ closedAt: core.clock.now(), notAskedShipIds: [], silentShipIds: [] });
  expect(core.state.events.filter((e) => e.type === 'CallClosed')).toHaveLength(0);
  expect(core.state.events.filter((e) => e.type === 'MeetingEnded')).toHaveLength(1);
});


it('refuses close for an agent, a stranger, a left person and an unknown call without changes', async () => {
  // Given an open call and a person not yet participating.
  const { callId } = unwrap(await messaging.openCall(chair, { meetingId, question: 'Ready?', excludedShipIds: [chair.shipId], model: SESSION_MODEL, idempotencyKey: newKey() }));
  // When callers lacking the right try to close it.
  expect(refusalOf(await messaging.closeCall(person, { meetingId, callId })).kind).toBe('MEETING_NOT_FOUND');
  unwrap(await join());
  expect(refusalOf(await messaging.closeCall(chair, { meetingId, callId })).kind).toBe('NOT_PERSON');
  expect(refusalOf(await messaging.closeCall(person, { meetingId, callId: core.ids('message') })).kind).toBe('MESSAGE_NOT_FOUND');
  unwrap(await messaging.changeMeeting(person, { meetingId, change: { kind: 'leave' } }));
  // Then none closes the call.
  expect(refusalOf(await messaging.closeCall(person, { meetingId, callId })).kind).toBe('PARTICIPANT_LEFT');
  expect(unwrap(await messaging.readMeeting(chair, { meetingId, callId, limit: 20 })).call?.closedAt).toBeNull();
});

it('repeats an explicit close without another round or event and refuses a close after the meeting ends', async () => {
  // Given a joined person and a call.
  unwrap(await join());
  const { callId } = unwrap(await messaging.openCall(chair, { meetingId, question: 'Ready?', excludedShipIds: [chair.shipId, person.shipId], model: SESSION_MODEL, idempotencyKey: newKey() }));
  // When the same call is closed twice.
  unwrap(await messaging.closeCall(person, { meetingId, callId }));
  const before = [core.state.messages.length, core.state.events.length];
  unwrap(await messaging.closeCall(person, { meetingId, callId }));
  // Then closing is repeatable and an ended meeting still refuses changes.
  expect([core.state.messages.length, core.state.events.length]).toEqual(before);
  unwrap(await messaging.changeMeeting(person, { meetingId, change: { kind: 'end' } }));
  expect(refusalOf(await messaging.closeCall(person, { meetingId, callId })).kind).toBe('MEETING_ENDED');
});
