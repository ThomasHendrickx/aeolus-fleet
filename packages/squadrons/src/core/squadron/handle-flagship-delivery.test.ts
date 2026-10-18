import { PING_CONTENT_TYPE, type DeliveryId, type FleetId, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { beforeEach, describe, expect, it } from 'vitest';

import type { FleetDoor, ManagementCrewStore, OutgoingMessage } from '../management/ports.js';
import { err, ok } from '../shared/result.js';
import { CHARTER_MAX_BYTES } from '../catalogue/catalogue.js';
import { CHECK_IN, ON_STATION, ROLE, STAND_DOWN, STOOD_DOWN } from './check-in.js';
import { ADD_MEMBER, MEMBER_ADDED, MEMBER_REMOVED, RELAY, REFUSED, REMOVE_MEMBER, STANDING_DOWN } from './proxy-messages.js';
import { createAddMember } from './add-member.js';
import { NO_LIMITS } from './limits.js';
import { createRemoveMember } from './remove-member.js';
import { issuedPrompt } from '../../../test/support/management-fakes.js';
import { memoryAttempts } from '../../../test/support/memory-attempts.js';
import { createStandDown } from './stand-down.js';
import { createHandleFlagshipDelivery, type FlagshipDelivery } from './handle-flagship-delivery.js';
import type { FlagshipMessageLog, KeptMessage, OperatorNotices, Relay, RelayLog, SquadronRepository } from './ports.js';
import type { Squadron } from './squadron.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const FLAGSHIP: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0000';
const PLANNER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0001';
const TESTER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0002';
const STRANGER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0009';
const ARGO: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0010';
const FORMING: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0011';
const OWNER: ShipId = 'shp_01m3tbfspe96yf1rnr4ank0012';
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
      { repository: REPO, name: 'planner', version: 1, file: 'squadrons/fixture.yaml', commit: 'p1', committedAt: FORMED, description: 'Plans.', checkInMinutes: 120, model: null, launchNote: null, charter: 'You plan.', handoffs: [], crew: {}, parameters: [], scopes: [] },
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
        ], crew: {}, parameters: [], scopes: [],
      },
    ],
    flagship: { shipId: FLAGSHIP, name: 'team-a1b2c3', crewToken: 'aeolus_ct_v1_flagship' },
    members: [
      { shipId: PLANNER, name: 'planner-k3x9', role: 'planner', type: 'team-a1b2c3:planner', onStationAt: null, checkIn: null, standDownMessageId: null, stoodDownAt: null, retiredAt: null, releasingSince: null, parameters: {} },
      { shipId: TESTER, name: 'tester-m4p7', role: 'tester', type: 'team-a1b2c3:tester', onStationAt: null, checkIn: null, standDownMessageId: null, stoodDownAt: null, retiredAt: null, releasingSince: null, parameters: {} },
    ],
    formedAt: FORMED,
    sailedAt: null,
    formingShip: null,
  };
}

let held: Squadron;
const MANAGEMENT_CREW_TOKEN = 'aeolus_ct_v1_management';
/** The scopes the forming ship holds now, as the fleet answers squadrons' own ship. */
let formingShipScopes: string[];
/** Whether the forming ship is retired, and its owner, as the fleet answers squadrons' own ship. */
let formingShipStatus: 'crewed' | 'retired';
let formingShipOwner: ShipId | null;
/** The scopes the forming ship's owner holds now. */
let ownerScopes: string[];
const acked: DeliveryId[] = [];
const ponged: DeliveryId[] = [];
let isPongRefused: boolean;
const sent: OutgoingMessage[] = [];
let isAckRefused: boolean;
/** The ships the fleet commissioned for added members, and the crew requests it holds. */
const commissioned: ShipId[] = [];
const crewRequests = new Set<ShipId>();

const door: FleetDoor = {
  register: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used' })),
  whoami: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used' })),
  getShip: (crewToken, { shipId }) => {
    const ship = { lastSeenAt: NOW, crewedSince: NOW, reportedAt: null, openDeliveries: 0, inFlightDeliveries: 0, hasCrewRequest: false };
    if (crewToken === MANAGEMENT_CREW_TOKEN && shipId === FORMING) {
      return Promise.resolve(ok({ ...ship, status: formingShipStatus, scopes: formingShipScopes, ownerShipId: formingShipOwner }));
    }
    if (crewToken === MANAGEMENT_CREW_TOKEN && shipId === OWNER) {
      return Promise.resolve(ok({ ...ship, status: 'crewed' as const, scopes: ownerScopes, ownerShipId: null }));
    }
    return Promise.resolve(err({ code: 'FORBIDDEN', message: 'Needs fleet:read' }));
  },
  deregister: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used' })),
  commission: (_crewToken, { name }) => {
    const shipId: ShipId = `shp_01m3tbfspe96yf1rnr4ank${String(commissioned.length + 50).padStart(4, '0')}`;
    commissioned.push(shipId);
    return Promise.resolve(ok({ shipId, ...issuedPrompt(shipId, `aeolus_sk_v1_${name}`) }));
  },
  requestCrew: (_crewToken, { shipId }) => {
    crewRequests.add(shipId);
    return Promise.resolve(ok(undefined));
  },
  removeCrewRequest: (_crewToken, { shipId }) =>
    Promise.resolve(crewRequests.delete(shipId) ? ok(undefined) : err({ code: 'NOT_FOUND', message: 'It holds no crew request' })),
  findLabelValue: () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used' })),
  retire: () => Promise.resolve(ok(undefined)),
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
  pong: (crewToken, deliveryId) => {
    if (isPongRefused || crewToken !== 'aeolus_ct_v1_flagship') {
      return Promise.resolve(err({ code: 'CONFLICT', message: 'not in flight' }));
    }
    ponged.push(deliveryId);
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
const told: { fleetId: FleetId; headline: string; body: string; key: string }[] = [];
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

const relayed: Relay[] = [];
const relays: RelayLog = {
  record: (relay) => {
    relayed.push(relay);
    return Promise.resolve();
  },
  find: (_fleetId, relayMessageId) => Promise.resolve(relayed.find((each) => each.relayMessageId === relayMessageId)),
};

/** For each advance of the stand-downs, how many deliveries were acked by then. */
const advances: number[] = [];

let now = NOW;
const management: ManagementCrewStore = {
  find: (fleetId) => Promise.resolve({ fleetId, shipId: 'shp_01m3tbfspe96yf1rnr4ank9h1a', name: 'squadrons', crewToken: MANAGEMENT_CREW_TOKEN, crewedAt: FORMED }),
  binding: () => Promise.resolve(undefined),
  connected: () => Promise.resolve([]),
  save: () => Promise.resolve(),
  drop: () => Promise.resolve(),
};
const clock = { now: () => now };
const handle = createHandleFlagshipDelivery({
  door,
  squadrons,
  messages,
  operator,
  relays,
  management,
  standDown: createStandDown({ squadrons }),
  addMember: createAddMember({ door, management, squadrons, attempts: memoryAttempts(), random: { suffix: () => 'q8r2' }, clock, limits: NO_LIMITS }),
  removeMember: createRemoveMember({ door, management, squadrons, clock }),
  advanceStandDowns: () => {
    advances.push(acked.length);
    return Promise.resolve();
  },
  clock,
});

let next = 0;
function delivery(from: ShipId, message: { contentType: string; payload: unknown; inReplyTo?: MessageId }): FlagshipDelivery {
  next += 1;
  return {
    deliveryId: `dlv_01m3tbfspe96yf1rnr4ank${String(next).padStart(4, '0')}`,
    messageId: `msg_01m3tbfspe96yf1rnr4ank${String(next).padStart(4, '0')}`,
    senderShipId: from,
    senderName: from === STRANGER ? 'reviewer-01' : from === FORMING ? 'tech-lead' : from === ARGO ? 'argo' : from === OWNER ? 'thomas' : 'a-member',
    contentType: message.contentType,
    payload: typeof message.payload === 'string' ? message.payload : JSON.stringify(message.payload),
    inReplyTo: message.inReplyTo ?? null,
  };
}

beforeEach(() => {
  held = squadron();
  acked.length = 0;
  ponged.length = 0;
  isPongRefused = false;
  sent.length = 0;
  kept.length = 0;
  told.length = 0;
  isAckRefused = false;
  advances.length = 0;
  relayed.length = 0;
  formingShipScopes = ['messages:send', 'messages:receive', 'squadrons:form'];
  formingShipStatus = 'crewed';
  formingShipOwner = OWNER;
  ownerScopes = ['messages:send', 'messages:receive', 'squadrons:form'];
  commissioned.length = 0;
  crewRequests.clear();
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

  it("fills its charter's placeholders with the member's parameter values (#343)", async () => {
    held = {
      ...held,
      templates: held.templates.map((template) => (template.name === 'tester' ? { ...template, charter: 'You test {{area}} for {{lead}}.' } : template)),
      members: held.members.map((member) => (member.shipId === TESTER ? { ...member, parameters: { area: 'the API', lead: 'planner-k3x9' } } : member)),
    };

    await handle(held, delivery(TESTER, { contentType: CHECK_IN, payload: { squadron: 'team-a1b2c3' } }));

    expect(JSON.parse(sent[0]?.payload ?? '{}')).toMatchObject({ charter: 'You test the API for planner-k3x9.' });
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

  it('tells argo, so a kept message is not left unseen, in a headline naming the sender and the squadron in the body (#849)', async () => {
    await handle(held, delivery(STRANGER, { contentType: 'text/plain', payload: 'Build login' }));

    expect(told.map(({ headline, body }) => ({ headline, body }))).toEqual([
      {
        headline: 'reviewer-01 sent a flagship a message it does not handle',
        body: '- Squadron: `team-a1b2c3`\n- From: reviewer-01\n- Content type: `text/plain`\n\nsquadrons keeps it for the squadron page; nothing was forwarded.',
      },
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

describe("argo's ping of the flagship", () => {
  it('is answered with pong, not acked, and neither kept nor told to argo', async () => {
    const ping = delivery(ARGO, { contentType: PING_CONTENT_TYPE, payload: 'ping' });

    await expect(handle(held, ping)).resolves.toEqual({ isOk: true, value: 'ponged' });

    expect(ponged).toEqual([ping.deliveryId]);
    expect(acked).toEqual([]);
    expect(kept).toEqual([]);
    expect(told).toEqual([]);
  });

  it('is refused while the fleet does not take the pong', async () => {
    isPongRefused = true;

    await expect(handle(held, delivery(ARGO, { contentType: PING_CONTENT_TYPE, payload: 'ping' }))).resolves.toMatchObject({ isOk: false });

    expect(acked).toEqual([]);
  });
});

describe('the flagship proxying between its squadron and its forming ship (decision 0017)', () => {
  /** The squadron as a ship formed it by message. */
  function formedByTechLead(): Squadron {
    return { ...squadron(), formingShip: { shipId: FORMING, name: 'tech-lead', formKey: 'form-1' } };
  }

  it("sends a member's relay on to the forming ship, naming the squadron, the member, its role and its message", async () => {
    held = formedByTechLead();
    const relay = delivery(TESTER, { contentType: RELAY, payload: { squadron: 'team-a1b2c3', payload: 'Which branch?' } });

    await expect(handle(held, relay)).resolves.toEqual({ isOk: true, value: 'relayed' });

    expect(sent).toEqual([
      {
        selector: { kind: 'ship', shipId: FORMING },
        contentType: RELAY,
        idempotencyKey: `relay-${relay.deliveryId}`,
        payload: JSON.stringify({ squadron: 'team-a1b2c3', member: { name: 'tester-m4p7', role: 'tester' }, messageId: relay.messageId, payload: 'Which branch?' }),
      },
    ]);
    expect(acked).toEqual([relay.deliveryId]);
  });

  it("sends a member's relay on to argo for a squadron argo formed", async () => {
    await handle(held, delivery(TESTER, { contentType: RELAY, payload: { squadron: 'team-a1b2c3', payload: 'Which branch?' } }));

    expect(sent[0]?.selector).toEqual({ kind: 'ship', name: 'argo' });
  });

  it("refuses a member's relay that does not fit 64 KB with its envelope, asking for a reference, and sends nothing on", async () => {
    held = formedByTechLead();
    const relay = delivery(TESTER, { contentType: RELAY, payload: { squadron: 'team-a1b2c3', payload: 'x'.repeat(64 * 1024 - 100) } });

    await handle(held, relay);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ selector: { kind: 'ship', shipId: TESTER }, contentType: REFUSED, inReplyTo: relay.messageId });
    expect(JSON.parse(sent[0]?.payload ?? '')).toMatchObject({ squadron: 'team-a1b2c3', code: 'PAYLOAD_TOO_LARGE' });
    expect(acked).toEqual([relay.deliveryId]);
  });

  it("sends the forming ship's answer to a relay to the member, as a reply to the member's message", async () => {
    held = formedByTechLead();
    const asked = delivery(TESTER, { contentType: RELAY, payload: { squadron: 'team-a1b2c3', payload: 'Which branch?' } });
    await handle(held, asked);
    sent.length = 0;
    const answer = delivery(FORMING, { contentType: RELAY, payload: { squadron: 'team-a1b2c3', payload: 'main' }, inReplyTo: 'msg_01m3tbfspe96yf1rnr4ank0100' });

    await expect(handle(held, answer)).resolves.toEqual({ isOk: true, value: 'relayed' });

    expect(sent).toEqual([
      {
        selector: { kind: 'ship', shipId: TESTER },
        contentType: RELAY,
        inReplyTo: asked.messageId,
        idempotencyKey: `relay-${answer.deliveryId}`,
        payload: JSON.stringify({ squadron: 'team-a1b2c3', from: 'tech-lead', payload: 'main' }),
      },
    ]);
  });

  it("sends the forming ship's relay naming a member to that member", async () => {
    held = formedByTechLead();

    await handle(held, delivery(FORMING, { contentType: RELAY, payload: { squadron: 'team-a1b2c3', to: { member: 'planner-k3x9' }, payload: 'Plan the login.' } }));

    expect(sent[0]).toMatchObject({ selector: { kind: 'ship', shipId: PLANNER }, contentType: RELAY });
    expect(JSON.parse(sent[0]?.payload ?? '')).toEqual({ squadron: 'team-a1b2c3', from: 'tech-lead', payload: 'Plan the login.' });
  });

  it("sends the forming ship's relay naming a role to one ship of the role", async () => {
    held = formedByTechLead();

    await handle(held, delivery(FORMING, { contentType: RELAY, payload: { squadron: 'team-a1b2c3', to: { role: 'tester' }, payload: 'Test main.' } }));

    expect(sent[0]?.selector).toEqual({ kind: 'type', type: 'team-a1b2c3:tester' });
  });

  it("refuses the forming ship's relay to a member the squadron does not have, naming it", async () => {
    held = formedByTechLead();
    const relay = delivery(FORMING, { contentType: RELAY, payload: { squadron: 'team-a1b2c3', to: { member: 'coder-zz11' }, payload: 'Code.' } });

    await handle(held, relay);

    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ selector: { kind: 'ship', shipId: FORMING }, contentType: REFUSED, inReplyTo: relay.messageId });
    expect(sent[0]?.payload).toContain('coder-zz11');
  });

  it('tells the forming ship, not argo, of a message it keeps, in a headline naming the sender and the squadron in the body', async () => {
    held = formedByTechLead();
    const unknown = delivery(STRANGER, { contentType: 'text/plain', payload: 'Build login' });

    await expect(handle(held, unknown)).resolves.toEqual({ isOk: true, value: 'kept' });

    expect(told).toEqual([]);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ selector: { kind: 'ship', shipId: FORMING }, contentType: 'text/markdown', idempotencyKey: `kept-${unknown.deliveryId}` });
    expect(sent[0]?.payload.split('\n')[0]).toBe('reviewer-01 sent a flagship a message it does not handle');
    expect(sent[0]?.payload).toContain('team-a1b2c3');
    expect(acked).toEqual([unknown.deliveryId]);
  });

  it('keeps a relay from a ship that is neither a member nor the forming ship, and sends nothing on', async () => {
    held = formedByTechLead();

    await expect(handle(held, delivery(STRANGER, { contentType: RELAY, payload: { squadron: 'team-a1b2c3', payload: 'Hi.' } }))).resolves.toEqual({ isOk: true, value: 'kept' });

    expect(sent.filter((each) => each.contentType === RELAY)).toEqual([]);
  });
});

describe('standing a squadron down by message to its flagship (decision 0017)', () => {
  function sailingFormedByTechLead(): Squadron {
    return { ...squadron(), state: 'sailing', sailedAt: NOW, formingShip: { shipId: FORMING, name: 'tech-lead', formKey: 'form-1' } };
  }

  it('stands the squadron down for its forming ship holding squadrons:form, sends each member its stand-down and answers standing down', async () => {
    held = sailingFormedByTechLead();
    const standDown = delivery(FORMING, { contentType: STAND_DOWN, payload: { squadron: 'team-a1b2c3' } });

    await expect(handle(held, standDown)).resolves.toEqual({ isOk: true, value: 'standing-down' });

    expect(held.state).toBe('standing-down');
    expect(advances).toHaveLength(1);
    expect(sent).toEqual([
      {
        selector: { kind: 'ship', shipId: FORMING },
        contentType: STANDING_DOWN,
        inReplyTo: standDown.messageId,
        idempotencyKey: `standing-down-${standDown.deliveryId}`,
        payload: JSON.stringify({ squadron: 'team-a1b2c3' }),
      },
    ]);
    expect(acked).toEqual([standDown.deliveryId]);
  });

  it('stands the squadron down for argo, whoever formed it', async () => {
    held = sailingFormedByTechLead();

    await expect(handle(held, delivery(ARGO, { contentType: STAND_DOWN, payload: { squadron: 'team-a1b2c3' } }))).resolves.toEqual({ isOk: true, value: 'standing-down' });

    expect(held.state).toBe('standing-down');
  });

  it('refuses any other ship, and the squadron sails on', async () => {
    held = sailingFormedByTechLead();
    const standDown = delivery(STRANGER, { contentType: STAND_DOWN, payload: { squadron: 'team-a1b2c3' } });

    await expect(handle(held, standDown)).resolves.toEqual({ isOk: true, value: 'refused' });

    expect(held.state).toBe('sailing');
    expect(sent[0]).toMatchObject({ selector: { kind: 'ship', shipId: STRANGER }, contentType: REFUSED, inReplyTo: standDown.messageId });
    expect(JSON.parse(sent[0]?.payload ?? '')).toMatchObject({ squadron: 'team-a1b2c3', code: 'NOT_FORMING_SHIP' });
  });

  it('refuses its forming ship once it no longer holds squadrons:form, naming the scope', async () => {
    held = sailingFormedByTechLead();
    formingShipScopes = ['messages:send', 'messages:receive'];

    await handle(held, delivery(FORMING, { contentType: STAND_DOWN, payload: { squadron: 'team-a1b2c3' } }));

    expect(held.state).toBe('sailing');
    expect(JSON.parse(sent[0]?.payload ?? '')).toMatchObject({ code: 'NEEDS_SCOPE' });
    expect(sent[0]?.payload).toContain('squadrons:form');
  });

  it('refuses a squadron that is still forming: only a sailing squadron stands down by message', async () => {
    held = { ...sailingFormedByTechLead(), state: 'forming', sailedAt: null };

    await handle(held, delivery(FORMING, { contentType: STAND_DOWN, payload: { squadron: 'team-a1b2c3' } }));

    expect(held.state).toBe('forming');
    expect(JSON.parse(sent[0]?.payload ?? '')).toMatchObject({ code: 'NOT_SAILING' });
  });
});

describe('a retired forming ship: its owner takes its place (0.R)', () => {
  function sailingFormedByTechLead(): Squadron {
    return { ...squadron(), state: 'sailing', sailedAt: NOW, formingShip: { shipId: FORMING, name: 'tech-lead', formKey: 'form-1' } };
  }

  beforeEach(() => {
    held = sailingFormedByTechLead();
    formingShipStatus = 'retired';
  });

  it("sends a member's relay on to the forming ship's owner", async () => {
    const relay = delivery(TESTER, { contentType: RELAY, payload: { squadron: 'team-a1b2c3', payload: 'Which branch?' } });

    await expect(handle(held, relay)).resolves.toEqual({ isOk: true, value: 'relayed' });

    expect(sent.map(({ selector }) => selector)).toEqual([{ kind: 'ship', shipId: OWNER }]);
    expect(acked).toEqual([relay.deliveryId]);
  });

  it("sends a member's relay on to argo when the retired forming ship has no owner the fleet names", async () => {
    formingShipOwner = null;

    await handle(held, delivery(TESTER, { contentType: RELAY, payload: { squadron: 'team-a1b2c3', payload: 'Which branch?' } }));

    expect(sent.map(({ selector }) => selector)).toEqual([{ kind: 'ship', name: 'argo' }]);
  });

  it('still sends to the forming ship while it is not retired', async () => {
    formingShipStatus = 'crewed';

    await handle(held, delivery(TESTER, { contentType: RELAY, payload: { squadron: 'team-a1b2c3', payload: 'Which branch?' } }));

    expect(sent.map(({ selector }) => selector)).toEqual([{ kind: 'ship', shipId: FORMING }]);
  });

  it("sends the owner's relay naming a member on to that member", async () => {
    await expect(
      handle(held, delivery(OWNER, { contentType: RELAY, payload: { squadron: 'team-a1b2c3', to: { member: 'planner-k3x9' }, payload: 'Pause.' } })),
    ).resolves.toEqual({ isOk: true, value: 'relayed' });

    expect(sent[0]).toMatchObject({ selector: { kind: 'ship', shipId: PLANNER }, contentType: RELAY });
    expect(JSON.parse(sent[0]?.payload ?? '')).toEqual({ squadron: 'team-a1b2c3', from: 'thomas', payload: 'Pause.' });
  });

  it('keeps a relay from the owner while the forming ship is not retired', async () => {
    formingShipStatus = 'crewed';

    await expect(handle(held, delivery(OWNER, { contentType: RELAY, payload: { squadron: 'team-a1b2c3', to: { member: 'planner-k3x9' }, payload: 'Pause.' } }))).resolves.toEqual({
      isOk: true,
      value: 'kept',
    });
  });

  it('tells the owner of a message it keeps', async () => {
    const unknown = delivery(STRANGER, { contentType: 'text/plain', payload: 'Build login' });

    await handle(held, unknown);

    expect(sent).toEqual([expect.objectContaining({ selector: { kind: 'ship', shipId: OWNER }, idempotencyKey: `kept-${unknown.deliveryId}` })]);
  });

  it('tells argo of a message it keeps when the retired forming ship has no owner the fleet names', async () => {
    formingShipOwner = null;
    const unknown = delivery(STRANGER, { contentType: 'text/plain', payload: 'Build login' });

    await handle(held, unknown);

    expect(sent).toEqual([]);
    expect(told.map(({ key }) => key)).toEqual([`kept-${unknown.deliveryId}`]);
  });

  it('stands the squadron down for the owner holding squadrons:form', async () => {
    await expect(handle(held, delivery(OWNER, { contentType: STAND_DOWN, payload: { squadron: 'team-a1b2c3' } }))).resolves.toEqual({ isOk: true, value: 'standing-down' });

    expect(held.state).toBe('standing-down');
  });

  it('refuses the owner without squadrons:form, naming the scope', async () => {
    ownerScopes = ['messages:send', 'messages:receive'];

    await handle(held, delivery(OWNER, { contentType: STAND_DOWN, payload: { squadron: 'team-a1b2c3' } }));

    expect(held.state).toBe('sailing');
    expect(JSON.parse(sent[0]?.payload ?? '')).toMatchObject({ code: 'NEEDS_SCOPE' });
  });

  it('refuses the owner while the forming ship is not retired', async () => {
    formingShipStatus = 'crewed';

    await handle(held, delivery(OWNER, { contentType: STAND_DOWN, payload: { squadron: 'team-a1b2c3' } }));

    expect(held.state).toBe('sailing');
    expect(JSON.parse(sent[0]?.payload ?? '')).toMatchObject({ code: 'NOT_FORMING_SHIP' });
  });
});

describe('scaling a squadron by message to its flagship (decision 0017)', () => {
  /** A sailing squadron a ship formed, its roles crewed by request. */
  function sailingFormedByTechLead(): Squadron {
    const formed = squadron();
    const roles = formed.blueprint.roles.map((role) => ({ ...role, crew: { workspace: { kind: 'worktree' as const, repository: 'hemma' } } }));
    return { ...formed, state: 'sailing', sailedAt: NOW, blueprint: { ...formed.blueprint, roles }, formingShip: { shipId: FORMING, name: 'tech-lead', formKey: 'form-1' } };
  }
  const addTester = (from: ShipId, key = 'add-1') => delivery(from, { contentType: ADD_MEMBER, payload: { squadron: 'team-a1b2c3', role: 'tester', key } });
  const removePlanner = (from: ShipId) => delivery(from, { contentType: REMOVE_MEMBER, payload: { squadron: 'team-a1b2c3', member: 'planner-k3x9' } });

  beforeEach(() => {
    held = sailingFormedByTechLead();
    formingShipScopes = ['messages:send', 'messages:receive', 'squadrons:scale'];
  });

  it('adds a member of the role for its forming ship holding squadrons:scale, and answers member-added with its name, role and the key', async () => {
    const add = addTester(FORMING);

    await expect(handle(held, add)).resolves.toEqual({ isOk: true, value: 'member-added' });

    expect(held.members.map(({ name, role }) => ({ name, role }))).toEqual([
      { name: 'planner-k3x9', role: 'planner' },
      { name: 'tester-m4p7', role: 'tester' },
      { name: 'tester-q8r2', role: 'tester' },
    ]);
    expect(sent).toEqual([
      {
        selector: { kind: 'ship', shipId: FORMING },
        contentType: MEMBER_ADDED,
        inReplyTo: add.messageId,
        idempotencyKey: `member-added-${add.deliveryId}`,
        payload: JSON.stringify({ squadron: 'team-a1b2c3', key: 'add-1', member: { name: 'tester-q8r2', role: 'tester' } }),
      },
    ]);
    expect(acked).toEqual([add.deliveryId]);
  });

  it('answers a request that comes again under its key with the first answer, and adds no second member', async () => {
    await handle(held, addTester(FORMING));
    sent.length = 0;

    await handle(held, addTester(FORMING));

    expect(commissioned).toHaveLength(1);
    expect(JSON.parse(sent[0]?.payload ?? '')).toEqual({ squadron: 'team-a1b2c3', key: 'add-1', member: { name: 'tester-q8r2', role: 'tester' } });
  });

  it('adds a member for argo, whoever formed the squadron', async () => {
    await expect(handle(held, addTester(ARGO))).resolves.toEqual({ isOk: true, value: 'member-added' });
  });

  it('adds a member for the owner holding squadrons:scale once the forming ship is retired', async () => {
    formingShipStatus = 'retired';
    ownerScopes = ['messages:send', 'messages:receive', 'squadrons:scale'];

    await expect(handle(held, addTester(OWNER))).resolves.toEqual({ isOk: true, value: 'member-added' });
  });

  it('refuses its forming ship without squadrons:scale, naming the scope, and adds nothing', async () => {
    formingShipScopes = ['messages:send', 'messages:receive', 'squadrons:form'];

    await expect(handle(held, addTester(FORMING))).resolves.toEqual({ isOk: true, value: 'refused' });

    expect(commissioned).toEqual([]);
    expect(JSON.parse(sent[0]?.payload ?? '')).toMatchObject({ squadron: 'team-a1b2c3', code: 'NEEDS_SCOPE' });
    expect(sent[0]?.payload).toContain('squadrons:scale');
  });

  it('refuses any other ship, and adds nothing', async () => {
    await handle(held, addTester(STRANGER));

    expect(commissioned).toEqual([]);
    expect(sent[0]).toMatchObject({ selector: { kind: 'ship', shipId: STRANGER }, contentType: REFUSED });
    expect(JSON.parse(sent[0]?.payload ?? '')).toMatchObject({ code: 'NOT_FORMING_SHIP' });
  });

  it("answers adding's refusal with its kind as the code", async () => {
    await handle(held, delivery(FORMING, { contentType: ADD_MEMBER, payload: { squadron: 'team-a1b2c3', role: 'designer', key: 'add-1' } }));

    expect(sent[0]).toMatchObject({ contentType: REFUSED });
    expect(JSON.parse(sent[0]?.payload ?? '')).toMatchObject({ code: 'ROLE_NOT_FOUND' });
  });

  it("keeps a member's add-member request as a message the flagship does not handle", async () => {
    await expect(handle(held, addTester(PLANNER))).resolves.toEqual({ isOk: true, value: 'kept' });

    expect(commissioned).toEqual([]);
  });

  it('removes a member by its name for its forming ship holding squadrons:scale, and answers member-removed', async () => {
    const remove = removePlanner(FORMING);

    await expect(handle(held, remove)).resolves.toEqual({ isOk: true, value: 'member-removed' });

    expect(held.members.find((each) => each.shipId === PLANNER)?.retiredAt).toEqual(NOW);
    expect(sent).toEqual([
      {
        selector: { kind: 'ship', shipId: FORMING },
        contentType: MEMBER_REMOVED,
        inReplyTo: remove.messageId,
        idempotencyKey: `member-removed-${remove.deliveryId}`,
        payload: JSON.stringify({ squadron: 'team-a1b2c3', member: 'planner-k3x9' }),
      },
    ]);
    expect(acked).toEqual([remove.deliveryId]);
  });

  it('answers member-removed again for a member already removed', async () => {
    held = { ...held, members: held.members.map((each) => (each.shipId === PLANNER ? { ...each, retiredAt: FORMED } : each)) };

    await expect(handle(held, removePlanner(FORMING))).resolves.toEqual({ isOk: true, value: 'member-removed' });

    expect(held.members.find((each) => each.shipId === PLANNER)?.retiredAt).toEqual(FORMED);
  });

  it('refuses a member the squadron does not have, naming it', async () => {
    await handle(held, delivery(FORMING, { contentType: REMOVE_MEMBER, payload: { squadron: 'team-a1b2c3', member: 'coder-zz11' } }));

    expect(JSON.parse(sent[0]?.payload ?? '')).toMatchObject({ code: 'NO_SUCH_MEMBER' });
    expect(sent[0]?.payload).toContain('coder-zz11');
  });

  it('refuses removing for its forming ship without squadrons:scale, and removes nothing', async () => {
    formingShipScopes = ['messages:send', 'messages:receive'];

    await handle(held, removePlanner(FORMING));

    expect(held.members.find((each) => each.shipId === PLANNER)?.retiredAt).toBeNull();
    expect(JSON.parse(sent[0]?.payload ?? '')).toMatchObject({ code: 'NEEDS_SCOPE' });
  });
});
