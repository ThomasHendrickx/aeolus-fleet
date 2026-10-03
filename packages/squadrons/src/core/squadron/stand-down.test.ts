import type { FleetId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import type { SquadronRepository } from './ports.js';
import { createStandDown } from './stand-down.js';
import type { Squadron, SquadronState } from './squadron.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const OTHER_FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';
const FORMED = new Date('2026-10-03T09:00:00.000Z');
const REPO = 'example.com/templates';

function aSquadron(state: SquadronState): Squadron {
  return {
    id: 'team-a1b2c3',
    fleetId: FLEET,
    state,
    blueprint: { repository: REPO, name: 'team', version: 1, file: 'squadrons/fixture.yaml', commit: 'b1', committedAt: FORMED, description: 'A team.', roles: [], handoffs: [], memberNames: 'plain' },
    templates: [],
    flagship: { shipId: 'shp_01m3tbfspe96yf1rnr4ank0000', name: 'team-a1b2c3', crewToken: 'aeolus_ct_v1_flagship' },
    members: [
      { shipId: 'shp_01m3tbfspe96yf1rnr4ank0001', name: 'tester-k3x9', role: 'tester', type: 'team-a1b2c3:tester', onStationAt: FORMED, checkIn: null, standDownMessageId: null, stoodDownAt: null, retiredAt: null },
    ],
    formedAt: FORMED,
    sailedAt: FORMED,
  };
}

let held: Squadron;
const squadrons: SquadronRepository = {
  exists: () => Promise.resolve(true),
  create: () => Promise.resolve(),
  list: (fleetId) => Promise.resolve(fleetId === FLEET ? [structuredClone(held)] : []),
  update: ({ after }) => {
    held = structuredClone(after);
    return Promise.resolve();
  },
};

const standDown = createStandDown({ squadrons });

beforeEach(() => {
  held = aSquadron('sailing');
});

describe('standing a squadron down', () => {
  it('puts a sailing squadron standing down: it takes no new work, and its members get their stand-down at the next advance', async () => {
    await expect(standDown({ fleetId: FLEET, squadronId: 'team-a1b2c3' })).resolves.toEqual({ isOk: true, value: undefined });

    expect(held.state).toBe('standing-down');
  });

  it.each<SquadronState>(['forming', 'standing-down', 'disbanded'])('refuses a %s squadron: only a sailing one stands down, a forming one only by force', async (state) => {
    held = aSquadron(state);

    await expect(standDown({ fleetId: FLEET, squadronId: 'team-a1b2c3' })).resolves.toMatchObject({ isOk: false, error: { kind: 'NOT_SAILING' } });
    expect(held.state).toBe(state);
  });

  it('refuses a squadron the fleet does not have', async () => {
    await expect(standDown({ fleetId: OTHER_FLEET, squadronId: 'team-a1b2c3' })).resolves.toMatchObject({ isOk: false, error: { kind: 'SQUADRON_NOT_FOUND' } });
  });
});
