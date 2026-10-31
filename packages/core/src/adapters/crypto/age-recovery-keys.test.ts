import { Decrypter, generateHybridIdentity, generateX25519Identity, identityToRecipient } from 'age-encryption';
import { describe, expect, it } from 'vitest';

import { ageRecoveryKeys } from './age-recovery-keys.js';

// A throwaway recipient whose private half was never kept: its fingerprint is
// worked out by hand as `printf %s <recipient> | openssl dgst -sha256 -binary | base64`, padding dropped.
const RECIPIENT = 'age15sx03k0yus80j2zqmfk63nt4wak07a69puqvnpx9k27y2d4tkdws6xur6l';
const FINGERPRINT = 'SHA256:RLouQfVT+LTAqvgAUUwpZd07rK3gIuuINXi3YOixo28';

describe('ageRecoveryKeys (decision 0068, B6)', () => {
  it("scenario 6: names an age X25519 recipient by the SHA-256 fingerprint of its text", () => {
    expect(ageRecoveryKeys.recoveryKeyOf(RECIPIENT)).toEqual({ recipient: RECIPIENT, fingerprint: FINGERPRINT });
  });

  it('scenario 6: wraps a data key that only the private half of the recovery key opens', async () => {
    const identity = await generateX25519Identity();
    const recoveryKey = ageRecoveryKeys.recoveryKeyOf(await identityToRecipient(identity));
    const material = new Uint8Array(32).fill(7);
    if (recoveryKey === undefined) {
      throw new Error('A generated X25519 recipient is a recovery key');
    }

    const wrapped = await ageRecoveryKeys.wrap(recoveryKey, material);

    expect(Buffer.from(wrapped).includes(Buffer.from(material))).toBe(false);
    const companyComputer = new Decrypter();
    companyComputer.addIdentity(identity);
    expect(await companyComputer.decrypt(wrapped)).toEqual(material);
    const anotherKey = new Decrypter();
    anotherKey.addIdentity(await generateX25519Identity());
    await expect(anotherKey.decrypt(wrapped)).rejects.toThrow();
  });

  it('takes no private key, no other recipient type and no recipient whose checksum fails', async () => {
    const hybrid = await identityToRecipient(await generateHybridIdentity());
    const brokenChecksum = `${RECIPIENT.slice(0, -1)}${RECIPIENT.endsWith('q') ? 'p' : 'q'}`;

    expect(ageRecoveryKeys.recoveryKeyOf(await generateX25519Identity())).toBeUndefined();
    expect(ageRecoveryKeys.recoveryKeyOf(hybrid)).toBeUndefined();
    expect(ageRecoveryKeys.recoveryKeyOf(brokenChecksum)).toBeUndefined();
    expect(ageRecoveryKeys.recoveryKeyOf(` ${RECIPIENT}`)).toBeUndefined();
  });
});
