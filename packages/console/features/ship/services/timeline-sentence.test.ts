import { createIdGenerator, type EventType, type TimelineEntry } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { plainText } from '../../../lib/sentence';
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
    signedInAccountId: null,
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

const fromPlanner = { id: newId('message'), sender: planner, recipient: { kind: 'ship' as const, ship: scout }, contentType: 'text/plain', isPing: false, model: null };
const pingFromArgo = { id: newId('message'), sender: argo, recipient: { kind: 'ship' as const, ship: scout }, contentType: 'application/vnd.aeolus.ping', isPing: true, model: null };
const fromScout = { id: newId('message'), sender: scout, recipient: { kind: 'ship' as const, ship: planner }, contentType: 'text/plain', isPing: false, model: null };

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
    ['accountCutOff', 'Its session ended: the account signed in as argo was cut off.'],
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

  it('says the session is pushed from its first push receive', () => {
    expect(onScoutsPage(anEntry('LeasePushed', { actor: scout }))).toEqual({
      sentence: 'Pushed: its trierarch or plugin watcher receives for its session',
      tone: 'ok',
      icon: 'received',
    });
  });

  it('says the ship received a message by a push receive, and received it again', () => {
    expect(onScoutsPage(anEntry('DeliveryReceived', { actor: scout, message: fromPlanner }))).toEqual({
      sentence: 'Received a message from planner',
      tone: 'active',
      icon: 'received',
    });
    expect(onScoutsPage(anEntry('DeliveryReceived', { actor: scout, message: fromPlanner, details: { again: true } })).sentence).toBe(
      'Received again a message from planner',
    );
  });

  it('says the ship took a message it claimed', () => {
    expect(onScoutsPage(anEntry('DeliveryHanded', { actor: scout, message: fromPlanner }))).toEqual({
      sentence: 'Took a message from planner',
      tone: 'active',
      icon: 'received',
    });
  });

  it('names another ship that took a message', () => {
    const reviewer = { id: newId('ship'), name: 'reviewer-02' };

    expect(onScoutsPage(anEntry('DeliveryHanded', { actor: reviewer, message: fromScout })).sentence).toBe(
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

  it('says the ship took a confirmed message once more after its turn died', () => {
    expect(onScoutsPage(anEntry('DeliveryHanded', { actor: scout, message: fromPlanner, details: { onceMore: true } })).sentence).toBe(
      'Took once more a message from planner',
    );
  });

  it('says the ship handled a message: the turn that took it ended by itself', () => {
    expect(onScoutsPage(anEntry('DeliveryHandled', { actor: scout, message: fromPlanner }))).toEqual({
      sentence: 'Handled a message from planner',
      tone: 'ok',
      icon: 'acknowledged',
    });
  });

  it('says a message was not handled: its turn died twice', () => {
    expect(onScoutsPage(anEntry('DeliveryNotHandled', { actor: scout, message: fromPlanner }))).toEqual({
      sentence: 'A message from planner was not handled: its turn died twice',
      tone: 'attention',
      icon: 'undeliverable',
    });
  });

  it('says a message is overdue, by the clock that ran out, and that argo was told', () => {
    const overdue = (details: Record<string, string | number>) => onScoutsPage(anEntry('DeliveryOverdue', { actor: null, message: fromPlanner, details })).sentence;
    expect(onScoutsPage(anEntry('DeliveryOverdue', { actor: null, message: fromPlanner, details: { clock: 'notConfirmed', minutes: 10 } }))).toEqual({
      sentence: 'A message from planner is overdue: handed, not confirmed for 10 min, argo told',
      tone: 'attention',
      icon: 'undeliverable',
    });
    expect(overdue({ clock: 'idle', minutes: 10 })).toBe('A message from planner is overdue: waiting 10 min while its session is idle, argo told');
    expect(overdue({ clock: 'busy', minutes: 60 })).toBe('A message from planner is overdue: waiting 60 min while its session is busy, argo told');
  });

  it("says the session's turn started or ended, as its hooks reported it", () => {
    expect(onScoutsPage(anEntry('TurnReported', { actor: scout, details: { turn: 'busy' } }))).toEqual({
      sentence: 'Turn started: busy',
      tone: 'active',
      icon: 'reported',
    });
    expect(onScoutsPage(anEntry('TurnReported', { actor: scout, details: { turn: 'idle' } }))).toEqual({
      sentence: 'Turn ended: idle',
      tone: 'ended',
      icon: 'reported',
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
    expect(onScoutsPage(anEntry('DeliveryHanded', { actor: scout, message: pingFromArgo })).sentence).toBe(
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

  it('says the crew stated what its ship is and offers, with the version and how many capabilities', () => {
    expect(onScoutsPage(anEntry('StatementSet', { actor: scout, details: { version: 2, capabilities: 3 } }))).toEqual({
      sentence: 'Stated what it is and offers: 3 capabilities, version 2',
      tone: 'ended',
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

  it('says who requested a crew for the ship, and who removed the request', () => {
    expect(onScoutsPage(anEntry('CrewRequested', { actor: argo, details: { settingsVersion: 1 } }))).toEqual({
      sentence: 'Crew requested by argo',
      tone: 'waiting',
      icon: 'claimed',
    });
    expect(onScoutsPage(anEntry('CrewRequestRemoved', { actor: argo }))).toEqual({
      sentence: 'Crew request removed by argo',
      tone: 'ended',
      icon: 'released',
    });
  });

  it('says why the crew request can not be placed, and who said so', () => {
    expect(onScoutsPage(anEntry('CrewRequestExplained', { actor: argo, details: { reason: 'no room' } }))).toEqual({
      sentence: 'Crew request can not be placed: no room by argo',
      tone: 'waiting',
      icon: 'reported',
    });
  });

  it('says the crew request was given back, why, and by which trierarch (#382)', () => {
    expect(onScoutsPage(anEntry('CrewRequestGivenBack', { actor: argo, details: { reason: 'mac-mini: claude-code 2.1.293 refused claude-opus-5-5' } }))).toEqual({
      sentence: 'Crew request given back: mac-mini: claude-code 2.1.293 refused claude-opus-5-5 by argo',
      tone: 'waiting',
      icon: 'released',
    });
  });

  it('says a kept worktree was asked to be cleared, how its trierarch confirmed it, or that the request went with the trierarch (decision 0032)', () => {
    expect(onScoutsPage(anEntry('WorktreeClearRequested', { actor: argo, details: { worktreeShipId: argo.id, repository: 'aeolus-fleet' } }))).toEqual({
      sentence: 'Clearing of the kept aeolus-fleet worktree requested by argo',
      tone: 'waiting',
      icon: 'reported',
    });
    expect(onScoutsPage(anEntry('WorktreeCleared', { actor: argo, details: { worktreeShipId: argo.id, repository: 'aeolus-fleet', outcome: 'removed' } }))).toEqual({
      sentence: 'Kept aeolus-fleet worktree cleared by argo',
      tone: 'ended',
      icon: 'retired',
    });
    expect(onScoutsPage(anEntry('WorktreeCleared', { actor: argo, details: { worktreeShipId: argo.id, repository: 'aeolus-fleet', outcome: 'not-kept' } }))).toMatchObject({
      sentence: 'Kept aeolus-fleet worktree cleared (none was kept) by argo',
    });
    expect(onScoutsPage(anEntry('WorktreeClearRemoved', { actor: argo, details: { worktreeShipId: argo.id, repository: 'aeolus-fleet' } }))).toEqual({
      sentence: 'Clearing of the kept aeolus-fleet worktree dropped by argo',
      tone: 'ended',
      icon: 'released',
    });
  });

  it('says who assigned the crew request, and how the trierarch says the crew stands', () => {
    expect(onScoutsPage(anEntry('CrewAssigned', { actor: argo, details: { assignedTo: argo.id } }))).toEqual({
      sentence: 'Crew request assigned by argo',
      tone: 'waiting',
      icon: 'claimed',
    });
    expect(onScoutsPage(anEntry('CrewStatusChanged', { actor: argo, details: { status: 'running' } }))).toEqual({
      sentence: 'Crew running by argo',
      tone: 'active',
      icon: 'reported',
    });
    expect(onScoutsPage(anEntry('CrewStatusChanged', { actor: argo, details: { status: 'crashed' } }))).toMatchObject({ tone: 'attention' });
  });

  it('says the network rules were set, how many and at which version, and by whom', () => {
    expect(onScoutsPage(anEntry('NetworkRulesSet', { actor: argo, details: { version: 2, rules: 3 } }))).toEqual({
      sentence: 'Network rules set: 3 rules, version 2 by argo',
      tone: 'ended',
      icon: 'fleet',
    });
  });

  it('says the network rules were cleared, back to all-to-all', () => {
    expect(onScoutsPage(anEntry('NetworkRulesSet', { actor: argo, details: { version: 3, rules: null } }))).toEqual({
      sentence: 'Network rules cleared: every ship reaches every ship, version 3 by argo',
      tone: 'ended',
      icon: 'fleet',
    });
  });

  it('says a ship declared network rules, how many, and by whom', () => {
    expect(onScoutsPage(anEntry('NetworkRulesDeclared', { actor: argo, details: { rules: 2 } }))).toEqual({
      sentence: 'Network rules declared: 2 rules by argo',
      tone: 'ended',
      icon: 'fleet',
    });
  });

  it('says a draft of the network rules was saved, how many rules and against which version', () => {
    expect(onScoutsPage(anEntry('NetworkRulesDraftSaved', { actor: argo, details: { rules: 2, savedAgainstVersion: 3 } }))).toEqual({
      sentence: 'Network rules draft saved: 2 rules, against version 3 by argo',
      tone: 'ended',
      icon: 'fleet',
    });
    expect(onScoutsPage(anEntry('NetworkRulesDraftSaved', { actor: argo, details: { rules: null, savedAgainstVersion: 3 } })).sentence).toBe(
      'Network rules draft saved: every ship reaches every ship, against version 3 by argo',
    );
  });

  it('says the draft of the network rules was discarded', () => {
    expect(onScoutsPage(anEntry('NetworkRulesDraftDiscarded', { actor: argo, details: {} }))).toEqual({ sentence: 'Network rules draft discarded by argo', tone: 'ended', icon: 'fleet' });
  });

  it('says declared network rules were withdrawn', () => {
    expect(onScoutsPage(anEntry('NetworkRulesDeclared', { actor: argo, details: { rules: 0 } }))).toEqual({
      sentence: 'Declared network rules withdrawn by argo',
      tone: 'ended',
      icon: 'fleet',
    });
  });

  it('says a plugin declared its namespace and how many scopes (decision 0046)', () => {
    expect(onScoutsPage(anEntry('ScopesDeclared', { actor: scout, details: { namespace: 'squadrons', scopes: 2 } }))).toEqual({
      sentence: 'Scopes declared: namespace squadrons, 2 scopes by scout',
      tone: 'ended',
      icon: 'fleet',
    });
  });

  it('says what scopes a ship was granted and revoked, and by whom (decision 0046)', () => {
    expect(onScoutsPage(anEntry('ScopesChanged', { actor: argo, details: { added: 'fleet:read squadrons:form', removed: 'labels:define' } }))).toEqual({
      sentence: 'Scopes changed: granted fleet:read squadrons:form, revoked labels:define by argo',
      tone: 'ended',
      icon: 'fleet',
    });
  });

  it('says only what changed', () => {
    expect(onScoutsPage(anEntry('ScopesChanged', { actor: argo, details: { added: 'fleet:read', removed: '' } })).sentence).toBe('Scopes changed: granted fleet:read by argo');
    expect(onScoutsPage(anEntry('ScopesChanged', { actor: argo, details: { added: '', removed: 'squadrons:form' } })).sentence).toBe('Scopes changed: revoked squadrons:form by argo');
  });

  it('says one scope in the singular', () => {
    expect(onScoutsPage(anEntry('ScopesDeclared', { actor: scout, details: { namespace: 'squadrons', scopes: 1 } })).sentence).toBe('Scopes declared: namespace squadrons, 1 scope by scout');
  });

  it('says a networking plugin registered, what happens while it is unavailable, at which version', () => {
    expect(onScoutsPage(anEntry('NetworkPluginRegistered', { actor: argo, details: { version: 4, whileUnavailable: 'keep-latest', notRespondingAfterSeconds: 120 } }))).toEqual({
      sentence: 'Networking plugin registered: while unavailable keep-latest, version 4 by argo',
      tone: 'ended',
      icon: 'fleet',
    });
  });

  it('says argo connected the ship as a plugin, which reads every ship', () => {
    expect(onScoutsPage(anEntry('PluginConnected', { actor: argo, details: {} }))).toEqual({ sentence: 'Connected as a plugin: reads every ship by argo', tone: 'ended', icon: 'fleet' });
  });

  it('says the ship is no longer a connected plugin, and why', () => {
    expect(onScoutsPage(anEntry('PluginDisconnected', { actor: argo, details: { why: 'released' } })).sentence).toBe('No longer a connected plugin: released by argo');
  });

  it('says the networking plugin unregistered, back to all-to-all', () => {
    expect(onScoutsPage(anEntry('NetworkPluginUnregistered', { actor: argo, details: { version: 5 } }))).toEqual({
      sentence: 'Networking plugin unregistered: every ship reaches every ship, version 5 by argo',
      tone: 'ended',
      icon: 'fleet',
    });
  });

  it('says the networking plugin turned open off for a verb, and the version', () => {
    expect(onScoutsPage(anEntry('BuiltInRuleChanged', { actor: argo, details: { rule: 'open', verb: 'send', isOn: false, version: 6 } }))).toEqual({
      sentence: 'Built-in rule open for send turned off, version 6 by argo',
      tone: 'ended',
      icon: 'fleet',
    });
  });

  it('says argo turned the viewer reading on', () => {
    expect(onScoutsPage(anEntry('BuiltInRuleChanged', { actor: argo, details: { rule: 'viewerRead', isOn: true, version: 7 } }))).toEqual({
      sentence: 'Built-in rule viewer read turned on, version 7 by argo',
      tone: 'ended',
      icon: 'fleet',
    });
  });

  it('names the label its owner deleted', () => {
    expect(onScoutsPage(anEntry('LabelDeleted', { actor: argo, details: { key: 'os' } }))).toEqual({
      sentence: 'Label os deleted',
      tone: 'ended',
      icon: 'retired',
    });
  });

  it('names the label its owner defined, changed or retired, with its values', () => {
    expect(onScoutsPage(anEntry('LabelDefined', { actor: argo, details: { key: 'os', values: 'macos,linux' } }))).toEqual({
      sentence: 'Label os defined: macos, linux',
      tone: 'ended',
      icon: 'reported',
    });
    expect(onScoutsPage(anEntry('LabelValuesChanged', { actor: argo, details: { key: 'os', values: 'macos' } }))).toEqual({
      sentence: 'Label os values changed: macos',
      tone: 'ended',
      icon: 'reported',
    });
    expect(onScoutsPage(anEntry('LabelRetired', { actor: argo, details: { key: 'os' } }))).toEqual({
      sentence: 'Label os retired',
      tone: 'ended',
      icon: 'retired',
    });
  });

  it('says how a ship got its owner at commission (decision 0045)', () => {
    expect(onScoutsPage(anEntry('OwnerSet', { actor: argo, details: { ownerShipId: 'shp_argo', how: 'argoByDefault' } }))).toEqual({
      sentence: 'Owner set: argo by default',
      tone: 'ended',
      icon: 'commissioned',
    });
    expect(onScoutsPage(anEntry('OwnerSet', { actor: argo, details: { ownerShipId: 'shp_thomas', how: 'inherited' } }))).toEqual({
      sentence: "Owner set: its commissioner's owner",
      tone: 'ended',
      icon: 'commissioned',
    });
    expect(onScoutsPage(anEntry('OwnerSet', { actor: { id: newId('ship'), name: 'gateway' }, details: { ownerShipId: 'shp_thomas', how: 'named' } }))).toEqual({
      sentence: 'Owner set: named by gateway',
      tone: 'ended',
      icon: 'commissioned',
    });
  });

  it('says a ship changed owner, by argo or because its owner retired', () => {
    expect(onScoutsPage(anEntry('OwnerChanged', { actor: argo, details: { why: 'setByArgo' } }))).toEqual({
      sentence: 'Owner changed by argo',
      tone: 'ended',
      icon: 'renamed',
    });
    expect(onScoutsPage(anEntry('OwnerChanged', { actor: argo, details: { why: 'ownerRetired' } }))).toEqual({
      sentence: 'Owner retired: argo owns it now',
      tone: 'ended',
      icon: 'renamed',
    });
  });

  it('says which label and value a ship was given or lost, and by whom', () => {
    expect(onScoutsPage(anEntry('LabelAssigned', { actor: argo, details: { key: 'os', value: 'macos' } }))).toEqual({
      sentence: 'Labelled os=macos by argo',
      tone: 'ended',
      icon: 'reported',
    });
    expect(onScoutsPage(anEntry('LabelUnassigned', { actor: argo, details: { key: 'os', value: 'macos' } }))).toEqual({
      sentence: 'Label os=macos removed by argo',
      tone: 'ended',
      icon: 'reported',
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
