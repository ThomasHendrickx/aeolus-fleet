/**
 * A payload as the fleet stores it (decision 0068, B7): plain text, or in a
 * sealed fleet sealed under a data key, with the plain payload's UTF-8 byte
 * count, so the 64 KB limit, the daily counts and pruning count the same
 * bytes in every fleet.
 */
import { payloadBytes } from '@aeolus-fleet/common';

import type { SealedPayload } from './payload-sealer.js';

export interface SealedMessagePayload {
  readonly sealed: SealedPayload;
  readonly plainBytes: number;
}

export type StoredPayload = string | SealedMessagePayload;

export function isSealedPayload(payload: StoredPayload): payload is SealedMessagePayload {
  return typeof payload !== 'string';
}

/** The plain payload's UTF-8 byte count, sealed or not. */
export function plainBytesOf(payload: StoredPayload): number {
  return isSealedPayload(payload) ? payload.plainBytes : payloadBytes(payload);
}
