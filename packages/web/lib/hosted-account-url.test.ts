import { describe, expect, it } from 'vitest';

import { hostedAccountUrlFrom } from './hosted-account-url';

describe('hostedAccountUrlFrom', () => {
  it("reads the hosting service's account page", () => {
    expect(hostedAccountUrlFrom({ AEOLUS_HOSTED_ACCOUNT_URL: 'https://pagasae.aeolus-fleet.dev/account' })).toBe('https://pagasae.aeolus-fleet.dev/account');
  });

  it.each([
    ['unset', {}],
    ['not a URL', { AEOLUS_HOSTED_ACCOUNT_URL: 'account' }],
    ['not http or https', { AEOLUS_HOSTED_ACCOUNT_URL: 'javascript:alert(1)' }],
  ])('is none when %s', (_case, environment) => {
    expect(hostedAccountUrlFrom(environment)).toBeUndefined();
  });
});
