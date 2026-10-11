import { describe, expect, it } from 'vitest';

import { signInRefusal } from './sign-in';

/** A failed call as the tRPC client reports it. */
function failure(code: string, message = 'refused'): Error & { data: { code: string } } {
  return Object.assign(new Error(message), { data: { code } });
}

describe('signInRefusal', () => {
  it('says the same for a wrong email and a wrong password', () => {
    expect(signInRefusal(failure('UNAUTHORIZED'))).toBe('Wrong email or password.');
  });

  it('asks for both fields when one is missing', () => {
    expect(signInRefusal(failure('BAD_REQUEST'))).toBe('Enter your email and password.');
  });

  it('asks to wait when over the rate limit', () => {
    expect(signInRefusal(failure('TOO_MANY_REQUESTS'))).toBe('Too many attempts. Wait a minute, then try again.');
  });

  it("passes on any other failure's message", () => {
    expect(signInRefusal(failure('INTERNAL_SERVER_ERROR', 'database unreachable'))).toBe(
      'Sign-in failed: database unreachable',
    );
  });
});
