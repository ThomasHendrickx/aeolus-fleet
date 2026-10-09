import { createIdGenerator, type CrewStatus, type ListedShip } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { crewRequestCell, handCrewOf, isNeedingCrew, needsCrew } from './needs-crew';

const newId = createIdGenerator();
const TRIERARCH = { id: newId('ship'), name: 'trierarch-mac' };
const ARGO = { id: newId('ship'), name: 'argo' };

function aShip(overrides: Partial<ListedShip> = {}): ListedShip {
  return {
    id: newId('ship'), name: 'scout', type: 'implementer', kind: 'agent', status: 'awaitingCrew', startingPrompt: null, location: null, lastSeenAt: null, ping: null,
    scopes: ['messages:send', 'messages:receive'], report: null, harness: null, model: null, awaitingCrewSince: null, crewRequest: null, labels: [], retiredAt: null, ...overrides,
  };
}

function aRequest(overrides: Partial<NonNullable<ListedShip['crewRequest']>> = {}): ListedShip['crewRequest'] {
  return { settingsVersion: 1, requestedAt: '2026-10-07T10:20:00.000Z', assignedTo: null, status: null, reason: null, crewedBy: null, attempt: 0, startedAt: null, givenBack: [], ...overrides };
}

const assigned = (status: CrewStatus) => aShip({ status: 'crewed', crewRequest: aRequest({ assignedTo: TRIERARCH, status, crewedBy: TRIERARCH, attempt: 0, startedAt: null }) });

describe('Needs crew without the trierarch plugin', () => {
  const plugin = { hasTrierarchs: false };

  it('lists a ship with a request that awaits crew', () => {
    expect(isNeedingCrew(aShip({ crewRequest: aRequest() }), plugin)).toBe(true);
  });

  it('leaves out a ship crewed by hand, one without a request, and a retired one', () => {
    expect(isNeedingCrew(aShip({ status: 'crewed', crewRequest: aRequest({ crewedBy: ARGO, attempt: 0, startedAt: null }) }), plugin)).toBe(false);
    expect(isNeedingCrew(aShip(), plugin)).toBe(false);
    expect(isNeedingCrew(aShip({ status: 'retired', crewRequest: aRequest() }), plugin)).toBe(false);
  });
});

describe('Needs crew with the trierarch plugin', () => {
  const plugin = { hasTrierarchs: true };

  it('lists requests that are not running: waiting for a trierarch, crewing, restarting, crashed', () => {
    expect(isNeedingCrew(aShip({ crewRequest: aRequest({ reason: 'no trierarch has room' }) }), plugin)).toBe(true);
    expect((['crewing', 'restarting', 'crashed'] as const).map((status) => isNeedingCrew(assigned(status), plugin))).toEqual([true, true, true]);
  });

  it('leaves out a running crew, a request being released, and a ship crewed by hand', () => {
    expect(isNeedingCrew(assigned('running'), plugin)).toBe(false);
    expect(isNeedingCrew(assigned('releasing'), plugin)).toBe(false);
    expect(isNeedingCrew(aShip({ status: 'crewed', crewRequest: aRequest({ crewedBy: ARGO, attempt: 0, startedAt: null }) }), plugin)).toBe(false);
  });

  it('lists the oldest request first', () => {
    const later = aShip({ name: 'later', crewRequest: aRequest({ requestedAt: '2026-10-07T12:00:00.000Z' }) });
    const earlier = aShip({ name: 'earlier', crewRequest: aRequest({ requestedAt: '2026-10-06T12:00:00.000Z' }) });

    expect(needsCrew([later, earlier], plugin).map((ship) => ship.name)).toEqual(['earlier', 'later']);
  });
});

describe('handCrewOf', () => {
  it('says whether a prompt was issued, taken by no session, or a hand crew ended', () => {
    expect(handCrewOf({ startingPrompt: null, awaitingCrewSince: null })).toEqual({ kind: 'no-prompt' });
    expect(handCrewOf({ startingPrompt: { issuedAt: '2026-10-07T13:20:00.000Z', isClaimed: false }, awaitingCrewSince: null })).toEqual({ kind: 'prompt-unclaimed', issuedAt: '2026-10-07T13:20:00.000Z' });
    expect(handCrewOf({ startingPrompt: { issuedAt: '2026-10-06T13:20:00.000Z', isClaimed: true }, awaitingCrewSince: '2026-10-07T08:15:00.000Z' })).toEqual({ kind: 'crew-ended', endedAt: '2026-10-07T08:15:00.000Z' });
  });
});

describe('crewRequestCell', () => {
  it('words each stage with its tone, and nothing without a request', () => {
    expect(crewRequestCell({ kind: 'none' })).toBeUndefined();
    expect(crewRequestCell({ kind: 'needsCrew', requestedAt: '', reason: null })).toEqual({ tone: 'waiting', word: 'Needs crew' });
    expect(crewRequestCell({ kind: 'assigned', requestedAt: '', trierarch: TRIERARCH, status: 'crashed', attempt: 0, startedAt: null })).toEqual({ tone: 'attention', word: 'Crashed' });
  });
});
