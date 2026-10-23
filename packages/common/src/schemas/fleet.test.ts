import { describe, expect, it } from 'vitest';

import { createIdGenerator } from '../ids/index.js';
import {
  commissionShipInputSchema,
  fleetEventsInputSchema,
  fleetLimitsOutputSchema,
  fleetListOutputSchema,
  isInReadReach,
  fleetStreamItemSchema,
  getStartingPromptInputSchema,
  pingStateSchema,
  recrewShipInputSchema,
  releaseShipInputSchema,
  releaseShipOutputSchema,
  renameShipInputSchema,
  retireShipInputSchema,
  retireShipOutputSchema,
  shipHandleSchema,
  commissionShipOutputSchema,
  startingPromptOutputSchema,
} from './fleet.js';

const newId = createIdGenerator();

describe('shipHandleSchema', () => {
  it.each(['scout', 'reviewer-2', '42', 'a', '-'])('accepts %j: lowercase letters, digits and hyphens', (handle) => {
    expect(shipHandleSchema.parse(handle)).toBe(handle);
  });

  it.each(['hemmafeaturea1b2c3:planner', 'squad:reviewer-2', 'a:b:c', ':'])(
    'accepts %j: a colon is an ordinary character',
    (handle) => {
      expect(shipHandleSchema.parse(handle)).toBe(handle);
    },
  );

  it('accepts 48 characters', () => {
    expect(shipHandleSchema.safeParse('a'.repeat(48)).success).toBe(true);
  });

  it('says what a handle may hold', () => {
    expect(shipHandleSchema.safeParse('Scout').error?.issues[0]?.message).toBe(
      'Use 1 to 48 lowercase letters, digits, hyphens or colons',
    );
  });

  it.each([
    ['49 characters', 'a'.repeat(49)],
    ['an empty handle', ''],
    ['an uppercase letter', 'Scout'],
    ['a space', 'sea scout'],
    ['spaces around it', ' scout '],
    ['an underscore', 'sea_scout'],
    ['a dot', 'sea.scout'],
    ['a letter outside a to z', 'zée'],
    ['an uppercase letter beside a colon', 'Hemma:planner'],
  ])('rejects %s', (_label, handle) => {
    expect(shipHandleSchema.safeParse(handle).success).toBe(false);
  });
});

describe('commissionShipInputSchema', () => {
  it('accepts a name, a type and a note', () => {
    const input = { name: 'scout', type: 'reviewer', note: 'reviews pull requests', idempotencyKey: 'commission-scout' };

    expect(commissionShipInputSchema.parse(input)).toEqual(input);
  });

  it('accepts a plugin scope to add to the ship: the fleet checks what the commissioner may grant (decision 0046)', () => {
    const input = { name: 'former', type: 'reviewer', scopes: ['squadrons:form'], idempotencyKey: 'commission-former' };

    expect(commissionShipInputSchema.parse(input)).toEqual(input);
  });

  it('accepts fleet scopes to add to the ship', () => {
    const input = { name: 'manager', type: 'squadron', scopes: ['fleet:read', 'fleet:manage'], idempotencyKey: 'commission-manager' };

    expect(commissionShipInputSchema.parse(input)).toEqual(input);
  });

  it('accepts crew:run among the fleet scopes, for a trierarch', () => {
    const input = { name: 'mac-mini', type: 'trierarch', scopes: ['crew:run'], idempotencyKey: 'commission-mac-mini' };

    expect(commissionShipInputSchema.parse(input)).toEqual(input);
  });

  it('accepts the label values to give the new ship, up to the 20 a ship carries (decision 0053)', () => {
    const input = { name: 'thomas', type: 'person', kind: 'person', valueIds: Array.from({ length: 20 }, () => newId('labelValue')), idempotencyKey: 'person-thomas' };

    expect(commissionShipInputSchema.parse(input)).toEqual(input);
  });

  it.each([
    ['21 label values', Array.from({ length: 21 }, () => newId('labelValue'))],
    ['a label id for a value', [newId('label')]],
  ])('rejects %s', (_label, valueIds) => {
    expect(commissionShipInputSchema.safeParse({ name: 'thomas', type: 'person', valueIds, idempotencyKey: 'person-thomas' }).success).toBe(false);
  });

  it.each([
    ['an unknown core scope', ['fleet:own']],
    ['a scope with no action', ['squadrons']],
  ])('rejects %s among the scopes', (_label, scopes) => {
    expect(commissionShipInputSchema.safeParse({ name: 'manager', type: 'squadron', scopes }).success).toBe(false);
  });

  it("accepts the ship that asked a plugin's ship for this one, whose owner it gets (decision 0045)", () => {
    const input = { name: 'login-flow', type: 'flagship', ownerOf: 'shp_01m3tbfspe96yf1rnr4ank0001', idempotencyKey: 'commission-login-flow' };

    expect(commissionShipInputSchema.parse(input)).toEqual(input);
  });

  it('rejects an asking ship that is not a ship id', () => {
    expect(commissionShipInputSchema.safeParse({ name: 'login-flow', type: 'flagship', ownerOf: 'tech-lead', idempotencyKey: 'commission-login-flow' }).success).toBe(false);
  });

  it('accepts the owner argo picked for an app ship the gateway commissions (decision 0045)', () => {
    const input = { name: 'crm', type: 'crm', kind: 'app', owner: 'shp_01m3tbfspe96yf1rnr4ank0001', idempotencyKey: 'commission-crm' };

    expect(commissionShipInputSchema.parse(input)).toEqual(input);
  });

  it('rejects an owner that is not a ship id', () => {
    expect(commissionShipInputSchema.safeParse({ name: 'crm', type: 'crm', kind: 'app', owner: 'thomas', idempotencyKey: 'commission-crm' }).success).toBe(false);
  });

  it.each(['agent', 'person', 'app'])('accepts the kind %s', (kind) => {
    const input = { name: 'thomas', type: 'person', kind, idempotencyKey: 'commission-thomas' };

    expect(commissionShipInputSchema.parse(input)).toEqual(input);
  });

  it.each(['operator', 'viewer', 'robot'])('rejects the kind %s, which no commission makes', (kind) => {
    expect(commissionShipInputSchema.safeParse({ name: 'thomas', type: 'person', kind, idempotencyKey: 'commission-thomas' }).success).toBe(false);
  });

  it('takes the note as optional', () => {
    expect(commissionShipInputSchema.parse({ name: 'scout', type: 'reviewer', idempotencyKey: 'commission-scout' })).toEqual({
      name: 'scout',
      type: 'reviewer',
      idempotencyKey: 'commission-scout',
    });
  });

  it('drops whitespace around the note', () => {
    expect(commissionShipInputSchema.parse({ name: 'scout', type: 'reviewer', note: ' ahoy \n', idempotencyKey: 'commission-scout' })).toMatchObject({
      note: 'ahoy',
    });
  });

  it('accepts an idempotency key of 256 characters', () => {
    expect(commissionShipInputSchema.safeParse({ name: 'scout', type: 'reviewer', idempotencyKey: 'k'.repeat(256) }).success).toBe(true);
  });

  it('accepts a note of 500 characters', () => {
    expect(
      commissionShipInputSchema.safeParse({ name: 'scout', type: 'reviewer', note: 'a'.repeat(500), idempotencyKey: 'commission-scout' }).success,
    ).toBe(true);
  });

  it.each([
    ['a note over 500 characters', { name: 'scout', type: 'reviewer', note: 'a'.repeat(501) }],
    ['a missing type', { name: 'scout' }],
    ['a type that is not a handle', { name: 'scout', type: 'Code Reviewer' }],
    ['a name that is not a handle', { name: 'Scout', type: 'reviewer' }],
    ['no idempotency key', { name: 'scout', type: 'reviewer' }],
    ['an empty idempotency key', { name: 'scout', type: 'reviewer', idempotencyKey: '' }],
    ['an idempotency key over 256 characters', { name: 'scout', type: 'reviewer', idempotencyKey: 'k'.repeat(257) }],
  ])('rejects %s', (_label, input) => {
    expect(commissionShipInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('getStartingPromptInputSchema', () => {
  it('accepts a ship id', () => {
    const shipId = newId('ship');

    expect(getStartingPromptInputSchema.parse({ shipId })).toEqual({ shipId });
  });

  it('rejects an id of another kind', () => {
    expect(getStartingPromptInputSchema.safeParse({ shipId: newId('fleet') }).success).toBe(false);
  });
});

describe('startingPromptOutputSchema', () => {
  const output = {
    shipId: newId('ship'),
    prompt: 'Ship secret: aeolus_sk_v1_abc',
    crewLines: [
      { harness: 'claude-code', line: '/aeolus:crew https://fleet.example.com shp_01 aeolus_sk_v1_abc' },
      { harness: 'codex', line: '$aeolus-crew https://fleet.example.com shp_01 aeolus_sk_v1_abc' },
    ],
    secret: 'aeolus_sk_v1_abc',
  };

  it('accepts the ship id, the prompt, one crew line per harness, and the secret', () => {
    expect(startingPromptOutputSchema.parse(output)).toEqual(output);
  });

  it.each([
    ['a missing prompt', { ...output, prompt: undefined }],
    ['missing crew lines', { ...output, crewLines: undefined }],
    ['a crew line without its harness', { ...output, crewLines: [{ line: '/aeolus:crew' }] }],
    ['a missing secret', { ...output, secret: undefined }],
  ])('rejects %s', (_label, candidate) => {
    expect(startingPromptOutputSchema.safeParse(candidate).success).toBe(false);
  });
});

describe('commissionShipOutputSchema', () => {
  it('accepts a first commission with its prompt, crew lines and secret, and a repeat with none of them', () => {
    const first = {
      shipId: newId('ship'),
      prompt: 'Ship secret: aeolus_sk_v1_abc',
      crewLines: [{ harness: 'claude-code', line: '/aeolus:crew https://fleet.example.com shp_01 aeolus_sk_v1_abc' }],
      secret: 'aeolus_sk_v1_abc',
      startingPrompt: { issuedAt: '2026-10-04T09:00:00.000Z', isClaimed: false },
    };
    const repeat = { ...first, prompt: null, crewLines: null, secret: null };

    expect(commissionShipOutputSchema.parse(first)).toEqual(first);
    expect(commissionShipOutputSchema.parse(repeat)).toEqual(repeat);
  });
});

describe('releaseShipInputSchema', () => {
  it('accepts a ship id', () => {
    const shipId = newId('ship');

    expect(releaseShipInputSchema.parse({ shipId })).toEqual({ shipId });
  });

  it.each([
    ['an id of another kind', { shipId: newId('lease') }],
    ['a missing ship id', {}],
  ])('rejects %s', (_label, input) => {
    expect(releaseShipInputSchema.safeParse(input).success).toBe(false);
  });
});

describe('releaseShipOutputSchema', () => {
  it('is empty: the OK is the answer', () => {
    expect(releaseShipOutputSchema.parse({})).toEqual({});
  });
});

describe('fleetListOutputSchema', () => {
  /** The last page of fleet.list, holding the ships given. */
  function pageOf(items: unknown[]) {
    return { items, nextCursor: null };
  }

  it('answers a page of ships and the ship id the next page starts after (decision 4 of the performance design)', () => {
    const nextCursor = newId('ship');

    expect(fleetListOutputSchema.parse({ items: [], nextCursor })).toEqual({ items: [], nextCursor });
  });

  const ship = {
    id: newId('ship'),
    name: 'scout',
    type: 'reviewer',
    kind: 'agent',
    status: 'awaitingCrew',
    startingPrompt: { issuedAt: '2026-09-29T12:00:00.000Z', isClaimed: false },
    location: null,
    lastSeenAt: null,
    ping: null,
    scopes: ['messages:send', 'messages:receive'],
    report: null,
    crewRequest: null,
    labels: [],
    model: null,
    harness: null,
    awaitingCrewSince: '2026-09-29T12:00:00.000Z',
    retiredAt: null,
    ownerShipId: null,
  };

  it('accepts ships with their status and prompt state', () => {
    expect(fleetListOutputSchema.parse(pageOf([ship]))).toEqual(pageOf([ship]));
  });

  it('accepts a ship outside read reach by its name, type and status only, beside whole ones (decision 0034)', () => {
    const outside = { id: newId('ship'), name: 'vault', type: 'keeper', status: 'crewed', isInReadReach: false };

    expect(fleetListOutputSchema.parse(pageOf([ship, outside]))).toEqual(pageOf([ship, outside]));
  });

  it('tells a whole ship from one outside read reach', () => {
    const listed = fleetListOutputSchema.parse(pageOf([ship, { id: newId('ship'), name: 'vault', type: 'keeper', status: 'crewed', isInReadReach: false }]));

    expect(listed.items.map(isInReadReach)).toEqual([true, false]);
  });

  it('accepts a crewed ship with the location its session reported', () => {
    const crewed = {
      ...ship,
      status: 'crewed',
      startingPrompt: { ...ship.startingPrompt, isClaimed: true },
      location: { kind: 'OTHER', description: 'a ci runner' },
      lastSeenAt: '2026-09-29T12:05:00.000Z',
      awaitingCrewSince: null,
    };

    expect(fleetListOutputSchema.parse(pageOf([crewed]))).toEqual(pageOf([crewed]));
  });

  it('accepts a crewed ship with its current model, stated when, and the harness its session runs in', () => {
    const crewed = {
      ...ship,
      status: 'crewed',
      location: { kind: 'DEVICE', description: null },
      harness: 'claude-code',
      model: { id: 'claude-opus-5-5', statedAt: '2026-09-29T12:05:00.000Z' },
    };

    expect(fleetListOutputSchema.parse(pageOf([crewed]))).toEqual(pageOf([crewed]));
  });

  it.each([
    ['waiting for an answer', { state: 'waiting', sentAt: '2026-09-29T12:05:00.000Z', answeredAt: null }],
    ['answered with pong', { state: 'answered', sentAt: '2026-09-29T12:05:00.000Z', answeredAt: '2026-09-29T12:05:04.000Z' }],
    ['acknowledged, not answered with pong', { state: 'acknowledged', sentAt: '2026-09-29T12:05:00.000Z', answeredAt: null }],
  ])('accepts a crewed ship whose last ping is %s', (_label, ping) => {
    const pinged = { ...ship, status: 'crewed', ping };

    expect(fleetListOutputSchema.parse(pageOf([pinged]))).toEqual(pageOf([pinged]));
  });

  it('accepts a ship with its crew request: its settings version and when it was requested', () => {
    const requested = {
      ...ship,
      crewRequest: { settingsVersion: 2, requestedAt: '2026-09-29T12:05:00.000Z', assignedTo: { id: newId('ship'), name: 'mac-mini' }, status: 'running', reason: null, crewedBy: null, attempt: 0, startedAt: '2026-09-29T12:06:00.000Z', givenBack: [] },
    };

    expect(fleetListOutputSchema.parse(pageOf([requested]))).toEqual(pageOf([requested]));
  });

  it('accepts a crewed ship with its crew\'s last report and the version of its details', () => {
    const reporting = {
      ...ship,
      status: 'crewed',
      report: { state: 'blocked', note: 'waiting for review', reportedAt: '2026-09-29T12:05:00.000Z', detailsVersion: 1 },
    };

    expect(fleetListOutputSchema.parse(pageOf([reporting]))).toEqual(pageOf([reporting]));
  });

  it('accepts a retired ship with when it was retired', () => {
    const retired = { ...ship, status: 'retired', startingPrompt: null, awaitingCrewSince: null, retiredAt: '2026-09-30T08:00:00.000Z' };

    expect(fleetListOutputSchema.parse(pageOf([retired]))).toEqual(pageOf([retired]));
  });

  it('accepts a ship without a prompt out', () => {
    expect(fleetListOutputSchema.safeParse(pageOf([{ ...ship, startingPrompt: null }])).success).toBe(true);
  });

  it('accepts the operator ship by its kind', () => {
    const argo = { ...ship, name: 'argo', type: 'operator', kind: 'operator', status: 'crewed', startingPrompt: null };

    expect(fleetListOutputSchema.parse(pageOf([argo]))).toEqual(pageOf([argo]));
  });

  it.each([
    ['an unknown status', { ...ship, status: 'sailing' }],
    ['a prompt date that is not ISO 8601', { ...ship, startingPrompt: { issuedAt: 'today', isClaimed: false } }],
    ['a ship id of another kind', { ...ship, id: newId('fleet') }],
    ['a missing kind', { ...ship, kind: undefined }],
    ['an unknown kind', { ...ship, kind: 'commander' }],
    ['a missing location', { ...ship, location: undefined }],
    ['an unknown location kind', { ...ship, location: { kind: 'LAPTOP', description: null } }],
    ['a missing ping', { ...ship, ping: undefined }],
    ['a missing model', { ...ship, model: undefined }],
    ['a model stated at a time that is not ISO 8601', { ...ship, model: { id: 'claude-opus-5-5', statedAt: 'today' } }],
    ['a missing harness', { ...ship, harness: undefined }],
    ['missing scopes', { ...ship, scopes: undefined }],
    ['a missing report', { ...ship, report: undefined }],
    ['a ship without its crew request', { ...ship, crewRequest: undefined }],
    ['a crew request with a settings version of 0', { ...ship, crewRequest: { settingsVersion: 0, requestedAt: '2026-09-29T12:05:00.000Z', assignedTo: null, status: null } }],
    ['a crew request in an unknown status', { ...ship, crewRequest: { settingsVersion: 1, requestedAt: '2026-09-29T12:05:00.000Z', assignedTo: null, status: 'asleep' } }],
    ['a report without its details version', { ...ship, report: { state: 'idle', note: null, reportedAt: '2026-09-29T12:05:00.000Z' } }],
    ['a report in an unknown state', { ...ship, report: { state: 'sleeping', note: null, reportedAt: '2026-09-29T12:05:00.000Z' } }],
    ['an unknown scope', { ...ship, scopes: ['fleet:own'] }],
    ['an unknown ping state', { ...ship, ping: { state: 'lost', sentAt: '2026-09-29T12:05:00.000Z', answeredAt: null } }],
    ['a missing time since it awaits crew', { ...ship, awaitingCrewSince: undefined }],
    ['a missing retirement', { ...ship, retiredAt: undefined }],
    ['a retirement that is not ISO 8601', { ...ship, status: 'retired', retiredAt: 'yesterday' }],
    ['a time since it awaits crew that is not ISO 8601', { ...ship, awaitingCrewSince: 'today' }],
  ])('rejects %s', (_label, listed) => {
    expect(fleetListOutputSchema.safeParse(pageOf([listed])).success).toBe(false);
  });
});

describe('fleetEventsInputSchema', () => {
  it.each([{}, { lastEventId: null }, { lastEventId: '0' }, { lastEventId: '42' }])(
    'accepts %j: no position, or the number of the last event applied',
    (input) => {
      expect(fleetEventsInputSchema.parse(input)).toEqual(input);
    },
  );

  it.each(['', '-1', '4.2', 'evt_01', '1e3', '1234567890123456'])('rejects the position %j', (lastEventId) => {
    expect(fleetEventsInputSchema.safeParse({ lastEventId }).success).toBe(false);
  });
});

describe('fleetStreamItemSchema', () => {
  const event = {
    seq: 7,
    id: newId('event'),
    type: 'ShipClaimed',
    occurredAt: '2026-10-01T09:00:00.000Z',
    actorKind: 'ship',
    actorShipId: newId('ship'),
    actorAccountId: null,
    actorSignedInAccountId: null,
    shipId: newId('ship'),
    messageId: null,
    deliveryId: null,
  };

  it('takes the account signed in to the console as argo when argo caused it, by its id only (decision 0054)', () => {
    const signedIn = { kind: 'event', event: { ...event, actorSignedInAccountId: 'acc-01lena' } };

    expect(fleetStreamItemSchema.parse(signedIn)).toEqual(signedIn);
  });

  it('accepts an event with its number, type, time, the ship that caused it and what it concerns', () => {
    expect(fleetStreamItemSchema.parse({ kind: 'event', event })).toEqual({ kind: 'event', event });
  });

  it('accepts the word to load the fleet again', () => {
    expect(fleetStreamItemSchema.parse({ kind: 'resync' })).toEqual({ kind: 'resync' });
  });

  it.each([
    ['an unknown kind', { kind: 'snapshot' }],
    ['an event numbered 0', { kind: 'event', event: { ...event, seq: 0 } }],
    ['an unknown event type', { kind: 'event', event: { ...event, type: 'ShipSank' } }],
    ['a time that is not ISO 8601', { kind: 'event', event: { ...event, occurredAt: 'now' } }],
    ['no word on who caused it', { kind: 'event', event: { ...event, actorShipId: undefined } }],
  ])('rejects %s', (_label, item) => {
    expect(fleetStreamItemSchema.safeParse(item).success).toBe(false);
  });
});

describe('retireShipInputSchema', () => {
  it('takes the ship to retire', () => {
    const input = { shipId: newId('ship') };

    expect(retireShipInputSchema.parse(input)).toEqual(input);
  });
});

describe('retireShipOutputSchema', () => {
  it('answers how many deliveries the retire abandoned', () => {
    expect(retireShipOutputSchema.parse({ abandonedDeliveries: 2 })).toEqual({ abandonedDeliveries: 2 });
  });
});

describe('recrewShipInputSchema', () => {
  it('takes the crewed ship to give a new crew', () => {
    const input = { shipId: newId('ship') };

    expect(recrewShipInputSchema.parse(input)).toEqual(input);
  });
});

describe('renameShipInputSchema', () => {
  it('takes the ship and its new name', () => {
    const input = { shipId: newId('ship'), name: 'lookout' };

    expect(renameShipInputSchema.parse(input)).toEqual(input);
  });

  it('takes a name of 48 characters and refuses 49', () => {
    const shipId = newId('ship');

    expect(renameShipInputSchema.safeParse({ shipId, name: 'a'.repeat(48) }).success).toBe(true);
    expect(renameShipInputSchema.safeParse({ shipId, name: 'a'.repeat(49) }).success).toBe(false);
  });

  it('refuses a name that is no handle', () => {
    expect(renameShipInputSchema.safeParse({ shipId: newId('ship'), name: 'Look Out' }).success).toBe(false);
  });
});

describe('pingStateSchema', () => {
  it.each(['waiting', 'answered', 'acknowledged', 'undeliverable'])('accepts the ping state %s', (state) => {
    expect(pingStateSchema.safeParse(state).success).toBe(true);
  });
});

describe('fleetLimitsOutputSchema', () => {
  it("gives the fleet's ship and daily message limits with what each counts, and when today's count starts again", () => {
    const limits = {
      ships: { limit: 10, count: 7 },
      dailyMessages: { limit: 1000, count: 12, resetsAt: '2026-10-05T00:00:00.000Z' },
    };

    expect(fleetLimitsOutputSchema.parse(limits)).toEqual(limits);
  });

  it('gives no limit as null', () => {
    const limits = { ships: { limit: null, count: 7 }, dailyMessages: { limit: null, count: 12, resetsAt: '2026-10-05T00:00:00.000Z' } };

    expect(fleetLimitsOutputSchema.parse(limits)).toEqual(limits);
  });
});
