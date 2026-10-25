import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';

/**
 * A cron expression of five fields (decision 0062, S1): minute, hour, day of
 * the month, month and day of the week, each `*`, a number, a range, a list
 * or a step, months and days of the week also by their English three-letter
 * names, Sunday 0 or 7. When both day fields are restricted, a day matching
 * either sends, as Vixie cron does. Its fields read as wall time in the
 * schedule's zone: a wall time summer time skips sends at the first valid
 * minute after it, and one it doubles sends once, at its first (S2).
 */
export interface Cron {
  minutes: readonly number[];
  hours: readonly number[];
  daysOfMonth: ReadonlySet<number>;
  months: ReadonlySet<number>;
  /** Sunday is 0. */
  daysOfWeek: ReadonlySet<number>;
  isDayOfMonthRestricted: boolean;
  isDayOfWeekRestricted: boolean;
}

export type CronRefusal = DomainError<'INVALID_TIMING'>;

interface FieldRange {
  label: string;
  min: number;
  max: number;
  names?: readonly string[];
}

const MINUTE: FieldRange = { label: 'minute', min: 0, max: 59 };
const HOUR: FieldRange = { label: 'hour', min: 0, max: 23 };
const DAY_OF_MONTH: FieldRange = { label: 'day of the month', min: 1, max: 31 };
const MONTH: FieldRange = { label: 'month', min: 1, max: 12, names: ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'] };
const DAY_OF_WEEK: FieldRange = { label: 'day of the week', min: 0, max: 7, names: ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] };

const FIELD_COUNT = 5;
const SUNDAY_AS_SEVEN = 7;
/** Temporal numbers Monday 1 to Sunday 7; cron Sunday 0. */
const TEMPORAL_SUNDAY = 7;
/** How far ahead a cron's next send time is looked for: two leap days, so 29 February always matches. */
const SEARCH_DAYS = 8 * 366;

const ITEM = /^(?:(\*)|([a-z0-9]+)(?:-([a-z0-9]+))?)(?:\/(\d+))?$/;

export function parseCron(text: string): Result<Cron, CronRefusal> {
  const fields = text.trim().toLowerCase().split(/\s+/);
  const [minute, hour, dayOfMonth, month, dayOfWeek] = fields;
  if (fields.length !== FIELD_COUNT || minute === undefined || hour === undefined || dayOfMonth === undefined || month === undefined || dayOfWeek === undefined) {
    return refuse('INVALID_TIMING', `A cron has five fields, minute hour day-of-month month day-of-week, such as 0 9 * * MON-FRI: "${text}" is not one`);
  }
  const minutes = fieldValues(minute, MINUTE);
  const hours = fieldValues(hour, HOUR);
  const daysOfMonth = fieldValues(dayOfMonth, DAY_OF_MONTH);
  const months = fieldValues(month, MONTH);
  const daysOfWeek = fieldValues(dayOfWeek, DAY_OF_WEEK);
  if (!minutes.isOk) return minutes;
  if (!hours.isOk) return hours;
  if (!daysOfMonth.isOk) return daysOfMonth;
  if (!months.isOk) return months;
  if (!daysOfWeek.isOk) return daysOfWeek;
  return ok({
    minutes: minutes.value,
    hours: hours.value,
    daysOfMonth: new Set(daysOfMonth.value),
    months: new Set(months.value),
    daysOfWeek: new Set(daysOfWeek.value.map((day) => (day === SUNDAY_AS_SEVEN ? 0 : day))),
    isDayOfMonthRestricted: !dayOfMonth.startsWith('*'),
    isDayOfWeekRestricted: !dayOfWeek.startsWith('*'),
  });
}

/**
 * The cron's first send time strictly after an instant, its fields read in
 * the zone; none when no day matches within eight years (30 February).
 */
export function cronSendTimeAfter(zoned: { cron: Cron; timeZone: string }, after: Date): Date | undefined {
  const { cron, timeZone } = zoned;
  const afterMs = after.getTime();
  let day = Temporal.Instant.fromEpochMilliseconds(afterMs).toZonedDateTimeISO(timeZone).toPlainDate();
  for (let searched = 0; searched < SEARCH_DAYS; searched += 1, day = day.add({ days: 1 })) {
    if (!isDayMatching(cron, day)) {
      continue;
    }
    for (const hour of cron.hours) {
      for (const minute of cron.minutes) {
        const sendTime = sendInstantOf(day.toPlainDateTime({ hour, minute }), timeZone);
        if (sendTime > afterMs) {
          return new Date(sendTime);
        }
      }
    }
  }
  return undefined;
}

/** How far ahead a cron's send times are walked to find its shortest interval: a year (decision 0062, S12). */
const INTERVAL_WALK_DAYS = 366;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Two consecutive send times of the cron less than the minimum apart, the
 * first such pair after an instant within the next year; none when every
 * pair is at least the minimum apart. Its fields read in UTC, whatever the
 * schedule's zone: summer time does not shorten a gap.
 */
export function cronSendTimesCloserThan(cron: Cron, walk: { after: Date; minimumMs: number }): { first: Date; second: Date } | undefined {
  const afterMs = walk.after.getTime();
  const untilMs = afterMs + INTERVAL_WALK_DAYS * DAY_MS;
  let previousMs: number | undefined;
  let day = Temporal.Instant.fromEpochMilliseconds(afterMs).toZonedDateTimeISO('UTC').toPlainDate();
  for (let walked = 0; walked <= INTERVAL_WALK_DAYS; walked += 1, day = day.add({ days: 1 })) {
    if (!isDayMatching(cron, day)) {
      continue;
    }
    for (const hour of cron.hours) {
      for (const minute of cron.minutes) {
        const sendMs = Date.UTC(day.year, day.month - 1, day.day, hour, minute);
        if (sendMs <= afterMs) {
          continue;
        }
        if (sendMs > untilMs) {
          return undefined;
        }
        if (previousMs !== undefined && sendMs - previousMs < walk.minimumMs) {
          return { first: new Date(previousMs), second: new Date(sendMs) };
        }
        previousMs = sendMs;
      }
    }
  }
  return undefined;
}

/** Whether a zone is an IANA zone the server knows. */
export function isKnownTimeZone(timeZone: string): boolean {
  try {
    Temporal.Now.zonedDateTimeISO(timeZone);
    return true;
  } catch {
    return false;
  }
}

function isDayMatching(cron: Cron, day: Temporal.PlainDate): boolean {
  if (!cron.months.has(day.month)) {
    return false;
  }
  const isDayOfMonth = cron.daysOfMonth.has(day.day);
  const isDayOfWeek = cron.daysOfWeek.has(day.dayOfWeek === TEMPORAL_SUNDAY ? 0 : day.dayOfWeek);
  if (cron.isDayOfMonthRestricted && cron.isDayOfWeekRestricted) {
    return isDayOfMonth || isDayOfWeek;
  }
  return isDayOfMonth && isDayOfWeek;
}

/**
 * The instant a wall time sends at, in epoch milliseconds: its first when
 * summer time doubles it, and the end of the gap when summer time skips it.
 */
function sendInstantOf(wallTime: Temporal.PlainDateTime, timeZone: string): number {
  // compatible takes the earlier of a doubled wall time, and shifts a skipped one past the gap.
  const zoned = wallTime.toZonedDateTime(timeZone, { disambiguation: 'compatible' });
  if (zoned.toPlainDateTime().equals(wallTime)) {
    return zoned.epochMilliseconds;
  }
  return (zoned.getTimeZoneTransition('previous') ?? zoned).epochMilliseconds;
}

/** A field's values, ascending without repeats. */
function fieldValues(field: string, range: FieldRange): Result<number[], CronRefusal> {
  const values = new Set<number>();
  for (const item of field.split(',')) {
    const match = ITEM.exec(item);
    const [, star, first, last, stepText] = match ?? [];
    const step = stepText === undefined ? 1 : Number(stepText);
    const start = star === undefined ? valueOf(first, range) : range.min;
    const end = star === undefined ? (last === undefined ? (stepText === undefined ? start : range.max) : valueOf(last, range)) : range.max;
    if (!match || start === undefined || end === undefined || start > end || step < 1) {
      return refuse('INVALID_TIMING', `The cron's ${range.label} field "${field}" is not valid: values ${range.min} to ${range.max}`);
    }
    for (let value = start; value <= end; value += step) {
      values.add(value);
    }
  }
  return ok([...values].sort((a, b) => a - b));
}

function valueOf(text: string | undefined, range: FieldRange): number | undefined {
  if (text === undefined) {
    return undefined;
  }
  const named = range.names?.indexOf(text) ?? -1;
  const value = named >= 0 ? named + range.min : /^\d+$/.test(text) ? Number(text) : undefined;
  return value !== undefined && value >= range.min && value <= range.max ? value : undefined;
}
