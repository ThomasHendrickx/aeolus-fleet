import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFormationAttempts } from '../src/adapters/prisma/formation-attempts.js';
import { createPrismaSquadronRepository } from '../src/adapters/prisma/squadron-repository.js';
import type { Squadron } from '../src/core/squadron/squadron.js';
import { createSquadronsDatabase } from './support/database.js';

// Storing squadrons in Postgres: an update writes only what changed, so two
// updates made from one snapshot, each to another member, keep both.

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const PLANNER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0001';
const TESTER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0002';
const AT = new Date('2026-10-03T09:00:00.000Z');
const LATER = new Date('2026-10-03T09:10:00.000Z');
const REPO = 'example.com/templates';
const clock = { now: () => AT };

let prisma: PrismaClient;

const formed: Squadron = {
  id: 'team-a1b2c3',
  fleetId: FLEET,
  state: 'forming',
  blueprint: {
    repository: REPO,
    name: 'team',
    version: 1,
    commit: 'b1',
    committedAt: AT,
    description: 'A team.',
    roles: [
      { name: 'planner', template: { repository: REPO, name: 'planner', version: 1 }, count: 1 },
      { name: 'tester', template: { repository: REPO, name: 'tester', version: 1 }, count: 1 },
    ],
    handoffs: [],
    memberNames: 'plain',
  },
  templates: [],
  flagship: { shipId: 'shp_01m3tbfspe96yf1rnr4ank0000', name: 'team-a1b2c3', crewToken: 'aeolus_ct_v1_flagship' },
  members: [
    { shipId: PLANNER, name: 'planner-k3x9', role: 'planner', type: 'team-a1b2c3:planner', onStationAt: null, checkIn: null },
    { shipId: TESTER, name: 'tester-m4p7', role: 'tester', type: 'team-a1b2c3:tester', onStationAt: null, checkIn: null },
  ],
  formedAt: AT,
  sailedAt: null,
};

beforeEach(async () => {
  prisma = createPrismaClient(await createSquadronsDatabase());
  const attempts = createPrismaFormationAttempts(prisma, clock);
  await attempts.begin({ id: 'team-a1b2c3@1', fleetId: FLEET, squadronId: formed.id, startedAt: AT });
  await createPrismaSquadronRepository(prisma, clock).create(formed, 'team-a1b2c3@1');
});

afterEach(async () => {
  await prisma.$disconnect();
});

describe('updating a squadron', () => {
  it('writes only what changed, so two updates from one snapshot to different members keep both', async () => {
    const squadrons = createPrismaSquadronRepository(prisma, clock);
    const [snapshot] = await squadrons.list(FLEET);
    if (!snapshot) {
      expect.fail('the squadron was not stored');
    }

    await squadrons.update({
      before: snapshot,
      after: { ...snapshot, members: snapshot.members.map((member) => (member.shipId === PLANNER ? { ...member, onStationAt: LATER } : member)) },
    });
    await squadrons.update({
      before: snapshot,
      after: { ...snapshot, members: snapshot.members.map((member) => (member.shipId === TESTER ? { ...member, checkIn: { at: LATER, model: 'claude-opus-5-5' } } : member)) },
    });

    const [stored] = await squadrons.list(FLEET);
    expect(stored?.members.map(({ onStationAt, checkIn }) => ({ onStationAt, checkIn }))).toEqual([
      { onStationAt: LATER, checkIn: null },
      { onStationAt: null, checkIn: { at: LATER, model: 'claude-opus-5-5' } },
    ]);
  });

  it('writes the squadron state and members it changes', async () => {
    const squadrons = createPrismaSquadronRepository(prisma, clock);
    const [snapshot] = await squadrons.list(FLEET);
    if (!snapshot) {
      expect.fail('the squadron was not stored');
    }

    await squadrons.update({
      before: snapshot,
      after: { ...snapshot, state: 'sailing', sailedAt: LATER, members: snapshot.members.map((member) => ({ ...member, onStationAt: LATER })) },
    });

    const [stored] = await squadrons.list(FLEET);
    expect(stored).toMatchObject({ state: 'sailing', sailedAt: LATER });
    expect(stored?.members.map((member) => member.onStationAt)).toEqual([LATER, LATER]);
  });
});
