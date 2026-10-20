import { createIdGenerator, type ReachRefusal } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { refusalCauseOf, refusalSentenceOf } from './reach-refusals';

const newId = createIdGenerator();

function aRefusedShip(name: string) {
  return { id: newId('ship'), name, labels: [], owner: null };
}

function aRefusal(overrides: Partial<ReachRefusal> = {}): ReachRefusal {
  return {
    id: newId('reachRefusal'),
    at: '2026-10-10T09:30:00.000Z',
    sender: { kind: 'ship', ...aRefusedShip('scout') },
    askedBy: null,
    recipient: { kind: 'ship', ship: aRefusedShip('vault') },
    verb: 'send',
    settingsVersion: 4,
    ...overrides,
  };
}

describe('a reach refusal in words', () => {
  it('names the ship the sender tried to message', () => {
    expect(refusalSentenceOf(aRefusal())).toBe('scout tried to message vault.');
  });

  it('names the type and each ship of it the sender tried to message', () => {
    const refusal = aRefusal({ recipient: { kind: 'type', type: 'reviewer', ships: [aRefusedShip('reviewer-1'), aRefusedShip('reviewer-2')] } });

    expect(refusalSentenceOf(refusal)).toBe('scout tried to message the type reviewer: reviewer-1 and reviewer-2.');
  });

  it('names the settings version that refused it', () => {
    expect(refusalCauseOf(aRefusal())).toBe('Refused by network settings version 4.');
  });
});
