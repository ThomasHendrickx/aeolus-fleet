/**
 * An ISO 8601 duration of a fixed length: weeks alone, or days, hours,
 * minutes and seconds (`PT30M`, `P1DT2H`, `P1W`). Years and months have no
 * fixed length, so they are no duration here.
 */
const DURATION = /^P(?:(\d+)W|(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+(?:\.\d+)?)S)?)?)$/;

const SECOND_MS = 1000;
const MINUTE_MS = 60 * SECOND_MS;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/** The duration's length in milliseconds; none for a text that is no duration, or one of no length. */
export function durationMs(text: string): number | undefined {
  const match = DURATION.exec(text);
  if (!match || text.endsWith('T')) {
    return undefined;
  }
  const [, weeks, days, hours, minutes, seconds] = match;
  const ms =
    Number(weeks ?? 0) * WEEK_MS + Number(days ?? 0) * DAY_MS + Number(hours ?? 0) * HOUR_MS + Number(minutes ?? 0) * MINUTE_MS + Math.round(Number(seconds ?? 0) * SECOND_MS);
  return ms > 0 ? ms : undefined;
}
