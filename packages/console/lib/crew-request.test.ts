import { createIdGenerator, type Party, type ShipDetail, type TimelineEntry } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { crewRequestAction, crewRequestStage, isRestartable, releaseSteps, requestedBy, restartWords, statusChangedAt, type CrewRequestStage } from './crew-request';

type CrewRequest = NonNullable<ShipDetail['crewRequest']>;

const newId = createIdGenerator();
const ARGO: Party = { id: newId('ship'), name: 'argo' };
const TRIERARCH: Party = { id: newId('ship'), name: 'trierarch-mac' };
const REQUESTED_AT = '2026-10-07T10:20:00.000Z';
const CREWED_SINCE = '2026-10-07T10:42:00.000Z';

function aRequest(overrides: Partial<CrewRequest> = {}): CrewRequest {
  return { settings: {}, settingsVersion: 1, requestedAt: REQUESTED_AT, assignedTo: null, status: null, reason: null, crewedBy: null, attempt: 0, startedAt: null, ...overrides };
}

function anEvent(entry: Pick<TimelineEntry, 'type' | 'occurredAt' | 'actor'>): TimelineEntry {
  return { seq: 1, id: newId('event'), ship: null, message: null, details: {}, ...entry };
}

describe('crewRequestStage', () => {
  it('is none without a crew request', () => {
    expect(crewRequestStage({ crewRequest: null, crewedSince: null })).toEqual({ kind: 'none' });
  });

  it('needs crew while unassigned and not crewed, with the trierarch plugin’s reason', () => {
    expect(crewRequestStage({ crewRequest: aRequest({ reason: 'no trierarch has room' }), crewedSince: null })).toEqual({
      kind: 'needsCrew',
      requestedAt: REQUESTED_AT,
      reason: 'no trierarch has room',
    });
  });

  it('is crewed by hand while unassigned and a crew is aboard', () => {
    expect(crewRequestStage({ crewRequest: aRequest({ crewedBy: ARGO, attempt: 0, startedAt: null }), crewedSince: CREWED_SINCE })).toEqual({
      kind: 'crewedByHand',
      requestedAt: REQUESTED_AT,
      crewedBy: ARGO,
      since: CREWED_SINCE,
    });
  });

  it('is assigned with the status its trierarch wrote', () => {
    expect(crewRequestStage({ crewRequest: aRequest({ assignedTo: TRIERARCH, status: 'running', crewedBy: TRIERARCH, attempt: 0, startedAt: null }), crewedSince: CREWED_SINCE })).toEqual({
      kind: 'assigned',
      requestedAt: REQUESTED_AT,
      trierarch: TRIERARCH,
      status: 'running',
      attempt: 0,
      startedAt: null,
    });
  });

  it('carries the restart attempt and when the session started', () => {
    expect(
      crewRequestStage({ crewRequest: aRequest({ assignedTo: TRIERARCH, status: 'running', crewedBy: TRIERARCH, attempt: 2, startedAt: CREWED_SINCE }), crewedSince: CREWED_SINCE }),
    ).toMatchObject({ kind: 'assigned', attempt: 2, startedAt: CREWED_SINCE });
  });

  it('is crewing once assigned, before the crew writes a status', () => {
    expect(crewRequestStage({ crewRequest: aRequest({ assignedTo: TRIERARCH }), crewedSince: null })).toMatchObject({ kind: 'assigned', status: 'crewing' });
  });
});

describe('crewRequestAction', () => {
  const assigned = (status: 'crewing' | 'running' | 'crashed' | 'releasing'): CrewRequestStage => ({ kind: 'assigned', requestedAt: REQUESTED_AT, trierarch: TRIERARCH, status, attempt: 0, startedAt: null });

  it('offers Remove request while no crew is on it', () => {
    expect(crewRequestAction({ kind: 'needsCrew', requestedAt: REQUESTED_AT, reason: null })).toBe('remove');
  });

  it('offers Release once a crew is aboard by hand', () => {
    expect(crewRequestAction({ kind: 'crewedByHand', requestedAt: REQUESTED_AT, crewedBy: ARGO, since: CREWED_SINCE })).toBe('release');
  });

  it('offers Release once a trierarch crews it', () => {
    expect(crewRequestAction(assigned('crewing'))).toBe('release');
    expect(crewRequestAction(assigned('running'))).toBe('release');
  });

  it('offers nothing while it releases, nor without a request', () => {
    expect(crewRequestAction(assigned('releasing'))).toBeUndefined();
    expect(crewRequestAction({ kind: 'none' })).toBeUndefined();
  });

  it('offers Restart only on a crashed request', () => {
    expect(isRestartable(assigned('crashed'))).toBe(true);
    expect(isRestartable(assigned('running'))).toBe(false);
    expect(isRestartable({ kind: 'needsCrew', requestedAt: REQUESTED_AT, reason: null })).toBe(false);
  });
});

describe('releaseSteps', () => {
  it('releases the lease after removing the request of a ship crewed by hand: its crew stays aboard otherwise', () => {
    expect(releaseSteps({ kind: 'crewedByHand', requestedAt: REQUESTED_AT, crewedBy: ARGO, since: CREWED_SINCE })).toEqual(['removeCrewRequest', 'release']);
  });

  it('only removes an assigned request: its trierarch releases the ship', () => {
    expect(releaseSteps({ kind: 'assigned', requestedAt: REQUESTED_AT, trierarch: TRIERARCH, status: 'running', attempt: 0, startedAt: null })).toEqual(['removeCrewRequest']);
  });
});

describe('requestedBy', () => {
  it('is the actor of the latest CrewRequested event', () => {
    const timeline = [
      anEvent({ type: 'CrewAssigned', occurredAt: '2026-10-07T10:22:00.000Z', actor: TRIERARCH }),
      anEvent({ type: 'CrewRequested', occurredAt: '2026-10-07T10:21:00.000Z', actor: ARGO }),
      anEvent({ type: 'CrewRequested', occurredAt: '2026-10-07T10:20:00.000Z', actor: TRIERARCH }),
    ];
    expect(requestedBy(timeline)).toEqual(ARGO);
  });

  it('is null when the timeline holds no request', () => {
    expect(requestedBy([])).toBeNull();
  });
});

describe('statusChangedAt', () => {
  it('is when the crew status last changed', () => {
    const timeline = [
      anEvent({ type: 'CrewStatusChanged', occurredAt: '2026-10-07T13:28:00.000Z', actor: TRIERARCH }),
      anEvent({ type: 'CrewStatusChanged', occurredAt: '2026-10-07T13:02:00.000Z', actor: TRIERARCH }),
    ];
    expect(statusChangedAt(timeline)).toBe('2026-10-07T13:28:00.000Z');
  });
});

describe('restartWords', () => {
  it('names the attempt while restarting', () => {
    expect(restartWords({ status: 'restarting', attempt: 2 })).toBe('attempt 2');
  });

  it('counts the restarts once crashed', () => {
    expect(restartWords({ status: 'crashed', attempt: 3 })).toBe('3 restarts');
  });

  it('counts one restart in the singular while running', () => {
    expect(restartWords({ status: 'running', attempt: 1 })).toBe('1 restart');
  });

  it('says nothing on a first start', () => {
    expect(restartWords({ status: 'running', attempt: 0 })).toBeUndefined();
  });

  it('says nothing while crewing or releasing', () => {
    expect([restartWords({ status: 'crewing', attempt: 1 }), restartWords({ status: 'releasing', attempt: 1 })]).toEqual([undefined, undefined]);
  });
});
