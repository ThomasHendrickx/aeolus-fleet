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
  installationAccountsCutOffInputSchema,
  installationAccountsSignOutInputSchema,
} from './installation.js';

const newId = createIdGenerator();

describe('installationFleetsCreateInputSchema with a viewer ship', () => {
  it('takes whether the fleet gets a viewer ship', () => {
    expect(installationFleetsCreateInputSchema.parse({ requestId: 'demo-1', name: 'demo', operatorEmail: 'demo@example.com', viewer: true })).toMatchObject({ viewer: true });
  });
});

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
      schedulesPerShip: { setting: { kind: 'fleet', limit: 5 }, applies: 5 },
      minimumScheduleInterval: { setting: { kind: 'default' }, applies: 60 },
      retention: { setting: { kind: 'fleet', days: 30 }, applies: 30 },
    },
    health: {
      oldestPendingAt: '2026-10-04T11:00:00.000Z',
      oldestInFlightAt: null,
      noShipCanTake: 1,
      needsAttention: 0,
      overdue: 0,
      stuck: [
        {
          cause: 'noShipCanTake',
          place: { kind: 'type', type: 'mapper' },
          count: 1,
          oldestSince: '2026-10-04T11:00:00.000Z',
          deliveries: [{ deliveryId: newId('delivery'), messageId: newId('message'), state: 'pending', since: '2026-10-04T11:00:00.000Z' }],
        },
      ],
      stuckPerHour: Array.from({ length: 168 }, () => ({ at: '2026-10-04T12:30:00.000Z', count: 1 })),
      acknowledged: { count: 12, medianMs: 6000, perHour: Array.from({ length: 24 }, () => ({ at: '2026-10-04T12:30:00.000Z', count: 0 })) },
    },
    featureFlags: [{ flag: 'sealing', isOn: true, canTurnOff: false }],
  };

  it('describes a fleet: its measures, its messages today and per UTC day of the last 7 days, the limits that apply and its health', () => {
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
    ['missing health', { ...fleet, health: undefined }],
    ['a feature flag core does not name (decision 0069)', { ...fleet, featureFlags: [{ flag: 'tracing', isOn: true, canTurnOff: true }] }],
    ['a negative count no ship can take', { ...fleet, health: { ...fleet.health, noShipCanTake: -1 } }],
    ['health without its stuck deliveries', { ...fleet, health: { ...fleet.health, stuck: undefined } }],
    ['a trend one hour short', { ...fleet, health: { ...fleet.health, stuckPerHour: fleet.health.stuckPerHour.slice(1) } }],
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
    expect(installationOperatorsIssueSignInTicketInputSchema.parse({ fleetId, as: 'viewer' })).toEqual({ fleetId, as: 'viewer' });
    expect(installationOperatorsIssueSignInTicketInputSchema.safeParse({ fleetId, as: 'agent' }).success).toBe(false);
    expect(installationOperatorsIssueSignInTicketOutputSchema.parse({ ticket: 'aeolus_st_v1_abc' })).toEqual({ ticket: 'aeolus_st_v1_abc' });
  });

  it('refuses a ship id for the fleet', () => {
    expect(installationOperatorsIssueSignInTicketInputSchema.safeParse({ fleetId: newId('ship') }).success).toBe(false);
  });

  it('takes the account it signs in as argo, by its id only (decision 0054)', () => {
    const fleetId = newId('fleet');

    expect(installationOperatorsIssueSignInTicketInputSchema.parse({ fleetId, account: { id: 'acc-mathilde' } })).toEqual({ fleetId, account: { id: 'acc-mathilde' } });
  });

  it.each([
    ['a name or an email beside the id', { id: 'acc-mathilde', name: 'mathilde@example.com' }],
    ['an empty id', { id: '' }],
  ])('refuses %s', (_label, account) => {
    expect(installationOperatorsIssueSignInTicketInputSchema.safeParse({ fleetId: newId('fleet'), account }).success).toBe(false);
  });
});

describe('installation settings', () => {
  const NOTHING_SET = { defaultShipLimit: null, defaultDailyMessageLimit: null, defaultSchedulesPerShipLimit: null, defaultMinimumScheduleInterval: null, defaultRetentionDays: null, fleetCap: null };

  it('hold the default ship, daily message and schedule limits and retention for new fleets and the cap on fleets; each may be none', () => {
    const settings = { defaultShipLimit: 10, defaultDailyMessageLimit: null, defaultSchedulesPerShipLimit: 20, defaultMinimumScheduleInterval: null, defaultRetentionDays: 30, fleetCap: 500 };

    expect(installationSettingsSchema.parse(settings)).toEqual(settings);
  });

  it('take a default retention of 1 day, the least there is, and none', () => {
    expect(installationSettingsSchema.parse({ ...NOTHING_SET, defaultRetentionDays: 1 })).toMatchObject({ defaultRetentionDays: 1 });
    expect(installationSettingsSchema.parse(NOTHING_SET)).toMatchObject({ defaultRetentionDays: null });
  });

  it.each([
    ['a negative limit', { ...NOTHING_SET, defaultShipLimit: -1 }],
    ['a fractional limit', { ...NOTHING_SET, defaultShipLimit: 1.5 }],
    ['a missing cap', { defaultShipLimit: 1, defaultDailyMessageLimit: 1, defaultSchedulesPerShipLimit: null, defaultMinimumScheduleInterval: null, defaultRetentionDays: null }],
    ['a missing minimum schedule interval', { defaultShipLimit: 1, defaultDailyMessageLimit: 1, defaultSchedulesPerShipLimit: null, defaultRetentionDays: null, fleetCap: null }],
    ['a retention of 0 days', { ...NOTHING_SET, defaultRetentionDays: 0 }],
    ['a missing retention', { defaultShipLimit: null, defaultDailyMessageLimit: null, defaultSchedulesPerShipLimit: null, defaultMinimumScheduleInterval: null, fleetCap: null }],
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
      schedulesPerShip: { setting: { kind: 'fleet', limit: 5 }, applies: 5 },
      minimumScheduleInterval: { setting: { kind: 'default' }, applies: 60 },
      retention: { setting: { kind: 'default' }, applies: 30 },
    };

    expect(installationFleetLimitsSchema.parse(limits)).toEqual(limits);
  });

  it('are set one or both at a time, back to the default too', () => {
    expect(installationFleetsSetLimitsInputSchema.parse({ fleetId, ships: { kind: 'fleet', limit: 25 } })).toEqual({ fleetId, ships: { kind: 'fleet', limit: 25 } });
    expect(installationFleetsSetLimitsInputSchema.parse({ fleetId, dailyMessages: { kind: 'default' } })).toEqual({ fleetId, dailyMessages: { kind: 'default' } });
  });

  it('set the retention for the fleet to a number of days or to none (kept for good)', () => {
    expect(installationFleetsSetLimitsInputSchema.parse({ fleetId, retention: { kind: 'fleet', days: 7 } })).toEqual({ fleetId, retention: { kind: 'fleet', days: 7 } });
    expect(installationFleetsSetLimitsInputSchema.parse({ fleetId, retention: { kind: 'fleet', days: null } })).toEqual({ fleetId, retention: { kind: 'fleet', days: null } });
  });

  it('refuse a retention of 0 days or of part of a day', () => {
    expect(installationFleetsSetLimitsInputSchema.safeParse({ fleetId, retention: { kind: 'fleet', days: 0 } }).success).toBe(false);
    expect(installationFleetsSetLimitsInputSchema.safeParse({ fleetId, retention: { kind: 'fleet', days: 1.5 } }).success).toBe(false);
  });

  it('refuse a negative limit or an unknown setting', () => {
    expect(installationFleetsSetLimitsInputSchema.safeParse({ fleetId, ships: { kind: 'fleet', limit: -1 } }).success).toBe(false);
    expect(installationFleetsSetLimitsInputSchema.safeParse({ fleetId, ships: { kind: 'none' } }).success).toBe(false);
  });
});

describe('installationAccountsCutOffInputSchema', () => {
  it("takes the account pagasae cut off, by its id only (decision 0058)", () => {
    expect(installationAccountsCutOffInputSchema.parse({ accountId: 'acc-burak' })).toEqual({ accountId: 'acc-burak' });
  });

  it.each([
    ['no account', {}],
    ['an empty account', { accountId: '' }],
    ['an email beside it', { accountId: 'acc-burak', email: 'burak@acme.example' }],
  ])('refuses %s', (_case, input) => {
    expect(installationAccountsCutOffInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('installationAccountsSignOutInputSchema', () => {
  it('takes the account that signed out in the account app, by its id only', () => {
    expect(installationAccountsSignOutInputSchema.parse({ accountId: 'acc-burak' })).toEqual({ accountId: 'acc-burak' });
  });

  it.each([
    ['no account', {}],
    ['an empty account', { accountId: '' }],
  ])('refuses %s', (_case, input) => {
    expect(installationAccountsSignOutInputSchema.safeParse(input).success).toBe(false);
  });
});
