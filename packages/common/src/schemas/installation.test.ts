import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import {
  installationFleetSchema,
  installationFleetsCreateInputSchema,
  installationFleetsCreateOutputSchema,
  installationFleetsDeleteInputSchema,
  installationFleetsGetInputSchema,
} from './installation.js';

const newId = createIdGenerator();

describe('installationFleetsCreateInputSchema', () => {
  it('takes a request id, a fleet name and the operator email, dropping whitespace around the email', () => {
    expect(installationFleetsCreateInputSchema.parse({ requestId: 'signup-42', name: 'hemma', operatorEmail: ' thomas@example.com ' })).toEqual({
      requestId: 'signup-42',
      name: 'hemma',
      operatorEmail: 'thomas@example.com',
    });
  });

  it.each([
    ['a missing request id', { name: 'hemma', operatorEmail: 'thomas@example.com' }],
    ['an empty request id', { requestId: '', name: 'hemma', operatorEmail: 'thomas@example.com' }],
    ['a request id over 256 characters', { requestId: 'r'.repeat(257), name: 'hemma', operatorEmail: 'thomas@example.com' }],
    ['a missing email', { requestId: 'signup-42', name: 'hemma' }],
    ['an email over 254 characters', { requestId: 'signup-42', name: 'hemma', operatorEmail: `${'a'.repeat(243)}@example.com` }],
    ['a password: hosted operators have none', { requestId: 'signup-42', name: 'hemma', operatorEmail: 'thomas@example.com', password: 'secret' }],
  ])('refuses %s', (_case, input) => {
    expect(installationFleetsCreateInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('installationFleetsCreateOutputSchema', () => {
  it("answers the new fleet's id and its argo's id", () => {
    const answer = { fleetId: newId('fleet'), operatorShipId: newId('ship') };

    expect(installationFleetsCreateOutputSchema.parse(answer)).toEqual(answer);
  });
});

describe('installationFleetSchema', () => {
  const fleet = {
    fleetId: newId('fleet'),
    name: 'hemma',
    operatorEmail: 'thomas@example.com',
    createdAt: '2026-10-04T12:00:00.000Z',
    shipCount: 3,
    messagesLast7Days: 12,
    lastActivityAt: '2026-10-04T12:30:00.000Z',
  };

  it('describes a fleet: id, name, operator email, created, ships not retired, messages of the last 7 days and last activity', () => {
    expect(installationFleetSchema.parse(fleet)).toEqual(fleet);
  });

  it('takes a fleet with no activity yet', () => {
    expect(installationFleetSchema.parse({ ...fleet, lastActivityAt: null })).toMatchObject({ lastActivityAt: null });
  });

  it.each([
    ['a negative ship count', { ...fleet, shipCount: -1 }],
    ['a fractional message count', { ...fleet, messagesLast7Days: 1.5 }],
  ])('refuses %s', (_case, input) => {
    expect(installationFleetSchema.safeParse(input).success).toBe(false);
  });
});

describe('installationFleetsGetInputSchema and installationFleetsDeleteInputSchema', () => {
  it('get takes a fleet id', () => {
    const fleetId = newId('fleet');

    expect(installationFleetsGetInputSchema.parse({ fleetId })).toEqual({ fleetId });
  });

  it('delete takes a request id and a fleet id', () => {
    const input = { requestId: 'delete-7', fleetId: newId('fleet') };

    expect(installationFleetsDeleteInputSchema.parse(input)).toEqual(input);
  });

  it.each([
    ['a ship id for a fleet id', { requestId: 'delete-7', fleetId: newId('ship') }],
    ['a missing request id', { fleetId: newId('fleet') }],
  ])('delete refuses %s', (_case, input) => {
    expect(installationFleetsDeleteInputSchema.safeParse(input).success).toBe(false);
  });
});
