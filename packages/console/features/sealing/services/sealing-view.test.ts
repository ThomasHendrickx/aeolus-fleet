import { describe, expect, it } from 'vitest';

import { dataKeyAge, newestFirst, progressOf, shortCompanyKey, shortened, stateSince } from './sealing-view';

const NOW = new Date(2026, 9, 29, 10, 12);

describe('the sealing page as the mockup words it', () => {
  it('shortens a KMS key ARN to its region, account and key id ends', () => {
    expect(shortCompanyKey('arn:aws:kms:eu-central-1:441703952218:key/7f3c2a91-5d0e-4b8a-9c61-2e8f04d7b1a3')).toBe('arn:aws:kms:eu-central-1:4417…:key/7f3c…b1a3');
  });

  it('leaves another key reference as given', () => {
    expect(shortCompanyKey('alias/acme')).toBe('alias/acme');
  });

  it('shortens a data key id in the middle', () => {
    expect(shortened('dky_01jd4r8xyzab7q1f')).toBe('dky_01jd4r…7q1f');
  });

  it('says a sealing fleet turned on how long ago, and a sealed one since when', () => {
    expect(stateSince({ state: 'sealing', since: new Date(2026, 9, 29, 10, 6).toISOString() }, NOW)).toBe('turned on 6 min ago');
    expect(stateSince({ state: 'sealed', since: new Date(2026, 7, 29, 10, 12).toISOString() }, NOW)).toBe('since 29 Aug, 10:12');
  });

  it("gives a data key's age in whole days", () => {
    expect(dataKeyAge(new Date(2026, 8, 28, 10, 12).toISOString(), NOW)).toBe('31 d');
  });

  it('counts the payloads sealed of how many, with the share for the bar', () => {
    expect(progressOf({ sealed: 2180, total: 3412 })).toEqual({
      words: '2,180 of 3,412 payloads sealed',
      percent: 63,
    });
  });

  it('lists the data keys newest first', () => {
    const older = {
      id: 'dky_a',
      createdAt: '2026-08-29T10:12:00.000Z',
      isCurrent: false,
    } as const;
    const current = {
      id: 'dky_b',
      createdAt: '2026-10-28T10:12:00.000Z',
      isCurrent: true,
    } as const;
    expect(newestFirst([older, current]).map(({ id }) => id)).toEqual(['dky_b', 'dky_a']);
  });
});
