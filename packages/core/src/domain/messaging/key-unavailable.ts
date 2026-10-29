import { refuse, type DomainError } from '../shared/errors.js';
import type { Err } from '../shared/result.js';
import type { KeyUnavailable, KeyUnavailableReason } from './key-vault.js';

/** The key vault's reason, as the refusal says it. */
const REASONS: Record<KeyUnavailableReason, string> = {
  accessDenied: 'access denied',
  disabled: 'disabled',
  notFound: 'not found',
  unreachable: 'unreachable',
  invalidWrap: 'a data key that does not open under it',
};

/** KEY_UNAVAILABLE with the key vault's reason (decision 0068): nothing was stored or claimed. */
export function keyUnavailable(unavailable: KeyUnavailable): Err<DomainError<'KEY_UNAVAILABLE'>> {
  return refuse('KEY_UNAVAILABLE', `The fleet's company key is not reachable: ${REASONS[unavailable.reason]}`);
}
