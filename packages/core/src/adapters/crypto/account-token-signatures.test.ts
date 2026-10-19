import { createIdGenerator } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { createTestIssuer, type TestIssuer } from '../../testing/account-token-issuer.js';
import { createAccountTokenSignatures } from './account-token-signatures.js';

const newId = createIdGenerator();
const fleetId = newId('fleet');
const ISSUED_AT = 1_760_000_000;
const ONE_MINUTE_MS = 60_000;

function claims(issuer: TestIssuer, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return { iss: issuer.issuer, aud: fleetId, sub: 'acc-charlotte', org: 'org-acme', scope: 'fleet:read', group: ['sales'], iat: ISSUED_AT, exp: ISSUED_AT + 600, ...overrides };
}

/** The signatures adapter over a test issuer's key set, counting its fetches, on a clock the test moves. */
function signaturesOf(issuer: TestIssuer, options: { isDown?: () => boolean } = {}) {
  let now = new Date('2026-10-19T10:00:00Z');
  let fetches = 0;
  const signatures = createAccountTokenSignatures({
    issuer: issuer.issuer,
    fetchKeySet: () => {
      fetches += 1;
      return options.isDown?.() ? Promise.reject(new Error('pagasae does not answer')) : Promise.resolve(issuer.keySet());
    },
    now: () => now,
  });
  return {
    signatures,
    fetches: () => fetches,
    pass: (milliseconds: number) => {
      now = new Date(now.getTime() + milliseconds);
    },
  };
}

describe('account token signatures', () => {
  it('reads the claims of a token the issuer signed', async () => {
    const issuer = createTestIssuer();
    const { signatures } = signaturesOf(issuer);

    expect(await signatures.verify(issuer.sign(claims(issuer)))).toMatchObject({ accountId: 'acc-charlotte', fleetId, scopes: ['fleet:read'], groupValues: ['sales'] });
  });

  it('reads a token signed with an ES256 key', async () => {
    const issuer = createTestIssuer();
    issuer.rotate('ES256');
    const { signatures } = signaturesOf(issuer);

    expect(await signatures.verify(issuer.sign(claims(issuer)))).toMatchObject({ accountId: 'acc-charlotte' });
  });

  it('refuses a token signed with a key the issuer never published', async () => {
    const issuer = createTestIssuer();
    const { signatures } = signaturesOf(issuer);

    expect(await signatures.verify(issuer.signWithUnpublishedKey(claims(issuer)))).toBeUndefined();
  });

  it('refuses a token whose claims were changed after signing', async () => {
    const issuer = createTestIssuer();
    const { signatures } = signaturesOf(issuer);
    const [header, , signature] = issuer.sign(claims(issuer)).split('.');
    const widened = Buffer.from(JSON.stringify(claims(issuer, { scope: 'fleet:read fleet:manage' }))).toString('base64url');

    expect(await signatures.verify(`${String(header)}.${widened}.${String(signature)}`)).toBeUndefined();
  });

  it('refuses a token that names another issuer', async () => {
    const issuer = createTestIssuer();
    const { signatures } = signaturesOf(issuer);

    expect(await signatures.verify(issuer.sign(claims(issuer, { iss: 'https://pagasae.test/' })))).toBeUndefined();
  });

  it('refuses a signed token that is not an access token', async () => {
    const issuer = createTestIssuer();
    const { signatures } = signaturesOf(issuer);

    expect(await signatures.verify(issuer.sign(claims(issuer), { type: 'JWT' }))).toBeUndefined();
  });

  it('refuses an unsigned token', async () => {
    const issuer = createTestIssuer();
    const { signatures } = signaturesOf(issuer);
    const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'at+jwt' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(claims(issuer))).toString('base64url');

    expect(await signatures.verify(`${header}.${body}.`)).toBeUndefined();
  });

  it.each([['no token', ''], ['one part', 'abc'], ['parts that are no JSON', 'a.b.c'], ['four parts', 'a.b.c.d']])('refuses %s', async (_case, token) => {
    const issuer = createTestIssuer();
    const { signatures } = signaturesOf(issuer);

    expect(await signatures.verify(token)).toBeUndefined();
  });

  it('refuses a signed token whose claims are malformed', async () => {
    const issuer = createTestIssuer();
    const { signatures } = signaturesOf(issuer);

    expect(await signatures.verify(issuer.sign(claims(issuer, { aud: 'acme' })))).toBeUndefined();
  });

  it('accepts a token signed with a key published after it last fetched, fetching the keys again', async () => {
    const issuer = createTestIssuer();
    const { signatures, pass } = signaturesOf(issuer);
    await signatures.verify(issuer.sign(claims(issuer)));
    pass(ONE_MINUTE_MS);
    issuer.rotate();

    expect(await signatures.verify(issuer.sign(claims(issuer)))).toMatchObject({ accountId: 'acc-charlotte' });
  });

  it('accepts a token signed with the old key while the issuer still publishes it beside the new', async () => {
    const issuer = createTestIssuer();
    const oldKeyId = issuer.keySet().keys[0]?.kid ?? '';
    issuer.rotate();
    const { signatures } = signaturesOf(issuer);

    expect(await signatures.verify(issuer.sign(claims(issuer), { keyId: oldKeyId }))).toMatchObject({ accountId: 'acc-charlotte' });
  });

  it('fetches the keys for an unknown key at most once a minute', async () => {
    const issuer = createTestIssuer();
    const { signatures, fetches, pass } = signaturesOf(issuer);
    await signatures.verify(issuer.sign(claims(issuer)));

    await signatures.verify(issuer.signWithUnpublishedKey(claims(issuer)));
    pass(ONE_MINUTE_MS - 1);
    await signatures.verify(issuer.signWithUnpublishedKey(claims(issuer)));

    expect(fetches()).toBe(1);
  });

  it('fetches the keys again a minute after it last did', async () => {
    const issuer = createTestIssuer();
    const { signatures, fetches, pass } = signaturesOf(issuer);
    await signatures.verify(issuer.sign(claims(issuer)));
    pass(ONE_MINUTE_MS);

    await signatures.verify(issuer.signWithUnpublishedKey(claims(issuer)));

    expect(fetches()).toBe(2);
  });

  it('refuses a token signed with a key the issuer dropped, once it fetched the keys again', async () => {
    const issuer = createTestIssuer();
    const leakedKeyId = issuer.keySet().keys[0]?.kid ?? '';
    const { signatures, pass } = signaturesOf(issuer);
    await signatures.verify(issuer.sign(claims(issuer)));
    const signedWithLeakedKey = issuer.sign(claims(issuer), { keyId: leakedKeyId });
    issuer.rotate();
    issuer.drop(leakedKeyId);
    pass(ONE_MINUTE_MS);

    expect(await signatures.verify(signedWithLeakedKey)).toBeUndefined();
  });

  it('goes on checking with the keys it holds while the issuer does not answer', async () => {
    const issuer = createTestIssuer();
    let isDown = false;
    const { signatures, pass } = signaturesOf(issuer, { isDown: () => isDown });
    await signatures.verify(issuer.sign(claims(issuer)));
    isDown = true;
    pass(ONE_MINUTE_MS);

    expect(await signatures.verify(issuer.sign(claims(issuer)))).toMatchObject({ accountId: 'acc-charlotte' });
  });

  it('refuses every token while it never got the keys', async () => {
    const issuer = createTestIssuer();
    const { signatures } = signaturesOf(issuer, { isDown: () => true });

    expect(await signatures.verify(issuer.sign(claims(issuer)))).toBeUndefined();
  });
});
