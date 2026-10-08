import type { DeliveryId, FleetId, MessageId, ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import type { FleetDoor, OutgoingMessage } from '../management/ports.js';
import { err, ok } from '../shared/result.js';
import { CHARTER_MAX_BYTES } from '../catalogue/catalogue.js';
import { CHECK_IN, ON_STATION, ROLE, STOOD_DOWN } from './check-in.js';
import { createHandleFlagshipDelivery, type FlagshipDelivery } from './handle-flagship-delivery.js';
import type { FlagshipMessageLog, KeptMessage, OperatorNotices, SquadronRepository } from './ports.js';
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
      file: 'squadrons/fixture.yaml', commit: 'b2',
      committedAt: FORMED,
      description: 'A team.',
      roles: [
        { name: 'planner', template: { repository: REPO, name: 'planner', version: 1 }, count: 1, model: null, crew: {}, parameters: {} },
        { name: 'tester', template: { repository: REPO, name: 'tester', version: 4 }, count: 1, model: null, crew: {}, parameters: {} },
      ],
      handoffs: [
        { role: 'tester', handoff: 'on-fail', to: 'planner' },
        { role: 'tester', handoff: 'on-pass', to: 'flagship' },
      ],
      memberNames: 'plain',
    },
    templates: [
      { repository: REPO, name: 'planner', version: 1, file: 'squadrons/fixture.yaml', commit: 'p1', committedAt: FORMED, description: 'Plans.', checkInMinutes: 120, model: null, launchNote: null, charter: 'You plan.', handoffs: [], crew: {}, parameters: [] },
      {
        repository: REPO,
        name: 'tester',
        version: 4,
        file: 'squadrons/fixture.yaml', commit: 't4',
        committedAt: FORMED,
        description: 'Tests.',
        checkInMinutes: 30,
        model: 'claude-opus-5-5',
        launchNote: null,
        charter: 'You test.',
        handoffs: [
          { name: 'on-fail', carries: 'failures' },
          { name: 'on-pass', carries: 'the run' },
        ], crew: {}, parameters: [],
      },
    ],
    flagship: { shipId: FLAGSHIP, name: 'team-a1b2c3', crewToken: 'aeolus_ct_v1_flagship' },
    members: [
      { shipId: PLANNER, name: 'planner-k3x9', role: 'planner', type: 'team-a1b2c3:planner', onStationAt: null, checkIn: null, standDownMessageId: null, stoodDownAt: null, retiredAt: null, releasingSince: null },
      { shipId: TESTER, name: 'tester-m4p7', role: 'tester', type: 'team-a1b2c3:tester', onStationAt: null, checkIn: null, standDownMessageId: null, stoodDownAt: null, retiredAt: null, releasingSince: null },
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
  getShip: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used' })),
  deregister: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used' })),
  commission: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used' })),
  requestCrew: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used' })),
  removeCrewRequest: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used' })),
  findLabelValue: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used' })),
  retire: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used' })),
  receive: () => Promise.resolve(ok([])),
  listShips: () => Promise.resolve(ok([])),
  getStartingPrompt: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used' })),
  release: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used' })),
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
  update: ({ after }) => {
    held = structuredClone(after);
    return Promise.resolve();
  },
};

const kept: KeptMessage[] = [];
const told: { fleetId: FleetId; text: string; key: string }[] = [];
const messages: FlagshipMessageLog = {
  keep: (message) => {
    // As the port promises: keeping the same delivery again changes nothing.
    if (!kept.some((each) => each.deliveryId === message.deliveryId)) {
      kept.push(message);
    }
    return Promise.resolve();
  },
  list: () => Promise.resolve(kept),
};
const operator: OperatorNotices = {
  tell: (notice) => {
    told.push(notice);
    return Promise.resolve();
  },
};

/** For each advance of the stand-downs, how many deliveries were acked by then. */
const advances: number[] = [];

let now = NOW;
const handle = createHandleFlagshipDelivery({
  door,
  squadrons,
  messages,
  operator,
  advanceStandDowns: () => {
    advances.push(acked.length);
    return Promise.resolve();
  },
  clock: { now: () => now },
});

let next = 0;
function delivery(from: ShipId, message: { contentType: string; payload: unknown; inReplyTo?: MessageId }): FlagshipDelivery {
  next += 1;
  return {
    deliveryId: `dlv_01m3tbfspe96yf1rnr4ank${String(next).padStart(4, '0')}`,
    messageId: `msg_01m3tbfspe96yf1rnr4ank${String(next).padStart(4, '0')}`,
    senderShipId: from,
    senderName: from === STRANGER ? 'reviewer-01' : 'a-member',
    contentType: message.contentType,
    payload: typeof message.payload === 'string' ? message.payload : JSON.stringify(message.payload),
    inReplyTo: message.inReplyTo ?? null,
  };
}

beforeEach(() => {
  held = squadron();
  acked.length = 0;
  sent.length = 0;
  kept.length = 0;
  told.length = 0;
  isAckRefused = false;
  advances.length = 0;
  now = NOW;
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

  it('stays within the 64 KB payload limit with the longest charter a template may have', async () => {
    const PAYLOAD_MAX_BYTES = 64 * 1024;
    held = { ...held, templates: held.templates.map((template) => ({ ...template, charter: 'x'.repeat(CHARTER_MAX_BYTES) })) };

    await handle(held, delivery(TESTER, { contentType: CHECK_IN, payload: { squadron: 'team-a1b2c3' } }));

    expect(Buffer.byteLength(sent[0]?.payload ?? '')).toBeLessThanOrEqual(PAYLOAD_MAX_BYTES);
  });

  it('says the check-in interval in hours when it is whole hours', async () => {
    await handle(held, delivery(PLANNER, { contentType: CHECK_IN, payload: { squadron: 'team-a1b2c3' } }));

    expect(JSON.parse(sent[0]?.payload ?? '{}')).toMatchObject({ role: 'planner', checkIn: '2h', handoffs: {} });
  });

  it('keeps when the member checked in and the model it states', async () => {
    await handle(held, delivery(TESTER, { contentType: CHECK_IN, payload: { squadron: 'team-a1b2c3', model: 'claude-sonnet-5-5' } }));

    expect(held.members.find((member) => member.shipId === TESTER)?.checkIn).toEqual({ at: NOW, model: 'claude-sonnet-5-5' });
  });

  it('keeps a check-in that states no model as stating none', async () => {
    await handle(held, delivery(TESTER, { contentType: CHECK_IN, payload: { squadron: 'team-a1b2c3' } }));

    expect(held.members.find((member) => member.shipId === TESTER)?.checkIn).toEqual({ at: NOW, model: null });
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

  it('comes on station again, from then, after the member checked in again: a new crew is not on station until it confirms its role', async () => {
    held = { ...held, state: 'sailing', sailedAt: FORMED, members: held.members.map((member) => ({ ...member, onStationAt: FORMED, checkIn: { at: FORMED, model: null } })) };
    await handle(held, delivery(TESTER, { contentType: CHECK_IN, payload: { squadron: 'team-a1b2c3' } }));
    const later = new Date('2026-10-03T09:11:00.000Z');
    now = later;

    await handle(held, delivery(TESTER, { contentType: ON_STATION, payload: { squadron: 'team-a1b2c3', role: 'tester' } }));

    expect(held.members.map((member) => member.onStationAt)).toEqual([FORMED, later]);
    expect(held).toMatchObject({ state: 'sailing', sailedAt: FORMED });
  });
});

describe('stood-down', () => {
  const STAND_DOWN_MESSAGE: MessageId = 'msg_01m3tbfspe96yf1rnr4ank0200';

  function standingDown(): Squadron {
    return {
      ...squadron(),
      state: 'standing-down',
      sailedAt: FORMED,
      members: squadron().members.map((member) => ({ ...member, onStationAt: FORMED, standDownMessageId: STAND_DOWN_MESSAGE })),
    };
  }

  it('records that the member stood down and acks it, then advances the stand-downs so it is retired when it holds no open deliveries', async () => {
    held = standingDown();

    await expect(handle(held, delivery(TESTER, { contentType: STOOD_DOWN, payload: { squadron: 'team-a1b2c3' }, inReplyTo: STAND_DOWN_MESSAGE }))).resolves.toEqual({
      isOk: true,
      value: 'stood-down',
    });

    expect(held.members.map((member) => member.stoodDownAt)).toEqual([null, NOW]);
    expect(advances).toEqual([1]);
    expect(acked).toHaveLength(1);
  });

  it.each([
    ['the role message that said the squadron stands down', 'msg_01m3tbfspe96yf1rnr4ank0201'],
    ['nothing', undefined],
  ] as const)('is known by its sender, a member of the squadron standing down, whatever it replies to: here %s', async (_label, inReplyTo) => {
    held = standingDown();

    await expect(handle(held, delivery(TESTER, { contentType: STOOD_DOWN, payload: { squadron: 'team-a1b2c3' }, ...(inReplyTo === undefined ? {} : { inReplyTo }) }))).resolves.toEqual({
      isOk: true,
      value: 'stood-down',
    });
    expect(held.members.find((member) => member.shipId === TESTER)?.stoodDownAt).toEqual(NOW);
  });

  it('keeps when the member first stood down, when its stood-down comes again', async () => {
    held = standingDown();
    const stoodDown = delivery(TESTER, { contentType: STOOD_DOWN, payload: { squadron: 'team-a1b2c3' }, inReplyTo: STAND_DOWN_MESSAGE });
    await handle(held, stoodDown);
    now = new Date('2026-10-03T09:20:00.000Z');

    await handle(held, stoodDown);

    expect(held.members.find((member) => member.shipId === TESTER)?.stoodDownAt).toEqual(NOW);
  });

  it('is kept as a message the flagship does not handle while the squadron does not stand down', async () => {
    held = { ...squadron(), state: 'sailing' };

    await expect(handle(held, delivery(TESTER, { contentType: STOOD_DOWN, payload: { squadron: 'team-a1b2c3' } }))).resolves.toEqual({ isOk: true, value: 'kept' });

    expect(held.members.every((member) => member.stoodDownAt === null)).toBe(true);
    expect(advances).toEqual([]);
  });

  it('is kept as a message the flagship does not handle when it names another squadron', async () => {
    held = standingDown();

    await expect(handle(held, delivery(TESTER, { contentType: STOOD_DOWN, payload: { squadron: 'other-squadron' } }))).resolves.toEqual({ isOk: true, value: 'kept' });
  });
});

describe('a check-in while the squadron stands down', () => {
  it('is answered with its role saying the squadron stands down, so the member finishes its work and sends stood-down', async () => {
    held = { ...squadron(), state: 'standing-down' };

    await handle(held, delivery(TESTER, { contentType: CHECK_IN, payload: { squadron: 'team-a1b2c3' } }));

    expect(JSON.parse(sent[0]?.payload ?? '{}')).toMatchObject({ role: 'tester', standingDown: true });
  });

  it('says nothing of standing down while the squadron sails', async () => {
    held = { ...squadron(), state: 'sailing' };

    await handle(held, delivery(TESTER, { contentType: CHECK_IN, payload: { squadron: 'team-a1b2c3' } }));

    expect(JSON.parse(sent[0]?.payload ?? '{}')).not.toHaveProperty('standingDown');
  });
});

describe('a delivery the flagship does not handle', () => {
  it.each([
    ['a check-in from a ship that is no member', delivery(STRANGER, { contentType: CHECK_IN, payload: { squadron: 'team-a1b2c3' } })],
    ['a check-in for another squadron', delivery(TESTER, { contentType: CHECK_IN, payload: { squadron: 'other-squadron' } })],
    ['a check-in that is no JSON', delivery(TESTER, { contentType: CHECK_IN, payload: 'hello' })],
    ['any other message: the flagship supports only the squadron messages', delivery(STRANGER, { contentType: 'text/plain', payload: 'Build login' })],
  ])('acknowledges and keeps %s for the squadron page, answering nothing', async (_label, unknown) => {
    await expect(handle(held, unknown)).resolves.toEqual({ isOk: true, value: 'kept' });

    expect(acked).toEqual([unknown.deliveryId]);
    expect(sent).toEqual([]);
    expect(kept).toEqual([
      {
        fleetId: FLEET,
        squadronId: 'team-a1b2c3',
        deliveryId: unknown.deliveryId,
        messageId: unknown.messageId,
        senderShipId: unknown.senderShipId,
        senderName: unknown.senderName,
        contentType: unknown.contentType,
        payload: unknown.payload,
        inReplyTo: null,
        receivedAt: NOW,
      },
    ]);
  });

  it('tells argo, so a kept message is not left unseen', async () => {
    await handle(held, delivery(STRANGER, { contentType: 'text/plain', payload: 'Build login' }));

    expect(told.map((notice) => notice.text)).toEqual([
      'The flagship of the squadron team-a1b2c3 got a message it does not handle, from reviewer-01 (text/plain). squadrons keeps it for the squadron page; nothing was forwarded.',
    ]);
  });

});

describe('handling before the ack', () => {
  it('answers and keeps a check-in before it acks it, so an ack that fails leaves the delivery to come again', async () => {
    isAckRefused = true;

    await expect(handle(held, delivery(TESTER, { contentType: CHECK_IN, payload: { squadron: 'team-a1b2c3', model: 'claude-opus-5-5' } }))).resolves.toMatchObject({
      isOk: false,
    });

    expect(sent.map((message) => message.contentType)).toEqual([ROLE]);
    expect(held.members.find((member) => member.shipId === TESTER)?.checkIn).toEqual({ at: NOW, model: 'claude-opus-5-5' });
  });

  it('answers a check-in that comes again with the same role message, under the same idempotency key', async () => {
    const checkIn = delivery(TESTER, { contentType: CHECK_IN, payload: { squadron: 'team-a1b2c3' } });
    isAckRefused = true;
    await handle(held, checkIn);
    isAckRefused = false;

    await expect(handle(held, checkIn)).resolves.toEqual({ isOk: true, value: 'answered' });

    expect(sent).toHaveLength(2);
    expect(sent[1]).toEqual(sent[0]);
    expect(acked).toEqual([checkIn.deliveryId]);
  });

  it('marks a member on station before it acks, and an on-station that comes again changes nothing', async () => {
    held = { ...held, members: held.members.map((member) => (member.shipId === PLANNER ? { ...member, onStationAt: FORMED } : member)) };
    const onStation = delivery(TESTER, { contentType: ON_STATION, payload: { squadron: 'team-a1b2c3', role: 'tester' } });
    isAckRefused = true;
    await expect(handle(held, onStation)).resolves.toMatchObject({ isOk: false });
    expect(held).toMatchObject({ state: 'sailing', sailedAt: NOW });
    isAckRefused = false;
    now = new Date('2026-10-03T09:20:00.000Z');

    await expect(handle(held, onStation)).resolves.toEqual({ isOk: true, value: 'on-station' });

    expect(held.members.find((member) => member.shipId === TESTER)?.onStationAt).toEqual(NOW);
    expect(held).toMatchObject({ state: 'sailing', sailedAt: NOW });
    expect(acked).toEqual([onStation.deliveryId]);
  });

  it('keeps when a member came on station again after checking in again, when that on-station comes again', async () => {
    held = { ...held, members: held.members.map((member) => ({ ...member, onStationAt: FORMED, checkIn: { at: FORMED, model: null } })) };
    await handle(held, delivery(TESTER, { contentType: CHECK_IN, payload: { squadron: 'team-a1b2c3' } }));
    const onStation = delivery(TESTER, { contentType: ON_STATION, payload: { squadron: 'team-a1b2c3', role: 'tester' } });
    await handle(held, onStation);
    now = new Date('2026-10-03T09:20:00.000Z');

    await handle(held, onStation);

    expect(held.members.find((member) => member.shipId === TESTER)?.onStationAt).toEqual(NOW);
  });

  it('keeps a message and tells argo before it acks, and a message that comes again is kept once and told under the same key', async () => {
    const unknown = delivery(STRANGER, { contentType: 'text/plain', payload: 'Build login' });
    isAckRefused = true;
    await expect(handle(held, unknown)).resolves.toMatchObject({ isOk: false });
    expect(kept).toHaveLength(1);
    isAckRefused = false;

    await expect(handle(held, unknown)).resolves.toEqual({ isOk: true, value: 'kept' });

    expect(kept).toHaveLength(1);
    expect(told).toHaveLength(2);
    expect(told[1]).toEqual(told[0]);
    expect(told[0]?.key).toBe(`kept-${unknown.deliveryId}`);
    expect(told[0]?.fleetId).toBe(FLEET);
  });
});
