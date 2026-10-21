import { accountIdSchema, createIdGenerator, type AccountId, type AccountTokenClaims, type FleetId } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { unwrap } from '../../testing/result.js';
import type { ShipCaller } from '../shared/caller.js';
import { createAuthenticateAccount } from './authenticate-account.js';
import type { AccountCutOffLookup, AccountTokenSignatures, HostedFleets } from './ports.js';

const newId = createIdGenerator();
const NOW = new Date('2026-10-19T10:00:00Z');
const MINUTE_MS = 60_000;
const SECOND_MS = 1000;
const fleetId = newId('fleet');
const otherFleetId = newId('fleet');
const personShipId = newId('ship');
const charlotte = accountIdSchema.parse('acc-charlotte');

function at(milliseconds: number): Date {
  return new Date(NOW.getTime() + milliseconds);
}

/** A token issued a minute ago that ends in nine minutes: the 10 minutes decision 0058 gives one. */
function aToken(overrides: Partial<AccountTokenClaims> = {}): AccountTokenClaims {
  return {
    issuer: 'https://pagasae.test',
    fleetId,
    accountId: charlotte,
    organisationId: 'org-acme',
    scopes: ['fleet:read', 'fleet:manage'],
    groupValues: ['sales'],
    personShipId,
    issuedAt: at(-MINUTE_MS),
    endsAt: at(9 * MINUTE_MS),
    ...overrides,
  };
}

/** The use case over a signatures fake that trusts exactly the tokens given, by their text. */
function authenticateAccountWith(trusted: Record<string, AccountTokenClaims>, options: { cutOff?: { accountId: AccountId; at: Date }; hosted?: FleetId[] } = {}) {
  const signatures: AccountTokenSignatures = { verify: (token) => Promise.resolve(trusted[token]) };
  const cutOffs: AccountCutOffLookup = {
    cutOffAt: (accountId) => Promise.resolve(options.cutOff?.accountId === accountId ? options.cutOff.at : undefined),
  };
  const fleets: HostedFleets = { isHosted: (id) => Promise.resolve((options.hosted ?? [fleetId, otherFleetId]).includes(id)) };
  return createAuthenticateAccount({ signatures, cutOffs, fleets, clock: { now: () => NOW } });
}

const gateway: ShipCaller = { shipId: newId('ship'), fleetId, kind: 'app', scopes: ['messages:send', 'messages:receive'] };

describe('authenticating with an account token', () => {
  it('makes the account the caller, with the scopes, group values and person ship its token carries, and when it ends', async () => {
    const authenticate = authenticateAccountWith({ token: aToken() });

    expect(unwrap(await authenticate('token', { through: null }))).toEqual({
      kind: 'account',
      accountId: charlotte,
      fleetId,
      scopes: ['fleet:read', 'fleet:manage'],
      groupValues: ['sales'],
      personShipId,
      throughShipId: null,
      tokenEndsAt: aToken().endsAt,
    });
  });

  it('names the ship that presented the token', async () => {
    const authenticate = authenticateAccountWith({ token: aToken() });

    expect(unwrap(await authenticate('token', { through: gateway }))).toMatchObject({ throughShipId: gateway.shipId });
  });

  it('refuses a token pagasae did not sign', async () => {
    const authenticate = authenticateAccountWith({});

    expect(await authenticate('forged', { through: null })).toMatchObject({ isOk: false, error: { kind: 'ACCOUNT_TOKEN_INVALID' } });
  });

  it('refuses a token for another fleet than the one of the ship presenting it', async () => {
    const authenticate = authenticateAccountWith({ token: aToken({ fleetId: otherFleetId }) });

    expect(await authenticate('token', { through: gateway })).toMatchObject({ isOk: false, error: { kind: 'ACCOUNT_TOKEN_INVALID' } });
  });

  it('refuses a token for a fleet this installation does not host', async () => {
    const authenticate = authenticateAccountWith({ token: aToken() }, { hosted: [otherFleetId] });

    expect(await authenticate('token', { through: null })).toMatchObject({ isOk: false, error: { kind: 'ACCOUNT_TOKEN_INVALID' } });
  });

  it('accepts a token up to 30 seconds after its end', async () => {
    const authenticate = authenticateAccountWith({ token: aToken({ issuedAt: at(-10 * MINUTE_MS), endsAt: at(-30 * SECOND_MS) }) });

    expect((await authenticate('token', { through: null })).isOk).toBe(true);
  });

  it('refuses a token more than 30 seconds after its end, saying it ended', async () => {
    const authenticate = authenticateAccountWith({ token: aToken({ issuedAt: at(-10 * MINUTE_MS - 1), endsAt: at(-30 * SECOND_MS - 1) }) });

    expect(await authenticate('token', { through: null })).toMatchObject({ isOk: false, error: { kind: 'ACCOUNT_TOKEN_ENDED' } });
  });

  it('accepts a token that lives 10 minutes and 30 seconds', async () => {
    const authenticate = authenticateAccountWith({ token: aToken({ issuedAt: at(-MINUTE_MS), endsAt: at(9 * MINUTE_MS + 30 * SECOND_MS) }) });

    expect((await authenticate('token', { through: null })).isOk).toBe(true);
  });

  it('refuses a token that lives longer than 10 minutes and 30 seconds, whatever its issuer says', async () => {
    const authenticate = authenticateAccountWith({ token: aToken({ issuedAt: at(-MINUTE_MS), endsAt: at(9 * MINUTE_MS + 30 * SECOND_MS + 1) }) });

    expect(await authenticate('token', { through: null })).toMatchObject({ isOk: false, error: { kind: 'ACCOUNT_TOKEN_INVALID' } });
  });

  it('refuses a token issued more than 30 seconds from now, which would outlive a cut-off', async () => {
    const authenticate = authenticateAccountWith({ token: aToken({ issuedAt: at(30 * SECOND_MS + 1), endsAt: at(10 * MINUTE_MS) }) });

    expect(await authenticate('token', { through: null })).toMatchObject({ isOk: false, error: { kind: 'ACCOUNT_TOKEN_INVALID' } });
  });

  it('refuses a token of a cut-off account issued before the cut-off', async () => {
    const authenticate = authenticateAccountWith({ token: aToken({ issuedAt: at(-MINUTE_MS) }) }, { cutOff: { accountId: charlotte, at: at(-1) } });

    expect(await authenticate('token', { through: null })).toMatchObject({ isOk: false, error: { kind: 'ACCOUNT_TOKEN_INVALID' } });
  });

  it('accepts a token of a cut-off account issued after the cut-off: pagasae enabled it again', async () => {
    const authenticate = authenticateAccountWith({ token: aToken({ issuedAt: at(-MINUTE_MS) }) }, { cutOff: { accountId: charlotte, at: at(-MINUTE_MS - 1) } });

    expect((await authenticate('token', { through: null })).isOk).toBe(true);
  });

  it('accepts a token of another account than the one cut off', async () => {
    const authenticate = authenticateAccountWith({ token: aToken() }, { cutOff: { accountId: accountIdSchema.parse('acc-burak'), at: NOW } });

    expect((await authenticate('token', { through: null })).isOk).toBe(true);
  });
});
