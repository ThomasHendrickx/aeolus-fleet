import { describe, expect, it } from 'vitest';

import {
  deliveryStateSchema,
  eventTypeSchema,
  locationKindSchema,
  scopeSchema,
  selectorKindSchema,
  shipKindSchema,
  shipStatusSchema,
} from './index.js';

describe('scopeSchema', () => {
  it.each(['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage', 'fleet:crew'])('accepts %s', (scope) => {
    expect(scopeSchema.parse(scope)).toBe(scope);
  });

  it.each(['fleet:write', 'FLEET:READ', 'messages', ''])('rejects %j', (scope) => {
    expect(scopeSchema.safeParse(scope).success).toBe(false);
  });
});

describe('shipKindSchema', () => {
  it('knows operator, agent and viewer, nothing else', () => {
    expect(shipKindSchema.options).toEqual(['operator', 'agent', 'viewer']);
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
      'ShipClaimed',
      'LeaseRevoked',
      'CredentialRevoked',
      'StartingPromptIssued',
      'OperatorPasswordReset',
      'MessageAccepted',
      'DeliveryClaimed',
      'DeliveryAcknowledged',
      'DeliveryUndeliverable',
      'DeliveryReturned',
      'ShipRetired',
      'DeliveryAbandoned',
      'DeliveryDismissed',
      'ShipRenamed',
      'ShipReported',
      'SignInTicketIssued',
      'FleetLimitsChanged',
      'ViewerSessionStarted',
      'CrewRequested',
      'CrewRequestRemoved',
    ]);
  });
});

describe('shipStatusSchema', () => {
  it('knows awaiting crew, crewed and retired, nothing else', () => {
    expect(shipStatusSchema.options).toEqual(['awaitingCrew', 'crewed', 'retired']);
  });
});

describe('selectorKindSchema', () => {
  it('knows ship and type, nothing else yet', () => {
    expect(selectorKindSchema.options).toEqual(['ship', 'type']);
  });
});

describe('deliveryStateSchema', () => {
  it('knows the six delivery states, nothing else', () => {
    expect(deliveryStateSchema.options).toEqual([
      'pending',
      'delivered',
      'acknowledged',
      'undeliverable',
      'dismissed',
      'abandoned',
    ]);
  });
});
