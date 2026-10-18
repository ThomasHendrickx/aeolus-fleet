import { createIdGenerator, type ReachRefusal } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { refusalCauseOf, refusalSentenceOf } from './reach-refusals';

const newId = createIdGenerator();

function aRefusedShip(name: string): ReachRefusal['sender'] {
  return { id: newId('ship'), name, labels: [] };
}

function aRefusal(overrides: Partial<ReachRefusal> = {}): ReachRefusal {
  return {
    id: newId('reachRefusal'),
    at: '2026-10-10T09:30:00.000Z',
    sender: aRefusedShip('scout'),
    recipient: { kind: 'ship', ship: aRefusedShip('vault') },
    settingsVersion: 4,
    whilePluginUnavailable: null,
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

  it('says the networking plugin was not responding, and what it declared for that', () => {
    expect(refusalCauseOf(aRefusal({ whilePluginUnavailable: 'block-all' }))).toBe(
      'Refused by network settings version 4 while the networking plugin was not responding: Block all.',
    );
  });

  it('says the latest rules were kept while the networking plugin was not responding', () => {
    expect(refusalCauseOf(aRefusal({ whilePluginUnavailable: 'keep-latest' }))).toBe(
      'Refused by network settings version 4 while the networking plugin was not responding: Keep the latest rules.',
    );
  });
});
