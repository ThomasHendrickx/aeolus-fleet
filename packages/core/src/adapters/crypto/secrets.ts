import { createHash, randomBytes } from 'node:crypto';

import type { RandomTokens, SecretHasher } from '../../domain/shared/secrets.js';

/** SHA-256 in hex. The inputs are 256-bit random strings, so a plain hash is enough. */
export const sha256Hasher: SecretHasher = {
  hash: (value) => createHash('sha256').update(value, 'utf8').digest('hex'),
};

/** 32 random bytes from the operating system, base64url encoded (43 characters). */
export const cryptoRandomTokens: RandomTokens = {
  next: () => randomBytes(32).toString('base64url'),
};
