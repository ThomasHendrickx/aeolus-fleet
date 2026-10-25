import { describe, expect, it } from 'vitest';

import {
  CORE_NAMESPACES,
  deliveryStateSchema,
  eventTypeSchema,
  FLEET_SCOPES,
  locationKindSchema,
  SCOPES,
  scopeNameSchema,
  scopeSchema,
  selectorKindSchema,
  shipKindSchema,
  shipStatusSchema,
} from './index.js';

describe('the scopes', () => {
  it('are the message scopes, then the fleet scopes, then the scopes for what was argo\'s alone, then declaring and granting scopes, then opening meetings, and nothing else (decisions 0046, 0053, 0061)', () => {
    expect(SCOPES).toEqual([
      'messages:send',
      'messages:receive',
      'messages:force',
      'messages:resend',
      'fleet:read',
      'fleet:commission',
      'fleet:manage',
      'crew:assign',
      'crew:run',
      'labels:define',
      'labels:assign',
      'fleet:network',
      'fleet:on-behalf',
      'fleet:person',
      'fleet:owner',
      'fleet:explain',
      'fleet:connect',
      'labels:any',
      'fleet:verify',
      'scopes:declare',
      'scopes:grant',
      'meetings:open',
    ]);
  });

  it('let a commission grant every job argo had alone, so an agent ship can hold each (decision 0053)', () => {
    expect(FLEET_SCOPES).toEqual([
      'messages:resend',
      'fleet:read',
      'fleet:commission',
      'fleet:manage',
      'crew:assign',
      'crew:run',
      'labels:define',
      'labels:assign',
      'fleet:network',
      'fleet:on-behalf',
      'fleet:person',
      'fleet:owner',
      'fleet:explain',
      'fleet:connect',
      'labels:any',
      'fleet:verify',
      'meetings:open',
    ]);
  });
});

describe('the core namespaces', () => {
  it('are messages, fleet, crew, labels, scopes and meetings, reserved for core (decisions 0046, 0061)', () => {
    expect(CORE_NAMESPACES).toEqual(['messages', 'fleet', 'crew', 'labels', 'scopes', 'meetings']);
  });

  it('name every core scope', () => {
    expect(SCOPES.filter((scope) => !CORE_NAMESPACES.some((namespace) => scope.startsWith(`${namespace}:`)))).toEqual([]);
  });
});

describe('scopeNameSchema', () => {
  it.each(['squadrons:form', 'messages:send', 'a:b', 'x2-y:scale-up', `${'n'.repeat(32)}:${'a'.repeat(32)}`])('accepts %s, a namespace and an action (decision 0046)', (scope) => {
    expect(scopeNameSchema.parse(scope)).toBe(scope);
  });

  it.each([
    ['an upper case letter', 'Squadrons:form'],
    ['a namespace starting with a digit', '2squadrons:form'],
    ['an action starting with a hyphen', 'squadrons:-form'],
    ['a namespace of 33 characters', `${'n'.repeat(33)}:form`],
    ['an action of 33 characters', `squadrons:${'a'.repeat(33)}`],
    ['no action', 'squadrons'],
    ['an empty action', 'squadrons:'],
    ['two colons', 'squadrons:form:now'],
    ['a space', 'squadrons: form'],
    ['an unknown scope of a core namespace', 'fleet:write'],
    ['nothing', ''],
  ])('rejects %s', (_what, scope) => {
    expect(scopeNameSchema.safeParse(scope).success).toBe(false);
  });
});

describe('scopeSchema', () => {
  it.each(['messages:send', 'messages:receive', 'messages:force', 'messages:resend', 'fleet:read', 'fleet:commission', 'fleet:manage', 'crew:assign', 'crew:run', 'labels:define', 'labels:assign', 'fleet:network', 'fleet:on-behalf', 'scopes:declare', 'scopes:grant'])('accepts %s', (scope) => {
    expect(scopeSchema.parse(scope)).toBe(scope);
  });

  it.each(['fleet:write', 'FLEET:READ', 'messages', ''])('rejects %j', (scope) => {
    expect(scopeSchema.safeParse(scope).success).toBe(false);
  });
});

describe('shipKindSchema', () => {
  it('knows operator, agent, viewer, person, app and plugin, nothing else (decision 0050)', () => {
    expect(shipKindSchema.options).toEqual(['operator', 'agent', 'viewer', 'person', 'app', 'plugin']);
  });
});

describe('locationKindSchema', () => {
  it('knows DEVICE, CLOUD, SERVER and OTHER, nothing else', () => {
    expect(locationKindSchema.options).toEqual(['DEVICE', 'CLOUD', 'SERVER', 'OTHER']);
  });

  it('is case sensitive', () => {
    expect(locationKindSchema.safeParse('device').success).toBe(false);
  });
});

describe('eventTypeSchema', () => {
  it('knows the events written so far', () => {
    expect(eventTypeSchema.options).toEqual([
      'FleetInitialised',
      'ShipCommissioned',
      'OwnerSet',
      'OwnerChanged',
      'ShipClaimed',
      'LeaseRevoked',
      'CredentialRevoked',
      'StartingPromptIssued',
      'OperatorPasswordReset',
      'OperatorLoginSet',
      'MessageAccepted',
      'LeasePushed',
      'DeliveryReceived',
      'DeliveryHanded',
      'DeliveryAcknowledged',
      'DeliveryHandled',
      'DeliveryNotHandled',
      'DeliveryOverdue',
      'DeliveryUndeliverable',
      'DeliveryReturned',
      'ShipRetired',
      'DeliveryAbandoned',
      'DeliveryDismissed',
      'ShipRenamed',
      'ShipReported',
      'StatementSet',
      'TurnReported',
      'SignInTicketIssued',
      'FleetLimitsChanged',
      'ViewerSessionStarted',
      'CrewRequested',
      'CrewRequestRemoved',
      'CrewAssigned',
      'CrewStatusChanged',
      'CrewRequestExplained',
      'CrewRequestGivenBack',
      'LabelDefined',
      'LabelValuesChanged',
      'LabelRetired',
      'LabelAssigned',
      'LabelUnassigned',
      'LabelDeleted',
      'WorktreeClearRequested',
      'WorktreeCleared',
      'WorktreeClearRemoved',
      'NetworkRulesSet',
      'NetworkRulesDeclared',
      'NetworkRulesDraftSaved',
      'NetworkRulesDraftDiscarded',
      'NetworkPluginRegistered',
      'NetworkPluginUnregistered',
      'BuiltInRuleChanged',
      'ScopesDeclared',
      'ScopesChanged',
      'PluginConnected',
      'PluginDisconnected',
      'VerifiedFactsSet',
      'VerifiedFactsRemoved',
      'MeetingOpened',
      'ParticipantAdded',
      'MicRequested',
      'MicRequestWithdrawn',
      'MicGiven',
      'MicReleased',
      'MicTaken',
      'MicPatternSet',
      'ParticipantLeft',
      'ParticipantRejoined',
      'ParticipantRevoked',
      'OwnershipTransferred',
      'ModeratorNamed',
      'MeetingEnded',
      'ScheduleCreated',
      'ScheduleCancelled',
      'ScheduledSendRefused',
      'SchedulePaused',
      'ScheduleEnded',
    ]);
  });
});

describe('shipStatusSchema', () => {
  it('knows awaiting crew, crewed and retired, nothing else', () => {
    expect(shipStatusSchema.options).toEqual(['awaitingCrew', 'crewed', 'retired']);
  });
});

describe('selectorKindSchema', () => {
  it('knows ship, type and meeting, nothing else yet (decision 0061)', () => {
    expect(selectorKindSchema.options).toEqual(['ship', 'type', 'meeting']);
  });
});

describe('deliveryStateSchema', () => {
  it('knows the nine delivery states, nothing else', () => {
    expect(deliveryStateSchema.options).toEqual([
      'pending',
      'received',
      'handed',
      'acknowledged',
      'handled',
      'notHandled',
      'undeliverable',
      'dismissed',
      'abandoned',
    ]);
  });
});
