import { createIdGenerator, type EventType, type TimelineEntry } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { plainText } from './sentence';
import { timelineSentence } from './timeline-sentence';

const newId = createIdGenerator();
const scout = { id: newId('ship'), name: 'scout' };
const planner = { id: newId('ship'), name: 'planner' };
const argo = { id: newId('ship'), name: 'argo' };

function anEntry(type: EventType, overrides: Partial<TimelineEntry> = {}): TimelineEntry {
  return {
    seq: 1,
    id: newId('event'),
    type,
    occurredAt: '2026-10-01T09:00:00.000Z',
    actor: null,
    ship: scout,
    message: null,
    details: {},
    ...overrides,
  };
}

/** The sentence, tone and icon of an entry on scout's page. */
function onScoutsPage(entry: TimelineEntry) {
  const { parts, tone, icon } = timelineSentence(entry, scout.id);
  return { sentence: plainText(parts), tone, icon };
}

const fromPlanner = { id: newId('message'), sender: planner, recipient: { kind: 'ship' as const, ship: scout }, contentType: 'text/plain', model: null };
const pingFromArgo = { id: newId('message'), sender: argo, recipient: { kind: 'ship' as const, ship: scout }, contentType: 'application/vnd.aeolus.ping', model: null };
const fromScout = { id: newId('message'), sender: scout, recipient: { kind: 'ship' as const, ship: planner }, contentType: 'text/plain', model: null };

describe('timelineSentence', () => {
  it('says the fleet was initialised', () => {
    expect(onScoutsPage(anEntry('FleetInitialised'))).toEqual({ sentence: 'Fleet initialised', tone: 'ended', icon: 'fleet' });
  });

  it('says who commissioned the ship and as what type', () => {
    expect(onScoutsPage(anEntry('ShipCommissioned', { actor: argo, details: { type: 'reviewer' } }))).toEqual({
      sentence: 'Commissioned by argo as reviewer',
      tone: 'ended',
      icon: 'commissioned',
    });
  });

  it('names no one for a ship the system commissioned', () => {
    expect(onScoutsPage(anEntry('ShipCommissioned', { details: { type: 'operator' } })).sentence).toBe(
      'Commissioned as operator',
    );
  });

  it('says a starting prompt was issued', () => {
    expect(onScoutsPage(anEntry('StartingPromptIssued'))).toEqual({
      sentence: 'Starting prompt issued',
      tone: 'ended',
      icon: 'prompt',
    });
  });

  it('says where the claiming session runs: its description when it gave one', () => {
    const claimed = anEntry('ShipClaimed', { details: { location: 'SERVER', locationDescription: 'hetzner-1' } });

    expect(onScoutsPage(claimed)).toEqual({ sentence: 'Claimed by a session on hetzner-1', tone: 'ok', icon: 'claimed' });
  });

  it('says where the claiming session runs: its kind without a description', () => {
    const claimed = anEntry('ShipClaimed', { details: { location: 'DEVICE', locationDescription: null } });

    expect(onScoutsPage(claimed).sentence).toBe('Claimed by a session on Device');
  });

  it.each([
    ['released', 'Released by argo.'],
    ['deregistered', 'Its session deregistered.'],
    ['takenOver', 'Taken over by a new console session.'],
    ['signedOut', 'The operator signed out.'],
    ['passwordReset', 'Its session ended with the operator password reset.'],
  ])('words a lease that ended because it was %s', (reason, sentence) => {
    const ended = anEntry('LeaseRevoked', { actor: argo, details: { reason, returnedDeliveries: 0 } });

    expect(onScoutsPage(ended)).toEqual({ sentence, tone: 'waiting', icon: 'released' });
  });

  it('counts the in-flight deliveries a lease end sent back to pending', () => {
    const one = anEntry('LeaseRevoked', { actor: argo, details: { reason: 'released', returnedDeliveries: 1 } });
    const three = anEntry('LeaseRevoked', { actor: argo, details: { reason: 'released', returnedDeliveries: 3 } });

    expect(onScoutsPage(one).sentence).toBe('Released by argo. 1 in-flight delivery went back to pending.');
    expect(onScoutsPage(three).sentence).toBe('Released by argo. 3 in-flight deliveries went back to pending.');
  });

  it('says the secret was invalidated', () => {
    expect(onScoutsPage(anEntry('CredentialRevoked'))).toEqual({
      sentence: 'Secret invalidated',
      tone: 'ended',
      icon: 'secret',
    });
  });

  it('says the operator password was reset', () => {
    expect(onScoutsPage(anEntry('OperatorPasswordReset'))).toEqual({
      sentence: 'Operator password reset',
      tone: 'waiting',
      icon: 'password',
    });
  });

  it("says the fleet's limits changed", () => {
    expect(onScoutsPage(anEntry('FleetLimitsChanged'))).toEqual({ sentence: 'Fleet limits changed', tone: 'ended', icon: 'fleet' });
  });

  it('says someone started viewing the fleet through the viewer ship', () => {
    expect(onScoutsPage(anEntry('ViewerSessionStarted'))).toEqual({
      sentence: 'Someone started viewing the fleet',
      tone: 'ended',
      icon: 'password',
    });
  });

  it('says a sign-in ticket was issued for the operator', () => {
    expect(onScoutsPage(anEntry('SignInTicketIssued'))).toEqual({
      sentence: 'Sign-in ticket issued',
      tone: 'ended',
      icon: 'password',
    });
  });

  it('says the ship sent a message to a ship', () => {
    expect(onScoutsPage(anEntry('MessageAccepted', { actor: scout, ship: planner, message: fromScout }))).toEqual({
      sentence: 'Sent a message to planner',
      tone: 'ended',
      icon: 'sent',
    });
  });

  it('says the ship sent a message to any ship of a type', () => {
    const toType = { ...fromScout, recipient: { kind: 'type' as const, type: 'reviewer' } };

    expect(onScoutsPage(anEntry('MessageAccepted', { actor: scout, ship: null, message: toType })).sentence).toBe(
      'Sent a message to any ship of type reviewer',
    );
  });

  it('says the ship received a message', () => {
    expect(onScoutsPage(anEntry('MessageAccepted', { actor: planner, message: fromPlanner }))).toEqual({
      sentence: 'Received a message from planner',
      tone: 'ended',
      icon: 'received',
    });
  });

  it('says the ship took a message it claimed', () => {
    expect(onScoutsPage(anEntry('DeliveryClaimed', { actor: scout, message: fromPlanner }))).toEqual({
      sentence: 'Took a message from planner',
      tone: 'active',
      icon: 'received',
    });
  });

  it('names another ship that took a message', () => {
    const reviewer = { id: newId('ship'), name: 'reviewer-02' };

    expect(onScoutsPage(anEntry('DeliveryClaimed', { actor: reviewer, message: fromScout })).sentence).toBe(
      'reviewer-02 took a message from scout',
    );
  });

  it('says the ship acknowledged a message', () => {
    expect(onScoutsPage(anEntry('DeliveryAcknowledged', { actor: scout, message: fromPlanner }))).toEqual({
      sentence: 'Acknowledged a message from planner',
      tone: 'ok',
      icon: 'acknowledged',
    });
  });

  it('says argo pinged the ship, on its page', () => {
    expect(onScoutsPage(anEntry('MessageAccepted', { actor: argo, ship: scout, message: pingFromArgo }))).toEqual({
      sentence: 'Pinged by argo',
      tone: 'ended',
      icon: 'received',
    });
  });

  it("says argo pinged the ship, on argo's page", () => {
    const { parts } = timelineSentence(anEntry('MessageAccepted', { actor: argo, ship: scout, message: pingFromArgo }), argo.id);

    expect(plainText(parts)).toBe('Pinged scout');
  });

  it('says the ship took the ping', () => {
    expect(onScoutsPage(anEntry('DeliveryClaimed', { actor: scout, message: pingFromArgo })).sentence).toBe(
      'Took a ping from argo',
    );
  });

  it('says the ship answered the ping with pong', () => {
    expect(
      onScoutsPage(anEntry('DeliveryAcknowledged', { actor: scout, message: pingFromArgo, details: { answer: 'pong' } })),
    ).toEqual({ sentence: 'Answered a ping from argo with pong', tone: 'ok', icon: 'acknowledged' });
  });

  it("says on argo's page that the ship answered its ping with pong", () => {
    const entry = anEntry('DeliveryAcknowledged', { actor: scout, message: pingFromArgo, details: { answer: 'pong' } });

    expect(plainText(timelineSentence(entry, argo.id).parts)).toBe('scout answered a ping from argo with pong');
  });

  it('says the ship acknowledged a ping without pong', () => {
    expect(onScoutsPage(anEntry('DeliveryAcknowledged', { actor: scout, message: pingFromArgo })).sentence).toBe(
      'Acknowledged a ping from argo',
    );
  });

  it('says a ping went back to pending', () => {
    expect(onScoutsPage(anEntry('DeliveryReturned', { message: pingFromArgo })).sentence).toBe(
      'A ping from argo went back to pending',
    );
  });

  it('says what the crew reported, with its note, its tone by the state', () => {
    expect(onScoutsPage(anEntry('ShipReported', { actor: scout, details: { state: 'blocked', note: 'waiting for review' } }))).toEqual({
      sentence: 'Reported blocked: waiting for review',
      tone: 'waiting',
      icon: 'reported',
    });
  });

  it('says what the crew reported without a note', () => {
    expect(onScoutsPage(anEntry('ShipReported', { actor: scout, details: { state: 'working', note: null } }))).toMatchObject({
      sentence: 'Reported working',
      tone: 'active',
    });
  });

  it('says a message went back to pending', () => {
    expect(onScoutsPage(anEntry('DeliveryReturned', { message: fromPlanner }))).toEqual({
      sentence: 'A message from planner went back to pending',
      tone: 'waiting',
      icon: 'returned',
    });
  });

  it('says a message became undeliverable', () => {
    expect(onScoutsPage(anEntry('DeliveryUndeliverable', { actor: scout, message: fromPlanner }))).toEqual({
      sentence: 'A message from planner became undeliverable',
      tone: 'attention',
      icon: 'undeliverable',
    });
  });

  it('says who retired the ship and how many deliveries that abandoned', () => {
    expect(onScoutsPage(anEntry('ShipRetired', { actor: argo, details: { abandonedDeliveries: 2 } }))).toEqual({
      sentence: 'Retired by argo. 2 deliveries abandoned.',
      tone: 'ended',
      icon: 'retired',
    });
    expect(onScoutsPage(anEntry('ShipRetired', { actor: argo, details: { abandonedDeliveries: 0 } })).sentence).toBe(
      'Retired by argo.',
    );
  });

  it('says a message was abandoned', () => {
    expect(onScoutsPage(anEntry('DeliveryAbandoned', { actor: argo, message: fromPlanner }))).toEqual({
      sentence: 'A message from planner was abandoned',
      tone: 'ended',
      icon: 'abandoned',
    });
  });

  it('says what a ship was renamed from and to, and by whom', () => {
    expect(onScoutsPage(anEntry('ShipRenamed', { actor: argo, details: { from: 'lookout', to: 'scout' } }))).toEqual({
      sentence: 'Renamed from lookout to scout by argo',
      tone: 'ended',
      icon: 'renamed',
    });
  });

  it('says who dismissed an undeliverable message', () => {
    expect(onScoutsPage(anEntry('DeliveryDismissed', { actor: argo, message: fromPlanner }))).toEqual({
      sentence: 'A message from planner was dismissed by argo',
      tone: 'ended',
      icon: 'dismissed',
    });
  });

  it('says a session ended because the ship was retired', () => {
    expect(onScoutsPage(anEntry('LeaseRevoked', { actor: argo, details: { reason: 'retired', returnedDeliveries: 0 } })).sentence).toBe(
      'Its session ended: the ship was retired.',
    );
  });

  it('keeps each ship as its own part, so it renders as a ShipName', () => {
    const { parts } = timelineSentence(anEntry('MessageAccepted', { actor: planner, message: fromPlanner }), scout.id);

    expect(parts).toEqual([
      { kind: 'text', text: 'Received a message from ' },
      { kind: 'ship', party: planner },
    ]);
  });
});
