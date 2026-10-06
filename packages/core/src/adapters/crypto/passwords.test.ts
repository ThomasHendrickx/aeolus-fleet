import { describe, expect, it } from 'vitest';

import { argon2idPasswordHasher } from './passwords.js';

/** The reference implementation's Argon2id vector: password "password", salt "somesalt". */
const REFERENCE_HASH = '$argon2id$v=19$m=65536,t=2,p=1$c29tZXNhbHQ$CTFhFdXPJO1aFaMaO6Mm5c8y7cJHAph8ArZWb2GRPPc';

describe('argon2idPasswordHasher', () => {
  it('hashes to an Argon2id string with 19 MiB, two passes and one lane', async () => {
    const hash = await argon2idPasswordHasher.hash('correct horse');

    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$[A-Za-z0-9+/]{22}\$[A-Za-z0-9+/]{43}$/);
    expect(hash).not.toContain('correct horse');
  });

  it('salts every hash: the same password never hashes the same twice', async () => {
    const [first, second] = await Promise.all([
      argon2idPasswordHasher.hash('correct horse'),
      argon2idPasswordHasher.hash('correct horse'),
    ]);

    expect(first).not.toBe(second);
  });

  it('verifies the password a hash was made from', async () => {
    const hash = await argon2idPasswordHasher.hash('correct horse');

    await expect(argon2idPasswordHasher.verify('correct horse', hash)).resolves.toBe(true);
  });

  it('refuses any other password', async () => {
    const hash = await argon2idPasswordHasher.hash('correct horse');

    await expect(argon2idPasswordHasher.verify('correct horse ', hash)).resolves.toBe(false);
    await expect(argon2idPasswordHasher.verify('Correct horse', hash)).resolves.toBe(false);
    await expect(argon2idPasswordHasher.verify('', hash)).resolves.toBe(false);
  });

  it('refuses every password when there is no hash to check against', async () => {
    await expect(argon2idPasswordHasher.verify('correct horse', undefined)).resolves.toBe(false);
  });

  it('verifies a hash made elsewhere with other parameters, read from the hash itself', async () => {
    await expect(argon2idPasswordHasher.verify('password', REFERENCE_HASH)).resolves.toBe(true);
    await expect(argon2idPasswordHasher.verify('passwort', REFERENCE_HASH)).resolves.toBe(false);
  });

  it.each([
    ['a bcrypt hash', '$2b$10$abcdefghijklmnopqrstuuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0'],
    ['an Argon2i hash', REFERENCE_HASH.replace('argon2id', 'argon2i')],
    ['another Argon2 version', REFERENCE_HASH.replace('v=19', 'v=16')],
    ['plain text', 'correct horse'],
  ])('fails loudly on a stored value that is not an Argon2id hash: %s', async (_label, stored) => {
    await expect(argon2idPasswordHasher.verify('correct horse', stored)).rejects.toThrow('not an Argon2id hash');
  });
});
