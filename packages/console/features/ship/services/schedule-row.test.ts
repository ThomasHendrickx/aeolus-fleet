import { idSchema, type ScheduleItem } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { scheduleRowOf } from './schedule-row';

const NOW = new Date(2026, 9, 25, 12, 0);
const scheduleId = idSchema('schedule').parse('sch_01m5saxrvna1k3ywca6fjp6qce');
const messageId = idSchema('message').parse('msg_01m5saxrvna1k3ywca6fjp6qce');
const plannerId = idSchema('ship').parse('shp_01m5saxrvna1k3ywca6fjp6qce');

function aSchedule(overrides: Partial<ScheduleItem> = {}): ScheduleItem {
  return {
    scheduleId,
    shipId: plannerId,
    state: 'active',
    selector: { kind: 'ship', name: 'chief-of-staff' },
    contentType: 'text/plain',
    inReplyTo: null,
    isForced: false,
    timing: { kind: 'every', every: 'PT6H', start: null, end: null, count: null },
    onRefused: 'skip',
    retryWindow: 'PT1H',
    onMissed: 'each',
    grace: 'PT5M',
    nextSendTime: new Date(2026, 9, 25, 18, 0).toISOString(),
    lastOutcome: null,
    createdAt: new Date(2026, 9, 24, 9, 0).toISOString(),
    endedAt: null,
    cancelledAt: null,
    ...overrides,
  };
}

describe('scheduleRowOf: who it sends to', () => {
  it('names a ship by its name', () => {
    expect(scheduleRowOf(aSchedule(), NOW).recipient).toBe('To chief-of-staff');
  });

  it('names a label selection by its key and value texts (decision 0065)', () => {
    const [teamA, siteNorth] = [idSchema('labelValue').parse('lbv_01m5saxrvna1k3ywca6fjp6qca'), idSchema('labelValue').parse('lbv_01m5saxrvna1k3ywca6fjp6qcb')];
    const selector = {
      kind: 'label' as const,
      valueIds: [teamA, siteNorth],
      values: [
        { valueId: teamA, key: 'team', value: 'a' },
        { valueId: siteNorth, key: 'site', value: 'north' },
      ],
    };

    expect(scheduleRowOf(aSchedule({ selector }), NOW).recipient).toBe('To every ship carrying team=a and site=north');
  });

  it('names a label selection given without texts by its value ids', () => {
    const teamA = idSchema('labelValue').parse('lbv_01m5saxrvna1k3ywca6fjp6qca');

    expect(scheduleRowOf(aSchedule({ selector: { kind: 'label', valueIds: [teamA] } }), NOW).recipient).toBe(`To every ship carrying ${teamA}`);
  });

  it('names a ship given by id by its id', () => {
    expect(scheduleRowOf(aSchedule({ selector: { kind: 'ship', shipId: plannerId } }), NOW).recipient).toBe(`To ${plannerId}`);
  });

  it('names a type as any ship of it', () => {
    expect(scheduleRowOf(aSchedule({ selector: { kind: 'type', type: 'reviewer' } }), NOW).recipient).toBe('To any ship of type reviewer');
  });
});

describe('scheduleRowOf: when it sends', () => {
  it('reads a once schedule as its time', () => {
    expect(scheduleRowOf(aSchedule({ timing: { kind: 'once', at: new Date(2026, 9, 26, 9, 0).toISOString() } }), NOW).timing).toBe('Once, 26 Oct, 09:00');
  });

  it('reads an every schedule as its length', () => {
    expect(scheduleRowOf(aSchedule(), NOW).timing).toBe('Every 6 h');
  });

  it('keeps an every under a minute as written', () => {
    expect(scheduleRowOf(aSchedule({ timing: { kind: 'every', every: 'PT30S', start: null, end: null, count: null } }), NOW).timing).toBe('Every PT30S');
  });

  it('reads a cron schedule as its fields and its time zone', () => {
    expect(scheduleRowOf(aSchedule({ timing: { kind: 'cron', cron: '0 9 * * 1-5', timeZone: 'Europe/Brussels', start: null, end: null, count: null } }), NOW).timing).toBe(
      'Cron 0 9 * * 1-5, Europe/Brussels',
    );
  });

  it('adds the end and the number of sends a repeat stops at', () => {
    const timing = { kind: 'every', every: 'P1D', start: null, end: new Date(2026, 10, 1, 9, 0).toISOString(), count: 5 } as const;
    expect(scheduleRowOf(aSchedule({ timing }), NOW).timing).toBe('Every 1 d, until 1 Nov, 09:00, at most 5 sends');
  });

  it('reads one send as one', () => {
    const timing = { kind: 'every', every: 'P1D', start: null, end: null, count: 1 } as const;
    expect(scheduleRowOf(aSchedule({ timing }), NOW).timing).toBe('Every 1 d, at most 1 send');
  });

  it('says its next send time', () => {
    expect(scheduleRowOf(aSchedule(), NOW).nextSend).toBe('Next 25 Oct, 18:00');
  });

  it('has no next send time once it ended', () => {
    expect(scheduleRowOf(aSchedule({ state: 'ended', nextSendTime: null }), NOW).nextSend).toBeUndefined();
  });
});

describe('scheduleRowOf: its last outcome', () => {
  const times = { sendTime: new Date(2026, 9, 25, 6, 0).toISOString(), at: new Date(2026, 9, 25, 9, 0).toISOString() };

  it('has none before its first send time', () => {
    expect(scheduleRowOf(aSchedule(), NOW).lastOutcome).toBeUndefined();
  });

  it('says a sent one and opens its message', () => {
    expect(scheduleRowOf(aSchedule({ lastOutcome: { kind: 'sent', messageId, ...times } }), NOW).lastOutcome).toEqual({ text: 'Sent 3 h ago', messageId });
  });

  it('says a refused one with its code', () => {
    expect(scheduleRowOf(aSchedule({ lastOutcome: { kind: 'refused', code: 'NOT_REACHABLE', ...times } }), NOW).lastOutcome).toEqual({ text: 'Refused 3 h ago: NOT_REACHABLE' });
  });

  it('says a missed one with its send time', () => {
    expect(scheduleRowOf(aSchedule({ lastOutcome: { kind: 'missed', ...times } }), NOW).lastOutcome).toEqual({ text: 'Missed the send time 25 Oct, 06:00' });
  });
});

describe('scheduleRowOf: what the console offers', () => {
  it('offers Pause and Cancel on an active schedule', () => {
    expect(scheduleRowOf(aSchedule(), NOW)).toMatchObject({ canPause: true, canCancel: true });
  });

  it('offers only Cancel on a paused schedule: only its ship resumes it', () => {
    expect(scheduleRowOf(aSchedule({ state: 'paused' }), NOW)).toMatchObject({ canPause: false, canCancel: true });
  });

  it.each(['ended', 'cancelled'] as const)('offers nothing on a %s schedule', (state) => {
    expect(scheduleRowOf(aSchedule({ state, nextSendTime: null }), NOW)).toMatchObject({ canPause: false, canCancel: false });
  });
});
