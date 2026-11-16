import { createIdGenerator } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { createRecordFleetJourney, type JourneyRecords } from './record-fleet-journey.js';
import type { FleetJourney } from './fleet-journey.js';

const ids = createIdGenerator();
const fleetId = ids('fleet');
const first = ids('ship');
const second = ids('ship');
const at = '2026-11-17T12:00:00.000Z';

function aJourneyRecorder() {
  let state: FleetJourney | undefined;
  const records: JourneyRecords = {
    read: () => Promise.resolve(state),
    save: (_fleetId, journey) => { state = journey; return Promise.resolve(); },
  };
  const record = createRecordFleetJourney({ records });
  return { record, read: () => state };
}

describe('fleet journey source facts', () => {
  it('derives First value from a linked reply between two crewed customer ships without payloads', async () => {
    // Given two distinct customer ships which acquired actual leases.
    const { record, read } = aJourneyRecorder();
    await record({ fleetId, createdAt: at, coverageFrom: at, computedAt: at, processedThrough: 1, facts: [
      { kind: 'crewed', at, shipId: first, shipKind: 'agent' },
      { kind: 'crewed', at, shipId: second, shipKind: 'app' },
    ] });

    // When their accepted messages include a linked reply, qualified at both sends.
    await record({ fleetId, createdAt: at, coverageFrom: at, computedAt: at, processedThrough: 2, facts: [
      { kind: 'message', at, isQualifying: true, isRoundTrip: false },
      { kind: 'message', at, isQualifying: true, isRoundTrip: true },
    ] });

    // Then First value remains named and versioned, with source times and coverage.
    expect(read()?.milestones).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: 'two-ships-crewed', state: 'reached', occurredAt: at }),
      expect.objectContaining({ key: 'first-value', label: 'First value', definitionVersion: 'round-trip-v1', state: 'reached', occurredAt: at, coverageFrom: at, computedAt: at }),
    ]));
  });

  it('excludes infrastructure, self messages and acknowledgements from achievements', async () => {
    // Given only infrastructure crews and excluded traffic.
    const { record, read } = aJourneyRecorder();
    // When those committed facts are projected.
    await record({ fleetId, createdAt: at, coverageFrom: at, computedAt: at, processedThrough: 4, facts: [
      { kind: 'crewed', at, shipId: first, shipKind: 'trierarch' },
      { kind: 'crewed', at, shipId: second, shipKind: 'plugin' },
      { kind: 'message', at, isQualifying: false, isRoundTrip: false },
    ] });
    // Then complete coverage can say not-yet, and fleet ready is independent.
    expect(read()?.milestones.filter((fact) => fact.key !== 'fleet-ready').every((fact) => fact.state === 'not-yet')).toBe(true);
    expect(read()?.milestones[0]).toMatchObject({ key: 'fleet-ready', state: 'reached', occurredAt: at });
  });

  it('preserves late occurrence times, unknown history and achievements on replay', async () => {
    // Given incomplete history for an existing fleet.
    const { record, read } = aJourneyRecorder();
    const later = '2026-11-20T12:00:00.000Z';
    await record({ fleetId, createdAt: '2026-10-01T00:00:00.000Z', coverageFrom: at, computedAt: later, processedThrough: 5, facts: [] });
    expect(read()?.milestones.find((fact) => fact.key === 'first-value')?.state).toBe('unknown');
    // When sufficient evidence is discovered three days late, then replayed after retention.
    const input = { fleetId, createdAt: '2026-10-01T00:00:00.000Z', coverageFrom: at, computedAt: later, processedThrough: 6, facts: [{ kind: 'message' as const, at, isQualifying: true, isRoundTrip: true }] };
    await record(input);
    await record({ ...input, processedThrough: 7, facts: [] });
    // Then source dates survive and missing earlier milestones never block value.
    expect(read()?.milestones.find((fact) => fact.key === 'first-value')).toMatchObject({ state: 'reached', occurredAt: at, computedAt: later });
    expect(read()?.milestones.find((fact) => fact.key === 'first-ship-crewed')?.state).toBe('unknown');
  });

  it('records repeat value only on a later UTC date within seven days and bounds activity', async () => {
    // Given first value near midnight UTC.
    const { record, read } = aJourneyRecorder();
    await record({ fleetId, createdAt: at, coverageFrom: at, computedAt: at, processedThrough: 1, facts: [{ kind: 'message', at, isQualifying: true, isRoundTrip: true }] });
    // When another interaction occurs on the next UTC date and later activity continues.
    const next = '2026-11-18T00:00:00.000Z';
    await record({ fleetId, createdAt: at, coverageFrom: at, computedAt: next, processedThrough: 2, facts: [{ kind: 'message', at: next, isQualifying: true, isRoundTrip: true }] });
    const future = '2027-03-01T12:00:00.000Z';
    await record({ fleetId, createdAt: at, coverageFrom: at, computedAt: future, processedThrough: 3, facts: [{ kind: 'message', at: future, isQualifying: true, isRoundTrip: false }] });
    // Then the one-time achievement survives while activity dates are bounded to 90 days.
    expect(read()?.milestones.find((fact) => fact.key === 'repeat-value')).toMatchObject({ state: 'reached', occurredAt: next });
    expect(read()?.activityDates).toEqual(['2027-03-01']);
  });
});
