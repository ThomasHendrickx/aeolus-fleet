/**
 * A sealed fleet (decision 0068): it stores no payload readable. Its sealing
 * names the company key that wraps its data keys; each data key is kept only
 * wrapped, with a check value that proves an unwrap gave the right key.
 */
import type { DataKeyId, FleetId } from '@aeolus-fleet/common';

import type { CompanyKeyReference, WrappedDataKey } from './key-vault.js';

/** Sealing while payloads stored plain before wait for the sealing pass; sealed once none is left. */
export type SealingState = 'sealing' | 'sealed';

export interface FleetSealing {
  fleetId: FleetId;
  state: SealingState;
  companyKey: CompanyKeyReference;
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
