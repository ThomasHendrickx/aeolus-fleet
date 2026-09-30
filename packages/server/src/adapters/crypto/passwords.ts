import { argon2, randomBytes, timingSafeEqual, type Argon2Parameters } from 'node:crypto';
import { promisify } from 'node:util';

import type { PasswordHasher } from '../../core/shared/secrets.js';

/**
 * Argon2id from Node's crypto module, stored in the PHC string format the
 * reference implementation uses:
 * `$argon2id$v=19$m=<KiB>,t=<passes>,p=<lanes>$<salt>$<hash>`, base64 without
 * padding. The parameters travel in the string, so hashes made with other
 * parameters keep verifying after these change.
 */

const deriveKey = promisify(argon2);

/** OWASP's baseline for Argon2id: 19 MiB of memory, two passes, one lane. */
const COST = { memory: 19_456, passes: 2, parallelism: 1 };
const SALT_BYTES = 16;
const HASH_BYTES = 32;
const ARGON2_VERSION = 19;

const PHC_PATTERN = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)\$([A-Za-z0-9+/]+)\$([A-Za-z0-9+/]+)$/;

type Cost = typeof COST;

interface StoredHash {
  cost: Cost;
  salt: Buffer;
  hash: Buffer;
}

function encode({ cost, salt, hash }: StoredHash): string {
  const unpadded = (bytes: Buffer) => bytes.toString('base64').replace(/=+$/, '');
  return `$argon2id$v=${String(ARGON2_VERSION)}$m=${String(cost.memory)},t=${String(cost.passes)},p=${String(cost.parallelism)}$${unpadded(salt)}$${unpadded(hash)}`;
}

/** Throws on anything but an Argon2id hash of version 19: a stored hash this adapter did not make is a system failure. */
function decode(stored: string): StoredHash {
  const match = PHC_PATTERN.exec(stored);
  const [, memory, passes, parallelism, salt, hash] = match ?? [];
  if (!memory || !passes || !parallelism || !salt || !hash) {
    throw new Error('The stored password hash is not an Argon2id hash');
  }
  return {
    cost: { memory: Number(memory), passes: Number(passes), parallelism: Number(parallelism) },
    salt: Buffer.from(salt, 'base64'),
    hash: Buffer.from(hash, 'base64'),
  };
}

function derive(password: string, stored: Omit<StoredHash, 'hash'> & { length: number }): Promise<Buffer> {
  const parameters: Argon2Parameters = {
    message: password,
    nonce: stored.salt,
    tagLength: stored.length,
    ...stored.cost,
  };
  return deriveKey('argon2id', parameters);
}

export const argon2idPasswordHasher: PasswordHasher = {
  hash: async (password) => {
    const salt = randomBytes(SALT_BYTES);
    const hash = await derive(password, { cost: COST, salt, length: HASH_BYTES });
    return encode({ cost: COST, salt, hash });
  },
  verify: async (password, passwordHash) => {
    if (passwordHash === undefined) {
      await derive(password, { cost: COST, salt: randomBytes(SALT_BYTES), length: HASH_BYTES });
      return false;
    }
    const stored = decode(passwordHash);
    const attempt = await derive(password, { ...stored, length: stored.hash.length });
    return timingSafeEqual(attempt, stored.hash);
  },
};
