import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import {
  commissionShipInputSchema,
  fleetListOutputSchema,
  getStartingPromptInputSchema,
  shipHandleSchema,
  startingPromptOutputSchema,
} from './fleet.js';

const newId = createIdGenerator();

describe('shipHandleSchema', () => {
  it.each(['scout', 'reviewer-2', '42', 'a', '-'])('accepts %j: lowercase letters, digits and hyphens', (handle) => {
    expect(shipHandleSchema.parse(handle)).toBe(handle);
  });

  it('accepts 48 characters', () => {
    expect(shipHandleSchema.safeParse('a'.repeat(48)).success).toBe(true);
  });

  it.each([
    ['49 characters', 'a'.repeat(49)],
    ['an empty handle', ''],
    ['an uppercase letter', 'Scout'],
    ['a space', 'sea scout'],
    ['spaces around it', ' scout '],
    ['an underscore', 'sea_scout'],
    ['a dot', 'sea.scout'],
    ['a letter outside a to z', 'zée'],
  ])('rejects %s', (_label, handle) => {
    expect(shipHandleSchema.safeParse(handle).success).toBe(false);
  });
});

describe('commissionShipInputSchema', () => {
  it('accepts a name, a type and a note', () => {
    const input = { name: 'scout', type: 'reviewer', note: 'reviews pull requests' };

    expect(commissionShipInputSchema.parse(input)).toEqual(input);
  });

  it('takes the note as optional', () => {
    expect(commissionShipInputSchema.parse({ name: 'scout', type: 'reviewer' })).toEqual({
      name: 'scout',
      type: 'reviewer',
    });
  });

  it('drops whitespace around the note', () => {
    expect(commissionShipInputSchema.parse({ name: 'scout', type: 'reviewer', note: ' ahoy \n' })).toMatchObject({
      note: 'ahoy',
    });
  });

  it('accepts a note of 500 characters', () => {
    expect(
      commissionShipInputSchema.safeParse({ name: 'scout', type: 'reviewer', note: 'a'.repeat(500) }).success,
    ).toBe(true);
  });

  it.each([
    ['a note over 500 characters', { name: 'scout', type: 'reviewer', note: 'a'.repeat(501) }],
    ['a missing type', { name: 'scout' }],
    ['a type that is not a handle', { name: 'scout', type: 'Code Reviewer' }],
    ['a name that is not a handle', { name: 'Scout', type: 'reviewer' }],
  ])('rejects %s', (_label, input) => {
    expect(commissionShipInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('getStartingPromptInputSchema', () => {
  it('accepts a ship id', () => {
    const shipId = newId('ship');

    expect(getStartingPromptInputSchema.parse({ shipId })).toEqual({ shipId });
  });

  it('rejects an id of another kind', () => {
    expect(getStartingPromptInputSchema.safeParse({ shipId: newId('fleet') }).success).toBe(false);
  });
});

describe('startingPromptOutputSchema', () => {
  it('accepts the ship id and the prompt', () => {
    const output = { shipId: newId('ship'), prompt: 'Ship secret: aeolus_sk_v1_abc' };

    expect(startingPromptOutputSchema.parse(output)).toEqual(output);
  });

  it('rejects a missing prompt', () => {
    expect(startingPromptOutputSchema.safeParse({ shipId: newId('ship') }).success).toBe(false);
  });
});

describe('fleetListOutputSchema', () => {
  const ship = {
    id: newId('ship'),
    name: 'scout',
    type: 'reviewer',
    status: 'awaitingCrew',
    startingPrompt: { issuedAt: '2026-09-29T12:00:00.000Z', isClaimed: false },
    location: null,
  };

  it('accepts ships with their status and prompt state', () => {
    expect(fleetListOutputSchema.parse([ship])).toEqual([ship]);
  });

  it('accepts a crewed ship with the location its session reported', () => {
    const crewed = {
      ...ship,
      status: 'crewed',
      startingPrompt: { ...ship.startingPrompt, isClaimed: true },
      location: { kind: 'OTHER', description: 'a ci runner' },
    };

    expect(fleetListOutputSchema.parse([crewed])).toEqual([crewed]);
  });

  it('accepts a ship without a prompt out', () => {
    expect(fleetListOutputSchema.safeParse([{ ...ship, startingPrompt: null }]).success).toBe(true);
  });

  it.each([
    ['an unknown status', { ...ship, status: 'sailing' }],
    ['a prompt date that is not ISO 8601', { ...ship, startingPrompt: { issuedAt: 'today', isClaimed: false } }],
    ['a ship id of another kind', { ...ship, id: newId('fleet') }],
    ['a missing location', { ...ship, location: undefined }],
    ['an unknown location kind', { ...ship, location: { kind: 'LAPTOP', description: null } }],
  ])('rejects %s', (_label, listed) => {
    expect(fleetListOutputSchema.safeParse([listed]).success).toBe(false);
  });
});
