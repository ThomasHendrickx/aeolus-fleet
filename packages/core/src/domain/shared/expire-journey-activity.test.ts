import { createIdGenerator } from '@aeolus-fleet/common';
import { expect, it } from 'vitest';

import { createExpireJourneyActivity, type JourneyActivityExpiry } from './expire-journey-activity.js';
import { newFleetJourney } from './fleet-journey.js';

it('purges activity older than ninety UTC dates even when a fleet is quiet, preserving achievements', async () => {
  // Given a quiet fleet with retained achievements and activity on both sides of the cutoff.
  const at = '2026-11-17T12:00:00.000Z';
  const fleetId = createIdGenerator()('fleet');
  let journey = { ...newFleetJourney({ createdAt: at, coverageFrom: at, computedAt: at }), activityDates: ['2026-11-17', '2026-11-18'] };
  const achievements = journey.milestones;
  const expiry: JourneyActivityExpiry = {
    expired: () => Promise.resolve([{ fleetId, journey }]),
    save: (_id, state) => { journey = state; return Promise.resolve(); },
  };
  // When maintenance runs on the ninetieth UTC date after the first activity.
  await createExpireJourneyActivity({ clock: { now: () => new Date('2027-02-15T00:00:00.000Z') }, uow: { run: (work) => work({ journeyActivity: expiry }) } })();
  // Then expired daily facts are removed from storage, without changing one-time achievements.
  expect(journey.activityDates).toEqual(['2026-11-18']);
  expect(journey.milestones).toEqual(achievements);
});
