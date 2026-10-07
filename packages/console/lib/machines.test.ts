import { createIdGenerator, type CrewStatus, type ListedShip } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { capacityLine, harnessOptions, machineLiveness, silentCount, spotsOf } from './machines';

const newId = createIdGenerator();
const TRIERARCH = { id: newId('ship'), name: 'trierarch-mac' };

function aShip(name: string, crewRequest: ListedShip['crewRequest']): ListedShip {
  return {
    id: newId('ship'), name, type: 'implementer', kind: 'agent', status: 'crewed', startingPrompt: null, location: null, lastSeenAt: null, ping: null,
    scopes: ['messages:send', 'messages:receive'], labels: [], report: null, harness: null, model: null, awaitingCrewSince: null, crewRequest, retiredAt: null,
  };
}

function assigned(status: CrewStatus | null, to = TRIERARCH): ListedShip['crewRequest'] {
  return { settingsVersion: 1, requestedAt: '2026-10-07T09:00:00.000Z', assignedTo: to, status, reason: null, crewedBy: null };
}

describe('silentCount', () => {
  it('counts the silent machines only', () => {
    expect(silentCount([{ isSilent: true }, { isSilent: false }, { isSilent: true }])).toBe(2);
  });
});

describe('machineLiveness', () => {
  it('is alive while its trierarch answers', () => {
    expect(machineLiveness({ status: 'crewed', isSilent: false, lastSeenAt: '2026-10-07T09:00:00.000Z' })).toBe('alive');
  });

  it('is silent once its trierarch stopped answering', () => {
    expect(machineLiveness({ status: 'crewed', isSilent: true, lastSeenAt: '2026-10-07T09:00:00.000Z' })).toBe('silent');
  });

  it('is not started while its trierarch never crewed its ship', () => {
    expect(machineLiveness({ status: 'awaitingCrew', isSilent: true, lastSeenAt: null })).toBe('not-started');
  });
});

describe('spotsOf', () => {
  it('lists the ships assigned to the machine, running first, a request with no status yet as crewing', () => {
    const ships = [
      aShip('scout-1', assigned(null)),
      aShip('docs-writer', assigned('crashed')),
      aShip('builder', assigned('running')),
      aShip('elsewhere', assigned('running', { id: newId('ship'), name: 'trierarch-hetzner' })),
      aShip('plain', null),
    ];

    expect(spotsOf({ shipId: TRIERARCH.id }, ships).map((spot) => [spot.name, spot.status])).toEqual([
      ['builder', 'running'],
      ['docs-writer', 'crashed'],
      ['scout-1', 'crewing'],
    ]);
  });
});

describe('capacityLine', () => {
  const spot = (status: 'running' | 'crashed' | 'crewing') => ({ shipId: newId('ship'), name: 'a', status });

  it('says how many run out of the ships it crews at most, and what else is there', () => {
    expect(capacityLine([spot('running'), spot('running'), spot('crashed')], { ships: 6 })).toBe('2 of 6 running · 1 crashed');
  });

  it('says full when every spot is taken', () => {
    expect(capacityLine([spot('running'), spot('crewing')], { ships: 2 })).toBe('1 of 2 running · 1 crewing · full');
  });

  it('is unknown before the machine reported', () => {
    expect(capacityLine([], undefined)).toBeUndefined();
  });
});

describe('harnessOptions', () => {
  it('reads each option’s values and default from the reported schema', () => {
    const schema = {
      type: 'object',
      properties: { model: { enum: ['claude-opus-5-5', 'claude-sonnet-5'], default: 'claude-opus-5-5' }, effort: { enum: ['low', 'high'] } },
      additionalProperties: false,
    };

    expect(harnessOptions(schema)).toEqual([
      { name: 'model', values: ['claude-opus-5-5', 'claude-sonnet-5'], defaultValue: 'claude-opus-5-5' },
      { name: 'effort', values: ['low', 'high'] },
    ]);
  });

  it('leaves out what is no option of value names', () => {
    expect(harnessOptions({ properties: { odd: { type: 'string' } } })).toEqual([]);
    expect(harnessOptions({})).toEqual([]);
  });
});
