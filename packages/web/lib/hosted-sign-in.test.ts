import { describe, expect, it } from 'vitest';

import { hostedSignInUrlFrom } from './hosted-sign-in';

describe('hostedSignInUrlFrom', () => {
  it('reads the hosting service sign-in page', () => {
    expect(hostedSignInUrlFrom({ AEOLUS_HOSTED_SIGN_IN_URL: 'https://pagasae.aeolus-fleet.dev/sign-in' })).toBe('https://pagasae.aeolus-fleet.dev/sign-in');
  });

  it.each([
    ['unset', {}],
    ['empty', { AEOLUS_HOSTED_SIGN_IN_URL: '' }],
    ['not a URL', { AEOLUS_HOSTED_SIGN_IN_URL: 'pagasae' }],
    ['not http or https', { AEOLUS_HOSTED_SIGN_IN_URL: 'javascript:alert(1)' }],
  ])('is none when %s: the console signs in with a password', (_case, environment) => {
    expect(hostedSignInUrlFrom(environment)).toBeUndefined();
  });
});
