/**
 * Outbound port: seals and unseals a sealed fleet's payloads with an
 * unwrapped data key (decision 0068). A sealed payload is bound to its fleet
 * and to the row it belongs to, so moved to another row or fleet it does not
 * open.
 */
import type { DataKeyId, FleetId, MessageId, ScheduleId } from '@aeolus-fleet/common';

import type { Result } from '../shared/result.js';
import type { DataKeyMaterial } from './key-vault.js';

/** An unwrapped data key with its id: what seals and unseals. */
export interface DataKey {
  readonly id: DataKeyId;
  readonly material: DataKeyMaterial;
}

/** The row a payload belongs to, in its fleet. */
export interface SealedRow {
  readonly fleetId: FleetId;
  readonly rowId: MessageId | ScheduleId;
}

/** A payload as stored in a sealed fleet: the data key that sealed it, the nonce and the ciphertext with its tag. */
export interface SealedPayload {
  readonly dataKeyId: DataKeyId;
  readonly nonce: Uint8Array<ArrayBuffer>;
  readonly ciphertext: Uint8Array<ArrayBuffer>;
}

/** The sealed payload did not open: another key, another row or fleet, or damaged. */
export interface SealNotOpened {
  readonly kind: 'sealNotOpened';
}

export interface SealInput {
  readonly key: DataKey;
  readonly row: SealedRow;
}

export interface PayloadSealer {
  seal(input: SealInput, payload: string): SealedPayload;
  unseal(input: SealInput, sealed: SealedPayload): Result<string, SealNotOpened>;
  /** Proves an unwrap or a recovery gave the right key: compared with the check value stored beside its wraps. */
  checkValue(material: DataKeyMaterial): Uint8Array<ArrayBuffer>;
}
