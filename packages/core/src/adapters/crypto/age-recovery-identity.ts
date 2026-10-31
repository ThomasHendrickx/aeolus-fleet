/**
 * The private half of a recovery key (decision 0068, B15), as the company
 * keeps it offline in an `age` identity file: read only by the recovery
 * command on the company's own computer, never sent, printed or logged. It
 * opens the data keys core wrapped to the recovery key's public half.
 */
import { Decrypter, identityToRecipient } from 'age-encryption';

import type { DataKeyMaterial, WrappedDataKey } from '../../domain/messaging/key-vault.js';
import { ageRecoveryKeys } from './age-recovery-keys.js';

/** An X25519 identity line of an age identity file; comment lines start with `#`. */
const X25519_IDENTITY = /^AGE-SECRET-KEY-1[0-9A-Z]+$/;

export interface RecoveryIdentity {
  /** The fingerprint of its public half, as the fleet names its recovery key. */
  readonly fingerprint: string;
  /** The data key a wrap to its public half holds; none for a wrap it does not open. */
  open(wrapped: WrappedDataKey): Promise<DataKeyMaterial | undefined>;
}

/** The recovery identity an age identity file holds; none when it holds no single X25519 identity. */
export async function recoveryIdentityOf(file: string): Promise<RecoveryIdentity | undefined> {
  const identities = file.split(/\r?\n/).map((line) => line.trim()).filter((line) => X25519_IDENTITY.test(line));
  const [identity] = identities;
  if (identity === undefined || identities.length > 1) {
    return undefined;
  }
  let recipient: string;
  try {
    recipient = await identityToRecipient(identity);
  } catch {
    // age refuses an identity whose bech32 checksum or length does not hold.
    return undefined;
  }
  const recoveryKey = ageRecoveryKeys.recoveryKeyOf(recipient);
  if (recoveryKey === undefined) {
    return undefined;
  }
  return {
    fingerprint: recoveryKey.fingerprint,
    open: async (wrapped) => {
      const decrypter = new Decrypter();
      decrypter.addIdentity(identity);
      try {
        return new Uint8Array(await decrypter.decrypt(wrapped));
      } catch {
        // age refuses a file not wrapped to this identity, or damaged.
        return undefined;
      }
    },
  };
}
