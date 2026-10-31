import { describe, expect, it } from 'vitest';

import {
  ALERT_BODY_MAX_BYTES,
  ALERT_HEADLINE_MAX_LENGTH,
  ALERT_PAYLOAD_MAX_BYTES,
  ALERT_SIGNALS,
  alertMessageSchema,
  raiseAlertInputSchema,
} from './alert.js';

// The alert message's contract (docs/design/monitoring, 4.9) and what
// fleet.raiseAlert takes (4.5): the watch and every reader share them.

const SHIP_ID = 'shp_01m66p4k2v9qz8f7x3n5c14ftc';
const SETTER_ID = 'shp_01m66p4k2v9qz8f7x3n5c1or1x';

// The design's example, to the owner (4.9).
const EXAMPLE = {
  alertId: 'alt_01m66p4k2v9qz8f7x3n5c1b0td',
  headline: 'merger-1: report unchanged 3 h 10 min, expected within 60 min',
  body: 'merger-1 reports **working**, *Merging to main*, PR #1391 step 2 of 3, unchanged since 12:05.\n\nExpected within 60 min, set by orchestrator-1. Clears by itself when the report changes.',
  signal: 'report-unchanged',
  ship: { id: SHIP_ID, name: 'merger-1' },
  fleetId: 'flt_01m66p4k2v9qz8f7x3n5c17acm',
  toldAs: 'owner',
  since: '2026-10-30T12:05:00Z',
  raisedAt: '2026-10-30T13:05:20Z',
  facts: { reportChangedAt: '2026-10-30T12:05:00Z', state: 'working', minutes: 60, setBy: SETTER_ID },
};

const DELIVERY = { deliveryId: 'dlv_01m66p4k2v9qz8f7x3n5c1dlv1', messageId: 'msg_01m66p4k2v9qz8f7x3n5c1msg1' };

describe('the alert signals (docs/design/monitoring, 4.4)', () => {
  it('are the four distribution signals and the two expectations, nothing else', () => {
    expect(ALERT_SIGNALS).toEqual(['crew-request-unassigned', 'delivery-unacknowledged', 'delivery-overdue', 'ping-unanswered', 'report-unchanged', 'task-not-done']);
  });
});

describe('alertMessageSchema (docs/design/monitoring, 4.9)', () => {
  it("takes the design's example", () => {
    expect(alertMessageSchema.parse(EXAMPLE)).toEqual(EXAMPLE);
  });

  it(`takes a headline of ${String(ALERT_HEADLINE_MAX_LENGTH)} characters and refuses one more, or none`, () => {
    expect(alertMessageSchema.safeParse({ ...EXAMPLE, headline: 'a'.repeat(ALERT_HEADLINE_MAX_LENGTH) }).success).toBe(true);
    expect(alertMessageSchema.safeParse({ ...EXAMPLE, headline: 'a'.repeat(ALERT_HEADLINE_MAX_LENGTH + 1) }).success).toBe(false);
    expect(alertMessageSchema.safeParse({ ...EXAMPLE, headline: '' }).success).toBe(false);
  });

  it('refuses a body over 2 KB', () => {
    expect(alertMessageSchema.safeParse({ ...EXAMPLE, body: 'a'.repeat(ALERT_BODY_MAX_BYTES) }).success).toBe(true);
    expect(alertMessageSchema.safeParse({ ...EXAMPLE, body: 'a'.repeat(ALERT_BODY_MAX_BYTES + 1) }).success).toBe(false);
  });

  it('refuses a payload over 8 KB', () => {
    expect(ALERT_PAYLOAD_MAX_BYTES).toBe(8 * 1024);
    const reason = 'a'.repeat(ALERT_PAYLOAD_MAX_BYTES);
    const unassigned = { ...EXAMPLE, signal: 'crew-request-unassigned', facts: { settingsVersion: 2, minutes: 15, reason } };

    expect(alertMessageSchema.safeParse(unassigned).success).toBe(false);
  });

  it('tells the owner and the setter apart, nobody else', () => {
    expect(alertMessageSchema.safeParse({ ...EXAMPLE, toldAs: 'setter' }).success).toBe(true);
    expect(alertMessageSchema.safeParse({ ...EXAMPLE, toldAs: 'argo' }).success).toBe(false);
  });

  it("refuses facts that are not its signal's", () => {
    expect(alertMessageSchema.safeParse({ ...EXAMPLE, signal: 'ping-unanswered' }).success).toBe(false);
  });
});

describe('raiseAlertInputSchema (docs/design/monitoring, 4.5)', () => {
  const raise = { shipId: SHIP_ID, occurrenceKey: DELIVERY.deliveryId, since: '2026-10-30T14:31:00Z' };

  it.each([
    ['crew-request-unassigned', { settingsVersion: 2, minutes: 15, reason: 'model disabled: claude-fable-5-1' }],
    ['crew-request-unassigned', { settingsVersion: 1, minutes: 15, reason: null }],
    ['delivery-unacknowledged', { ...DELIVERY, state: 'pending', awaitingCrew: true, minutes: 15 }],
    ['delivery-overdue', { ...DELIVERY, overdueEventId: 'evt_01m66p4k2v9qz8f7x3n5c1evt1' }],
    ['ping-unanswered', { ...DELIVERY, minutes: 10 }],
    ['report-unchanged', { reportChangedAt: '2026-10-30T12:05:00Z', state: 'blocked', minutes: 60, setBy: SETTER_ID }],
    ['task-not-done', { task: { kind: 'url', url: 'https://github.com/ThomasHendrickx/aeolus-fleet/pull/1391' }, doneBy: '2026-10-30T18:00:00Z', setBy: SETTER_ID }],
  ])('takes %s with its facts', (signal, facts) => {
    expect(raiseAlertInputSchema.parse({ ...raise, signal, facts })).toEqual({ ...raise, signal, facts });
  });

  it('refuses a signal it does not know', () => {
    expect(raiseAlertInputSchema.safeParse({ ...raise, signal: 'disk-full', facts: {} }).success).toBe(false);
  });

  it('refuses facts with a field missing', () => {
    expect(raiseAlertInputSchema.safeParse({ ...raise, signal: 'ping-unanswered', facts: { ...DELIVERY } }).success).toBe(false);
  });

  it('refuses an empty occurrence key, and one over 200 characters', () => {
    const facts = { ...DELIVERY, minutes: 10 };

    expect(raiseAlertInputSchema.safeParse({ ...raise, signal: 'ping-unanswered', facts, occurrenceKey: '' }).success).toBe(false);
    expect(raiseAlertInputSchema.safeParse({ ...raise, signal: 'ping-unanswered', facts, occurrenceKey: 'a'.repeat(201) }).success).toBe(false);
  });
});
