/**
 * Outbound port: the company's key vault, which keeps a sealed fleet's
 * company key (decision 0068). Core never sees the company key; it asks the
 * vault to make, wrap, unwrap and rewrap data keys under it. Every call names
 * the fleet, and the vault binds each wrap to it (the encryption context
 * `aeolus:fleet = <fleet id>`), so a wrap made for one fleet never opens for
 * another. Called outside every transaction.
 */
import type { FleetId } from '@aeolus-fleet/common';

import type { Result } from '../shared/result.js';

/** A company key as the company's key vault names it: an AWS KMS key ARN first. */
export type CompanyKeyReference = string;

/** Why the key vault could not answer: the KMS's reason, as `KEY_UNAVAILABLE` carries it. */
export type KeyUnavailableReason =
  /** The installation may not use the company key: no grant, or a policy that refuses it. */
  | 'accessDenied'
  /** The company key is disabled or waits for deletion. */
  | 'disabled'
  /** No such company key. */
  | 'notFound'
  /** The key vault did not answer in time, or not at all. */
  | 'unreachable'
  /** The wrap does not open under this company key for this fleet: made for another fleet, another key, or damaged. */
  | 'invalidWrap';

export interface KeyUnavailable {
  readonly kind: 'keyUnavailable';
  readonly reason: KeyUnavailableReason;
}

/** A data key's bytes, unwrapped: held in memory only, never stored, logged or sent. */
export type DataKeyMaterial = Uint8Array<ArrayBuffer>;

/** A data key wrapped by a company key: what the vault answered, opaque to core. */
export type WrappedDataKey = Uint8Array<ArrayBuffer>;

/** A new data key: its bytes, and the same bytes wrapped by the company key. */
export interface MadeDataKey {
  readonly material: DataKeyMaterial;
  readonly wrapped: WrappedDataKey;
}

/** Which company key, for which fleet. */
export interface CompanyKeyUse {
  readonly fleetId: FleetId;
  readonly companyKey: CompanyKeyReference;
}

export interface KeyVault {
  /** A new 256-bit data key under the company key, for this fleet. */
  makeDataKey(use: CompanyKeyUse): Promise<Result<MadeDataKey, KeyUnavailable>>;
  /** The data key a wrap holds, when it was made under the company key for this fleet. */
  unwrap(use: CompanyKeyUse, wrapped: WrappedDataKey): Promise<Result<DataKeyMaterial, KeyUnavailable>>;
  /** The given data key wrapped by the company key, for this fleet. */
  wrap(use: CompanyKeyUse, material: DataKeyMaterial): Promise<Result<WrappedDataKey, KeyUnavailable>>;
  /**
   * A wrap moved from one company key to another inside the vault, for this
   * fleet, so the data key never leaves it.
   */
  rewrap(change: CompanyKeyChange, wrapped: WrappedDataKey): Promise<Result<WrappedDataKey, KeyUnavailable>>;
}

/** Moving a fleet's data keys from one company key to another. */
export interface CompanyKeyChange {
  readonly fleetId: FleetId;
  readonly from: CompanyKeyReference;
  readonly to: CompanyKeyReference;
}
