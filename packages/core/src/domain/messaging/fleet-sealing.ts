/**
 * A sealed fleet (decision 0068): it stores no payload readable. Its sealing
 * names the company key that wraps its data keys; each data key is kept only
 * wrapped, with a check value that proves an unwrap gave the right key.
 */
import type { DataKeyId, FleetId } from '@aeolus-fleet/common';

import type { CompanyKeyReference, KeyUnavailableReason, WrappedDataKey } from './key-vault.js';
import type { RecoveryKey } from './recovery-key.js';

/** Sealing while payloads stored plain before wait for the sealing pass; sealed once none is left. */
export type SealingState = 'sealing' | 'sealed';

/** Why the company key vault refused the company key: a wrap that does not open is no change of its availability. */
export type CompanyKeyUnavailableReason = Exclude<KeyUnavailableReason, 'invalidWrap'>;

/**
 * Whether the company key answered this fleet's last unwrap, and since when
 * (B11): available from turning on, unavailable with the key vault's reason
 * from the first refusal after a success, available again from the first
 * success after.
 */
export type KeyAvailability = { isAvailable: true; since: Date } | { isAvailable: false; reason: CompanyKeyUnavailableReason; since: Date };

export interface FleetSealing {
  fleetId: FleetId;
  state: SealingState;
  companyKey: CompanyKeyReference;
  /** The offline key each data key is wrapped to as well, by its public half; none when the company set none. */
  recoveryKey: RecoveryKey | null;
  keyAvailability: KeyAvailability;
}

/** A data key as the fleet keeps it (B6): never unwrapped in storage. */
export interface StoredDataKey {
  id: DataKeyId;
  fleetId: FleetId;
  wrappedByCompanyKey: WrappedDataKey;
  /** The same key wrapped to the fleet's recovery key; none while the fleet has none. */
  wrappedByRecoveryKey: WrappedDataKey | null;
  checkValue: Uint8Array<ArrayBuffer>;
  createdAt: Date;
  /** One current per fleet: the key that seals; old ones only unseal. */
  isCurrent: boolean;
}

/** A data key as the fleet's sealing read shows it: its id, when it was made and whether it seals now. */
export type DataKeyAge = Pick<StoredDataKey, 'id' | 'createdAt' | 'isCurrent'>;

/** How old the current data key grows before the 30 second pass makes a new one current (B13a). */
export const DATA_KEY_ROTATION_MS = 30 * 24 * 60 * 60 * 1000;

/** The time a current data key made at or before is due a new one (B13a). */
export function dataKeyRotationCutoff(now: Date): Date {
  return new Date(now.getTime() - DATA_KEY_ROTATION_MS);
}

/** Whether the fleet's current data key is 30 days old or older, so a new one is due (B13a); a fleet with none is not. */
export function isDueANewDataKey(dataKeys: readonly DataKeyAge[], now: Date): boolean {
  const current = dataKeys.find((dataKey) => dataKey.isCurrent);
  return current !== undefined && current.createdAt.getTime() <= dataKeyRotationCutoff(now).getTime();
}
