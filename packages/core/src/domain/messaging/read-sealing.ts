import type { Caller } from '../shared/caller.js';
import { shownProgress, type DataKeyAge, type FleetSealing } from './fleet-sealing.js';
import type { FleetSealingRepository } from './ports.js';

/**
 * A fleet's sealing as read: none, or its state and since when, the sealing
 * pass's progress while sealing, company key, recovery key fingerprint, the
 * key's availability and its data keys' ages.
 */
export type SealingRead =
  | { state: 'none' }
  | (Omit<FleetSealing, 'fleetId' | 'recoveryKey' | 'progress'> & { progress: { sealed: number; total: number } | null; recoveryKeyFingerprint: string | null; dataKeys: DataKeyAge[] });

export type ReadSealing = (caller: Caller) => Promise<SealingRead>;

/**
 * Use case: the caller's fleet's sealing (decision 0068, B5, B11): whether it
 * is sealed and since when, how many of the payloads stored plain before
 * the sealing pass sealed while it seals, the company key by its reference, the recovery key by its
 * fingerprint, whether that key answered its
 * last unwrap and since when, and when each data key was made. Never a key,
 * wrapped or not. The caller's scope (fleet:read) is checked before this runs.
 */
export function createReadSealing(deps: { sealings: Pick<FleetSealingRepository, 'find' | 'dataKeyAges'> }): ReadSealing {
  return async (caller) => {
    const sealing = await deps.sealings.find(caller.fleetId);
    if (sealing === undefined) {
      return { state: 'none' };
    }
    const { state, since, progress, companyKey, recoveryKey, keyAvailability } = sealing;
    return {
      state,
      since,
      progress: state === 'sealing' ? shownProgress(progress) : null,
      companyKey,
      recoveryKeyFingerprint: recoveryKey?.fingerprint ?? null,
      keyAvailability,
      dataKeys: await deps.sealings.dataKeyAges(caller.fleetId),
    };
  };
}
