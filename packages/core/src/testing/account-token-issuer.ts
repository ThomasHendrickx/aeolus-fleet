import { generateKeyPairSync, randomUUID, sign, type KeyObject } from 'node:crypto';

/** A public key as a key set publishes it. */
export type PublishedKey = Record<string, unknown> & { kid: string };

/**
 * A stand-in for pagasae signing account tokens (decision 0058), for tests:
 * it publishes its keys as a key set, signs with the newest, rotates by
 * publishing a new key beside the old, and can sign with a key it never
 * published. Ed25519 by default; ES256 on request.
 */
export interface TestIssuer {
  issuer: string;
  /** The published keys, as `<issuer>/.well-known/jwks.json` answers them. */
  keySet(): { keys: PublishedKey[] };
  /** Publishes a new key beside the old ones and signs with it from now on; answers its key id. */
  rotate(algorithm?: SigningAlgorithm): string;
  /** Stops publishing a key. */
  drop(keyId: string): void;
  /** A token with these claims, signed with the newest key, or the named one. */
  sign(claims: Record<string, unknown>, options?: { keyId?: string; type?: string }): string;
  /** A token signed with a key the issuer never published, naming a key id of its own. */
  signWithUnpublishedKey(claims: Record<string, unknown>): string;
}

export type SigningAlgorithm = 'EdDSA' | 'ES256';

interface SigningKey {
  keyId: string;
  algorithm: SigningAlgorithm;
  privateKey: KeyObject;
  publicKey: KeyObject;
}

export function createTestIssuer(issuer = 'https://pagasae.test'): TestIssuer {
  const keys: SigningKey[] = [];
  const rotate = (algorithm: SigningAlgorithm = 'EdDSA'): string => {
    const key = newSigningKey(algorithm);
    keys.push(key);
    return key.keyId;
  };
  rotate();
  return {
    issuer,
    keySet: () => ({ keys: keys.map(publicJwk) }),
    rotate,
    drop: (keyId) => {
      const index = keys.findIndex((key) => key.keyId === keyId);
      if (index >= 0) {
        keys.splice(index, 1);
      }
    },
    sign: (claims, options = {}) => {
      const key = options.keyId === undefined ? keys.at(-1) : keys.find((held) => held.keyId === options.keyId);
      if (!key) {
        throw new Error(`The test issuer holds no key ${options.keyId ?? ''}`);
      }
      return signedToken(key, { claims, type: options.type ?? 'at+jwt' });
    },
    signWithUnpublishedKey: (claims) => signedToken(newSigningKey('EdDSA'), { claims, type: 'at+jwt' }),
  };
}

function newSigningKey(algorithm: SigningAlgorithm): SigningKey {
  const { privateKey, publicKey } = algorithm === 'EdDSA' ? generateKeyPairSync('ed25519') : generateKeyPairSync('ec', { namedCurve: 'P-256' });
  return { keyId: randomUUID(), algorithm, privateKey, publicKey };
}

function publicJwk(key: SigningKey): PublishedKey {
  return { ...key.publicKey.export({ format: 'jwk' }), kid: key.keyId, alg: key.algorithm, use: 'sig' };
}

function signedToken(key: SigningKey, token: { claims: Record<string, unknown>; type: string }): string {
  const { claims, type } = token;
  const header = encode({ alg: key.algorithm, typ: type, kid: key.keyId });
  const body = encode(claims);
  const input = Buffer.from(`${header}.${body}`);
  const signature =
    key.algorithm === 'EdDSA' ? sign(null, input, key.privateKey) : sign('sha256', input, { key: key.privateKey, dsaEncoding: 'ieee-p1363' });
  return `${header}.${body}.${signature.toString('base64url')}`;
}

function encode(value: unknown): string {
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}
