import type { DataKeyId, IdGenerator } from '@aeolus-fleet/common';

import { checkFeatureFlag, type FeatureFlagReads } from '../registry/public.js';
import { actorOf, hasScope, type Caller } from '../shared/caller.js';
import type { Clock } from '../shared/clock.js';
import { refuse, type DomainError } from '../shared/errors.js';
import { recordEvent, type EventLog } from '../shared/events.js';
import { err, ok, type Result } from '../shared/result.js';
import type { UnitOfWork } from '../shared/unit-of-work.js';
import { checkCompanyKey } from './company-key-check.js';
import { keyUnavailable } from './key-unavailable.js';
import type { CompanyKeyReference, KeyVault, WrappedDataKey } from './key-vault.js';
import type { PayloadSealer } from './payload-sealer.js';
import type { FleetSealingRepository } from './ports.js';

export interface ChangeCompanyKeyTx {
  sealings: FleetSealingRepository;
  events: EventLog;
}

export interface CompanyKeyChanged {
  companyKey: CompanyKeyReference;
}

export type ChangeCompanyKeyRefusal = DomainError<'FORBIDDEN' | 'FEATURE_FLAG_OFF' | 'FLEET_NOT_SEALED' | 'KEY_UNAVAILABLE' | 'KEY_NOT_BOUND_TO_FLEET'>;

export type ChangeCompanyKey = (caller: Caller, input: { companyKey: CompanyKeyReference }) => Promise<Result<CompanyKeyChanged, ChangeCompanyKeyRefusal>>;

/** How often the rewrap runs again for data keys rotated while it ran, before the change is refused. */
const MAX_RUNS = 3;

/** A data key's wrap by the new company key. */
interface Rewrapped {
  id: DataKeyId;
  wrappedByCompanyKey: WrappedDataKey;
}

/** The fleet's data keys or company key changed between the rewrap and the swap: rewrap again. */
interface KeysChanged {
  kind: 'keysChanged';
}

/**
 * Use case: changing a sealed fleet's company key (decision 0068, B13c), by
 * an actor holding `fleet:keys`. The new key is checked as at turning sealing
 * on (B4); then every data key is rewrapped from the old company key to the
 * new one inside the key vault, outside every unit of work, so no data key
 * leaves it. An old key that is not reachable refuses KEY_UNAVAILABLE:
 * recovery is the way then (B15). Then one unit of work holds the fleet's
 * sealing lock, so no rotation adds a key meanwhile, finds the same company
 * key and data keys it rewrapped, and swaps every wrap and the reference,
 * FleetCompanyKeyChanged naming both; a key rotated in between rewraps them
 * again. Rolled back, every wrap and the reference stay as they were. No
 * payload is sealed again.
 */
export function createChangeCompanyKey(deps: {
  uow: UnitOfWork<ChangeCompanyKeyTx>;
  clock: Clock;
  ids: IdGenerator;
  vault: KeyVault;
  sealer: PayloadSealer;
  /** The fleets' sealing and data keys, read outside the unit of work. */
  sealings: FleetSealingRepository;
  /** The fleets' feature flags: sealing's procedures refuse a fleet whose sealing flag is off (decision 0069). */
  featureFlags: FeatureFlagReads;
}): ChangeCompanyKey {
  return async (caller, { companyKey: to }) => {
    if (!hasScope(caller, 'fleet:keys')) {
      return refuse('FORBIDDEN', 'Changing the company key needs the fleet:keys scope');
    }
    const { fleetId } = caller;
    const offered = await checkFeatureFlag(deps.featureFlags, { fleetId, flag: 'sealing' });
    if (!offered.isOk) {
      return offered;
    }
    if ((await deps.sealings.find(fleetId)) === undefined) {
      return refuse('FLEET_NOT_SEALED', `Fleet ${fleetId} is not sealed: turn sealing on with the company key instead`);
    }
    const checked = await checkCompanyKey(deps, { fleetId, companyKey: to });
    if (!checked.isOk) {
      return checked;
    }

    for (let run = 1; run <= MAX_RUNS; run += 1) {
      const ages = await deps.sealings.dataKeyAges(fleetId);
      const wrapped = await deps.sealings.wrappedDataKeys(fleetId, ages.map(({ id }) => id));
      if (wrapped === undefined) {
        return refuse('FLEET_NOT_SEALED', `Fleet ${fleetId} is not sealed`);
      }
      const from = wrapped.companyKey;
      const rewrapped: Rewrapped[] = [];
      for (const dataKey of wrapped.dataKeys) {
        const moved = await deps.vault.rewrap({ fleetId, from, to }, dataKey.wrappedByCompanyKey);
        if (!moved.isOk) {
          const { message } = keyUnavailable(moved.error).error;
          return refuse('KEY_UNAVAILABLE', `${message}. The old company key must be reachable to change it; without it, recovery with the recovery key is the way`);
        }
        rewrapped.push({ id: dataKey.id, wrappedByCompanyKey: moved.value });
      }

      const swapped = await deps.uow.run(async (tx): Promise<Result<CompanyKeyChanged, KeysChanged>> => {
        await tx.sealings.lockSealing(fleetId);
        const sealing = await tx.sealings.find(fleetId);
        const ids = new Set((await tx.sealings.dataKeyAges(fleetId)).map(({ id }) => id));
        if (sealing?.companyKey !== from || ids.size !== rewrapped.length || rewrapped.some(({ id }) => !ids.has(id))) {
          return err({ kind: 'keysChanged' });
        }
        await tx.sealings.changeCompanyKey(fleetId, { companyKey: to, dataKeys: rewrapped });
        await recordEvent({ events: tx.events, ids: deps.ids }, { fleetId, type: 'FleetCompanyKeyChanged', occurredAt: deps.clock.now(), actor: actorOf(caller), details: { from, to } });
        return ok({ companyKey: to });
      });
      if (swapped.isOk) {
        return swapped;
      }
    }
    return refuse('KEY_UNAVAILABLE', "The fleet's data keys changed while this call ran: call again");
  };
}
