import type { FleetId, ShipId } from '@aeolus-fleet/common';

import type { FleetDoor, FleetRefusal, ManagementBinding, ManagementCrew, ManagementCrewStore } from '../../src/core/management/ports.js';
import { err, ok, type Result } from '../../src/core/shared/result.js';

export const SHIP_ID: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h1a';
export const FLEET_ID: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
export const OTHER_FLEET_ID: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8zz';

/** What the fleet issues with a starting prompt: the secret and one crew line per harness. */
export function issuedPrompt(shipId: ShipId, secret: string): { secret: string; crewLines: { harness: string; line: string }[] } {
  return {
    secret,
    crewLines: [
      { harness: 'claude-code', line: `/aeolus:crew https://fleet.example.com ${shipId} ${secret}` },
      { harness: 'codex', line: `$aeolus-crew https://fleet.example.com ${shipId} ${secret}` },
    ],
  };
}

/** The fleet's MCP URL, where a chat client's connector reaches it. */
export const MCP_URL = 'https://fleet.example.com/mcp';

/** The crew lines a member is handed: the fleet's, each with the squadron id, and one for a chat client. */
export function memberCrewLines(member: { shipId: ShipId; secret: string; squadronId: string; role: string }): { harness: string; line: string }[] {
  const { shipId, secret, squadronId, role } = member;
  return [
    ...issuedPrompt(shipId, secret).crewLines.map(({ harness, line }) => ({ harness, line: `${line} ${squadronId}` })),
    {
      harness: 'chat',
      line:
        `Crew Aeolus ship ${shipId} through the fleet's MCP connector at ${MCP_URL}: register with ship id ${shipId}, secret ${secret} and your chat client as harness (claude-chat or chatgpt). ` +
        `Then check in: send the ship ${squadronId} contentType application/vnd.aeolus.squadron.check-in+json, payload {"squadron":"${squadronId}","model":"<your exact model id>"}; it answers your role and charter; ` +
        `answer that inReplyTo with application/vnd.aeolus.squadron.on-station+json, payload {"squadron":"${squadronId}","role":"${role}"}, and take up the charter.`,
    },
  ];
}

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
    release: notUsed,
    retire: notUsed,
    receive: notUsed,
    ack: notUsed,
    send: notUsed,
    listShips: notUsed,
  };
  return { state, door };
}

/** A connection the management store holds for one fleet: the binding stays when the crew token is dropped. */
interface HeldConnection {
  binding: ManagementBinding;
  name: string;
  crewToken: string | null;
  crewedAt: Date;
}

/** The management store in memory, one connection per fleet. */
export function memoryManagementStore(): ManagementCrewStore & { held: Map<FleetId, HeldConnection> } {
  const held = new Map<FleetId, HeldConnection>();
  const crewOf = (connection: HeldConnection): ManagementCrew | undefined =>
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
    save: (crew: ManagementCrew) => {
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
