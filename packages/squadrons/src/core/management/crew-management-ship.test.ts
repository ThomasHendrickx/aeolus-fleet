import type { FleetId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import { err, ok, type Result } from '../shared/result.js';
import { createCrewManagementShip } from './crew-management-ship.js';
import type { FleetDoor, FleetRefusal, ManagementCrew, ManagementCrewStore } from './ports.js';

const SHIP_ID: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h1a';
const FLEET_ID: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const AT = new Date('2026-10-03T08:00:00.000Z');

/** A fleet that knows one management ship: its secret claims it once, and its crew tokens work while their lease holds. */
function fakeFleet() {
  const state = { secret: 'aeolus_sk_v1_good', isCrewed: false, liveTokens: new Set<string>(), registers: 0 };
  const door: FleetDoor = {
    register: ({ shipId, secret }): Promise<Result<{ crewToken: string }, FleetRefusal>> => {
      state.registers += 1;
      if (shipId !== SHIP_ID || secret !== state.secret) {
        return Promise.resolve(err({ code: 'UNAUTHORIZED', message: 'Wrong ship id or secret' }));
      }
      if (state.isCrewed) {
        return Promise.resolve(err({ code: 'CONFLICT', message: 'squadrons is crewed by another session' }));
      }
      state.isCrewed = true;
      const crewToken = `aeolus_ct_v1_${String(state.registers)}`;
      state.liveTokens.add(crewToken);
      return Promise.resolve(ok({ crewToken }));
    },
    whoami: (crewToken) =>
      Promise.resolve(
        state.liveTokens.has(crewToken)
          ? ok({ shipId: SHIP_ID, fleetId: FLEET_ID, name: 'squadrons', type: 'squadrons' })
          : err({ code: 'LEASE_ENDED', message: 'This ship was released; this session no longer crews it.' }),
      ),
    commission: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used here' })),
    retire: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used here' })),
    receive: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used here' })),
    ack: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used here' })),
    send: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used here' })),
    listShips: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used here' })),
  };
  return { state, door };
}

function memoryStore(): ManagementCrewStore & { held: ManagementCrew | undefined } {
  const store: ManagementCrewStore & { held: ManagementCrew | undefined } = {
    held: undefined,
    find: () => Promise.resolve(store.held),
    save: (crew) => {
      store.held = { ...crew };
      return Promise.resolve();
    },
  };
  return store;
}

let fleet: ReturnType<typeof fakeFleet>;
let store: ReturnType<typeof memoryStore>;

beforeEach(() => {
  fleet = fakeFleet();
  store = memoryStore();
});

function crewWith(secret: string | undefined) {
  return createCrewManagementShip({ door: fleet.door, store, clock: { now: () => AT }, ship: { shipId: SHIP_ID, secret } });
}

describe('crewing the management ship', () => {
  it('registers with the secret the first time, and keeps the crew token', async () => {
    await expect(crewWith('aeolus_sk_v1_good')()).resolves.toEqual({
      isOk: true,
      value: { crewToken: 'aeolus_ct_v1_1', name: 'squadrons' },
    });
    expect(store.held).toEqual({ fleetId: FLEET_ID, shipId: SHIP_ID, crewToken: 'aeolus_ct_v1_1', crewedAt: AT });
  });

  it('crews it again with the kept crew token after a restart, without the secret', async () => {
    await crewWith('aeolus_sk_v1_good')();

    await expect(crewWith(undefined)()).resolves.toMatchObject({ isOk: true, value: { crewToken: 'aeolus_ct_v1_1' } });
    expect(fleet.state.registers).toBe(1);
  });

  it('registers again with a new secret once the kept crew token stopped working: the operator re-crewed it', async () => {
    await crewWith('aeolus_sk_v1_good')();
    fleet.state.liveTokens.clear();
    fleet.state.isCrewed = false;
    fleet.state.secret = 'aeolus_sk_v1_new';

    await expect(crewWith('aeolus_sk_v1_new')()).resolves.toMatchObject({ isOk: true, value: { crewToken: 'aeolus_ct_v1_2' } });
    expect(store.held?.crewToken).toBe('aeolus_ct_v1_2');
  });
});

describe('the management ship not crewed', () => {
  it('says to give a secret when none is kept and none is given', async () => {
    await expect(crewWith(undefined)()).resolves.toMatchObject({ isOk: false, error: { kind: 'MANAGEMENT_SECRET_MISSING' } });
  });

  it('says another session crews it when the fleet refuses the claim with CONFLICT', async () => {
    fleet.state.isCrewed = true;

    await expect(crewWith('aeolus_sk_v1_good')()).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'MANAGEMENT_SHIP_CREWED_ELSEWHERE' },
    });
  });

  it('says the fleet refused the secret, and keeps nothing', async () => {
    await expect(crewWith('aeolus_sk_v1_wrong')()).resolves.toMatchObject({
      isOk: false,
      error: { kind: 'MANAGEMENT_SECRET_REFUSED', message: 'The fleet refused the management ship secret: Wrong ship id or secret' },
    });
    expect(store.held).toBeUndefined();
  });
});
