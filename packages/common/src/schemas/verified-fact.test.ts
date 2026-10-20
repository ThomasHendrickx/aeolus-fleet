import { describe, expect, it } from 'vitest';

import {
  VERIFIED_FACT_ISSUER_MAX_LENGTH,
  VERIFIED_FACT_VALUE_MAX_LENGTH,
  VERIFIED_FACTS_MAX,
  discoveredVerifiedFactSchema,
  setVerifiedFactsInputSchema,
  VERIFIED_CHECKS,
} from './verified-fact.js';

const SHIP_ID = 'shp_01m5cndw5t282s37hw17k3396p';

const CARD = { checked: 'a2aCardDomain', value: 'agents.supplier.example' };
const OAUTH = { checked: 'oauthSubject', issuer: 'https://login.acme.example', value: 'aeolus-gateway' };

function factsOf(facts: unknown[]) {
  return setVerifiedFactsInputSchema.safeParse({ shipId: SHIP_ID, facts });
}

describe('the checks a verified fact names (decision 0059)', () => {
  it('are the client id document domain, the TLS host, the A2A card domain and the OAuth subject, nothing else', () => {
    expect(VERIFIED_CHECKS).toEqual(['clientIdDocumentDomain', 'tlsHost', 'a2aCardDomain', 'oauthSubject']);
  });
});

describe('setVerifiedFactsInputSchema (decision 0059)', () => {
  it('takes the ship and its facts, each what was checked and the value it found', () => {
    const input = { shipId: SHIP_ID, facts: [CARD, { checked: 'tlsHost', value: 'crm.acme.example' }, { checked: 'clientIdDocumentDomain', value: 'claude.acme.example' }] };

    expect(setVerifiedFactsInputSchema.parse(input)).toEqual(input);
  });

  it('takes an OAuth subject with the issuer it means something under', () => {
    expect(factsOf([OAUTH]).data?.facts).toEqual([OAUTH]);
  });

  it('takes no facts, which withdraws the writer\'s', () => {
    expect(factsOf([]).data?.facts).toEqual([]);
  });

  it('refuses an OAuth subject without its issuer', () => {
    expect(factsOf([{ checked: 'oauthSubject', value: 'aeolus-gateway' }]).success).toBe(false);
  });

  it.each(['clientIdDocumentDomain', 'tlsHost', 'a2aCardDomain'])('refuses an issuer on %s, which means nothing under one', (checked) => {
    expect(factsOf([{ checked, issuer: 'https://login.acme.example', value: 'acme.example' }]).success).toBe(false);
  });

  it('refuses a check off the closed list', () => {
    expect(factsOf([{ checked: 'email', value: 'someone@acme.example' }]).success).toBe(false);
  });

  it('refuses a field of its own beside the fixed ones', () => {
    expect(factsOf([{ ...CARD, note: 'fetched at noon' }]).success).toBe(false);
  });

  it(`takes a value of ${String(VERIFIED_FACT_VALUE_MAX_LENGTH)} characters and refuses one more, or none`, () => {
    expect(factsOf([{ checked: 'tlsHost', value: 'a'.repeat(VERIFIED_FACT_VALUE_MAX_LENGTH) }]).success).toBe(true);
    expect(factsOf([{ checked: 'tlsHost', value: 'a'.repeat(VERIFIED_FACT_VALUE_MAX_LENGTH + 1) }]).success).toBe(false);
    expect(factsOf([{ checked: 'tlsHost', value: '' }]).success).toBe(false);
  });

  it(`takes an issuer of ${String(VERIFIED_FACT_ISSUER_MAX_LENGTH)} characters and refuses one more, or none`, () => {
    expect(factsOf([{ ...OAUTH, issuer: 'i'.repeat(VERIFIED_FACT_ISSUER_MAX_LENGTH) }]).success).toBe(true);
    expect(factsOf([{ ...OAUTH, issuer: 'i'.repeat(VERIFIED_FACT_ISSUER_MAX_LENGTH + 1) }]).success).toBe(false);
    expect(factsOf([{ ...OAUTH, issuer: '' }]).success).toBe(false);
  });

  it(`takes ${String(VERIFIED_FACTS_MAX)} facts and refuses one more`, () => {
    const hosts = (count: number) => Array.from({ length: count }, (_, index) => ({ checked: 'tlsHost', value: `host-${String(index)}.acme.example` }));

    expect(factsOf(hosts(VERIFIED_FACTS_MAX)).success).toBe(true);
    expect(factsOf(hosts(VERIFIED_FACTS_MAX + 1)).success).toBe(false);
  });

  it('takes the same check twice with different values', () => {
    expect(factsOf([CARD, { ...CARD, value: 'cards.supplier.example' }]).success).toBe(true);
  });

  it('refuses the same fact twice', () => {
    expect(factsOf([OAUTH, { ...OAUTH }]).success).toBe(false);
  });

  it('refuses a ship id that is no ship id', () => {
    expect(setVerifiedFactsInputSchema.safeParse({ shipId: 'lbl_01m5cndw5t282s37hw17k3396p', facts: [] }).success).toBe(false);
  });
});

describe('discoveredVerifiedFactSchema (decision 0059)', () => {
  const AT = '2026-10-20T10:12:00.000Z';

  it.each([
    ['a ship, by id and name', { kind: 'ship', id: SHIP_ID, name: 'gateway' }],
    ['an account, by id only', { kind: 'account', id: 'acc-mathilde' }],
    ['the installation', { kind: 'installation' }],
  ])('answers a fact with its writer, %s, and when it was written', (_writer, by) => {
    const fact = { ...OAUTH, by, at: AT };

    expect(discoveredVerifiedFactSchema.parse(fact)).toEqual(fact);
  });

  it('refuses an account named by more than its id', () => {
    expect(discoveredVerifiedFactSchema.safeParse({ ...CARD, by: { kind: 'account', id: 'acc-mathilde', email: 'mathilde@acme.example' }, at: AT }).success).toBe(false);
  });
});
