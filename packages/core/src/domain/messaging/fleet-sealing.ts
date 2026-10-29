/**
 * A sealed fleet (decision 0068): it stores no payload readable. Its sealing
 * names the company key that wraps its data keys; each data key is kept only
 * wrapped, with a check value that proves an unwrap gave the right key.
 */
import type { DataKeyId, FleetId } from '@aeolus-fleet/common';

import type { CompanyKeyReference, KeyUnavailableReason, WrappedDataKey } from './key-vault.js';

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
  keyAvailability: KeyAvailability;
}

/** A data key as the fleet keeps it (B6): never unwrapped in storage. */
export interface StoredDataKey {
  id: DataKeyId;
  fleetId: FleetId;
  wrappedByCompanyKey: WrappedDataKey;
  checkValue: Uint8Array<ArrayBuffer>;
  createdAt: Date;
  /** One current per fleet: the key that seals; old ones only unseal. */
  isCurrent: boolean;
}
