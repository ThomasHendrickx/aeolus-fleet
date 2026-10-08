import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createPrismaClient, type PrismaClient } from '../src/adapters/prisma/client.js';
import { createPrismaFormationAttempts } from '../src/adapters/prisma/formation-attempts.js';
import { createPrismaSquadronRepository } from '../src/adapters/prisma/squadron-repository.js';
import { beginFormation } from '../src/core/squadron/formation.js';
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
      { name: 'planner', template: { repository: REPO, name: 'planner', version: 1 }, count: 1, model: null, crew: {}, parameters: {} },
      { name: 'tester', template: { repository: REPO, name: 'tester', version: 1 }, count: 1, model: null, crew: {}, parameters: {} },
    ],
    handoffs: [],
    memberNames: 'plain',
    file: 'squadrons/blueprints/team.yaml',
  },
  templates: [],
  flagship: { shipId: 'shp_01m3tbfspe96yf1rnr4ank0000', name: 'team-a1b2c3', crewToken: 'aeolus_ct_v1_flagship' },
  members: [
    { shipId: PLANNER, name: 'planner-k3x9', role: 'planner', type: 'team-a1b2c3:planner', onStationAt: null, checkIn: null, standDownMessageId: null, stoodDownAt: null, retiredAt: null },
    { shipId: TESTER, name: 'tester-m4p7', role: 'tester', type: 'team-a1b2c3:tester', onStationAt: null, checkIn: null, standDownMessageId: null, stoodDownAt: null, retiredAt: null },
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

  it("writes each member's stand-down message, when it stood down and when it retired", async () => {
    const squadrons = createPrismaSquadronRepository(prisma, clock);
    const [snapshot] = await squadrons.list(FLEET);
    if (!snapshot) {
      expect.fail('the squadron was not stored');
    }

    await squadrons.update({
      before: snapshot,
      after: {
        ...snapshot,
        state: 'standing-down',
        members: snapshot.members.map((member) =>
          member.shipId === PLANNER ? { ...member, standDownMessageId: 'msg_01m3tbfspe96yf1rnr4ank0100', stoodDownAt: LATER, retiredAt: LATER } : { ...member, standDownMessageId: 'msg_01m3tbfspe96yf1rnr4ank0101' },
        ),
      },
    });

    const [stored] = await squadrons.list(FLEET);
    expect(stored?.state).toBe('standing-down');
    expect(stored?.members.map(({ standDownMessageId, stoodDownAt, retiredAt }) => ({ standDownMessageId, stoodDownAt, retiredAt }))).toEqual([
      { standDownMessageId: 'msg_01m3tbfspe96yf1rnr4ank0100', stoodDownAt: LATER, retiredAt: LATER },
      { standDownMessageId: 'msg_01m3tbfspe96yf1rnr4ank0101', stoodDownAt: null, retiredAt: null },
    ]);
  });
});

describe('adding a member', () => {
  it('stores the new member and finishes its formation attempt together', async () => {
    const squadrons = createPrismaSquadronRepository(prisma, clock);
    const attempts = createPrismaFormationAttempts(prisma, clock);
    await attempts.begin({ id: 'team-a1b2c3@2', fleetId: FLEET, squadronId: formed.id, startedAt: LATER });
    const [snapshot] = await squadrons.list(FLEET);
    if (!snapshot) {
      expect.fail('the squadron was not stored');
    }
    const added = { shipId: 'shp_01m3tbfspe96yf1rnr4ank0003', name: 'tester-q8r2', role: 'tester', type: 'team-a1b2c3:tester', onStationAt: null, checkIn: null, standDownMessageId: null, stoodDownAt: null, retiredAt: null } as const;

    await squadrons.update({ before: snapshot, after: { ...snapshot, members: [...snapshot.members, added] }, finishesAttempt: 'team-a1b2c3@2' });

    const [stored] = await squadrons.list(FLEET);
    expect(stored?.members.map((member) => member.name)).toEqual(['planner-k3x9', 'tester-m4p7', 'tester-q8r2']);
    await expect(attempts.unfinished(FLEET)).resolves.toEqual([]);
  });
});

describe('formation attempts begun in the same instant', () => {
  it('get ids of their own, so adding a member in the instant its squadron formed is no clash', async () => {
    const attempts = createPrismaFormationAttempts(prisma, clock);
    let drawn = 0;
    const deps = {
      door: { register: unused, whoami: unused, commission: unused, getShip: unused, release: unused, deregister: unused, getStartingPrompt: unused, listShips: unused, requestCrew: unused, removeCrewRequest: unused, findLabelValue: unused, retire: unused, receive: unused, ack: unused, send: unused },
      attempts,
      random: {
        suffix: (length: number) => {
          drawn += 1;
          return String(drawn).padStart(length, '0');
        },
      },
      clock,
    };
    const crew = { fleetId: FLEET, shipId: 'shp_01m3tbfspe96yf1rnr4ank9h1a', name: 'squadrons', crewToken: 'aeolus_ct_v1_management', crewedAt: AT } as const;

    const forming = await beginFormation(deps, { crew, squadronId: 'team-b2c3d4' });
    const adding = await beginFormation(deps, { crew, squadronId: 'team-b2c3d4' });

    expect(adding.attemptId).not.toBe(forming.attemptId);
    await expect(attempts.unfinished(FLEET)).resolves.toHaveLength(2);
  });
});

function unused(): never {
  throw new Error('not used: an attempt begins without the fleet');
}

describe('a squadron formed before versions kept their file', () => {
  it('is read with no file for its blueprint', async () => {
    await prisma.$executeRaw`UPDATE squadrons SET blueprint = blueprint - 'file'`;

    const [stored] = await createPrismaSquadronRepository(prisma, clock).list(FLEET);

    expect(stored?.blueprint.file).toBe('');
  });
});
