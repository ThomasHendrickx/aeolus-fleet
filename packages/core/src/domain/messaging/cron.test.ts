import { describe, expect, it } from 'vitest';

import { unwrap } from '../../testing/result.js';
import { cronSendTimeAfter, parseCron } from './cron.js';

/** The send time a cron gives after an instant, in a zone, as ISO 8601 in UTC. */
function after(cron: string, instant: string, timeZone = 'UTC'): string | undefined {
  return cronSendTimeAfter(unwrap(parseCron(cron)), timeZone, new Date(instant))?.toISOString();
}

describe('a cron expression', () => {
  it.each([
    { cron: '0 9 * * *', instant: '2026-10-25T08:00:00Z', next: '2026-10-25T09:00:00.000Z' },
    { cron: '0 9 * * *', instant: '2026-10-25T09:00:00Z', next: '2026-10-26T09:00:00.000Z' },
    { cron: '*/15 * * * *', instant: '2026-10-25T08:07:30Z', next: '2026-10-25T08:15:00.000Z' },
    { cron: '0 */6 * * *', instant: '2026-10-25T07:00:00Z', next: '2026-10-25T12:00:00.000Z' },
    { cron: '30 8-10/2 * * *', instant: '2026-10-25T08:31:00Z', next: '2026-10-25T10:30:00.000Z' },
    { cron: '0 0 1,15 * *', instant: '2026-10-02T00:00:00Z', next: '2026-10-15T00:00:00.000Z' },
    { cron: '0 0 1 jan *', instant: '2026-10-25T00:00:00Z', next: '2027-01-01T00:00:00.000Z' },
    { cron: '0 9 * * MON-FRI', instant: '2026-10-24T10:00:00Z', next: '2026-10-26T09:00:00.000Z' },
    { cron: '0 9 * * 7', instant: '2026-10-24T10:00:00Z', next: '2026-10-25T09:00:00.000Z' },
    { cron: '0 0 29 2 *', instant: '2026-10-25T00:00:00Z', next: '2028-02-29T00:00:00.000Z' },
  ])('$cron after $instant sends at $next', ({ cron, instant, next }) => {
    expect(after(cron, instant)).toBe(next);
  });

  it('matches either day when both the day of the month and the day of the week are restricted', () => {
    // 2026-10-26 is a Monday, before the 1st.
    expect(after('0 0 1 * 1', '2026-10-25T12:00:00Z')).toBe('2026-10-26T00:00:00.000Z');
  });

  it('reads its fields as wall time in its zone', () => {
    expect(after('0 9 * * *', '2026-10-25T00:00:00Z', 'Asia/Tokyo')).toBe('2026-10-26T00:00:00.000Z');
  });

  it('sends a wall time skipped by summer time at the first valid minute after it', () => {
    // Brussels skips 02:00 to 03:00 on 2027-03-28: 02:30 sends at 03:00 local, 01:00Z.
    expect(after('30 2 * * *', '2027-03-27T12:00:00Z', 'Europe/Brussels')).toBe('2027-03-28T01:00:00.000Z');
  });

  it('sends the skipped wall times of one gap once, at its end', () => {
    expect(after('*/15 2 * * *', '2027-03-28T01:00:00Z', 'Europe/Brussels')).toBe('2027-03-29T00:00:00.000Z');
  });

  it('sends a doubled wall time once, at its first', () => {
    // Brussels goes back from 03:00 to 02:00 on 2026-10-25: 02:30 is 00:30Z, then 01:30Z.
    expect(after('30 2 * * *', '2026-10-24T12:00:00Z', 'Europe/Brussels')).toBe('2026-10-25T00:30:00.000Z');
    expect(after('30 2 * * *', '2026-10-25T00:30:00Z', 'Europe/Brussels')).toBe('2026-10-26T01:30:00.000Z');
  });

  it('sends nothing in the second pass of a doubled hour', () => {
    expect(after('*/30 2 * * *', '2026-10-25T00:30:00Z', 'Europe/Brussels')).toBe('2026-10-26T01:00:00.000Z');
  });

  it('has no send time when no day ever matches', () => {
    expect(after('0 0 30 2 *', '2026-10-25T00:00:00Z')).toBeUndefined();
  });

  it.each([
    { label: 'four fields', cron: '0 9 * *' },
    { label: 'six fields', cron: '0 0 9 * * *' },
    { label: 'a minute over 59', cron: '60 9 * * *' },
    { label: 'an hour over 23', cron: '0 24 * * *' },
    { label: 'a day of the month of 0', cron: '0 9 0 * *' },
    { label: 'a month of 13', cron: '0 9 * 13 *' },
    { label: 'a day of the week of 8', cron: '0 9 * * 8' },
    { label: 'a step of 0', cron: '*/0 9 * * *' },
    { label: 'a range backwards', cron: '0 10-8 * * *' },
    { label: 'a name in the wrong field', cron: '0 9 * MON *' },
    { label: 'a macro', cron: '@daily' },
    { label: 'nothing', cron: '' },
  ])('refuses $label', ({ cron }) => {
    expect(parseCron(cron)).toMatchObject({ isOk: false, error: { kind: 'INVALID_TIMING' } });
  });
});
