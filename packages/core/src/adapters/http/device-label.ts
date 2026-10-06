/**
 * The device a console sign-in comes from, in a few words for the operator
 * ("Mac · Chrome"), from the browser's User-Agent. A label only: never
 * trusted for anything, so a rough reading is enough. The first match wins:
 * an iPhone also says "like Mac OS X", Android also says "Linux", Edge also
 * says "Chrome", and Chrome also says "Safari".
 */

const SYSTEMS: readonly [RegExp, string][] = [
  [/iPhone/, 'iPhone'],
  [/iPad/, 'iPad'],
  [/Android/, 'Android'],
  [/CrOS/, 'ChromeOS'],
  [/Macintosh/, 'Mac'],
  [/Windows/, 'Windows'],
  [/Linux/, 'Linux'],
];

const BROWSERS: readonly [RegExp, string][] = [
  [/Edg\//, 'Edge'],
  [/OPR\//, 'Opera'],
  [/Firefox\//, 'Firefox'],
  [/Chrome\//, 'Chrome'],
  [/Version\/[\d.]+.*Safari\//, 'Safari'],
];

export const UNKNOWN_DEVICE_LABEL = 'Unknown device';

function firstMatch(userAgent: string, table: readonly [RegExp, string][]): string | undefined {
  return table.find(([pattern]) => pattern.test(userAgent))?.[1];
}

export function deviceLabelOf(userAgent: string | undefined): string {
  if (userAgent === undefined) {
    return UNKNOWN_DEVICE_LABEL;
  }
  const system = firstMatch(userAgent, SYSTEMS);
  if (system === undefined) {
    return UNKNOWN_DEVICE_LABEL;
  }
  const browser = firstMatch(userAgent, BROWSERS);
  return browser === undefined ? system : `${system} · ${browser}`;
}
