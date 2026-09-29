import { describe, expect, it } from 'vitest';

import { eventTypeSchema, locationKindSchema, scopeSchema, shipKindSchema, shipStatusSchema } from './index.js';

describe('scopeSchema', () => {
  it.each(['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage'])('accepts %s', (scope) => {
    expect(scopeSchema.parse(scope)).toBe(scope);
  });

  it.each(['fleet:write', 'FLEET:READ', 'messages', ''])('rejects %j', (scope) => {
    expect(scopeSchema.safeParse(scope).success).toBe(false);
  });
});

describe('shipKindSchema', () => {
  it('knows operator and agent, nothing else', () => {
    expect(shipKindSchema.options).toEqual(['operator', 'agent']);
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
    ]);
  });
});

describe('shipStatusSchema', () => {
  it('knows awaiting crew, crewed and retired, nothing else', () => {
    expect(shipStatusSchema.options).toEqual(['awaitingCrew', 'crewed', 'retired']);
  });
});
