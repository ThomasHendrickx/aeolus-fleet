import type { DeliveryId, FleetId, MessageId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import type { FleetDoor, OutgoingMessage } from '../management/ports.js';
import { err, ok } from '../shared/result.js';
import { CHECK_IN, ON_STATION, ROLE } from './check-in.js';
import { createHandleFlagshipDelivery, type FlagshipDelivery } from './handle-flagship-delivery.js';
import type { SquadronRepository } from './ports.js';
import type { Squadron } from './squadron.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const FLAGSHIP: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0000';
const PLANNER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0001';
const TESTER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0002';
const STRANGER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0009';
const FORMED = new Date('2026-10-03T09:00:00.000Z');
const NOW = new Date('2026-10-03T09:10:00.000Z');
const REPO = 'example.com/templates';

function squadron(): Squadron {
  return {
    id: 'team-a1b2c3',
    fleetId: FLEET,
    state: 'forming',
    blueprint: {
      repository: REPO,
      name: 'team',
      version: 2,
      commit: 'b2',
      committedAt: FORMED,
      description: 'A team.',
      roles: [
        { name: 'planner', template: { repository: REPO, name: 'planner', version: 1 }, count: 1 },
        { name: 'tester', template: { repository: REPO, name: 'tester', version: 4 }, count: 1 },
      ],
      handoffs: [
        { role: 'tester', handoff: 'on-fail', to: 'planner' },
        { role: 'tester', handoff: 'on-pass', to: 'flagship' },
      ],
      entry: 'planner',
      memberNames: 'plain',
    },
    templates: [
      { repository: REPO, name: 'planner', version: 1, commit: 'p1', committedAt: FORMED, description: 'Plans.', checkInMinutes: 120, launchNote: null, charter: 'You plan.', handoffs: [] },
      {
        repository: REPO,
        name: 'tester',
        version: 4,
        commit: 't4',
        committedAt: FORMED,
        description: 'Tests.',
        checkInMinutes: 30,
        launchNote: null,
        charter: 'You test.',
        handoffs: [
          { name: 'on-fail', carries: 'failures' },
          { name: 'on-pass', carries: 'the run' },
        ],
      },
    ],
    flagship: { shipId: FLAGSHIP, name: 'team-a1b2c3', crewToken: 'aeolus_ct_v1_flagship' },
    members: [
      { shipId: PLANNER, name: 'planner-k3x9', role: 'planner', type: 'team-a1b2c3:planner', onStationAt: null },
      { shipId: TESTER, name: 'tester-m4p7', role: 'tester', type: 'team-a1b2c3:tester', onStationAt: null },
    ],
    formedAt: FORMED,
    sailedAt: null,
  };
}

let held: Squadron;
const acked: DeliveryId[] = [];
const sent: OutgoingMessage[] = [];
let isAckRefused: boolean;

const door: FleetDoor = {
  register: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used' })),
  whoami: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used' })),
  commission: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used' })),
  retire: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used' })),
  receive: () => Promise.resolve(ok([])),
  ack: (crewToken, deliveryId) => {
    if (isAckRefused || crewToken !== 'aeolus_ct_v1_flagship') {
      return Promise.resolve(err({ code: 'CONFLICT', message: 'not in flight' }));
    }
    acked.push(deliveryId);
    return Promise.resolve(ok(undefined));
  },
  send: (_crewToken, message) => {
    sent.push(message);
    return Promise.resolve(ok({ messageId: 'msg_01m3tbfspe96yf1rnr4ank0100' satisfies MessageId }));
  },
};

const squadrons: SquadronRepository = {
  exists: () => Promise.resolve(true),
  create: () => Promise.resolve(),
  list: () => Promise.resolve([held]),
  update: (squadron) => {
    held = structuredClone(squadron);
    return Promise.resolve();
  },
};

const handle = createHandleFlagshipDelivery({ door, squadrons, clock: { now: () => NOW } });

let next = 0;
function delivery(from: ShipId, message: { contentType: string; payload: unknown; inReplyTo?: MessageId }): FlagshipDelivery {
  next += 1;
  return {
    deliveryId: `dlv_01m3tbfspe96yf1rnr4ank${String(next).padStart(4, '0')}`,
    messageId: `msg_01m3tbfspe96yf1rnr4ank${String(next).padStart(4, '0')}`,
    senderShipId: from,
    contentType: message.contentType,
    payload: typeof message.payload === 'string' ? message.payload : JSON.stringify(message.payload),
    inReplyTo: message.inReplyTo ?? null,
  };
}

beforeEach(() => {
  held = squadron();
  acked.length = 0;
  sent.length = 0;
  isAckRefused = false;
});

describe("a member's check-in", () => {
  it('is acknowledged and answered with its role: the template, charter, check-in and hand-offs as selectors', async () => {
    const checkIn = delivery(TESTER, { contentType: CHECK_IN, payload: { squadron: 'team-a1b2c3' } });

    await expect(handle(held, checkIn)).resolves.toEqual({ isOk: true, value: 'answered' });

    expect(acked).toEqual([checkIn.deliveryId]);
    expect(sent).toEqual([
      {
        selector: { kind: 'ship', shipId: TESTER },
        contentType: ROLE,
        inReplyTo: checkIn.messageId,
        idempotencyKey: `role-${checkIn.deliveryId}`,
        payload: JSON.stringify({
          squadron: 'team-a1b2c3',
          role: 'tester',
          template: 'tester@4',
          charter: 'You test.',
          checkIn: '30m',
          handoffs: {
            'on-fail': { kind: 'type', type: 'team-a1b2c3:planner' },
            'on-pass': { kind: 'ship', name: 'team-a1b2c3' },
          },
          flagship: 'team-a1b2c3',
        }),
      },
    ]);
  });

  it('says the check-in interval in hours when it is whole hours', async () => {
    await handle(held, delivery(PLANNER, { contentType: CHECK_IN, payload: { squadron: 'team-a1b2c3' } }));

    expect(JSON.parse(sent[0]?.payload ?? '{}')).toMatchObject({ role: 'planner', checkIn: '2h', handoffs: {} });
  });

  it('is answered again after /clear: a member checks in as often as it starts', async () => {
    await handle(held, delivery(TESTER, { contentType: CHECK_IN, payload: { squadron: 'team-a1b2c3' } }));
    await handle(held, delivery(TESTER, { contentType: CHECK_IN, payload: { squadron: 'team-a1b2c3' } }));

    expect(sent).toHaveLength(2);
  });
});

describe('on station', () => {
  it("marks the member on station, and the squadron sails once every member is", async () => {
    await handle(held, delivery(PLANNER, { contentType: ON_STATION, payload: { squadron: 'team-a1b2c3', role: 'planner' } }));
    expect(held).toMatchObject({ state: 'forming', sailedAt: null });

    await expect(handle(held, delivery(TESTER, { contentType: ON_STATION, payload: { squadron: 'team-a1b2c3', role: 'tester' } }))).resolves.toEqual({
      isOk: true,
      value: 'on-station',
    });

    expect(held.members.map((member) => member.onStationAt)).toEqual([NOW, NOW]);
    expect(held).toMatchObject({ state: 'sailing', sailedAt: NOW });
    expect(acked).toHaveLength(2);
  });
});

describe('a delivery the flagship leaves alone', () => {
  it.each([
    ['a check-in from a ship that is no member', delivery(STRANGER, { contentType: CHECK_IN, payload: { squadron: 'team-a1b2c3' } })],
    ["a check-in for another squadron", delivery(TESTER, { contentType: CHECK_IN, payload: { squadron: 'other-squadron' } })],
    ['a check-in that is no JSON', delivery(TESTER, { contentType: CHECK_IN, payload: 'hello' })],
    ['any other message, until Thomas says what the flagship does with it', delivery(STRANGER, { contentType: 'text/plain', payload: 'Build login' })],
  ])('leaves %s unacknowledged and unanswered', async (_label, unknown) => {
    await expect(handle(held, unknown)).resolves.toEqual({ isOk: true, value: 'unhandled' });

    expect(acked).toEqual([]);
    expect(sent).toEqual([]);
  });

  it('answers nothing when the ack is refused: act only on an acknowledged delivery', async () => {
    isAckRefused = true;

    await expect(handle(held, delivery(TESTER, { contentType: CHECK_IN, payload: { squadron: 'team-a1b2c3' } }))).resolves.toMatchObject({ isOk: false });
    expect(sent).toEqual([]);
  });
});
