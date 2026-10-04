import type { FleetId, MessageId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import type { FleetDoor, FleetShip, ManagementCrew, ManagementCrewStore, OutgoingMessage } from '../management/ports.js';
import { err, ok } from '../shared/result.js';
import { createAdvanceStandDowns } from './advance-stand-downs.js';
import { STAND_DOWN } from './check-in.js';
import type { SquadronRepository } from './ports.js';
import type { Member, Squadron, SquadronState } from './squadron.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const MANAGEMENT: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h1a';
const FLAGSHIP: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0000';
const PLANNER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0001';
const TESTER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0002';
const FORMED = new Date('2026-10-03T09:00:00.000Z');
const NOW = new Date('2026-10-03T10:00:00.000Z');
const REPO = 'example.com/templates';

function aMember(shipId: ShipId, { role, onStationAt }: { role: string; onStationAt: Date | null }): Member {
  return { shipId, name: `${role}-k3x9`, role, type: `team-a1b2c3:${role}`, onStationAt, checkIn: null, standDownMessageId: null, stoodDownAt: null, retiredAt: null };
}

function aSquadron(state: SquadronState = 'standing-down'): Squadron {
  return {
    id: 'team-a1b2c3',
    fleetId: FLEET,
    state,
    blueprint: { repository: REPO, name: 'team', version: 1, file: 'squadrons/fixture.yaml', commit: 'b1', committedAt: FORMED, description: 'A team.', roles: [], handoffs: [], memberNames: 'plain' },
    templates: [],
    flagship: { shipId: FLAGSHIP, name: 'team-a1b2c3', crewToken: 'aeolus_ct_v1_flagship' },
    members: [aMember(PLANNER, { role: 'planner', onStationAt: FORMED }), aMember(TESTER, { role: 'tester', onStationAt: FORMED })],
    formedAt: FORMED,
    sailedAt: FORMED,
  };
}

function aShip(open: { openDeliveries: number; inFlightDeliveries: number } = { openDeliveries: 0, inFlightDeliveries: 0 }): FleetShip {
  return { status: 'crewed', scopes: [], lastSeenAt: null, crewedSince: FORMED, reportedAt: null, ...open };
}

let held: Squadron;
let ships: Map<ShipId, FleetShip>;
/** Each message squadrons sent, by its id. */
let messages: Map<MessageId, OutgoingMessage>;
const sent: OutgoingMessage[] = [];
const retired: ShipId[] = [];
let isFleetDown: boolean;

const notUsed = () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used' }));
const down = () => Promise.resolve(err({ code: 'UNAVAILABLE', message: 'The fleet did not answer' }));
const door: FleetDoor = {
  register: notUsed,
  whoami: notUsed,
  deregister: notUsed,
  commission: notUsed,
  getStartingPrompt: notUsed,
  release: notUsed,
  listShips: notUsed,
  receive: notUsed,
  ack: notUsed,
  getShip: (crewToken, { shipId }) => {
    const ship = ships.get(shipId);
    if (isFleetDown) {
      return down();
    }
    return Promise.resolve(crewToken === 'aeolus_ct_v1_management' && ship ? ok(ship) : err({ code: 'NOT_FOUND', message: 'No such ship' }));
  },
  send: (crewToken, message) => {
    if (isFleetDown) {
      return down();
    }
    if (crewToken !== 'aeolus_ct_v1_flagship') {
      return notUsed();
    }
    // As the fleet promises: the same idempotency key answers the same message, sent once.
    const known = [...messages.entries()].find(([, each]) => each.idempotencyKey === message.idempotencyKey);
    if (known) {
      return Promise.resolve(ok({ messageId: known[0] }));
    }
    sent.push(message);
    const messageId: MessageId = `msg_01m3tbfspe96yf1rnr4ank${String(sent.length).padStart(4, '0')}`;
    messages.set(messageId, message);
    return Promise.resolve(ok({ messageId }));
  },
  retire: (crewToken, { shipId }) => {
    const ship = ships.get(shipId);
    if (isFleetDown) {
      return down();
    }
    if (crewToken !== 'aeolus_ct_v1_management' || !ship) {
      return notUsed();
    }
    if (ship.status === 'retired') {
      return Promise.resolve(err({ code: 'CONFLICT', message: 'retired already' }));
    }
    ships.set(shipId, { ...ship, status: 'retired' });
    retired.push(shipId);
    return Promise.resolve(ok(undefined));
  },
};

let crew: ManagementCrew | undefined;
const management: ManagementCrewStore = {
  find: (fleetId) => Promise.resolve(crew?.fleetId === fleetId ? crew : undefined),
  binding: (fleetId) => Promise.resolve(crew?.fleetId === fleetId ? { fleetId: crew.fleetId, shipId: crew.shipId } : undefined),
  connected: () => Promise.resolve(crew ? [crew] : []),
  save: () => Promise.resolve(),
  drop: () => Promise.resolve(),
};
const squadrons: SquadronRepository = {
  exists: () => Promise.resolve(true),
  create: () => Promise.resolve(),
  list: (fleetId) => Promise.resolve(fleetId === FLEET ? [structuredClone(held)] : []),
  update: ({ after }) => {
    held = structuredClone(after);
    return Promise.resolve();
  },
};

const advance = createAdvanceStandDowns({ door, management, squadrons, clock: { now: () => NOW } });

function member(shipId: ShipId): Member | undefined {
  return held.members.find((each) => each.shipId === shipId);
}

/** Members that sent stood-down to their flagship, as the flagship records it. */
function standDown(...shipIds: ShipId[]): void {
  held = { ...held, members: held.members.map((each) => (shipIds.includes(each.shipId) ? { ...each, stoodDownAt: NOW } : each)) };
}

beforeEach(() => {
  held = aSquadron();
  crew = { fleetId: FLEET, shipId: MANAGEMENT, name: 'squadrons', crewToken: 'aeolus_ct_v1_management', crewedAt: FORMED };
  ships = new Map([
    [FLAGSHIP, aShip()],
    [PLANNER, aShip()],
    [TESTER, aShip()],
  ]);
  messages = new Map();
  sent.length = 0;
  retired.length = 0;
  isFleetDown = false;
});

describe('a squadron standing down', () => {
  it('sends each member on station its stand-down from the flagship, and keeps which message it was', async () => {
    await advance(FLEET);

    expect(sent).toEqual([
      { selector: { kind: 'ship', shipId: PLANNER }, contentType: STAND_DOWN, payload: JSON.stringify({ squadron: 'team-a1b2c3' }), idempotencyKey: `stand-down-team-a1b2c3-${PLANNER}` },
      { selector: { kind: 'ship', shipId: TESTER }, contentType: STAND_DOWN, payload: JSON.stringify({ squadron: 'team-a1b2c3' }), idempotencyKey: `stand-down-team-a1b2c3-${TESTER}` },
    ]);
    expect(held.members.map((each) => each.standDownMessageId)).toEqual(['msg_01m3tbfspe96yf1rnr4ank0001', 'msg_01m3tbfspe96yf1rnr4ank0002']);
  });

  it('sends each member its stand-down once, however often it advances', async () => {
    await advance(FLEET);
    await advance(FLEET);

    expect(sent).toHaveLength(2);
  });

  it('never retires a member that has not sent stood-down, though it has its stand-down: it finishes and wraps up first', async () => {
    await advance(FLEET);

    await advance(FLEET);

    expect(retired).toEqual([]);
    expect(held.state).toBe('standing-down');
  });

  it('does not retire a member that stood down but still holds open or in-flight deliveries', async () => {
    await advance(FLEET);
    standDown(PLANNER, TESTER);
    ships.set(PLANNER, aShip({ openDeliveries: 1, inFlightDeliveries: 0 }));
    ships.set(TESTER, aShip({ openDeliveries: 0, inFlightDeliveries: 1 }));

    await advance(FLEET);

    expect(retired).toEqual([]);
  });

  it('retires a member once it stood down and holds no open deliveries', async () => {
    await advance(FLEET);
    standDown(PLANNER, TESTER);
    ships.set(TESTER, aShip({ openDeliveries: 2, inFlightDeliveries: 0 }));

    await advance(FLEET);

    expect(retired).toEqual([PLANNER]);
    expect(member(PLANNER)?.retiredAt).toEqual(NOW);
    expect(member(TESTER)?.retiredAt).toBeNull();
  });

  it('retires at once a member that never came on station: it holds no work, so it gets no stand-down', async () => {
    held = { ...held, members: [aMember(PLANNER, { role: 'planner', onStationAt: FORMED }), aMember(TESTER, { role: 'tester', onStationAt: null })] };

    await advance(FLEET);

    expect(retired).toEqual([TESTER]);
    expect(sent.map((each) => each.selector)).toEqual([{ kind: 'ship', shipId: PLANNER }]);
  });

  it('counts a member whose ship is retired already as retired', async () => {
    await advance(FLEET);
    standDown(PLANNER);
    ships.set(PLANNER, { ...aShip(), status: 'retired' });

    await advance(FLEET);

    expect(member(PLANNER)?.retiredAt).toEqual(NOW);
  });

  it('retires the flagship once every member is retired, and the squadron is disbanded, its history kept', async () => {
    await advance(FLEET);
    standDown(PLANNER, TESTER);

    await advance(FLEET);

    expect(retired).toEqual([PLANNER, TESTER, FLAGSHIP]);
    expect(held.state).toBe('disbanded');
    expect(held.members).toHaveLength(2);
  });

  it('leaves a squadron as it is while the fleet does not answer, to advance at the next rescan', async () => {
    standDown(PLANNER);
    isFleetDown = true;

    await advance(FLEET);

    expect(held.members.map((each) => ({ standDownMessageId: each.standDownMessageId, retiredAt: each.retiredAt }))).toEqual([
      { standDownMessageId: null, retiredAt: null },
      { standDownMessageId: null, retiredAt: null },
    ]);
  });

  it.each<SquadronState>(['forming', 'sailing', 'disbanded'])('leaves a %s squadron alone', async (state) => {
    held = aSquadron(state);

    await advance(FLEET);

    expect(sent).toEqual([]);
    expect(retired).toEqual([]);
  });

  it('does nothing while squadrons is not connected', async () => {
    crew = undefined;

    await advance(FLEET);

    expect(sent).toEqual([]);
  });
});
