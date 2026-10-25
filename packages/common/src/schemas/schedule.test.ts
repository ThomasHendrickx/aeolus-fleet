import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import { PAYLOAD_MAX_BYTES } from './message.js';
import {
  cancelScheduleInputSchema,
  cancelScheduleOutputSchema,
  durationMs,
  fleetSchedulesInputSchema,
  scheduleInputSchema,
  scheduleOutputSchema,
  schedulesInputSchema,
  schedulesOutputSchema,
} from './schedule.js';

const newId = createIdGenerator();

describe('scheduleInputSchema', () => {
  const input = {
    selector: { kind: 'ship', name: 'chief-of-staff' },
    payload: 'Check in: what changed in the last 6 hours?',
    idempotencyKey: 'check-in-2026-10-26',
    model: 'claude-opus-5-5',
    timing: { kind: 'once', at: '2026-10-26T09:00:00+02:00' },
  };

  it('accepts a once schedule: a send input with an instant and its offset', () => {
    expect(scheduleInputSchema.parse(input)).toEqual(input);
  });

  it('accepts a whole send input: a type, a content type, a reply, forced, with its refusal strategy and retry window', () => {
    const whole = {
      ...input,
      selector: { kind: 'type', type: 'reviewer' },
      contentType: 'application/vnd.aeolus.check-in+json',
      inReplyTo: newId('message'),
      isForced: true,
      onRefused: 'retry',
      retryWindow: 'PT30M',
    };

    expect(scheduleInputSchema.parse(whole)).toEqual(whole);
  });

  it('accepts an every schedule of a duration, with its start, end and count', () => {
    const every = { ...input, timing: { kind: 'every', every: 'PT6H', start: '2026-10-26T06:00:00+02:00', end: '2026-12-31T00:00:00Z', count: 10 } };

    expect(scheduleInputSchema.parse(every)).toEqual(every);
  });

  it('accepts a cron schedule, with or without its zone', () => {
    const zoned = { ...input, timing: { kind: 'cron', cron: '0 9 * * MON-FRI', timeZone: 'Europe/Brussels' } };
    const utc = { ...input, timing: { kind: 'cron', cron: '0 */6 * * *' } };

    expect([scheduleInputSchema.parse(zoned), scheduleInputSchema.parse(utc)]).toEqual([zoned, utc]);
  });

  it.each(['each', 'once', 'skip'])('accepts the missed strategy %s with a grace', (onMissed) => {
    expect(scheduleInputSchema.parse({ ...input, onMissed, grace: 'PT1M' })).toMatchObject({ onMissed, grace: 'PT1M' });
  });

  it.each(['skip', 'retry', 'pause'])('accepts the refusal strategy %s', (onRefused) => {
    expect(scheduleInputSchema.parse({ ...input, onRefused }).onRefused).toBe(onRefused);
  });

  it('accepts a payload of exactly 64 KB', () => {
    expect(scheduleInputSchema.safeParse({ ...input, payload: 'a'.repeat(PAYLOAD_MAX_BYTES) }).success).toBe(true);
  });

  it.each([
    ['a payload one byte over 64 KB', { ...input, payload: 'a'.repeat(PAYLOAD_MAX_BYTES + 1) }],
    ['a meeting selector', { ...input, selector: { kind: 'meeting', meetingId: newId('meeting') } }],
    ['an instant without its offset', { ...input, timing: { kind: 'once', at: '2026-10-26T09:00:00' } }],
    ['a date without a time', { ...input, timing: { kind: 'once', at: '2026-10-26' } }],
    ['a timing of an unknown kind', { ...input, timing: { kind: 'hourly' } }],
    ['no timing', { ...input, timing: undefined }],
    ['an unknown refusal strategy', { ...input, onRefused: 'drop' }],
    ['a retry window that is no duration', { ...input, retryWindow: 'an hour' }],
    ['a retry window in months, which have no fixed length', { ...input, retryWindow: 'P1M' }],
    ['no idempotency key', { ...input, idempotencyKey: undefined }],
    ['a count that is no whole number', { ...input, timing: { kind: 'every', every: 'PT1H', count: 1.5 } }],
    ['an end without its offset', { ...input, timing: { kind: 'every', every: 'PT1H', end: '2026-12-31T00:00:00' } }],
    ['a zone on an every', { ...input, timing: { kind: 'every', every: 'PT1H', timeZone: 'UTC' } }],
    ['an unknown missed strategy', { ...input, onMissed: 'all' }],
    ['a grace in years', { ...input, grace: 'P1Y' }],
  ])('rejects %s', (_label, candidate) => {
    expect(scheduleInputSchema.safeParse(candidate).success).toBe(false);
  });
});

describe('durationMs', () => {
  it.each([
    ['PT30S', 30_000],
    ['PT5M', 300_000],
    ['PT1H', 3_600_000],
    ['P1D', 86_400_000],
    ['P1W', 604_800_000],
    ['P1DT2H30M', 95_400_000],
    ['PT0.5S', 500],
  ])('reads %s as %d ms', (text, ms) => {
    expect(durationMs(text)).toBe(ms);
  });

  it.each(['P', 'PT', 'P1M', 'P1Y', '1H', 'PT-1H', 'P1W1D', 'PT0S'])('reads %s as no duration', (text) => {
    expect(durationMs(text)).toBeUndefined();
  });
});

describe('scheduleOutputSchema', () => {
  it("answers the schedule's id", () => {
    const output = { scheduleId: newId('schedule') };

    expect(scheduleOutputSchema.parse(output)).toEqual(output);
  });
});

describe('schedulesInputSchema', () => {
  it('accepts a first page with no filter', () => {
    expect(schedulesInputSchema.parse({})).toEqual({});
  });

  it('accepts a state filter and a cursor', () => {
    const input = { states: ['ended', 'cancelled'], cursor: newId('schedule'), limit: 20 };

    expect(schedulesInputSchema.parse(input)).toEqual(input);
  });

  it.each([
    ['an unknown state', { states: ['sent'] }],
    ['an empty state filter', { states: [] }],
    ['a cursor of another kind', { cursor: newId('message') }],
  ])('rejects %s', (_label, candidate) => {
    expect(schedulesInputSchema.safeParse(candidate).success).toBe(false);
  });
});

describe('fleetSchedulesInputSchema', () => {
  it('names the ship whose schedules a manager lists', () => {
    const input = { shipId: newId('ship') };

    expect(fleetSchedulesInputSchema.parse(input)).toEqual(input);
  });

  it('rejects no ship', () => {
    expect(fleetSchedulesInputSchema.safeParse({}).success).toBe(false);
  });
});

describe('schedulesOutputSchema', () => {
  const schedule = {
    scheduleId: newId('schedule'),
    shipId: newId('ship'),
    state: 'active',
    selector: { kind: 'ship', name: 'chief-of-staff' },
    contentType: 'text/plain',
    inReplyTo: null,
    isForced: false,
    timing: { kind: 'once', at: '2026-10-26T07:00:00.000Z' },
    onRefused: 'skip',
    retryWindow: 'PT1H',
    onMissed: 'each',
    grace: 'PT5M',
    nextSendTime: '2026-10-26T07:00:00.000Z',
    lastOutcome: null,
    createdAt: '2026-10-25T07:00:00.000Z',
    endedAt: null,
    cancelledAt: null,
  };

  it('answers a page of schedules with their state and next send time', () => {
    const page = { items: [schedule], nextCursor: null };

    expect(schedulesOutputSchema.parse(page)).toEqual(page);
  });

  it('answers a sent outcome with its message and a refused one with its code', () => {
    const sent = { ...schedule, state: 'ended', nextSendTime: null, lastOutcome: { kind: 'sent', messageId: newId('message'), sendTime: '2026-10-26T07:00:00.000Z', at: '2026-10-26T07:00:01.000Z' } };
    const refused = { ...schedule, lastOutcome: { kind: 'refused', code: 'NOT_REACHABLE', sendTime: '2026-10-26T07:00:00.000Z', at: '2026-10-26T07:00:01.000Z' } };

    expect(schedulesOutputSchema.parse({ items: [sent, refused], nextCursor: null }).items).toEqual([sent, refused]);
  });

  it('answers a repeat with its bounds and a missed outcome with its send time', () => {
    const cron = {
      ...schedule,
      timing: { kind: 'cron', cron: '0 9 * * *', timeZone: 'Europe/Brussels', start: null, end: '2026-12-31T00:00:00.000Z', count: null },
      lastOutcome: { kind: 'missed', sendTime: '2026-10-26T07:00:00.000Z', at: '2026-10-26T08:00:00.000Z' },
    };

    expect(schedulesOutputSchema.parse({ items: [cron], nextCursor: null }).items).toEqual([cron]);
  });

  it('rejects an unknown state', () => {
    expect(schedulesOutputSchema.safeParse({ items: [{ ...schedule, state: 'sent' }], nextCursor: null }).success).toBe(false);
  });
});

describe('cancelScheduleInputSchema and cancelScheduleOutputSchema', () => {
  it('takes the schedule by its id and answers it cancelled', () => {
    const scheduleId = newId('schedule');

    expect(cancelScheduleInputSchema.parse({ scheduleId })).toEqual({ scheduleId });
    expect(cancelScheduleOutputSchema.parse({ scheduleId, state: 'cancelled' })).toEqual({ scheduleId, state: 'cancelled' });
  });

  it('rejects a schedule id of another kind', () => {
    expect(cancelScheduleInputSchema.safeParse({ scheduleId: newId('meeting') }).success).toBe(false);
  });
});
