/**
 * A sealed fleet's recovery key (decision 0068, B6, B15): an optional offline
 * key pair the company makes and keeps. Core holds only its public half, an
 * `age` X25519 recipient, and wraps each data key to it too, so the company
 * can open its data keys on its own computer when its company key is lost.
 */
import { refuse, type DomainError } from '../shared/errors.js';
import { ok, type Result } from '../shared/result.js';
import type { DataKeyMaterial, WrappedDataKey } from './key-vault.js';

/** The recovery key by its public half, and the fingerprint the fleet shows it by. */
export interface RecoveryKey {
  /** The `age` X25519 recipient (`age1...`): public, never the private half. */
  readonly recipient: string;
  /** `SHA256:` and the unpadded base64 of the SHA-256 of the recipient's text. */
  readonly fingerprint: string;
}

/** Outbound port: reads and wraps to a recovery key. */
export interface RecoveryKeys {
  /** The recovery key an `age` X25519 recipient names; none for any other text. */
  recoveryKeyOf(recipient: string): RecoveryKey | undefined;
  /** The data key wrapped to the recovery key: only its private half, offline at the company, opens it. */
  wrap(recoveryKey: RecoveryKey, material: DataKeyMaterial): Promise<WrappedDataKey>;
}

/** The recovery key the given text names, or refused INVALID_RECOVERY_KEY. */
export function recoveryKey(recoveryKeys: RecoveryKeys, recipient: string): Result<RecoveryKey, DomainError<'INVALID_RECOVERY_KEY'>> {
  const parsed = recoveryKeys.recoveryKeyOf(recipient);
  return parsed === undefined ? refuse('INVALID_RECOVERY_KEY', 'A recovery key is the public half of an age X25519 key pair: a recipient starting age1') : ok(parsed);
}
