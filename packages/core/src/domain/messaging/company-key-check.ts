import type { IdGenerator } from '@aeolus-fleet/common';

import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import { keyUnavailable } from './key-unavailable.js';
import type { CompanyKeyUse, DataKeyMaterial, KeyVault, MadeDataKey } from './key-vault.js';

export type CompanyKeyRefusal = DomainError<'KEY_UNAVAILABLE' | 'KEY_NOT_BOUND_TO_FLEET'>;

/**
 * Checks a company key for a fleet (decision 0068, B4), before a fleet is
 * sealed under it or moves to it (B13c): the key vault makes a data key
 * under it for this fleet's context and unwraps it again, and refuses one for
 * another fleet's context, so a key whose policy has no fleet condition,
 * which one tenant could point at another's key with, is refused
 * KEY_NOT_BOUND_TO_FLEET. A refusal or no answer is KEY_UNAVAILABLE with its
 * reason. Answers the data key it made, wrapped and unwrapped.
 */
export async function checkCompanyKey(deps: { vault: KeyVault; ids: IdGenerator }, use: CompanyKeyUse): Promise<Result<MadeDataKey & { unwrapped: DataKeyMaterial }, CompanyKeyRefusal>> {
  const made = await deps.vault.makeDataKey(use);
  if (!made.isOk) {
    return keyUnavailable(made.error);
  }
  const unwrapped = await deps.vault.unwrap(use, made.value.wrapped);
  if (!unwrapped.isOk) {
    return keyUnavailable(unwrapped.error);
  }
  const otherFleet = await deps.vault.makeDataKey({ fleetId: deps.ids('fleet'), companyKey: use.companyKey });
  if (otherFleet.isOk) {
    return refuse('KEY_NOT_BOUND_TO_FLEET', `The key policy of ${use.companyKey} grants it for any fleet: grant it with a condition naming fleet ${use.fleetId}`);
  }
  if (otherFleet.error.reason !== 'accessDenied') {
    return keyUnavailable(otherFleet.error);
  }
  return ok({ ...made.value, unwrapped: unwrapped.value });
}
