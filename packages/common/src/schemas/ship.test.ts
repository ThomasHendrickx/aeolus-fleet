import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import { locationSchema, registerInputSchema, registerOutputSchema, whoamiOutputSchema } from './ship.js';

const newId = createIdGenerator();

describe('locationSchema', () => {
  it.each(['DEVICE', 'CLOUD', 'SERVER'])('accepts %s without a description', (kind) => {
    expect(locationSchema.parse({ kind })).toEqual({ kind });
  });

  it('accepts OTHER with a description, without the whitespace around it', () => {
    expect(locationSchema.parse({ kind: 'OTHER', description: ' a ci runner \n' })).toEqual({
      kind: 'OTHER',
      description: 'a ci runner',
    });
  });

  it('accepts a description of 100 characters', () => {
    expect(locationSchema.safeParse({ kind: 'OTHER', description: 'a'.repeat(100) }).success).toBe(true);
  });

  it.each([
    ['OTHER without a description', { kind: 'OTHER' }],
    ['OTHER with an empty description', { kind: 'OTHER', description: '   ' }],
    ['a description over 100 characters', { kind: 'OTHER', description: 'a'.repeat(101) }],
    ['a description on DEVICE', { kind: 'DEVICE', description: 'my laptop' }],
    ['an unknown kind', { kind: 'LAPTOP' }],
    ['a kind in lowercase', { kind: 'device' }],
  ])('rejects %s', (_label, location) => {
    expect(locationSchema.safeParse(location).success).toBe(false);
  });
});

describe('registerInputSchema', () => {
  const input = { shipId: newId('ship'), secret: 'aeolus_sk_v1_abc', location: { kind: 'CLOUD' } };

  it('accepts a ship id, its secret and a location', () => {
    expect(registerInputSchema.parse(input)).toEqual(input);
  });

  it.each([
    ['an id of another kind', { ...input, shipId: newId('fleet') }],
    ['an empty secret', { ...input, secret: '' }],
    ['a secret over 256 characters', { ...input, secret: 'a'.repeat(257) }],
    ['a missing location', { shipId: input.shipId, secret: input.secret }],
  ])('rejects %s', (_label, candidate) => {
    expect(registerInputSchema.safeParse(candidate).success).toBe(false);
  });
});

describe('registerOutputSchema', () => {
  it('accepts the crew token', () => {
    expect(registerOutputSchema.parse({ crewToken: 'aeolus_ct_v1_abc' })).toEqual({ crewToken: 'aeolus_ct_v1_abc' });
  });
});

describe('whoamiOutputSchema', () => {
  const output = { shipId: newId('ship'), fleetId: newId('fleet'), name: 'scout', type: 'reviewer' };

  it("accepts the ship's id, fleet, name and type", () => {
    expect(whoamiOutputSchema.parse(output)).toEqual(output);
  });

  it('rejects a fleet id of another kind', () => {
    expect(whoamiOutputSchema.safeParse({ ...output, fleetId: newId('ship') }).success).toBe(false);
  });
});
