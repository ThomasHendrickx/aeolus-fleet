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

/**
 * Outbound port: hashes the operator password (Argon2id). Each hash has its
 * own random salt, so a password is checked with `verify`, never found by its
 * hash.
 */
export interface PasswordHasher {
  hash(password: string): Promise<string>;
  /**
   * True when the password is the one the hash was made from. Without a hash
   * it takes as long and is false, so a wrong email costs as much time as a
   * wrong password and gives nothing away.
   */
  verify(password: string, passwordHash: string | undefined): Promise<boolean>;
}
