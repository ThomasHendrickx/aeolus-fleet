import { createIdGenerator } from '@aeolus-fleet/common';
import { describe, expect, it } from 'vitest';

import { newFleetJourney } from '../shared/fleet-journey.js';
import { createReadInstallationJourneys, type InstallationJourneyReads } from './read-installation-journeys.js';

it('returns twenty compact fleet resources with a stable position and no private crew evidence', async () => {
  // Given twenty-one projected fleet resources at the same source time.
  const ids = createIdGenerator();
  const at = '2026-11-17T00:00:00.000Z';
  const rows = Array.from({ length: 21 }, () => ({ fleetId: ids('fleet'), createdAt: new Date(at), journey: newFleetJourney({ createdAt: at, coverageFrom: at, computedAt: at }) }));
  const reads: InstallationJourneyReads = { find: () => Promise.resolve(undefined), page: () => Promise.resolve(rows), changes: () => Promise.resolve([]) };
  // When the hosting service reads a page.
  const page = await createReadInstallationJourneys({ reads, clock: { now: () => new Date(at) } }).page();
  // Then only the first twenty are returned and the position names the last included resource.
  expect(page.items).toHaveLength(20);
  expect(page.next).toEqual({ fleetId: rows[19]?.fleetId, createdAt: new Date(at) });
  expect(JSON.stringify(page.items)).not.toContain('crewedShipIds');
});

describe('installation journey changes', () => {
  it('keeps an empty change cursor and returns deletion without inventing a summary', async () => {
    // Given a persisted deletion and then no more changed resources.
    const fleetId = createIdGenerator()('fleet');
    const reads: InstallationJourneyReads = { find: () => Promise.resolve(undefined), page: () => Promise.resolve([]), changes: (after) => Promise.resolve(after < 3n ? [{ fleetId, seq: 3n, isDeleted: true, journey: null }] : []) };
    const read = createReadInstallationJourneys({ reads, clock: { now: () => new Date('2026-11-17T00:00:00.000Z') } });
    // When a saved cursor resumes and then resumes again.
    const changed = await read.changes(2n);
    const empty = await read.changes(changed.next);
    // Then both pages are safe to replay and absence never resets the checkpoint.
    expect(changed).toEqual({ items: [{ fleetId, isDeleted: true, journey: null }], next: 3n, hasMore: false });
    expect(empty).toEqual({ items: [], next: 3n, hasMore: false });
  });
});
