import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { ConnectionStore, FleetDoor, FleetRefusal, PluginBinding, PluginCrew } from '../../src/core/connection/ports.js';
import { err, ok, type Result } from '../../src/core/shared/result.js';

export const SHIP_ID: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h1a';
export const FLEET_ID: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
export const OTHER_FLEET_ID: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';

/**
 * A fleet that knows the networking plugin's ship: its secret claims it once,
 * its crew tokens work while their lease holds, and it has the scopes it was
 * given.
 */
export function fakePluginFleet() {
  const state = {
    secret: 'aeolus_sk_v1_good',
    fleetId: FLEET_ID,
    scopes: ['messages:send', 'messages:receive', 'fleet:read', 'fleet:network'],
    isCrewed: false,
    isAnswering: true,
    liveTokens: new Set<string>(),
    registers: 0,
    deregistered: new Array<string>(),
  };
  const unavailable = () => Promise.resolve(err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' }));
  const released = () => Promise.resolve(err({ code: 'LEASE_ENDED', message: 'This ship was released; this session no longer crews it.' }));
  const door: FleetDoor = {
    register: ({ shipId, secret }): Promise<Result<{ crewToken: string }, FleetRefusal>> => {
      state.registers += 1;
      if (shipId !== SHIP_ID || secret !== state.secret) {
        return Promise.resolve(err({ code: 'UNAUTHORIZED', message: 'Wrong ship id or secret' }));
      }
      if (state.isCrewed) {
        return Promise.resolve(err({ code: 'CONFLICT', message: 'The ship is crewed by another session' }));
      }
      state.isCrewed = true;
      const crewToken = `aeolus_ct_v1_${String(state.registers)}`;
      state.liveTokens.add(crewToken);
      return Promise.resolve(ok({ crewToken }));
    },
    whoami: (crewToken) => (state.liveTokens.has(crewToken) ? Promise.resolve(ok({ shipId: SHIP_ID, fleetId: state.fleetId, name: 'networking-plugin', type: 'networking-plugin' })) : released()),
    getShip: (crewToken, { shipId }) => {
      if (!state.isAnswering) {
        return unavailable();
      }
      if (!state.liveTokens.has(crewToken)) {
        return released();
      }
      if (!state.scopes.includes('fleet:read')) {
        return Promise.resolve(err({ code: 'FORBIDDEN', message: 'Needs fleet:read' }));
      }
      return Promise.resolve(shipId === SHIP_ID ? ok({ status: 'crewed', scopes: [...state.scopes] }) : err({ code: 'NOT_FOUND', message: 'No such ship' }));
    },
    deregister: (crewToken) => {
      state.liveTokens.delete(crewToken);
      state.isCrewed = false;
      state.deregistered.push(crewToken);
      return Promise.resolve(ok(undefined));
    },
  };
  return { state, door };
}

/** A connection the store holds for one fleet: the binding stays when the crew token is dropped. */
interface HeldConnection {
  binding: PluginBinding;
  name: string;
  crewToken: string | null;
  crewedAt: Date;
}

/** The connection store in memory, one connection per fleet. */
export function memoryConnectionStore(): ConnectionStore & { held: Map<FleetId, HeldConnection> } {
  const held = new Map<FleetId, HeldConnection>();
  const crewOf = (connection: HeldConnection): PluginCrew | undefined =>
    connection.crewToken ? { ...connection.binding, name: connection.name, crewToken: connection.crewToken, crewedAt: connection.crewedAt } : undefined;
  return {
    held,
    find: (fleetId) => {
      const connection = held.get(fleetId);
      return Promise.resolve(connection ? crewOf(connection) : undefined);
    },
    binding: (fleetId) => {
      const connection = held.get(fleetId);
      return Promise.resolve(connection ? { ...connection.binding } : undefined);
    },
    connected: () => Promise.resolve([...held.values()].flatMap((connection) => crewOf(connection) ?? [])),
    save: (crew: PluginCrew) => {
      held.set(crew.fleetId, { binding: { fleetId: crew.fleetId, shipId: crew.shipId }, name: crew.name, crewToken: crew.crewToken, crewedAt: crew.crewedAt });
      return Promise.resolve();
    },
    drop: (fleetId) => {
      const connection = held.get(fleetId);
      if (connection) {
        held.set(fleetId, { ...connection, crewToken: null });
      }
      return Promise.resolve();
    },
  };
}
