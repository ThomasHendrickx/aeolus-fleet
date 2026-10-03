import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { FleetDoor, FleetRefusal, ManagementBinding, ManagementCrew, ManagementCrewStore } from '../../src/core/management/ports.js';
import { err, ok, type Result } from '../../src/core/shared/result.js';

export const SHIP_ID: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h1a';
export const FLEET_ID: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
export const OTHER_FLEET_ID: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';

const notUsed = () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used here' }));

/**
 * A fleet that knows one management ship: its secret claims it once, its crew
 * tokens work while their lease holds, and it has the scopes it was given.
 */
export function fakeManagementFleet() {
  const state = {
    secret: 'aeolus_sk_v1_good',
    fleetId: FLEET_ID,
    scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:manage'],
    isCrewed: false,
    liveTokens: new Set<string>(),
    registers: 0,
    deregistered: new Array<string>(),
  };
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
          ? ok({ shipId: SHIP_ID, fleetId: state.fleetId, name: 'squadrons', type: 'squadrons' })
          : err({ code: 'LEASE_ENDED', message: 'This ship was released; this session no longer crews it.' }),
      ),
    getShip: (crewToken, { shipId }) => {
      if (!state.liveTokens.has(crewToken)) {
        return Promise.resolve(err({ code: 'LEASE_ENDED', message: 'released' }));
      }
      if (!state.scopes.includes('fleet:read')) {
        return Promise.resolve(err({ code: 'FORBIDDEN', message: 'Needs fleet:read' }));
      }
      return Promise.resolve(shipId === SHIP_ID ? ok({ status: 'crewed', scopes: [...state.scopes], lastSeenAt: null, crewedSince: null, reportedAt: null, openDeliveries: 0, inFlightDeliveries: 0 }) : err({ code: 'NOT_FOUND', message: 'No such ship' }));
    },
    deregister: (crewToken) => {
      state.liveTokens.delete(crewToken);
      state.isCrewed = false;
      state.deregistered.push(crewToken);
      return Promise.resolve(ok(undefined));
    },
    commission: notUsed,
    getStartingPrompt: notUsed,
    retire: notUsed,
    receive: notUsed,
    ack: notUsed,
    send: notUsed,
    listShips: notUsed,
  };
  return { state, door };
}

/** The management store in memory: the binding stays when the crew token is dropped. */
export function memoryManagementStore(): ManagementCrewStore & { held: { binding: ManagementBinding; name: string; crewToken: string | null; crewedAt: Date } | undefined } {
  const store: ManagementCrewStore & { held: { binding: ManagementBinding; name: string; crewToken: string | null; crewedAt: Date } | undefined } = {
    held: undefined,
    find: () => {
      const { held } = store;
      return Promise.resolve(held?.crewToken ? { ...held.binding, name: held.name, crewToken: held.crewToken, crewedAt: held.crewedAt } : undefined);
    },
    binding: () => Promise.resolve(store.held ? { ...store.held.binding } : undefined),
    save: (crew: ManagementCrew) => {
      store.held = { binding: { fleetId: crew.fleetId, shipId: crew.shipId }, name: crew.name, crewToken: crew.crewToken, crewedAt: crew.crewedAt };
      return Promise.resolve();
    },
    drop: () => {
      if (store.held) {
        store.held = { ...store.held, crewToken: null };
      }
      return Promise.resolve();
    },
  };
  return store;
}
