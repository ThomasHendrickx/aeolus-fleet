/**
 * Recovery keys as `age` X25519 recipients (decision 0068, B6): a data key is
 * wrapped to one as an age file, which the company opens on its own computer
 * with the offline private half, with the age tool or core's CLI. Only the
 * X25519 type is taken; a recipient is named by the SHA-256 fingerprint of its
 * text, as ssh-keygen names a key.
 */
import { createHash } from 'node:crypto';

import { Encrypter } from 'age-encryption';

import type { DataKeyMaterial, WrappedDataKey } from '../../domain/messaging/key-vault.js';
import type { RecoveryKeys } from '../../domain/messaging/recovery-key.js';

/** `age1`, then 32 bytes and a checksum in bech32's alphabet, which has no `1`, so no other recipient type (`age1pq1...`, `age1tag1...`) fits. */
const X25519_RECIPIENT = /^age1[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{58}$/;

function encrypterTo(recipient: string): Encrypter {
  const encrypter = new Encrypter();
  encrypter.addRecipient(recipient);
  return encrypter;
}

function hasValidChecksum(recipient: string): boolean {
  try {
    encrypterTo(recipient);
    return true;
  } catch {
    // age refuses a recipient whose bech32 checksum or length does not hold.
    return false;
  }
}

export const ageRecoveryKeys: RecoveryKeys = {
  recoveryKeyOf: (recipient) => {
    if (!X25519_RECIPIENT.test(recipient) || !hasValidChecksum(recipient)) {
      return undefined;
    }
    return { recipient, fingerprint: `SHA256:${createHash('sha256').update(recipient, 'utf8').digest('base64').replace(/=+$/, '')}` };
  },
  wrap: async (recoveryKey, material: DataKeyMaterial): Promise<WrappedDataKey> => new Uint8Array(await encrypterTo(recoveryKey.recipient).encrypt(material)),
};
