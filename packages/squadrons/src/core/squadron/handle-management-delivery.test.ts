import { PING_CONTENT_TYPE, type DeliveryId, type FleetId, type MessageId, type ShipId } from '@aeolus-fleet/common';
import { assert, beforeEach, describe, expect, it } from 'vitest';

import type { BlueprintVersion, Catalogue, TemplateVersion } from '../catalogue/catalogue.js';
import type { FleetDoor, FleetShip, ManagementCrew, ManagementCrewStore, OutgoingMessage } from '../management/ports.js';
import { err, ok } from '../shared/result.js';
import { issuedPrompt } from '../../../test/support/management-fakes.js';
import { memoryAttempts } from '../../../test/support/memory-attempts.js';
import { createFormSquadron } from './form-squadron.js';
import { FORM, FORM_REFUSED, FORMED } from './form-messages.js';
import { createHandleManagementDelivery, type HandleManagementDelivery } from './handle-management-delivery.js';
import type { FormRefusals, OperatorNotices, SquadronRepository } from './ports.js';
import type { Squadron } from './squadron.js';

const FLEET: FleetId = 'flt_01m3tb1zgr5h2ffee12xnch8sv';
const MANAGEMENT: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9h1a';
const TECH_LEAD: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9t00';
const AT = new Date('2026-10-18T09:00:00.000Z');
const REPO = 'example.com/templates';
const CREW: ManagementCrew = { fleetId: FLEET, shipId: MANAGEMENT, name: 'squadrons', crewToken: 'aeolus_ct_v1_management', crewedAt: AT };

const builder: TemplateVersion = {
  repository: REPO,
  name: 'builder',
  version: 1,
  file: 'templates/builder.yaml',
  commit: 'c1',
  committedAt: AT,
  description: 'Builds.',
  checkInMinutes: 30,
  model: null,
  launchNote: null,
  charter: 'You build {{area}}.',
  handoffs: [],
  crew: { workspace: { kind: 'worktree', repository: 'hemma' } },
  parameters: [{ name: 'area', description: 'What to build' }],
  scopes: [],
};
const delivery: BlueprintVersion = {
  repository: REPO,
  name: 'delivery',
  version: 3,
  file: 'blueprints/delivery.yaml',
  commit: 'b3',
  committedAt: AT,
  description: 'Delivers one outcome.',
  roles: [{ name: 'builder', template: { repository: REPO, name: 'builder', version: 1 }, count: 1, model: null, crew: {}, parameters: {} }],
  handoffs: [],
  memberNames: 'plain',
};
const catalogue: Catalogue = { templates: [builder], blueprints: [delivery], problems: [] };

let senderScopes: string[];
let commissioned: { name: string; type: string }[];
let sent: OutgoingMessage[];
let acked: DeliveryId[];
let ponged: DeliveryId[];
let told: { headline: string; key: string }[];
let held: Squadron[];
let refusals: { formingShipId: ShipId; key: string; code: string; message: string }[];
let handle: HandleManagementDelivery;

function aShip(scopes: string[]): FleetShip {
  return { status: 'crewed', scopes, lastSeenAt: AT, crewedSince: AT, reportedAt: null, openDeliveries: 0, inFlightDeliveries: 0, hasCrewRequest: false };
}

function fleetDoor(): FleetDoor {
  let next = 0;
  const notUsed = () => Promise.resolve(err({ code: 'FORBIDDEN', message: 'not used here' }));
  return {
    register: ({ shipId }) => Promise.resolve(ok({ crewToken: `aeolus_ct_v1_${shipId}` })),
    whoami: notUsed,
    getShip: (_crewToken, { shipId }) =>
      Promise.resolve(shipId === MANAGEMENT ? ok(aShip(['fleet:read', 'fleet:commission'])) : shipId === TECH_LEAD ? ok(aShip(senderScopes)) : err({ code: 'NOT_FOUND', message: 'No such ship' })),
    deregister: notUsed,
    commission: (_crewToken, { name, type }) => {
      next += 1;
      const shipId: ShipId = `shp_01m3tbfspe96yf1rnr4ank${String(next).padStart(4, '0')}`;
      commissioned.push({ name, type });
      return Promise.resolve(ok({ shipId, ...issuedPrompt(shipId, `aeolus_sk_v1_${name}`) }));
    },
    release: notUsed,
    getStartingPrompt: notUsed,
    listShips: () => Promise.resolve(ok([])),
    retire: () => Promise.resolve(ok(undefined)),
    requestCrew: () => Promise.resolve(ok(undefined)),
    removeCrewRequest: notUsed,
    findLabelValue: notUsed,
    receive: () => Promise.resolve(ok([])),
    ack: (crewToken, deliveryId) => {
      acked.push(deliveryId);
      return Promise.resolve(crewToken === CREW.crewToken ? ok(undefined) : err({ code: 'UNAUTHORIZED', message: 'wrong crew token' }));
    },
    pong: (_crewToken, deliveryId) => {
      ponged.push(deliveryId);
      return Promise.resolve(ok(undefined));
    },
    send: (_crewToken, message) => {
      sent.push(message);
      return Promise.resolve(ok({ messageId: 'msg_01m3tbfspe96yf1rnr4ank0100' satisfies MessageId }));
    },
  };
}

const squadrons: SquadronRepository = {
  exists: (fleetId, id) => Promise.resolve(held.some((each) => each.fleetId === fleetId && each.id === id)),
  create: (squadron) => {
    held.push(structuredClone(squadron));
    return Promise.resolve();
  },
  list: (fleetId) => Promise.resolve(held.filter((each) => each.fleetId === fleetId)),
  update: () => Promise.resolve(),
};

const formRefusals: FormRefusals = {
  find: (_fleetId, { formingShipId, key }) => Promise.resolve(refusals.find((each) => each.formingShipId === formingShipId && each.key === key)),
  keep: (refusal) => {
    refusals.push(refusal);
    return Promise.resolve();
  },
};

const operator: OperatorNotices = {
  tell: (notice) => {
    told.push({ headline: notice.headline, key: notice.key });
    return Promise.resolve();
  },
};

const management: ManagementCrewStore = {
  find: () => Promise.resolve(CREW),
  binding: () => Promise.resolve({ fleetId: FLEET, shipId: MANAGEMENT }),
  connected: () => Promise.resolve([CREW]),
  save: () => Promise.resolve(),
  drop: () => Promise.resolve(),
};

let deliveries = 0;
function aFormRequest(payload: unknown, contentType = FORM) {
  deliveries += 1;
  const number = String(deliveries).padStart(4, '0');
  return {
    deliveryId: `dlv_01m3tbfspe96yf1rnr4ank${number}` satisfies DeliveryId,
    messageId: `msg_01m3tbfspe96yf1rnr4ank${number}` satisfies MessageId,
    senderShipId: TECH_LEAD,
    senderName: 'tech-lead',
    contentType,
    payload: typeof payload === 'string' ? payload : JSON.stringify(payload),
    inReplyTo: null,
  };
}

const formDelivery = { blueprint: `${REPO}#delivery@3`, squadronId: 'login-flow', members: { 'builder-1': { parameters: { area: 'the login flow' } } }, key: 'form-1' };

/** The payload of the one answer sent, parsed. */
function answer(): unknown {
  expect(sent).toHaveLength(1);
  return JSON.parse(sent[0]?.payload ?? '');
}

beforeEach(() => {
  senderScopes = ['messages:send', 'messages:receive', 'squadrons:form'];
  commissioned = [];
  sent = [];
  acked = [];
  ponged = [];
  told = [];
  held = [];
  refusals = [];
  const door = fleetDoor();
  const attempts = memoryAttempts();
  const form = createFormSquadron({ door, management, squadrons, attempts, catalogue: () => catalogue, random: { suffix: (length) => 'k3x9abcd'.slice(0, length) }, clock: { now: () => AT } });
  handle = createHandleManagementDelivery({ door, squadrons, refusals: formRefusals, form, operator });
});

describe('a ship forming a squadron by message to squadrons (decision 0017)', () => {
  it('forms the squadron for a sender holding squadrons:form, and answers it formed with the squadron id and its flagship', async () => {
    const request = aFormRequest(formDelivery);

    await expect(handle(CREW, request)).resolves.toEqual({ isOk: true, value: 'formed' });

    expect(commissioned).toEqual([
      { name: 'login-flow', type: 'flagship' },
      { name: 'builder-k3x9', type: 'login-flow:builder' },
    ]);
    expect(sent[0]).toMatchObject({ selector: { kind: 'ship', shipId: TECH_LEAD }, contentType: FORMED, inReplyTo: request.messageId });
    expect(answer()).toEqual({ key: 'form-1', squadronId: 'login-flow', flagship: 'login-flow' });
    expect(acked).toEqual([request.deliveryId]);
  });

  it('keeps the sender as the forming ship, by the id and name the fleet gives, never a name in the payload', async () => {
    await handle(CREW, aFormRequest({ ...formDelivery, formingShip: 'someone-else' }));

    expect(held[0]?.formingShip).toEqual({ shipId: TECH_LEAD, name: 'tech-lead', formKey: 'form-1' });
  });

  it('fills the members parameters the request gives', async () => {
    await handle(CREW, aFormRequest(formDelivery));

    expect(held[0]?.members[0]?.parameters).toEqual({ area: 'the login flow' });
  });

  it('carries no crew line or secret in its answer', async () => {
    await handle(CREW, aFormRequest(formDelivery));

    expect(sent[0]?.payload).not.toContain('aeolus_sk_v1');
  });

  it('refuses a sender without squadrons:form, naming the scope, and commissions nothing', async () => {
    senderScopes = ['messages:send', 'messages:receive'];

    await expect(handle(CREW, aFormRequest(formDelivery))).resolves.toEqual({ isOk: true, value: 'refused' });

    expect(commissioned).toEqual([]);
    expect(sent[0]?.contentType).toBe(FORM_REFUSED);
    expect(answer()).toMatchObject({ key: 'form-1', code: 'NEEDS_SCOPE' });
    expect(JSON.stringify(answer())).toContain('squadrons:form');
  });

  it('refuses a blueprint the catalogue does not hold, naming the problem, and commissions nothing', async () => {
    await handle(CREW, aFormRequest({ ...formDelivery, blueprint: `${REPO}#delivery@9` }));

    expect(commissioned).toEqual([]);
    expect(answer()).toMatchObject({ key: 'form-1', code: 'BLUEPRINT_NOT_FOUND' });
  });

  it.each([
    ['no JSON', 'form it please'],
    ['no key', JSON.stringify({ blueprint: `${REPO}#delivery@3` })],
    ['a blueprint that is no <repository>#<name>@<n>', JSON.stringify({ ...formDelivery, blueprint: 'delivery' })],
  ])('refuses a request with %s, and commissions nothing', async (_what, payload) => {
    await expect(handle(CREW, aFormRequest(payload))).resolves.toEqual({ isOk: true, value: 'refused' });

    expect(commissioned).toEqual([]);
    expect(sent[0]?.contentType).toBe(FORM_REFUSED);
    expect(answer()).toMatchObject({ code: 'INVALID_FORM_REQUEST' });
  });

  it('answers a repeat of a key the squadron it formed, and forms nothing again', async () => {
    await handle(CREW, aFormRequest(formDelivery));
    sent = [];

    await expect(handle(CREW, aFormRequest({ ...formDelivery, squadronId: 'another' }))).resolves.toEqual({ isOk: true, value: 'repeated' });

    expect(commissioned).toHaveLength(2);
    expect(answer()).toEqual({ key: 'form-1', squadronId: 'login-flow', flagship: 'login-flow' });
  });

  it('answers a repeat of a refused key its first refusal, though the sender holds the scope now', async () => {
    senderScopes = [];
    await handle(CREW, aFormRequest(formDelivery));
    senderScopes = ['squadrons:form'];
    sent = [];

    await expect(handle(CREW, aFormRequest(formDelivery))).resolves.toEqual({ isOk: true, value: 'repeated' });

    expect(commissioned).toEqual([]);
    expect(answer()).toMatchObject({ key: 'form-1', code: 'NEEDS_SCOPE' });
  });

  it('acknowledges another message, tells argo, and forms nothing', async () => {
    const other = aFormRequest('hello', 'text/plain');

    await expect(handle(CREW, other)).resolves.toEqual({ isOk: true, value: 'kept' });

    expect(acked).toEqual([other.deliveryId]);
    expect(told).toEqual([{ headline: 'tech-lead sent squadrons a message it does not handle', key: `management-kept-${other.deliveryId}` }]);
    expect(commissioned).toEqual([]);
  });

  it("answers argo's ping with pong", async () => {
    const ping = aFormRequest('', PING_CONTENT_TYPE);

    await expect(handle(CREW, ping)).resolves.toEqual({ isOk: true, value: 'ponged' });

    expect(ponged).toEqual([ping.deliveryId]);
  });

  it('acknowledges nothing while it cannot read the sender, so the delivery comes again', async () => {
    const unknownShip: ShipId = 'shp_01m3tbfspe96yf1rnr4ank9z99';
    const stranger = { ...aFormRequest(formDelivery), senderShipId: unknownShip };

    const handled = await handle(CREW, stranger);

    assert(!handled.isOk);
    expect(acked).toEqual([]);
    expect(commissioned).toEqual([]);
  });
});
