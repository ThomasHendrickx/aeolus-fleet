import { describe, expect, it } from 'vitest';

import { isSignedInElsewhere, retryAtOf, trpcErrorCode } from './errors';

describe('trpcErrorCode', () => {
  it('reads the code of a tRPC error', () => {
    expect(trpcErrorCode({ data: { code: 'UNAUTHORIZED' } })).toBe('UNAUTHORIZED');
  });

  it.each([null, 'failed', {}, { data: null }, { data: { code: 401 } }])('has none for %j', (error) => {
    expect(trpcErrorCode(error)).toBeUndefined();
  });
});

describe('isSignedInElsewhere', () => {
  it('knows a session a sign-in elsewhere ended', () => {
    expect(isSignedInElsewhere({ data: { code: 'UNAUTHORIZED', refusal: 'SIGNED_IN_ELSEWHERE' } })).toBe(true);
  });

  it('takes any other refusal as not signed in elsewhere', () => {
    expect(isSignedInElsewhere({ data: { code: 'UNAUTHORIZED' } })).toBe(false);
  });
});

describe('retryAtOf', () => {
  it('reads when a rate-limited sign-in may try again', () => {
    expect(retryAtOf({ data: { code: 'TOO_MANY_REQUESTS', retryAt: '2026-10-01T14:33:00.000Z' } })).toEqual(
      new Date('2026-10-01T14:33:00.000Z'),
    );
  });

  it.each([{ data: { code: 'TOO_MANY_REQUESTS' } }, { data: { retryAt: 'soon' } }])('has none for %j', (error) => {
    expect(retryAtOf(error)).toBeUndefined();
  });
});
