import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import { accountTokenClaimsSchema } from './account-token.js';

const newId = createIdGenerator();
const fleetId = newId('fleet');
const personShipId = newId('ship');

function claims(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: 'https://pagasae.example',
    aud: fleetId,
    sub: 'acc-charlotte',
    org: 'org-acme',
    scope: 'fleet:read fleet:manage squadrons:form',
    group: ['sales', 'engineering'],
    person_ship: personShipId,
    iat: 1_760_000_000,
    exp: 1_760_000_600,
    ...overrides,
  };
}

describe('accountTokenClaimsSchema', () => {
  it('reads the account, its organisation, the fleet, its scopes, group values, person ship and life', () => {
    expect(accountTokenClaimsSchema.parse(claims())).toEqual({
      issuer: 'https://pagasae.example',
      fleetId,
      accountId: 'acc-charlotte',
      organisationId: 'org-acme',
      scopes: ['fleet:read', 'fleet:manage', 'squadrons:form'],
      groupValues: ['sales', 'engineering'],
      personShipId,
      isArgoAllowed: false,
      issuedAt: new Date(1_760_000_000_000),
      endsAt: new Date(1_760_000_600_000),
    });
  });

  it('reads an account without a person ship in the fleet', () => {
    expect(accountTokenClaimsSchema.parse(claims({ person_ship: undefined }))).toMatchObject({ personShipId: null });
  });

  it('reads an account allowed as argo of the fleet from its argo claim', () => {
    expect(accountTokenClaimsSchema.parse(claims({ argo: true }))).toMatchObject({ isArgoAllowed: true });
  });

  it('reads an account not allowed as argo when the claim says false', () => {
    expect(accountTokenClaimsSchema.parse(claims({ argo: false }))).toMatchObject({ isArgoAllowed: false });
  });

  it('reads an account with no scopes and no groups', () => {
    expect(accountTokenClaimsSchema.parse(claims({ scope: '', group: [] }))).toMatchObject({ scopes: [], groupValues: [] });
  });

  it.each([
    ['a missing account', { sub: undefined }],
    ['an empty account', { sub: '' }],
    ['an account id over 128 characters', { sub: 'a'.repeat(129) }],
    ['a fleet that is no fleet id', { aud: 'acme' }],
    ['several audiences', { aud: [fleetId, fleetId] }],
    ['a malformed scope', { scope: 'fleet' }],
    ['an unknown core scope', { scope: 'fleet:everything' }],
    ['a missing end', { exp: undefined }],
    ['a missing issue time', { iat: undefined }],
    ['a person ship that is no ship id', { person_ship: 'charlotte' }],
    ['a missing organisation', { org: undefined }],
    ['an argo claim that is no boolean', { argo: 'yes' }],
  ])('refuses %s', (_case, overrides) => {
    expect(accountTokenClaimsSchema.safeParse(claims(overrides)).success).toBe(false);
  });
});
