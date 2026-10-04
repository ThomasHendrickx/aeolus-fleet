import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import {
  installationFleetSchema,
  installationFleetsCreateInputSchema,
  installationFleetsCreateOutputSchema,
  installationFleetsDeleteInputSchema,
  installationFleetLimitsSchema,
  installationFleetsGetInputSchema,
  installationOperatorsIssueSignInTicketInputSchema,
  installationOperatorsIssueSignInTicketOutputSchema,
  installationFleetsSetLimitsInputSchema,
  installationSettingsSchema,
} from './installation.js';

const newId = createIdGenerator();

describe('installationFleetsCreateInputSchema', () => {
  it('takes a request id, a fleet name and the operator email, dropping whitespace around the email', () => {
    expect(installationFleetsCreateInputSchema.parse({ requestId: 'signup-42', name: 'hemma', operatorEmail: ' thomas@example.com ' })).toEqual({
      requestId: 'signup-42',
      name: 'hemma',
      operatorEmail: 'thomas@example.com',
    });
  });

  it.each([
    ['a missing request id', { name: 'hemma', operatorEmail: 'thomas@example.com' }],
    ['an empty request id', { requestId: '', name: 'hemma', operatorEmail: 'thomas@example.com' }],
    ['a request id over 256 characters', { requestId: 'r'.repeat(257), name: 'hemma', operatorEmail: 'thomas@example.com' }],
    ['a missing email', { requestId: 'signup-42', name: 'hemma' }],
    ['an email over 254 characters', { requestId: 'signup-42', name: 'hemma', operatorEmail: `${'a'.repeat(243)}@example.com` }],
    ['a password: hosted operators have none', { requestId: 'signup-42', name: 'hemma', operatorEmail: 'thomas@example.com', password: 'secret' }],
  ])('refuses %s', (_case, input) => {
    expect(installationFleetsCreateInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('installationFleetsCreateOutputSchema', () => {
  it("answers the new fleet's id and its argo's id", () => {
    const answer = { fleetId: newId('fleet'), operatorShipId: newId('ship') };

    expect(installationFleetsCreateOutputSchema.parse(answer)).toEqual(answer);
  });
});

describe('installationFleetSchema', () => {
  const fleet = {
    fleetId: newId('fleet'),
    name: 'hemma',
    operatorEmail: 'thomas@example.com',
    createdAt: '2026-10-04T12:00:00.000Z',
    shipCount: 3,
    messagesLast7Days: 12,
    lastActivityAt: '2026-10-04T12:30:00.000Z',
    storage: 4096,
    messagesToday: 3,
    messagesPerDay: [
      { date: '2026-09-28', count: 0 },
      { date: '2026-09-29', count: 1 },
      { date: '2026-09-30', count: 2 },
      { date: '2026-10-01', count: 0 },
      { date: '2026-10-02', count: 4 },
      { date: '2026-10-03', count: 2 },
      { date: '2026-10-04', count: 3 },
    ],
    limits: {
      ships: { setting: { kind: 'default' }, applies: 10 },
      dailyMessages: { setting: { kind: 'fleet', limit: null }, applies: null },
    },
  };

  it('describes a fleet: its measures, its messages today and per UTC day of the last 7 days, and the limits that apply', () => {
    expect(installationFleetSchema.parse(fleet)).toEqual(fleet);
  });

  it('takes a fleet with no activity yet', () => {
    expect(installationFleetSchema.parse({ ...fleet, lastActivityAt: null })).toMatchObject({ lastActivityAt: null });
  });

  it.each([
    ['a negative ship count', { ...fleet, shipCount: -1 }],
    ['a fractional message count', { ...fleet, messagesLast7Days: 1.5 }],
    ['a missing storage', { ...fleet, storage: undefined }],
    ['a negative storage', { ...fleet, storage: -1 }],
    ['a day that is no date', { ...fleet, messagesPerDay: [{ date: 'yesterday', count: 1 }] }],
    ['missing limits', { ...fleet, limits: undefined }],
  ])('refuses %s', (_case, input) => {
    expect(installationFleetSchema.safeParse(input).success).toBe(false);
  });
});

describe('installationFleetsGetInputSchema and installationFleetsDeleteInputSchema', () => {
  it('get takes a fleet id', () => {
    const fleetId = newId('fleet');

    expect(installationFleetsGetInputSchema.parse({ fleetId })).toEqual({ fleetId });
  });

  it('delete takes a request id and a fleet id', () => {
    const input = { requestId: 'delete-7', fleetId: newId('fleet') };

    expect(installationFleetsDeleteInputSchema.parse(input)).toEqual(input);
  });

  it.each([
    ['a ship id for a fleet id', { requestId: 'delete-7', fleetId: newId('ship') }],
    ['a missing request id', { fleetId: newId('fleet') }],
  ])('delete refuses %s', (_case, input) => {
    expect(installationFleetsDeleteInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('installationOperatorsIssueSignInTicket', () => {
  it("takes the fleet whose operator signs in, and answers the ticket", () => {
    const fleetId = newId('fleet');

    expect(installationOperatorsIssueSignInTicketInputSchema.parse({ fleetId })).toEqual({ fleetId });
    expect(installationOperatorsIssueSignInTicketOutputSchema.parse({ ticket: 'aeolus_st_v1_abc' })).toEqual({ ticket: 'aeolus_st_v1_abc' });
  });

  it('refuses a ship id for the fleet', () => {
    expect(installationOperatorsIssueSignInTicketInputSchema.safeParse({ fleetId: newId('ship') }).success).toBe(false);
  });
});

describe('installation settings', () => {
  it('hold the default ship and daily message limits for new fleets and the cap on fleets; each may be no limit', () => {
    const settings = { defaultShipLimit: 10, defaultDailyMessageLimit: null, fleetCap: 500 };

    expect(installationSettingsSchema.parse(settings)).toEqual(settings);
  });

  it.each([
    ['a negative limit', { defaultShipLimit: -1, defaultDailyMessageLimit: null, fleetCap: null }],
    ['a fractional limit', { defaultShipLimit: 1.5, defaultDailyMessageLimit: null, fleetCap: null }],
    ['a missing cap', { defaultShipLimit: 1, defaultDailyMessageLimit: 1 }],
  ])('refuse %s', (_case, settings) => {
    expect(installationSettingsSchema.safeParse(settings).success).toBe(false);
  });
});

describe("a fleet's limits", () => {
  const fleetId = newId('fleet');

  it('each follow the installation default, or are set for the fleet to a number or to no limit, and say which applies', () => {
    const limits = {
      fleetId,
      ships: { setting: { kind: 'default' }, applies: 10 },
      dailyMessages: { setting: { kind: 'fleet', limit: null }, applies: null },
    };

    expect(installationFleetLimitsSchema.parse(limits)).toEqual(limits);
  });

  it('are set one or both at a time, back to the default too', () => {
    expect(installationFleetsSetLimitsInputSchema.parse({ fleetId, ships: { kind: 'fleet', limit: 25 } })).toEqual({ fleetId, ships: { kind: 'fleet', limit: 25 } });
    expect(installationFleetsSetLimitsInputSchema.parse({ fleetId, dailyMessages: { kind: 'default' } })).toEqual({ fleetId, dailyMessages: { kind: 'default' } });
  });

  it('refuse a negative limit or an unknown setting', () => {
    expect(installationFleetsSetLimitsInputSchema.safeParse({ fleetId, ships: { kind: 'fleet', limit: -1 } }).success).toBe(false);
    expect(installationFleetsSetLimitsInputSchema.safeParse({ fleetId, ships: { kind: 'none' } }).success).toBe(false);
  });
});
