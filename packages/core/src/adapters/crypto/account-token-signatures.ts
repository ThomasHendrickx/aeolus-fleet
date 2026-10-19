import { createPublicKey, verify, type KeyObject } from 'node:crypto';

import { accountTokenClaimsSchema } from '@aeolus-fleet/common';
import { z } from 'zod';

import type { AccountTokenSignatures } from '../../domain/identity/ports.js';

/**
 * How long the keys core holds count as pagasae's current ones. A key core
 * does not know makes it fetch them again, and so does a check after this
 * long, so a key pagasae dropped (a leaked one replaced, decision 0058)
 * stops counting within it; never more often, so a forged key id cannot make
 * core fetch without end.
 */
const KEYS_FRESH_FOR_MS = 60_000;

/** RFC 9068: an account token is an access token. */
const ACCESS_TOKEN_TYPE = 'at+jwt';

const headerSchema = z.object({ alg: z.enum(['EdDSA', 'ES256']), typ: z.literal(ACCESS_TOKEN_TYPE), kid: z.string().min(1) });
type SigningAlgorithm = z.infer<typeof headerSchema>['alg'];

/** The fields of a published key node reads: Ed25519 (`OKP`) and P-256 (`EC`) public keys. */
const publishedKeySchema = z.object({ kid: z.string().min(1), kty: z.string(), crv: z.string(), x: z.string(), y: z.string().optional() });
const keySetSchema = z.object({ keys: z.array(z.unknown()) });

/**
 * Checks pagasae's signature on account tokens (decision 0058) with node's
 * crypto: the issuer's published key set, read from `fetchKeySet` (its
 * `/.well-known/jwks.json`), Ed25519 and P-256 keys. While pagasae does not
 * answer, the keys core already holds go on checking.
 */
export function createAccountTokenSignatures(deps: {
  issuer: string;
  fetchKeySet: () => Promise<unknown>;
  now: () => Date;
}): AccountTokenSignatures {
  let keys = new Map<string, KeyObject>();
  let fetchedAt: number | undefined;
  let fetching: Promise<void> | undefined;

  const refresh = (): Promise<void> => {
    fetching ??= (async () => {
      fetchedAt = deps.now().getTime();
      try {
        keys = publicKeys(await deps.fetchKeySet());
      } catch {
        // pagasae down or answering nonsense: keep the keys held (decision 0058, "pagasae down").
      } finally {
        fetching = undefined;
      }
    })();
    return fetching;
  };

  return {
    verify: async (token) => {
      const parts = token.split('.');
      if (parts.length !== 3) {
        return undefined;
      }
      const [encodedHeader = '', encodedClaims = '', encodedSignature = ''] = parts;
      const header = headerSchema.safeParse(decoded(encodedHeader));
      if (!header.success) {
        return undefined;
      }
      if (fetchedAt === undefined || deps.now().getTime() - fetchedAt >= KEYS_FRESH_FOR_MS) {
        await refresh();
      }
      const key = keys.get(header.data.kid);
      if (!key || !isSignedBy(key, { algorithm: header.data.alg, input: `${encodedHeader}.${encodedClaims}`, signature: encodedSignature })) {
        return undefined;
      }
      const claims = accountTokenClaimsSchema.safeParse(decoded(encodedClaims));
      return claims.success && claims.data.issuer === deps.issuer ? claims.data : undefined;
    },
  };
}

function decoded(part: string): unknown {
  try {
    const parsed: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'));
    return parsed;
  } catch {
    return undefined;
  }
}

/** The usable keys of a key set by id; a key node cannot read is left out. */
function publicKeys(keySet: unknown): Map<string, KeyObject> {
  const read = new Map<string, KeyObject>();
  for (const published of keySetSchema.parse(keySet).keys) {
    const parsed = publishedKeySchema.safeParse(published);
    if (!parsed.success) {
      continue;
    }
    const { kid, ...jwk } = parsed.data;
    try {
      read.set(kid, createPublicKey({ key: jwk, format: 'jwk' }));
    } catch {
      // Not a public key node reads: it can sign nothing core accepts.
    }
  }
  return read;
}

function isSignedBy(key: KeyObject, signed: { algorithm: SigningAlgorithm; input: string; signature: string }): boolean {
  const { algorithm } = signed;
  const input = Buffer.from(signed.input);
  const signature = Buffer.from(signed.signature, 'base64url');
  switch (algorithm) {
    case 'EdDSA':
      return key.asymmetricKeyType === 'ed25519' && verify(null, input, key, signature);
    case 'ES256':
      return key.asymmetricKeyType === 'ec' && key.asymmetricKeyDetails?.namedCurve === 'prime256v1' && verify('sha256', input, { key, dsaEncoding: 'ieee-p1363' }, signature);
  }
}
