import type { DataKeyId, FleetId } from '@aeolus-fleet/common';

import { checkFeatureFlag, type FeatureFlagReads } from '../registry/public.js';
import { hasScope, type Caller } from '../shared/caller.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { WrappedDataKey } from './key-vault.js';
import type { FleetSealingRepository } from './ports.js';

/** A data key as the recovery command opens it: wrapped to the recovery key alone, with the check value that proves it opened right. */
export interface RecoveryDataKey {
  readonly id: DataKeyId;
  readonly wrappedByRecoveryKey: WrappedDataKey;
  readonly checkValue: Uint8Array<ArrayBuffer>;
}

/** What the recovery command reads: the fleet whose context the new wraps name, the recovery key by fingerprint, and every data key, oldest first. */
export interface RecoverySet {
  readonly fleetId: FleetId;
  readonly recoveryKeyFingerprint: string;
  readonly dataKeys: readonly RecoveryDataKey[];
}

export type ReadRecoverySetRefusal = DomainError<'FORBIDDEN' | 'FEATURE_FLAG_OFF' | 'FLEET_NOT_SEALED' | 'NO_RECOVERY_KEY'>;

export type ReadRecoverySet = (caller: Caller) => Promise<Result<RecoverySet, ReadRecoverySetRefusal>>;

/**
 * Use case: the recovery set of a sealed fleet (decision 0068, B15), for an
 * actor holding `fleet:keys`: each data key wrapped to the recovery key, with
 * its check value. Only the company's offline private half opens it; no wrap
 * by the company key is in it, so nothing in it opens with any key Aeolus can
 * use. A fleet sealed without a recovery key is refused NO_RECOVERY_KEY:
 * recovery is the KMS's own then. A fleet holds a data key per 30 days, so
 * the set is read whole.
 */
export function createReadRecoverySet(deps: { sealings: FleetSealingRepository; featureFlags: FeatureFlagReads }): ReadRecoverySet {
  return async (caller) => {
    if (!hasScope(caller, 'fleet:keys')) {
      return refuse('FORBIDDEN', 'Reading the recovery set needs the fleet:keys scope');
    }
    const { fleetId } = caller;
    const offered = await checkFeatureFlag(deps.featureFlags, { fleetId, flag: 'sealing' });
    if (!offered.isOk) {
      return offered;
    }
    const ages = await deps.sealings.dataKeyAges(fleetId);
    const wrapped = await deps.sealings.wrappedDataKeys(fleetId, ages.map(({ id }) => id));
    if (wrapped === undefined) {
      return refuse('FLEET_NOT_SEALED', `Fleet ${fleetId} is not sealed`);
    }
    const { recoveryKey } = wrapped;
    if (recoveryKey === null) {
      return refuse('NO_RECOVERY_KEY', `Fleet ${fleetId} was sealed without a recovery key: recovery is the company's KMS's own`);
    }
    const dataKeys: RecoveryDataKey[] = [];
    for (const { id, wrappedByRecoveryKey, checkValue } of wrapped.dataKeys) {
      if (wrappedByRecoveryKey === null) {
        return refuse('NO_RECOVERY_KEY', `Data key ${id} of fleet ${fleetId} is not wrapped to the recovery key`);
      }
      dataKeys.push({ id, wrappedByRecoveryKey, checkValue });
    }
    return ok({ fleetId, recoveryKeyFingerprint: recoveryKey.fingerprint, dataKeys });
  };
}
