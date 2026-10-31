import type { SealingOutput } from '@aeolus-fleet/common';

import { duration, relativeTime, sinceTime } from '../../../lib/relative-time';

/** A sealed fleet's sealing as `fleet.sealing` answers it. */
export type Sealing = Exclude<SealingOutput, { state: 'none' }>;

const DAY_MS = 24 * 60 * 60 * 1000;
/** How many characters of a long reference stay on each side of the ellipsis. */
const KEPT_AT_START = 6;
const KEPT_AT_END = 4;

/** "dky_01JD4R…7Q1F", "SHA256:q8f…k3d9": an id or fingerprint shortened in the middle, the whole one in its title and copy. */
export function shortened(
  value: string,
  kept: { start: number; end: number } = {
    start: KEPT_AT_START,
    end: KEPT_AT_END,
  },
): string {
  const prefixEnd = value.indexOf('_') + 1 || value.indexOf(':') + 1;
  const start = prefixEnd + kept.start;
  return value.length <= start + kept.end + 1 ? value : `${value.slice(0, start)}…${value.slice(-kept.end)}`;
}

/**
 * "arn:aws:kms:eu-central-1:4417…:key/7f3c…b1a3": an AWS KMS key ARN with its
 * account and key id shortened, so the region and the kind stay readable; any
 * other reference as given.
 */
export function shortCompanyKey(companyKey: string): string {
  const match = /^(arn:aws:kms:[^:]+:)(\d+)(:(?:key|alias)\/)(.+)$/.exec(companyKey);
  if (match === null) {
    return companyKey;
  }
  const [, region = '', account = '', kind = '', id = ''] = match;
  const shortId = id.length > KEPT_AT_START + KEPT_AT_END ? `${id.slice(0, KEPT_AT_END)}…${id.slice(-KEPT_AT_END)}` : id;
  return `${region}${account.slice(0, KEPT_AT_END)}…${kind}${shortId}`;
}

/** "turned on 6 min ago" while sealing; "since 29 Aug, 10:12" once sealed. */
export function stateSince(sealing: Pick<Sealing, 'state' | 'since'>, now: Date): string {
  const since = new Date(sealing.since);
  return sealing.state === 'sealing' ? `turned on ${relativeTime(since, now).toLowerCase()}` : `since ${sinceTime(since, now)}`;
}

/** "since 29 Aug, 10:12" while reachable; "access denied, since 14:05" while not. */
export function availabilitySince(keyAvailability: Sealing['keyAvailability'], now: Date): string {
  const since = `since ${sinceTime(new Date(keyAvailability.since), now)}`;
  return keyAvailability.isAvailable ? since : `${keyUnavailableReasonWords(keyAvailability.reason)}, ${since}`;
}

/** The key vault's reason as the page says it. */
export function keyUnavailableReasonWords(reason: Extract<Sealing['keyAvailability'], { isAvailable: false }>['reason']): string {
  switch (reason) {
    case 'accessDenied':
      return 'access denied';
    case 'disabled':
      return 'disabled';
    case 'notFound':
      return 'not found';
    case 'unreachable':
      return 'unreachable';
  }
}

/** "1 d", "31 d": a data key's age in whole days; under a day, as long as it is. */
export function dataKeyAge(createdAt: string, now: Date): string {
  const created = new Date(createdAt);
  const days = Math.floor((now.getTime() - created.getTime()) / DAY_MS);
  return days >= 1 ? `${String(days)} d` : duration(created, now);
}

/** "2,180 of 3,412 payloads sealed", with the share sealed for the bar. */
export function progressOf(progress: { sealed: number; total: number }): {
  words: string;
  percent: number;
} {
  const format = new Intl.NumberFormat('en-US');
  const percent = progress.total === 0 ? 100 : Math.floor((progress.sealed / progress.total) * 100);
  return {
    words: `${format.format(progress.sealed)} of ${format.format(progress.total)} payloads sealed`,
    percent,
  };
}

/** The data keys newest first, as the page lists them. */
export function newestFirst(dataKeys: Sealing['dataKeys']): Sealing['dataKeys'] {
  return dataKeys.toSorted((one, other) => other.createdAt.localeCompare(one.createdAt) || other.id.localeCompare(one.id));
}
