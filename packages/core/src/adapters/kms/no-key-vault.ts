import type { KeyUnavailable, KeyVault } from '../../domain/messaging/key-vault.js';
import { err, type Result } from '../../domain/shared/result.js';

function unreachable(): Promise<Result<never, KeyUnavailable>> {
  return Promise.resolve(err({ kind: 'keyUnavailable', reason: 'unreachable' }));
}

/**
 * The key vault of an installation with no KMS configured (decision 0068):
 * it answers no call, so no fleet can be sealed, and a fleet that is not
 * sealed never calls it.
 */
export const noKeyVault: KeyVault = { makeDataKey: unreachable, unwrap: unreachable, wrap: unreachable, rewrap: unreachable };
