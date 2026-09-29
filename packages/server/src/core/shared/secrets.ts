/**
 * Outbound port: hashes ship secrets and console session tokens (SHA-256).
 * Only hashes are stored; the same input always gives the same hash, so a
 * secret is found by its hash.
 */
export interface SecretHasher {
  hash(value: string): string;
}

/** Outbound port: unguessable random strings (256 bits, URL safe) for secrets and session tokens. */
export interface RandomTokens {
  next(): string;
}
