/**
 * Recovery keys in memory, for the use case tests (decision 0068): any text
 * starting `age1` is a recipient, its fingerprint names it, and a wrap names
 * the recipient and holds the data key as it is. Nothing here keeps a secret;
 * {@link openedByRecoveryKey} opens a wrap as the company's offline private
 * half would, on its own computer.
 */
import type { DataKeyMaterial } from '../../src/domain/messaging/key-vault.js';
import type { RecoveryKeys } from '../../src/domain/messaging/recovery-key.js';

const SEPARATOR = '\0';

export const inMemoryRecoveryKeys: RecoveryKeys = {
  recoveryKeyOf: (recipient) => (/^age1[a-z0-9]+$/.test(recipient) ? { recipient, fingerprint: `SHA256:fingerprint-of-${recipient}` } : undefined),
  wrap: (recoveryKey, material) => Promise.resolve(new Uint8Array(Buffer.from(`${recoveryKey.recipient}${SEPARATOR}${Buffer.from(material).toString('hex')}`, 'utf8'))),
};

/** The data key a wrap holds when it was wrapped to the recipient; none for another recipient or no wrap. */
export function openedByRecoveryKey(recipient: string, wrapped: Uint8Array | null | undefined): DataKeyMaterial | undefined {
  if (wrapped === null || wrapped === undefined) {
    return undefined;
  }
  const [wrappedTo, hex] = Buffer.from(wrapped).toString('utf8').split(SEPARATOR);
  return wrappedTo === recipient && hex !== undefined ? new Uint8Array(Buffer.from(hex, 'hex')) : undefined;
}
