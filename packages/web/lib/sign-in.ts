import { trpcErrorCode } from './errors';

const REFUSALS: Record<string, string> = {
  UNAUTHORIZED: 'Wrong email or password.',
  BAD_REQUEST: 'Enter your email and password.',
  TOO_MANY_REQUESTS: 'Too many attempts. Wait a minute, then try again.',
};

/**
 * What to tell the operator when signing in fails. A wrong email and a wrong
 * password read the same, as the server answers them the same.
 */
export function signInRefusal(error: { message: string }): string {
  return REFUSALS[trpcErrorCode(error) ?? ''] ?? `Sign-in failed: ${error.message}`;
}
